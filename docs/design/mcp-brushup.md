# MCP ブラッシュアップ 設計（テーマ3）

> 上流 AI（Claude Code 等）が MCP 経由でこのデッキを編集する体験を底上げする。
> ADR＝[../adr/0015-mcp-brushup.md](../adr/0015-mcp-brushup.md)、ユーザ向けガイド＝[../mcp-server.md](../mcp-server.md)。

北極星は [ADR-0009](../adr/0009-p2-collab-host.md) の協働ホストモデル（GUI がホスト・上流 AI が Tools で編集・
人はライブ確認）。AI の面は **Tools のみ**なので、Tools の質＝この協働体験の質になる。

---

## 背景 — 監査（2026-07-04）

現行サーフェス（[server.ts](../../src/mcp/server.ts) / [session.ts](../../src/mcp/session.ts) 実読）＝
18 deck tools ＋ host 専用ライフサイクル（list/select/close/undo/redo）＋ `deck://` リソース。

5レンズ（フィードバック設計 / サーフェス完全性 / 重複・命名 / read 粒度 / エラー契約）＋各提案の敵対検証で
**35 findings**。7 件が P1（全て schema-safe・重複なし・any-template-safe）。柱は3つ：

- **T1 適切な粒度の高品質フィードバック** — mutation の戻りを「ok/error」から「何が変わったか＋診断＋
  次の一手ヒント」へ。#12（違反 notices）/ #13（skipped op を候補 id つきで報告）の思想を全 tool へ横展開。
- **T2 提供機能の全面見直し** — 構造操作・図/表/レイアウト直接操作・read の過不足を監査。重複/紛らわしさの整理。
- **T3 自己記述オーサリング契約＋テンプレ discovery**（ユーザ insight 2026-07-04・**最優先**）— 上流 AI が
  ①テンプレを調達（提出/選択/作らせる）→ ②Markdown の書き方を**知り** → ③書いて提出 → ④feedback で直す、
  という end-to-end ループの**手前半（①②）**が伝わるか。ここが弱いと人の介入なしにリッチなスライドは出ない。

### 監査が掘り当てた実バグ（collab モード）

[host-core.ts](../../src/mcp/host-core.ts) の `commitMutation` は `result.ok===false` だけで変更判定するため、
**no-op の mutation でも undo 履歴に push・rev 加算・deckChanged 発火**する。具体的には `apply_design_intent`
が `{ok:true, changed:false}`（未知 nodeId 等）を返しても、また同一 diagram を `set_slide_diagram` で
再書き込みしても、全 collab クライアントが無駄に起こされ undo 履歴が汚れる（`historyReducer` の commit は
dedupe しない）。→ 統一 envelope の `changed` を `commitMutation` が読むようにすれば直る。S3 で対処。

### 背景 — オーサリング契約と template discovery（T3・ユーザ insight 2026-07-04）

end-to-end ループの手前半を実コードで検証した結果：

- **②書式ルールは MCP に出ていない**。`get_template_capabilities` が返す [deckCapabilities()](../../src/engine/template-catalog.ts)
  は薄い一段落（slide kind・columns 上限・本文容量）だけで、**Markdown の書き方は含まれない**。文法には
  **推測不能なトークン**がある（[md-parser](../../src/engine/md-parser.ts) の `<!-- col -->` / `<!-- kpi -->` /
  `<!-- step -->` 区切り）— 教えなければ AI は KPI/カラム/プロセス系レイアウトを正しく書けない。
- **①テンプレの選択/作成も MCP から届かない**。レジストリ [master-store.ts](../../src/ipc/master-store.ts) は
  `src/ipc/`（デスクトップ専用）で `src/mcp/` は import していない。`list_templates`/`use_template`/`create_template` は無い。
