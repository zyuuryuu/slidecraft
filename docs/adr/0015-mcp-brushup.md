# ADR-0015: MCP ブラッシュアップ — 統一 mutation envelope・構造操作・read 粒度

- **Status**: Accepted（**S1–S6 実装完了 2026-07-04**・**S2 増分2〔`list_templates`/`use_template`〕実装完了 2026-07-07**）
- **Date**: 2026-07-04（S2 増分2 追記 2026-07-07）

## Context

ROADMAP テーマ3「MCP ブラッシュアップ — 上流 AI の作業性向上」（サイズ M〜L）。北極星は
[ADR-0009](0009-p2-collab-host.md) の協働ホストモデル（GUI がホスト・上流 AI が Tools で編集・人はライブ確認）で、
**AI の面は Tools のみ**＝Tools の質がそのまま協働体験の質になる。

着手にあたり現行 MCP サーフェス（18 deck tools ＋ host 専用ライフサイクル ＋ `deck://` リソース）の入出力を
5レンズ（フィードバック設計 / サーフェス完全性 / 重複・命名 / read 粒度 / エラー契約）で監査し、各提案を敵対的に
検証した（2026-07-04・35 findings・7 件 P1）。詳細設計＝[docs/design/mcp-brushup.md](../design/mcp-brushup.md)。

監査で確定した論点：
- **フィードバック不均一（T1）**：6 mutation の戻りが発散（`set_slide_diagram`/`convert_bullets_to_table` は
  診断も `changed` も返さない・`split_overflowing_slides` はどのスライドが分割されたか返さない）。AI が envelope で
  tool を見分けられず、no-op を成功と区別できない。
- **構造操作の欠落（T2・最大の穴）**：add/delete/move/duplicate スライドが engine/GUI/MCP のどこにも無い。
  唯一の代替 `set_deck_markdown` は figure 非保持で、1枚操作のための deck 丸ごと再生成が**他スライドの図を無言で
  消す**（correctness bug）。
- **read 粒度（T1）**：1スライドの編集計画に 3 tool を stitch＋Markdown 再パースが要る。`resolvedLayout` は
  bare Markdown から再構成不能。
- **図を text スライドに追加できない（T1/T2）**：`set_slide_diagram` が figureless を拒否。GUI はできる＝Tools-parity の穴。
- **実バグ（collab）**：`commitMutation` が `ok===false` だけで判定するため、**no-op mutation でも undo push・
  rev 加算・deckChanged 発火**し全クライアントを無駄に起こす。
- **オーサリング契約が伝わっていない（T3・ユーザ insight・最優先）**：上流 AI が①テンプレを調達（提出/選択/
  作らせる）→②Markdown の書き方を知り→③書いて提出→④feedback で直す、というループの**手前半（①②）**が弱い。
  ②書式ルールは MCP に出ておらず（`get_template_capabilities` は薄い要約のみ・`<!-- col/kpi/step -->` 等の
  **推測不能トークン**を教えない）、①テンプレの選択/作成はレジストリ（`src/ipc/master-store.ts`）が MCP から届かず不可。
  **朗報**：オーサリング契約は既に `slideSystemPrompt(catalog)`（[llm-prompts.ts](../../src/engine/llm-prompts.ts)・
  catalog 解決済み＝alien-safe）に書かれ GUI 内蔵 AI が使用中 — MCP 未接続なだけ＝「露出」で済む安価な問題。

## Decision

ユーザ合意（2026-07-04）の3点を骨格に、6スライスで実装する（**手前半 T3 を先頭**）：

**手前半（T3・最優先・①②を埋める）**

