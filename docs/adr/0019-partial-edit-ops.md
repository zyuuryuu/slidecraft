# ADR-0019: AI 単一スライド編集は「構造化編集 ops → 決定論マージ」（部分生成）

- **Status**: Accepted
- **Date**: 2026-07-05
- **関連**: [ADR-0012](0012-ai-edit-structure-preservation.md)（構造保全）・[ADR-0018](0018-validation-at-adoption-gate.md)（採用ゲート）を **supersede せず補追**

## Context

単一スライドの AI 編集は現状**全文再生成**：`slide` モードは「スライド**全文を Markdown で**返せ」（`deck-plan-prompts.ts` `slideMarkdownEditPrompt`）、`diagram-edit` モードは「他は保て、**でも図全体の DiagramSpec を**返せ」（`diagram-type-prompts.ts` `diagramEditSystemPrompt`・**内在矛盾**）。

これが2つの根本問題を生む：

1. **drift の源**：変更していないフィールド（ノード ID・未編集ラベル・数値・スタイル・言語）まで再出力するため、1 行ごとに数値/言語 drift の可能性。[ADR-0012](0012-ai-edit-structure-preservation.md) の reconcile＋validate はこれを**検出**するが、**発生自体は止められない**（warnings が出続ける根本原因）。
2. **遅い**（特にオフライン）：出力トークンが編集規模に無関係に「スライド/図の全量」。弱い内蔵モデル（〜3B）では致命的。

一方、**Stage②（design）の `apply_design_intent` は既にこの正解形**を実装している：モデルは小さな **ops 配列**（`regionSplit`/`emphasize`/`relayout`）だけを出し、エンジンが `applyToFigure`（生 YAML を部分ミューテート→`dumpDiagramLikeSource` で無損失 re-dump）で決定論的に反映する。placeholder テキストも `applyFieldEdit`（idx-keyed マージ・[ADR-0011](0011-placeholder-input-bijection.md)）という決定論マージ基盤が既にある。

## Decision

**AI 編集を「変更フィールドのみの構造化 ops」出力に絞り、エンジンが決定論的にマージする。** `apply_design_intent` の ops→`applyToFigure` パターンを **content 編集にも一般化**する。

- **ops → 決定論マージ**：モデルは編集で**変更した箇所だけを ops 配列**で出力（例 `[{op:"nodeUpdate",id:"db",label:"PostgreSQL"}]`）。エンジンは該当フィールドのみ差し替え、**残りは verbatim**（drift ゼロ・最速）。マージは既存基盤の再利用：図は `applyToFigure`、テキストは `applyFieldEdit`、表は 2D セル差し替え。
- **full-regen フォールバック**：ops を出せない弱モデルは従来の全文 Markdown/図 YAML を返す → 既存パス（`reconcileSlideEdit`/`applyFigureYaml`）が受ける。判別は `parseDesignIntent` と同型（whole-string JSON ops 配列か否か）。**追加式・既存パス温存・後方互換**。
- **採用ゲートは不変**（[ADR-0018](0018-validation-at-adoption-gate.md)）：検証はマージ**結果**の SlideIR に対して走る（ops フォーマットではなく）。プレビュー＋warnings＋採用/却下の流れはそのまま。**描画は止めない。**
- **skip は never-silent**：未知 node id 等で効かなかった op は `SkippedOp` で報告（`applyDesignIntentReport` と同じ・`editNotice`）。無言のデータ喪失を作らない。
- **コアスキーマ不変（R4 非該当）**：`schema.ts`（DiagramSpec/Node/Edge）・`slide-schema.ts`（SlideIR）は不変。増えるのは **ops 入力語彙のみ**（`DiagramEditOp` 等・非保存の中間フォーマット・DesignIntent と同格）。

### 段階導入

- **P1（本 ADR で着手）＝ diagram-edit の ops 化**：文書化された最大の drift 源。`DiagramEditOp`（`nodeUpdate`/`edgeUpdate`/`addNode`/`removeNode`/`addEdge`/`removeEdge`/`setDirection`）→ `applyDiagramEditOps`（`applyToFigure` 再利用）。プロンプトを「FULL 返せ」→「変更 ops のみ」に。
- **P2** placeholder テキスト ops（`applyFieldEdit` 即利用）／**P3** chart/table/gantt ops（series/cards/tasks/cell）／**P4** refine・batch 経路へ配線＋delta 成功率テレメトリ。

## Consequences

- **未変更フィールドは再出力されない＝変わらない**（drift は op した箇所のみに局在）。オフラインでも高速（出力トークンが編集規模に比例）。
- **既存テスト温存**：全 regen パスは fallback として維持。`applyToFigure`/`applyFieldEdit`（テスト済）を再利用し、新規 delta テストを追加。
- **弱モデル安全**：ops が `safeParse` 落ち→全文フォールバック（破壊なし）。skip は報告（無言ドロップ無し）。
- **do-NOT-undo**：ops は**中間フォーマット**（非保存）・コアスキーマ不変／検証はマージ結果に対して（ops に対してではない）＝採用ゲート不変／fallback を消さない（弱モデル対応の生命線）。
- 将来：warnings→自己修復ループ（[[backlog_ai_edit_efficiency]]・次の一手）と直交して積める。

## References

- コード：`src/engine/design-intent.ts`（`applyToFigure`・`applyDesignIntentReport`・`SkippedOp`＝雛形）・`src/engine/diagram-edit-ops.ts`（新・`DiagramEditOp`/`applyDiagramEditOps`/`parseDiagramEditOps`）・`src/engine/placeholder-binding.ts`（`applyFieldEdit`）・`src/engine/ai-apply.ts`（`applyFigureYaml`/`previewFigureEdit`・fallback）・`src/engine/diagram-type-prompts.ts`（`diagramEditSystemPrompt`）
- 関連 ADR：[ADR-0012](0012-ai-edit-structure-preservation.md)・[ADR-0018](0018-validation-at-adoption-gate.md)・[ADR-0011](0011-placeholder-input-bijection.md)・[ADR-0005](0005-harness-over-model.md)（harness-over-model）
- 開発メモリ：`backlog_ai_edit_efficiency`（部分生成を先に＝drift を源で断つ）・`product_philosophy_harness`・`editing_two_stage`