- **朗報：オーサリング契約はすでに書かれている**。[llm-prompts.ts](../../src/engine/llm-prompts.ts) の
  `slideSystemPrompt(catalog)` が正確な Markdown 書式＋区切り＋図 fence＋レイアウト規則を、**その catalog の
  実レイアウト名に解決して**提示する（**alien-safe**）— GUI 内蔵 AI が現に使っているが MCP には未接続なだけ。
  `templateSpecSystemPrompt`（テンプレを作らせる時の spec 書式）も既存。→ **T3 の手前半は「新しい知能を作る」
  ではなく「既存資産を MCP に出す」問題**（安価・高レバレッジ・harness-over-model と整合）。ADR-0008 は既に
  「`get_slide_fix_request` を MCP **prompt** として出す」を deferred として挙げており（現状 prompt 登録ゼロ）、
  prompt がこの手のガイドの idiomatic な置き場。

---

## 確定した設計方針

ユーザ合意（2026-07-04）：**(1) 手前半（T3＝オーサリング契約＋テンプレ discovery）を最優先**（`get_authoring_guide`
は S3 envelope と並行可）、**(2) ①は選択（list/use_template）＋作成（create_template）＋既存 capabilities 強化を全部やる**、
**(3) envelope は既存の兄弟 shape に統一＋2点追加**（リッチな新 envelope は不採用）。着手は ADR＋本設計の docs 反映まで
（実装は S1–S6 で順次・手前半 S1–S2 が先頭）。以下、手前半（F・G）→ 後半（A〜E）の順に記す。

### F. 自己記述オーサリング契約（T3・S1）— 深掘り設計（2026-07-04・red-team 反映）

②「書き方を知る」を埋める。核心は **契約＝3層 × push-first 配信**。原則「新しい知能は作らず既存資産を露出」
（catalog-parameterized・モデル非呼び出し＝静的 instruction text）。実コード検証で判明：`slideSystemPrompt` は
**スライド骨格しか教えず、表・コード・そして12種の図の語彙を教えていない**（図は flowchart 1例のみ）。MCP には
図の語彙を出す surface が皆無だった。→「露出で済む」は L1 骨格のみ真で、L2 図・表は設計が要る。

**契約の3層**

| 層 | 中身 | 既存資産 |
|---|---|---|
| **L1 スライド骨格** | レイアウト指定・`---`・タイトル/サブ・箇条書き・Category/Date/Footer・`<!-- col/kpi/step -->`・**表(GFM)・コード** | `slideSystemPrompt(catalog)`（**表/コードは未収録＝追記が要る**） |
| **L2 図の語彙** | **12種の authorable DiagramSpec type**（`VALID_TYPES`） | `diagramRoutePrompt`（12種メニュー）＋`diagramSystemPrompt(type)`（per-type 構文＋JSON例）＝**二段構え** |
| **L3 テンプレ spec** | create_template 用（→ G/S2） | `templateSpecSystemPrompt`（G に記載） |

> **red-team 修正1（notes 削除）**：当初 L1 に `notes`（発表者ノート）を含めたが、SlideIR / md-parser / serializer の
> どこにも notes フィールドが無い（`slide-schema.ts` に無・`+1Notes` はレイアウト名接尾辞で別物）。教えても engine が
> **無言で捨てる**（author-then-lose＝harness が防ぐべき失敗）。SlideIR へのフィールド追加＝R4 のため今期は不可 →
> **notes は S1 スコープから除外**（将来項目）。実体のある **表(GFM)・コード**のみ追記（`md-slide-parser` に構文一致・
> ドリフト防止の round-trip テストは⑥）。
>
> **red-team 修正2（図 type の正確化）**：`class/state/ER/mindmap` は DiagramSpec の **type ではない**
> （`VALID_TYPES` は上記12種のみ・`class` 等は node shape）。これらは ```mermaid 入力を書けば flowchart/sequence 等に
> **graduate** する経路でのみ描ける。→ `get_diagram_types` が挙げるのは authorable な12 type、guide は「それ以外は
> ```mermaid で」と別記（`type:mindmap` を出させると validation で落ちる）。