0-A. **自己記述オーサリング契約を露出（契約＝3層 × push-first 配信）**。深掘り（2026-07-04）で判明：`slideSystemPrompt`
   はスライド骨格のみで**表・コード・12種の図の語彙を教えておらず**、MCP には図語彙の surface が皆無だった。設計（詳細＝
   [design/mcp-brushup.md](../design/mcp-brushup.md) §F）：
   - **L1 骨格** `get_authoring_guide()`＝`slideSystemPrompt(catalog)`（実レイアウト名に解決）＋**表/コード追記**＋budget。
     （red-team：`notes` は SlideIR/parser に実体が無く教えると無言で捨てる＝R4 のため今期スコープ外。実体のある表/コードのみ。）
   - **L2 図語彙（二段）** `get_diagram_types()`（authorable 12種＝`VALID_TYPES`）＋`get_diagram_guide(type)`（その type の
     構文＋例のみ）。class/state/ER/mindmap は type でなく ```mermaid 入力経由のみ（`type:mindmap` は validation で落ちる）。
   - **配信＝アンカー型ダイジェスト＋ポインタ**：push は tool description とセッション入口 tool の戻りのみ（resource は pull・
     prompt は floor）。ダイジェストを `open_project`/`new_project`／**`select_document`（collab では AI は GUI が開いた doc を
     選ぶだけ）**の戻りに載せ、中身は推測不能アンカー（区切り＋レイアウト名＋budget＋「図は `get_diagram_types`」）に絞る。
     budget は毎ターン呼ぶ `get_deck_issues` にも同梱。bootstrapping は `new_project(template, md無し)`→`get_authoring_guide`→著作の順。
   - **preventive budget**：実在する **deck レベル本文 budget**（`contentBodyBox`→`{maxLines,charsPerLine}`）を契約と一緒に運ぶ
     （per-layout budget は導出不能＝将来項目・red-team 是正）。`get_template_capabilities` は実在範囲（図可否・区切り・groupKind）で actionable 化。
   新文言は表/コード追記のみで大半は既存資産の露出（モデル非呼び出し）。ADR-0008 deferred の `get_slide_fix_request` prompt も初 prompt として登録。
0-B. **テンプレ discovery/provisioning**（深掘りで判明：`TemplateSpec` は小さい＝`{name, fonts, palette:9色, layouts?}`で
   layouts 省略時 canonical 30 既定・`writeTemplate` は fs 無しで実行時生成可）：
   - `create_template(spec)`＝AI は**名前＋2フォント＋9色**を著作（layouts 既定30）→harness 検証・コントラストガード
     （ADR-0014）→[template-writer](../../src/engine/template-writer.ts) 生成。両モード可。`MIDNIGHT_PALETTE` を preset として
     露出（preset＋色/フォント override・preset は品質フロア）。
   - **stdio 開始＝create→new_project 合成**（ユーザ選択）：bytes を持たない素の stdio AI は `create_template({preset})`→
     `new_project(bytes)` で始める（.pptx を bundle しない・実行時生成で足りる）。
   - `list_templates`/`use_template(id)` は **host**：master レジストリ（`useMasterRegistry`/`src/ipc/master-store.ts`・
     Tauri fs 裏）を **GUI が accessor として `HostContext` に注入**（engine 直参照でない・red-team 是正）。id は人間可読。
   提出は既存 `new_project(templateBase64)`。

0-C. **契約↔engine ドリフト防止＋入口一本化（⑥品質・S1 の品質ゲート）**：guide は手書き散文で parser と別ソース＝
   ドリフトする（今回の notes/表/コード）。→ **round-trip 不変条件**（ユーザ選択）で guide の**具体例が必ず parser/schema を
   通る**ことをテストで固定（L1 例は `parseMd`／L2 各 `DIAGRAM_TYPES.shape` は `DiagramSpecSchema`／L3 例は `writeTemplate`
   health ok）＝既存 `tests/prompt-invariants.test.ts` 等を拡張。`get_authoring_guide` を単一エントリ（manifest）にし他 guide へ
   ポインタ＝「どこから始める?」の答え。「契約は engine 実挙動の鏡」を CI で担保（harness-over-model の帰結）。

**後半（T1/T2）**

1. **フィードバックは既存の兄弟 shape に統一（リッチな新 envelope は不採用）**。6 mutation を
   `{ok, changed, beforeMd?, afterMd?, diagnostics, budget?, skipped?}` に収束させ、不足（`set_slide_diagram`/
   `convert_bullets_to_table` の `changed`＋`diagnostics`、`set_deck_markdown` の `changed`、各 mutation の `budget`）
   を埋めるだけにする。`convert_bullets_to_table` の「対象なし」は `{ok:false, applicable:false}` から
   `{ok:true, changed:false, status:"not-applicable"}` へ（正当な非結果を失敗に見せない）。**`commitMutation` は
   `result.changed` を読む**ように直す（上記バグ修正）。helper とヒント表は R2/R1 のため新モジュール
   `src/mcp/next-steps.ts` に置く。
2. **構造操作 4 tool を新設**：`insert_slide` / `delete_slide`（最後の1枚は never-silent 拒否・`deletedMd` 返却）/
   `move_slide` / `duplicate_slide`（`structuredClone` で図を byte-identical 複製）。命名規約で
   **構造＝`insert_/delete_/move_/duplicate_`** vs **content＝`set_/apply_/convert_/split_`**（prefix でルーティング）。
   全て slides 配列操作＝**schema 変更なし**、`autoSelectLayout` 経由で alien-safe。
3. **`get_slide(index)` 構造化 read を追加**（既存値の純合成：resolvedLayout・hasFigure・figureKind・bulletCount・
   budget・overBudget・当該スライドの issues・markdown）。`get_slide_markdown` は bare-MD 経路として残す（追加であって置換ではない）。
4. **`set_slide_diagram` を緩和**して text-only スライドへ図を追加可能に（空き body ordinal を `nthBody`＝role ベースで
   既定・alien-safe、`placeholderIdx?` 任意、`created` 返却）。
5. **エラー契約を統一**：`isError:true` は un-modeled crash 専用に予約し、ドメイン拒否（範囲外 index・未オープン・
   未ガード `JSON.parse`）を `{ok:false, error, code?}` に寄せる。stale-rev variant を docs で発見可能にする。
6. **決定論ヒント**（`split`/key-value `visualize` lever → 対応 tool に限定・`condense`/`title` は
   `get_slide_fix_request` に委譲）を mutation envelope に載せ、`split_overflowing_slides` は index シフト解消のため
   新 index を `changedSlides` で返す。

スライス順（**手前半先頭**）：**S1** オーサリング契約（guide＋capabilities）→ **S2** テンプレ discovery（list/use/create）→
**S3** 統一 envelope＋バグ修正 → **S4** 構造操作 → **S5** 図追加＋`get_slide` → **S6** ヒント＋changedSlides＋エラー契約＋
`docs/mcp-server.md` 更新。S1 は既存資産の露出で安価かつ効き目大（S3 と並行可）、S3 が④feedback の envelope を確定させ後続が乗る。

## Consequences

**良い点**
- **手前半（T3）で end-to-end ループが閉じる**：AI がテンプレを調達（提出/選択/作らせる）し、書式ルール
  （推測不能な区切り含む）と使えるレイアウトを1呼び出しで知る → 人の介入を最小にリッチなスライドが出せる。
  しかも `slideSystemPrompt`/`templateSpecSystemPrompt` の**既存資産の露出**が主で安価（新しい知能を作らない）。
- 上流 AI が全 mutation を1つの envelope で扱え、no-op を never-silent に区別できる。構造操作で「図を消さずに
  1枚 insert/delete/move/duplicate」が可能になり、`get_slide` で1スライドの編集計画が1呼び出しで済む。
- collab の no-op スプリアス通知/undo 汚染という実バグが直る（`changed` 判定への移行）。
- [ADR-0008](0008-mcp-tool-surface.md) の do-not-undo ガードレールを継承：read tool を削らない・
  `generate_from_plan` を作らない・mutation ペアを統合しない。`get_slide` は追加、構造操作は新経路であって重複ではない。
- **schema.ts / SlideIR / DeckIR は不変（R4 非該当）**。変更は MCP 層と slides 配列操作に閉じる。

**実装（2026-07-04・S1–S6 完了）**
- S1 契約露出（`get_authoring_guide`/`get_diagram_types`/`get_diagram_guide`＋L1 表/コード・`src/mcp/guides.ts`）＋配信
  （`contract` ダイジェストを open/new/select/list_documents に・`src/mcp/next-steps.ts` 前身）。S2 調達（`create_template`/
  `get_template_spec_guide`・`src/mcp/templates.ts`）。S3 統一 envelope＋`commitMutation` no-op バグ修正。S4 構造操作
  （`src/mcp/structure.ts`）。S5 `get_slide`（`src/mcp/reads.ts`）＋text スライドへ図追加。S6 決定論 hints（`src/mcp/next-steps.ts`）
  ＋split の `changedSlides`＋`docs/mcp-server.md` 更新。各スライスを敵対レビュー通過（S3 の commitMutation データ喪失・
  S4 の insert 複数枚無言破棄・S5 の図 clobber/resolvedLayout 等を検出修正）。全 982 tests green・schema 変更なし。

**代償・限界**
- **S2 増分2（`list_templates`/`use_template`/`register_templates`）実装完了（2026-07-07）**：collab host は別 Node
  サイドカー（`host-main.ts`）で webview の master レジストリ（`useMasterRegistry`/Tauri fs）とはプロセスが別なので、
  **GUI が collab 開始時に自レジストリを `register_templates`（GUI ロール限定）で host へ upload**（deck シードと同型）→
  共有 `MemTemplateStore`（`host-core.ts`）に投入 → AI が `list_templates`/`use_template` で選択、という**プロトコル越し橋渡し**で
  「engine 直参照でない accessor 注入」を実現（`HostContext.templates`）。`use_template(id, md?)` は new_project 経路で新 doc を
  mint（既存 doc のテンプレ入替ではない）。未接続→`{ok:false, code:"template-registry-unavailable"}`、未知 id→`unknown-template`。
  stdio は `create_template`／bytes 持参のまま。敵対レビューで2件是正（GuardCode union 未拡張で `typecheck:mcp` 破綻・
  upload の `Promise.all` 全滅→per-item ガード）。1122 tests green・schema 変更なし。
- **エラー契約の完全統一は将来**：ドメイン拒否＝`{ok:false}`、呼び出し/クラッシュ（範囲外 index・未オープン）＝`isError` の
  2カテゴリで運用（`docs/mcp-server.md` に明記）。ガード throw→`{ok:false}` の完全統一は磨き込み項目。
- **T3 の template discovery は host モード依存**：`list_templates`/`use_template` は GUI の master レジストリを
  前提とし、`HostContext` に registry accessor を足す（stdio 単体では非対応＝AI が bytes 持参 or `create_template`）。
  `create_template` は純エンジンで両モード可。
- 監査で REJECTED：表の直接操作 tool・`set_slide_layout` 専用 tool は当面作らない（Markdown 経由で十分・
  未知レイアウト名は graceful degrade・discoverability は S1 の guide が担う）。リソースの stdio/host 収束もスコープ外。
- `session.ts`（340/400 行）に近接。envelope helper/構造ハンドラの増分で 400 行超過が見込まれるため、
  収束 helper を `src/mcp/next-steps.ts` に、必要なら構造ハンドラを別モジュールに切り出す（R1）。

## References

- 設計書: [docs/design/mcp-brushup.md](../design/mcp-brushup.md)（envelope 仕様・tool signature・スライス計画・やらないこと）
- コード: `src/mcp/{server,session,resources,host-core}.ts`・`src/engine/{deck-diagnostics,slide-schema,placeholder-binding,distill}.ts`
- 関連 ADR: [ADR-0008](0008-mcp-tool-surface.md)（監査結論・do-not-undo）・[ADR-0009](0009-p2-collab-host.md)（協働ホスト）・
  [ADR-0005](0005-harness-over-model.md)（harness over model）・[ADR-0012](0012-ai-edit-structure-preservation.md)（#12/#13 の思想）
- ユーザ向け: [docs/mcp-server.md](../mcp-server.md)（S4 で更新）
