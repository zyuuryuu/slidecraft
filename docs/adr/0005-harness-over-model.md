# ADR-0005: harness-over-model ＋ 自動修復ループ（distill/refine）

- **Status**: Accepted
- **Date**: 2026-06（テーマ確立は 2026-06-18／閉ループ本体 4b05a58・7f3884a で実装）

## Context

- フロンティア API への依存は、製品を「薄い AI ラッパー」に堕とす：コモディティ化・課金・データ流出・オフライン不可。durable value はモデルではなくエンジン/ハーネス側にある（[[product_philosophy_harness]]、ユーザ宣言の project-wide 優先事項 2026-06-18）。
- 一方で本ツールの正体は content 生成器ではなく **「最後の一マイル」ハーネス**＝上流の台本 Markdown ＋テンプレートを受け、整形/入力/微調整する distill。コア価値は**テンプレを尊重したまま**情報過多な原稿をインパクトある形に蒸留すること（4 レバー：分割/凝縮/可視化/整形、フォント縮小は禁止）([[tool_role_last_mile]])。
- ROADMAP「①③の交点」で、テーマ①(AI 一体化)と③(原稿→マスター整形)は別物でなく **「ハーネスが AI を方向づける反復ループ」に収束**すると整理された。診断は人が直す材料ではなく、上流 AI に返すフィードバック信号として使う。

## Decision

- **知能はエンジン/ハーネスに置き、モデルには置かない**。レイアウト選択・DSL 生成・構造化は `autoSelectLayout`/engine が決定論で担い、モデルの仕事は狭いスロット埋めと判断（意味的な分割点・パンチの効いた言い回し・どこを強調するか）に縮める。ローカル/小型モデルでも「ほぼ」成立することを目標にする。
- **閉ループ（generate → diagnose → 決定論レバー → AI 残余 → 再診断 → 収束）** を実装する。各段の役割を固定：
  - **A. フィードフォワード**：生成前にテンプレ容量/kind/文字・行予算を AI へ渡す（粗く実装）。
  - **B. 診断（非破壊）**：`diagnoseDeck` が課題＋推奨 `Lever`（split/condense/visualize/title）を提示するのみで**変形しない＝差し戻し**（`deck-diagnostics.ts`）。
  - **C. 自動修復（Lv3）**：`refineDeck`（`refine.ts`）が、まず**決定論レバー**で直せる物を直し（visualize→ネイティブ表、split は parse 時に自動）、**残余だけ** AI（condense/title）へ回し、再診断して反復収束。
- **3 段階強度に明示的に紐付ける**：Lv1=診断のみ（flag、変形しない）／Lv2=＋決定論／Lv3=＋AI。distill の物語の一部とし、独立機能にしない。
- **AI 出力を信用しすぎない**：返り Markdown は `parseMd` を通し、空/同一/失敗は採用しない。slide-fix の instruction は**行や事実を丸ごと削除させない**ガードを明文化（過去の「丸ごと Omit」是正、298832c）。
- **「制約＋診断 ⇄ AI」を再利用可能なコントラクト（feedback packet）として実装**：`slide-fix.ts` の `SlideFix`/`slideFixRequest`。`refineDeck` は AI を**注入**（`AiSlideFix`）するため純ロジックでテスト可能。同じ契約を in-app ループ・バッチ編集（`batchEditDeck`）・将来の **D. MCP** が**再露出だけで再利用**する（作り直し不要）。
- **収束・コスト保証**：問題スライドのみ対象、per-slide で安価に、no-progress 停止＋反復上限（`maxIterations` 既定 6）、AI 失敗は retryable のみ上限付き再試行、cancelled は即停止。
- **変更は無言で適用しない**：`RefineResult.changes` に before→after と決定論/AI 種別を残し、UI（ReviewBar/RefineProposal）でレビュー後に採用（1 undo）。

## Consequences

- 弱いモデルでも format に乗りやすく、token 安い per-slide スコープ（「このスライドだけ」）が中心に残る。全デッキ再生成の高コストを回避。
- C を正しく作れば D（MCP/外部化）は**契約の再露出**で済む。複数 AI 呼び出しが要るため AI タスク管理（履歴/並列/キャンセル）がこの機能で必要化（[[backlog_ai_request_mgmt]] 連動）。
- **やってはいけない（do-NOT-undo）**：
  - placeholder のフォントを content に合わせて自動縮小しない（テンプレ typography を破壊。過去にユーザが REVERT 済み）。Overflow は distill（分割/凝縮/可視化）で解く。
  - 上流の SUBSTANCE（何を言うか・新主張）には踏み込まない。ツールは PRESENTATION（どう伝えるか）のみ。
  - 「ワンクリック再生成ボタン」として作らない（構造化コントラクトとして作る）。
  - `refineDeck` の AI 注入設計（純ロジック）を壊さない＝engine に DOM/Tauri/AI 呼び出しを持ち込まない（R2）。
  - 診断 Lv1 を変形させない（差し戻しの性質を保つ）。
- 受け入れたトレードオフ：A フィードフォワードは粗いまま／逐次反復のため per-slide 並列化は同パス内のみ／D は将来。

## References

- 設計：`docs/ROADMAP.md`（「①③の交点 — Harness-directed AI loop」A–D 表、設計原則1–3）
- コード：`src/engine/distill.ts`（`distillDeck`/`splitSlideToFit`/`packParagraphs`/`contentBodyBox`）、`src/engine/refine.ts`（`refineDeck`/`batchEditDeck`/`AiSlideFix`）、`src/engine/deck-diagnostics.ts`（`diagnoseDeck`/`Lever`）、`src/engine/slide-fix.ts`（`SlideFix`/`buildSlideFix`/`slideFixRequest`）、`src/engine/slide-rewrite.ts`（`visualizeKeyValueMd`）
- 開発メモリ：[[product_philosophy_harness]]、[[tool_role_last_mile]]、[[backlog_ai_request_mgmt]]、[[editing_two_stage]]