**① 完全性 — L1 追記＋L2 二段露出**
- L1: 表(GFM pipe)・コード(```fence)を `slideSystemPrompt` に追記（`deckPlanSystemPrompt` は JSON DeckPlan 用で
  Markdown 経路には使えない＝別物）。実構文は `md-slide-parser` に一致させる。
- L2: GUI の二段構えをそのまま MCP に写す（context を太らせない）— **決定＝二段（menu＋per-type）**：
  - `get_diagram_types()` → `[{type, label, hint}]`（12種・`DIAGRAM_TYPES`/`diagramRoutePrompt` 由来・≈12行）。
    AI が「flowchart 以外に11種ある」と知る。
  - `get_diagram_guide(type)` → `diagramSystemPrompt(type)` ＝ base＋その type の構文＋JSON例**のみ**。選んだ1種だけ pull。
  - 新 type は `DIAGRAM_TYPES` 1エントリ追加で menu/guide/UI に自動反映（既存の拡張点・保守コストゼロ）。

**② 配信 — スキップ不可チャンネルに載せる（決定＝ダイジェスト＋ポインタ）**
MCP で AI が確実に見るのは (1) **tool description**（tool 一覧は常時 context）と (2) **編集ループで必ず呼ぶ tool の戻り値**
のみ。resource は client 依存（Claude Code は @-mention で読めるので pull 経路としては有効）、prompt は人間 UI 前提で
autonomous AI は自動起動しない → **push は前2者・resource/prompt は pull の floor**。
- **契約ダイジェスト**（`contract` フィールド）を **AI が doc に入る全経路**に載せる：`open_project`/`new_project` の戻り
  （stdio）＋ **`select_document` の戻り**＋ **`list_documents` の各 doc 行**。最後が要るのは、collab で AI が GUI 開き doc に
  `soleDocId` フォールバック（`entryOf`）で open/new/select を呼ばず着地しうるため（S1 増分2 の review 指摘）＝discovery の
  list→operate 経路を塞ぐ。中身は**推測不能なアンカーに絞る**：`<!-- col/kpi/step -->` 区切り＋**このテンプレのレイアウト名**＋
  **budget**＋「**図は `get_diagram_types` を呼べ**／全文は `get_authoring_guide`」。汎用要約でなくアンカーだけにすることで
  fat/thin ジレンマと「図が在ると気づかず text-only を書く」を同時に回避。belt＝`get_authoring_guide` の pull ＋ description アンカー。
- **budget は `get_deck_issues` の戻りにも同梱**（編集ループが毎ターン呼ぶ tool＝`getDiagnostics` は既に budget を返す）。
- `set_slide_markdown`/`new_project` の **description に短い書式アンカー**（区切りが在る・`get_authoring_guide` を呼べ）。
  ※description は静的でレイアウト名は載らない＝名前は戻り値ダイジェスト側で運ぶ。
- 全文/per-type は pull（`get_authoring_guide`/`get_diagram_guide`）で常時 context を小さく保つ。

**bootstrapping（red-team 修正4・chicken-and-egg 解消）**：catalog 解決済み guide は「テンプレを開いた後」しか出せない。
正順は **① `new_project(template, markdown 無し)` で catalog＋valid な1枚 deck を得る → ② `get_authoring_guide`
（catalog-aware）で書式を知る → ③ `set_slide_markdown`/`insert_slide` で著作**。`new_project` は md 無しでも valid deck を
返す既存仕様なのでこの順で回る。`get_authoring_guide` は project 必須（未 open は never-silent エラー・canonical 名を漏らさない）。

**③ preventive — budget を契約と一緒に運ぶ（red-team 修正5でスコープ是正）**
- 実在するのは **deck レベルの本文 budget** のみ＝`contentBodyBox`→`FitBox {maxLines, charsPerLine}`（`budgetOf` が
  `{maxBullets, charsPerBullet}` に写像・**per-layout でも bodyRegions でもない**・inherited-xfrm マスタでは null）。
  → 契約が運ぶのはこの deck レベル budget。**per-layout budget は将来項目**（今は導出不能）。
- `get_template_capabilities` の actionable 化は**実在する範囲**で：図可否・区切りトークン・`CatalogEntry.groupKind`
  （card/step/kpi/compare）・`bodyCount`。過剰な per-layout 数値は約束しない。
- budget を **ダイジェスト・guide・get_deck_issues** に同梱 → AI は書く前に「1枚 ≤ N 行/N 文字幅」を知り
  **author-within-budget**。④feedback（envelope 診断＋ヒント）は安全網に降格＝harness-over-model の本流。

**S1 の新／変更サーフェス（まとめ）**

| tool / 変更 | 中身 | 実装 |
|---|---|---|
| `get_authoring_guide()` | L1 全文（`slideSystemPrompt(catalog)`＋**表/コード**）＋budget＋図ポインタ。project 必須 | `session.ts` read handler・`llm-prompts.ts` に L1 追記 |
| `get_diagram_types()` | L2 メニュー（authorable 12種） | `DIAGRAM_TYPES`/`VALID_TYPES` の投影 |
| `get_diagram_guide(type)` | L2 per-type（base＋構文＋例）＋「他は ```mermaid」注記 | `diagramSystemPrompt(type)` 露出 |
| `get_template_capabilities` 強化 | 図可否＋区切り＋`groupKind`＋deck budget（実在範囲のみ） | `deckCapabilities()`／`getCatalog()` |
| `open_project`/`new_project`/**`select_document`** 戻り ＋`contract` | アンカー型ダイジェスト（区切り＋レイアウト名＋budget＋図/全文ポインタ） | `session.ts`／host 側 |
| `get_deck_issues` 戻り | budget を継続同梱（既存）＋毎ターンの budget 供給 | `session.ts`（既存 `getDiagnostics`） |
| `set_slide_markdown`/`new_project` description | 短い書式アンカー＋guide 参照 | `server.ts` |
| floor（pull・頼らない push） | `deck://authoring-guide` resource＋MCP prompt（＋ADR-0008 deferred の `get_slide_fix_request` prompt を初 prompt として） | `resources.ts`/`server.ts` |

> caveat（⑥品質クラスタで要検討）：図 base prompt の色パレット・アイコンは Midnight 固定（`diagram-type-prompts.ts`
> `COLOR_PALETTE`）＝alien テンプレに Midnight 配色を出す。図スタイルは template 独立の別関心として当面許容。

### G. テンプレ discovery / provisioning（T3・S2）— 深掘り設計（2026-07-04）

①「調達（提出/選択/作成）」を埋める。提出（`new_project(templateBase64)`）は既存。実コード検証で**思ったより軽い**と判明：
- **`TemplateSpec` は小さい**（[template-writer.ts:18](../../src/engine/template-writer.ts#L18)）＝`{name, fonts:{major,minor},
  palette:{9色}, layouts?}`。**layouts 省略時は canonical 30 が既定**＝AI が書くのは**名前＋2フォント＋9色だけ**。
  `MIDNIGHT_PALETTE` が既存＝preset の種。→ ④「full spec は重い」は過大評価。
- **`writeTemplate` は fs 無しで実行時生成できる**（template-writer.ts:245）→ **stdio に .pptx を bundle せず preset から
  その場で生成**でき、bytes を持たない素の AI が始められる（⑤の bundling 不要）。

| 追加 | signature | 戻り | 実装・モード |
|---|---|---|---|
| `create_template` | `(spec)`＝`{name, fonts, palette, layouts?}` | `{templateBase64, health}` | **両モード可**（純エンジン）。layouts 既定＝canonical 30。AI が spec 著作→harness 検証・正規化・**コントラストガード（ADR-0014）**→[template-writer](../../src/engine/template-writer.ts) 生成。サーバはモデル非呼び出し |
| preset | （`get_template_spec_guide` に同梱） | 名前つき palette（`MIDNIGHT_PALETTE`＋将来追加） | preset から開始＋色/フォント個別 override。9色なので from-scratch も可＝**preset は品質フロア** |
| `list_templates` | `()` | `{templates:[{id,name,health}]}` | **host**：GUI が registry accessor（`useMasterRegistry`／[master-store.ts](../../src/ipc/master-store.ts)・Tauri fs 裏）を `HostContext` に注入（engine 直参照でない・red-team 是正） |
| `use_template` | `(id)` | `{templateBase64}` or host で doc mint | registry から bytes 解決。id＝`MasterIndexEntry.id`＋preset は安定文字列（"midnight"）＝人間可読 |
| `get_template_spec_guide` | `()` | `templateSpecSystemPrompt()`＋preset 一覧 | `template-spec-prompts.ts` 再利用（L3・`create_template` とペア） |

**決定（red-team フォーク解決・ユーザ選択）**:
- **stdio 開始＝create→new_project 合成**：素の stdio AI は `create_template({preset:"midnight"})` で bytes を得て
  `new_project(bytes)` に渡す（bundling 不要・tool 直交・`new_project` は bytes を取る既存仕様のまま・往復1回）。
- **select は host の GUI 注入 accessor**、stdio は create/持参で代替（headless の built-in select は当面不要＝実行時生成で足りる）。

`create_template` は「作る」だけ＝返した bytes を `new_project` に渡して着手（対称・composable）。
ADR-0014「AI は spec 提案のみ・PPTX を書くのは決定論コード」を MCP に踏襲。

### H. 品質 — 契約↔engine のドリフト防止＋入口一本化（⑥・S1 の品質ゲート）

guide（`slideSystemPrompt` 等）は手書き散文で `md-parser` とは別ソース → 実際に表/コード欠落・`notes` 幻・per-layout
budget 過剰主張のドリフトが起きた（red-team で顕在化）。既存の prompt テスト（`tests/prompt-invariants.test.ts`・
`slide-system-prompt.test.ts`・`diagram-type-prompts.test.ts`・`template-spec-prompts.test.ts`）を土台に拡張する。

**決定（ユーザ選択＝round-trip テスト）**:
- **ドリフトゲート＝round-trip 不変条件**：guide が載せる**具体例が必ず parser/schema を通る**ことをテストで固定。
  - L1: `get_authoring_guide` の例スライド Markdown が `parseMd` で意図した構造に解決する。
  - L2: 各 `DIAGRAM_TYPES[type].shape` の JSON 例が `DiagramSpecSchema` を通りその `type` になる。
  - L3: `templateSpecSystemPrompt` の例が `TemplateSpec` として `writeTemplate` を通り health ok。
  散文は手書きのまま（instruction text は parser から生成できない）だが、**例だけは engine の真実に固定**＝
  「契約は engine 実挙動の鏡」を仕組み化。今回の notes/表/コードのドリフトはこのゲートで自動検出される。
- **入口一本化（manifest）**：`get_authoring_guide` を**単一エントリ**とし、末尾で `get_diagram_types` /
  `get_template_spec_guide` へポインタ。②のダイジェスト＋この manifest が「どこから始める?」への答え（red-team の
  no-entrypoint 指摘を解消）。

harness-over-model の帰結：知能をハーネスに寄せた以上、**AI に渡す契約がハーネスの真実と一致しなければ寄せた意味が
壊れる**。ドリフトゲートはその不一致を CI で捕まえる。着手＝S1（guide 変更と同時にテスト追加・test-first R3）。

### A. 統一 mutation envelope（T1・S3）

6 つの決定論 mutation（`set_slide_markdown` / `set_deck_markdown` / `split_overflowing_slides` /
`convert_bullets_to_table` / `set_slide_diagram` / `apply_design_intent`）の戻りを **1つの shape** に収束させる。
新しい投機的な形は作らず、**既にある兄弟 shape を canonical にする**：

```
成功: { ok: true,
        changed: boolean,          // deck が実際に変わったか（no-op を never-silent に）
        beforeMd?: string,         // 単一スライド op のみ
        afterMd?: string,          // 同上
        diagnostics: DeckIssue[],  // 編集後の diagnoseDeck（既存 shape・schema 変更なし）
        budget?: { maxBullets, charsPerBullet } | null,  // このテンプレの本文容量
        skipped?: SkippedOp[] }    // 効果の無かった op を候補 id つきで（#13・skip し得る tool のみ）
拒否: { ok: false, error: string [, code?] }   // 既存の never-silent 拒否（＋ stale variant は不変）
```

- 不足を埋めるだけ：`set_slide_diagram` / `convert_bullets_to_table` に `changed` ＋ `diagnostics` を追加。
  `set_deck_markdown` に `changed`。`budget` は overflow 修正のために各 mutation へ同梱（[deck-diagnostics](../../src/engine/deck-diagnostics.ts) の `contentBodyBox` 由来・alien-safe）。
- `convert_bullets_to_table` の「対象なし」は今 `{ok:false, applicable:false}`。これは **正当な非結果を
  失敗に見せている**（AI が `ok` で分岐すると no-op を失敗と誤認）。→ `{ok:true, changed:false,
  status:"not-applicable", beforeMd}` に変更。`ok:false` は真の拒否専用に戻す。
- **`commitMutation` は `result.changed` を読む**ように変更（上記バグ修正）。`server.ts` の `mutate()` は
  既に `{ok:false}` を特別扱いし host rev/docId を spread しているので envelope はその上位互換＝server.ts 変更不要。
- **実装 R1 メモ**：`session.ts` は 340/400 行。envelope 生成 helper（例 `buildMutationResult`）と後述の
  ヒント表は engine を MCP tool 名に結合させない（R2）ため **新モジュール `src/mcp/next-steps.ts`** に置く。
  各ハンドラは helper 経由で ~1 行に収束する。**schema.ts / SlideIR / DeckIR は不変（R4 非該当）**。

### B. 構造操作（T2・最大の穴・S4）

engine・GUI・MCP のどこにも add/delete/move/duplicate スライドが無い。唯一の代替 `set_deck_markdown` は
[session.ts](../../src/mcp/session.ts) の `applyDeckMarkdown` が figure を保持しないため、**1枚の追加/削除の
ために deck 丸ごと再生成すると他スライドのネイティブ図が無言で消える**（`applySlideMarkdown` の merge dance を
通らない）。したがって構造操作は「重複する create-door」ではなく真に新しい経路。全て slides 配列操作で
**schema 変更不要**。

命名規約で content 動詞と分離（prefix だけで AI がルーティングできる）：
**構造＝`insert_/delete_/move_/duplicate_`** vs **content＝`set_/apply_/convert_/split_`**。

| tool | signature | 戻り（＋ envelope） | 要点 |
|---|---|---|---|
| `insert_slide` | `(index, markdown, position?: 'before'\|'after')` | `{insertedIndex, slideCount, diagnostics}` | `parseMd` で1スライド化（layout='auto' → `autoSelectLayout` が入力マスターで解決＝alien-safe）→ splice → DeckIR を zod 検証 |
| `delete_slide` | `(index)` | `{deletedIndex, slideCount, deletedMd, diagnostics}` | `assertIndex` → splice。**最後の1枚は never-silent 拒否**（`slides.min(1)`）。`deletedMd` を返し reversible/inspectable に |
| `move_slide` | `(fromIndex, toIndex)` | `{fromIndex, toIndex, slideCount, diagnostics}` | 純 permutation。content 不変＝図/レイアウト byte-identical 保持 |
| `duplicate_slide` | `(index, position?: 'before'\|'after')` | `{newIndex, slideCount, diagnostics}` | **`structuredClone` で SlideIR を複製**（Markdown 経由でなく diagram/table/code/svgCache まで byte-identical）→ splice |

host モードでは `commitMutation` を通り undo/rev/deckChanged に自然に載る。`set_deck_markdown` は
「一括/rewrite による並べ替え」の唯一経路として残し、構造 tool は surgical な代替と明記（set_slide vs set_deck と同じ枠組み）。

### C. read 粒度 — `get_slide`（T1・S5）

1スライドの編集計画に今は `get_slide_markdown`（文字列のみ）＋ `get_deck_issues`（deck 全体を index で filter）
＋ `get_template_capabilities` を stitch し、Markdown を再パースして `hasFigure`/`resolvedLayout`/`bulletCount` を
再導出する必要がある。特に **`resolvedLayout` は `autoSelectLayout` の catalog＋first-slide 規則に依存し、
bare Markdown から再構成不能**。

```
get_slide(index) → {
  index, resolvedLayout, groupKind?, hasFigure,
  figureKind: 'diagram'|'mermaid'|'table'|'code'|null,
  bulletCount, budget: {maxBullets, charsPerBullet}|null, overBudget: boolean,
  issues: DeckIssue[],   // このスライドのみ（diagnoseDeck().filter(slideIndex===i)）
  markdown               // slideToMarkdown（auto 解決済み）
}
```

全フィールドが既存値の純合成（schema 変更なし・alien-safe）。`get_slide_markdown` は bare-MD 経路として残し、
`get_slide` はその構造化 sibling。ADR-0008 の「reads は二重提供・削らない」は継続（`get_*` × `deck://`）。

### D. 図を text スライドに追加（T1/T2・S5）

`setDiagram` は [session.ts](../../src/mcp/session.ts) が既存 figure からしか `placeholderIdx` を取らず
figureless を拒否 → **text-only スライドに図を追加できない**。GUI はできる（`placeholderIdx:"1"`）ので
協働北極星（AI=Tools のみ）で Tools-parity の穴。

方針：**`set_slide_diagram` を緩和**（新 tool を足さない）。figure が無くても解決済みレイアウトに空き body
placeholder があれば、その **body ordinal**（`nthBody`＝role ベース・[placeholder-binding](../../src/engine/placeholder-binding.ts)・alien-safe。ハードコード idx にしない）を既定にする。
multi-body 用に `placeholderIdx?: string` を任意追加。戻りに `created: boolean`（新規 vs 置換）を含める。

### E. エラー契約＋決定論ヒント＋split の index シフト（T1/T2・S6）

- **エラー契約統一**：今は「ドメイン拒否＝`{ok:false,error}` を JSON で」vs「throw＝`isError:true` の裸文字列」が
  混在し、同種の問題が両側に散る（空 markdown→`{ok:false}` だが範囲外 index→throw 文字列、変換不能 mermaid→
  `{ok:false}` だが不正 JSON→throw）。→ **`isError:true` は un-modeled crash 専用**に予約し、
  `assertIndex`/`requireLoaded`/範囲外/`set_slide_diagram` の未ガード `JSON.parse` を `{ok:false, error, code?}` に寄せる。
  stale-rev variant（`{ok:false, stale:true, expectedRev, currentRev, docId}`）を docs で発見可能にする。
- **決定論ヒント（narrow）**：mutation envelope に「次の一手」を載せるが、**決定論トゥールに限定**
  （`split` lever → `split_overflowing_slides`、key-value の `visualize` lever → `convert_bullets_to_table(index)`）。
  `condense`/`title` の AI 著作系は既存の `get_slide_fix_request` に委ね、二重化しない。ヒントは `diagnoseDeck`
  出力の純関数（同じ deck → 同じヒント・モデル不要）。表は `src/mcp/next-steps.ts`。
- **`split_overflowing_slides` の `changedSlides`**：`distillDeck` は継続スライドを deck 中間に挿入し
  **下流 index を全てずらす**ので、split 後に AI の index 指定 follow-up が stale を指す。→ split が生んだ
  新 index を `changedSlides` で返す（per-source flatMap の group-count diff・alien-safe）。

---

## スライス計画（各独立出荷可・test-first R3・**手前半 S1–S2 先頭**）

| S | 柱 | 内容 | 主な触点 | 出荷価値 |
|---|---|---|---|---|
| **S1** | T3 | 自己記述オーサリング契約：`get_authoring_guide`（tool＋prompt＋resource）＝`slideSystemPrompt(catalog)`・`get_template_capabilities` の actionable 化・`get_template_spec_guide` | `session.ts`・`server.ts`・`resources.ts`・`template-catalog.ts`・tests | **②の核心** — AI が書式（区切り含む）と使えるレイアウトを知る。既存資産の露出＝安価 |
| **S2** | T3 | テンプレ discovery：`list_templates`/`use_template`（host・レジストリ橋渡し）・`create_template(spec)`（template-writer wire） | `host-core.ts`・`host.ts`・`server.ts`・`session.ts`・`ipc/master-store.ts` 参照・tests | **①選択/作成** — ループの入口が閉じる |
| **S3** | T1 | 統一 mutation envelope＋`commitMutation` no-op バグ修正＋`convert_bullets` の not-applicable 是正 | `session.ts`・`host-core.ts`・`src/mcp/next-steps.ts`（新）・tests | 実バグ修正＋④feedback の形が確定（後続が乗る） |
| **S4** | T2 | 構造操作 `insert_/delete_/move_/duplicate_slide` | `session.ts`・`server.ts`・tests | T2 最大の穴を塞ぐ |
| **S5** | T1/T2 | `set_slide_diagram` 緩和（text スライドへ図追加）＋`get_slide` 構造化 read | `session.ts`・`server.ts`・`resources.ts`（任意）・tests | 図追加の Tools-parity＋1スライド編集計画が1呼び出し |
| **S6** | T1/T2 | 決定論ヒント＋split の `changedSlides`＋エラー契約統一＋`docs/mcp-server.md` 更新 | `src/mcp/next-steps.ts`・`session.ts`・`server.ts`・docs | 「次の一手」と index シフト解消・ユーザ docs 同期 |

順序の根拠：ユーザ最優先の**手前半（①②＝S1–S2）を先頭**に。S1 は既存資産の露出で安価かつ効き目大（S3 と並行可）。
S3 が④feedback の envelope を確定させ、S4 以降がそれに乗る。

---

## やらないこと（監査で REJECTED / ADR-0008 do-not-undo を継承）

- **`get_*` 読み取り tool を「重複だから」と削除しない**（`tools/call` は唯一全クライアントで自律サポートされる
  読み取り経路）。`get_slide` は追加であって置換ではない。
- **`generate_from_plan` / `slidePlanToSlide` 経路を新設しない**（任意テンプレ保証を壊す・`new_project` に畳む）。
- **mutation ペアを統合しない**（`set_slide`/`set_deck`・`set_slide_diagram`/`apply_design_intent`・
  `validate_deck`/`get_deck_issues` は別軸）。名前の紛らわしさは説明文＋prefix 規約で対処。
- **表の直接操作 tool を作らない**（表は GFM Markdown で set_slide_markdown 経由＝十分・REJECTED）。
- **`set_slide_layout` 専用 tool は当面作らない**（layout は Markdown ディレクティブで編集可・未知名は
  `autoSelectLayout` が graceful degrade＝benign。discoverability は S1 の `get_authoring_guide`＋actionable な
  capabilities が担う。将来やるなら「候補名つき never-silent 検証」の形で）。
- **リソースの stdio/host 収束は今回スコープ外**（協働では GUI が人の面・resource は orphan で据え置き）。
- **schema.ts / SlideIR / DeckIR の変更なし**（R4 非該当）。全て MCP 層 or slides 配列操作に閉じる。

---

## 参照

- ADR: [0015-mcp-brushup](../adr/0015-mcp-brushup.md)（本設計の決定）・[0008](../adr/0008-mcp-tool-surface.md)（監査結論・do-not-undo）・
  [0009](../adr/0009-p2-collab-host.md)（協働ホスト）・[0005](../adr/0005-harness-over-model.md)（harness over model）・
  [0012](../adr/0012-ai-edit-structure-preservation.md)（#12/#13 の思想）
- コード: `src/mcp/{server,session,resources,host-core,host}.ts`・
  `src/engine/{deck-diagnostics,slide-schema,placeholder-binding,distill,llm-prompts,template-catalog,template-writer,template-spec-prompts}.ts`・
  `src/ipc/master-store.ts`（レジストリ・S2 で橋渡し）
- ユーザ向け: [docs/mcp-server.md](../mcp-server.md)（S6 で更新）
- 関連メモリ: `master_intake_workflow`（マスター intake/役割推論の前方向きアイデア）・`tool_role_last_mile`（DISTILL）
