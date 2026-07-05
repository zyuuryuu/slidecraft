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

- **P1（本 ADR で実装）＝ 図コンテンツの ops 化**：`DiagramEditOp`（`nodeUpdate`/`edgeUpdate`/`addNode`/`removeNode`/`addEdge`/`removeEdge`/`setDirection`）→ `applyDiagramEditOps`（`applyToFigure` 再利用・drift ゼロ）。
  - **実装知見**：`diagram-edit` モード（`diagramEditSystemPrompt`）は**実 UI から未起動＝dead**（生成呼び出しは `slide`〔AiPanel〕と `diagram`〔LlmAssist・新規生成〕のみ）と判明。よって live な**スライド編集プロンプト `slideMarkdownEditPrompt` の (B) ops ブランチ**（既に design ops を提示）に**図コンテンツ ops を追加**し、apply/preview（`handleApplySlide`/`previewSlideEdit`）は **`parseDiagramEditOps`→`parseDesignIntent`→Markdown** の順で**出力フォーマットにより判別**（モード非依存）。図コンテンツ変更は (A) Markdown 内でフェンス全体を再出力する経路（drift 源）から (B) ops に誘導。効かない op は `editNotice` で報告。
- **P2** placeholder テキスト ops（`applyFieldEdit` 即利用）／**P3** chart/table/gantt ops（series/cards/tasks/cell）／**P4** refine・batch 経路へ配線＋delta 成功率テレメトリ。

#### ① 自己修復（単発リテイク・Option A）＝2026-07-05 実装

実機テストで、L5 プロンプト後も弱モデルは図編集で **(A) 全文へ逸れて drift → reconcile 原状復帰 → 意図喪失**する回が残った（L4 で*見える*が*直って*はいない）。これを**決定論トリガの単発リテイク**で埋める（ユーザ選択＝Option C の A 部分・発火は自動）：

- **トリガ（決定論）**：`previewSlideEdit` が「図持ちスライド ∧ 全文フォールバックで drift（`figureFallbackTag` 発火）」を検出したら `shouldRetry:true` ＋ **harness 生成の ops-bias nudge**（`buildOpsRetryInstruction`＝元指示＋**実ノードid列挙**＋「全文 Markdown 禁止・ops 配列のみ・数値/言語保持」・純粋 R2）を返す。
- **自動発火・1回だけ**：`AiPanel` が `useEffect` で検出→`ai.retry`（`useAiGeneration`・enqueue/runTask 再利用・タスク名「🔁 opsで再生成」）。**ref ガードで user generate ごとに最大1回**（2回目の drift は `[全文フォールバック]` タグ付き結果を出すだけ＝ループしない）。透明バナー表示。
- **bound（ADR-0018 の auto-repair 懸念に正対）**：トリガは HARD drift かつ図スライド時のみ・上限1回・**採用ゲート不変（最終は必ず人が採用/却下）**。生成自体は非決定論だがトリガと nudge 本文は完全決定論。`--parallel 1` は不変。
- **前提修正（同梱）**：`applyDiagramEditOps` に `dirty` フラグ＝実質 no-op（不在idの removeNode 等）は元スライドを byte-identical で返す。再ダンプ（`yaml.dump` は書式非同一）による偽 `-0+1` diff／無言リフォームを防ぎ、偽 drift による空振りリトライも塞ぐ。

#### ① best-of-N（Option B・単一スライド編集）＝2026-07-05 実装

Option A（単発リテイク）でも弱モデルは複雑な構造編集で取りこぼす（実機 ②「pay→paygw を消さず並列に不正検知を追加」＝不完全な張り替え）。**複数候補から採用ゲートで最良を拾う** best-of-N を単一スライド編集に実装：

