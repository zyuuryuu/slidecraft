# ADR-0018: AI 編集の検証は「採用ゲート」に置く（描画は止めない）

- **Status**: Accepted（[ADR-0012](0012-ai-edit-structure-preservation.md) を **supersede せず補追**）
- **Date**: 2026-07-04（PR #68・commit `7db4447`）

## Context

[ADR-0012](0012-ai-edit-structure-preservation.md) で「reconcile+validate を全適用経路に」置いた。だが検証結果（数値/言語 drift・構造欠落の advisory）を **適用の後** に `parseError` へ流していた。`SlidePreview` は `parseError`（=`error`）を受けると **プレビュー描画をエラーボックスに差し替える**（`SlidePreview.tsx` の `{error ? <box> : <preview>}`）。

結果、granite が有効な gantt 編集を出し reconcile で問題なく適用できたのに、付随する軽微な drift advisory が `parseError` に入って **採用済みの正しいスライドが空白＋「Error」表示** になった。ユーザ報告＋強い是正要求：

> 「AI による生成物に問題があれば **採用しない** ことであって、適用したものに問題がないのに **描写しない** なんてのはまったく想定外」

根本＝「**採用しない**（生成物を却下する）」と「**描画しない**（表示を止める）」の混同。検証は前者に効くべきで、後者を起こしてはならない。これは [ADR-0012](0012-ai-edit-structure-preservation.md) の「決定論ガードを適用パスに」という決定が **どこで走り・何を止めてよいか** を規定していなかった隙。

## Decision

**検証は採用ゲート（採用前レビュー時）で走らせ、描画は絶対に止めない。**

- **`reconcileSlideEdit(old, rawMd)`（`ai-apply.ts`・engine 純粋）** を新設：採用前に (1) 壊れた図は落として old の有効な図を carry、(2) `reconcileEdit` で構造復元、(3) `validateStructure`/`validateCondense` で drift を検出し、**常に有効・描画可能な reconciled スライド＋人間可読 `warnings`** を返す。`null` は AI 出力が slide に parse できない時のみ。
- **`previewSlideEdit(raw)`（`useDeckController`）** が採用前に reconciled 結果＋`warnings` を計算 → `AiPanel` の「**変更プレビュー（採用前に確認）**」が **`DiffView`（reconciled after）＋ amber warnings バナー** を出す。人が warnings を見て **採用/却下** を決める。
- **採用（`handleApplySlide`）はクリーンにコミット**：`reconcileSlideEdit(old, raw)` → `handleSlideUpdate(rec.slide, "commit")`。適用後の検証・ブロックは無い。**採用済みは常に有効＝常に描画**。
- **非破壊の advisory 経路を分離**：design-op skip 等の助言は `parseError` ではなく **`editNotice`**（`SlidePreview` の `{notice && !error}` amber バナー＝**描画を差し替えない**）。`parseError` は真の parse 失敗（Initialize に留まるべき状態）専用に戻す。
- **弱モデル floor を前段に**：`sanitizeSlideEditOutput`（`edit-sanitize.ts`）が `(A)/(B)` ラベル・echoed `"Instruction:"`・trailing prose を reconcile/diff の前に除去（[ADR-0005](0005-harness-over-model.md) のオフライン floor）。

## Consequences

- 「有効な編集を採用したらプレビューが空白」バグは **構造的に消える**（検証は描画を差し替えない）。回帰は `tests/ai-apply-reconcile.test.ts` で固定（数値変化→advisory・clean rephrase→warnings 空・title drop→復元 advisory、いずれも slide は valid のまま描画可能）。
- ユーザは「**何が変わるか（diff）＋何が引っかかったか（warnings）**」を採用前に見て決められる（採用 ≠ 無検証、描画 ≠ 検証結果）。
- 全 1007 tests green（PR #68 時点）・schema 変更なし。
- **do-NOT-undo**：
  - 検証 advisory を `parseError`（=描画差し替え）に流さない＝採用済みを空白化しない。
  - 採用後に検証してブロックしない（検証は採用ゲートで）。
  - `reconcileSlideEdit` は「**常に有効な slide を返す**」契約を保つ（壊れた図は old を carry）。
  - `editNotice`（非破壊）と `parseError`（破壊的＝真の parse 失敗のみ）を混同しない。
- 補追の関係：[ADR-0012](0012-ai-edit-structure-preservation.md) を **supersede しない**（reconcile+validate を全経路に、の決定は生きている）。本 ADR はその「**どこで**検証し・検証は**何を止めてよいか**（採用は止める・描画は止めない）」を明確化する補追。
- 将来拡張：warnings を AI に自動フィードバックして再生成する **自己修復ループ** は backlog（`backlog_ai_edit_efficiency`）。本 ADR の warnings がそのフィードバック信号になる。

## References

- コード：`src/engine/ai-apply.ts`（`reconcileSlideEdit`）・`src/engine/edit-sanitize.ts`（`sanitizeSlideEditOutput`）・`src/components/useDeckController.ts`（`handleApplySlide`/`previewSlideEdit`/`editNotice`）・`src/components/AiPanel.tsx`（`editPreview`・warnings バナー）・`src/components/SlidePreview.tsx`（`notice` vs `error` 分岐）・`tests/ai-apply-reconcile.test.ts`
- 関連 ADR：[ADR-0012](0012-ai-edit-structure-preservation.md)（構造保全＝本 ADR が補追）・[ADR-0005](0005-harness-over-model.md)（harness-over-model）・[ADR-0011](0011-placeholder-input-bijection.md)（placeholder 全単射）
- 開発メモリ：`backlog_ai_edit_efficiency`（自己修復ループ）・`feedback_verify_real_output`・`product_philosophy_harness`