- **N候補生成**：`useAiGeneration.generateBest(prompt, mode, n)` が N世代を `Promise.all` で fan-out。`generateWithAI` は per-call 純関数なので外部APIは真の並列、内蔵は llamafile のスロット数に応じ直列/並列。cancel は fan-out 全体を中断。
- **決定論採点＋選別**：`AiPanel` が各候補を**採用ゲート**（`previewSlideEdit`/`reconcileSlideEdit` の warnings 数＋全文ドリフトに大ペナルティ）でスコア化し**最良を preselect**。候補ピッカー（◀ n/N ▶・✓/⚠k）で人が見比べ→採用。**採用ゲート不変・最終は人**。選別は決定論、生成N本のみ非決定論。
- **N は設定・HARD clamp [1,5]**（`clampBestOfN`・`MAX_BEST_OF_N=5`・永続化）。誤って 100 等でも暴走ファンアウトしない（ユーザ要望のガードレール）。N=1 で無効＝Option A（自動リテイク）に戻る（N>1 時は自動リテイク停止＝best-of-N が品質レバー）。
- **内蔵ランタイム＝RAM 連動**（ユーザ選択「RAM見て自動」）：`local_ai.rs` `choose_parallel` が空きRAMで `--parallel N`（余裕あれば最大3・`-c`=8192·N で各スロット8K維持）、tight なら 1スロット/8K にフォールバック（**OOM を絶対に招かない**保守見積り＝weights〔gguf サイズ〕＋N·KV〔2GB/slot〕＋margin）。外部API は常に真の並列。
- **将来**：whole-deck refine への展開（refine.ts の aiFix を N候補+選別に）。開発メモリ `backlog_ai_edit_efficiency`。

#### P1 実機テスト由来の補強（2026-07-05・弱モデル granite-4.1-8b で観測）

実機で2つの実害を確認し、**決定論・採用ゲート不変**の範囲で塞いだ（プロンプト側の判定強化＝L5 はユーザ承認の上で適用済み）：

- **削除の的外し（T4a）**＝「存在しない Cache を削除」に弱モデルが近い `redis` を幻覚マッチ→`removeEdge api→redis` を出す。ops は**形状**しか検証しないため素通り。**`checkDeleteIntent(slide, ops, instruction)`**（`diagram-edit-ops.ts`・純粋 R2・指示文は文字列引数）を追加：削除対象の id/label が**指示文に出てこない**削除を**アドバイザリで告知**（NFKC＋部分一致・1文字idは無効化・**採用は止めない**）。
- **ops パスの可観測性（L3）**：`previewSlideEdit` の ops 分岐は従来 `warnings:[]`＝図 diff のみだった → skipped＋delete アドバイザリを **warnings に載せ**、`removeNode`/`removeEdge`/`edgeUpdate` の skip メッセージに**候補一覧**を付す（Markdown パスと同等の情報量に）。
- **全文フォールバックの透明化（L4）**＝図スライドの編集が (B) ops でなく (A) 全文で返り drift→原状復帰した際、`変更なし` が不透明。**`figureFallbackTag(hadFigure, warnings)`**（`ai-apply.ts`）で「図の部分編集として解釈できず全文再構成→ずれ検出」タグを前置（drift 時のみ・良性のテキスト編集は非対象）。
- **L5 プロンプト判定強化（T2/T4a を源で減）**：`slideMarkdownEditPrompt` の (A)/(B) セレクタを書き直し — 「既存図のノード/エッジ増減も (A) 全文へ」と読める衝突を解消し、弱モデルを決定論 ops から遠ざけていた**「迷ったら (A)」を撤去**して**「既存図の変更は (B) 優先」**に。加えて (B) に**削除の安全則**（`removeNode`/`removeEdge` は指示の id を厳密に・図に無くても engine が skip＋報告するので**近い id に置換するな**）＋**削除 few-shot**（`[{"op":"removeNode","id":"cache"}]`）。プロンプトは確率的で保証ではない（弱 8B は依然揺れうる）ため L2〜L4 の決定論ガードの**補完**と位置づけ。
- **見送り**：ops 検出の prose 許容拡大（L1）は既存の regression ガード `apply-routing.test.ts`（#3C＝prose 内の ops 配列で Markdown を破棄しない）と衝突し、かつ観測された T2 失敗は「(A) 全文選択」であって「prose 巻き ops の誤ルーティング」ではないため**却下**（R6：根本は L5 のプロンプト判定）。

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
