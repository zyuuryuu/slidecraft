# SlideCraft MCP サーバ（`slidecraft serve`）

上流の AI エージェント（Claude Desktop / Claude Code など）から SlideCraft を駆動するための
**headless な stdio MCP サーバ**。エージェントがスライドの「中身」を考え、SlideCraft の
**決定論エンジン**がレイアウト・分割・検証・PPTX 生成を担う（harness-over-model）。

- **エージェント＝LLM**：サーバ自身は LLM を呼ばない。公開するのは決定論的な engine 操作だけ。
- **headless**：webview もブラウザも不要（Node プロセス）。WSL2 の GUI 問題とは無関係。
- **--no-fs（v1）**：`.slidecraft` / `.pptx` のバイト列は **base64 で stdio をやり取り**する。
  サーバはファイルシステムに一切触れない（信頼境界は「起動した親エージェント」＝OSユーザ）。

---

## ビルドと起動

```bash
npm install
npm run build:mcp        # → dist/mcp/cli.js を生成（esbuild, Node ESM）
node dist/mcp/cli.js      # stdio で MCP サーバとして待機（通常はエージェントが spawn する）
```

`--root` を渡すと現状はエラー終了する（scoped fs は次バージョン）。v1 は `--no-fs` のみ。

---

## エージェントへの接続（例：Claude Desktop）

`claude_desktop_config.json` の `mcpServers` に登録する（パスは絶対パス）：

```json
{
  "mcpServers": {
    "slidecraft": {
      "command": "node",
      "args": ["/absolute/path/to/slidecraft/dist/mcp/cli.js"]
    }
  }
}
```

Claude Code なら `claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js`
相当の登録でよい。登録後、エージェントから下記ツールが見える。

---

## ツール一覧

まず **`get_authoring_guide`** で「このテンプレでの書き方」を受け取ってから著作する。テンプレ base64 が無ければ
`create_template` で生成できる（テーマ3 で自己記述・構造操作・テンプレ調達・per-slide read・次の一手 hints を追加）。

| 種別 | ツール | 内容 |
|---|---|---|
| 入口 | `open_project(dataBase64)` | base64 の `.slidecraft` を読み込み。`{slideCount, diagnostics, contract}` |
| 入口 | `new_project(templateBase64, markdown?)` | base64 の `.pptx` テンプレ＋（任意）Markdown から新規（GUI の Draft と同じ parseMd→distill）。`{slideCount, diagnostics, contract}` |
| 調達 | `create_template(spec?)` | `TemplateSpec`（name＋fonts＋9色 palette・layouts 既定30）からテンプレ PPTX を生成し `{templateBase64, health, notices}`。欠落は MIDNIGHT preset 補完＋コントラスト自動修正。返り値を `new_project` に渡す |
| 調達 | `get_template_spec_guide()` | `create_template` 用 spec の書式ガイド＋MIDNIGHT preset 値 |
| 契約 | `get_authoring_guide()` | **著作の入口**：このテンプレのレイアウト名に解決した Markdown 書式・`<!-- col/kpi/step -->`・表/コード・本文 budget＋図/spec ガイドへのポインタ |
| 契約 | `get_diagram_types()` | 図の種類メニュー（authorable な12種＝type/label/hint） |
| 契約 | `get_diagram_guide(type)` | 選んだ図タイプの構文＋JSON例（`` ```diagram `` に書く DiagramSpec。他は `` ```mermaid `` で） |
| 読む | `get_deck` / `get_deck_markdown` | deck（DeckIR JSON）/ deck 全体の round-trip Markdown |
| 読む | `get_slide_markdown(index)` | 1スライドの素の Markdown（auto レイアウト解決済み） |
| 読む | `get_slide(index)` | 1スライドの**構造化 read**：resolvedLayout・hasFigure/figureKind・bulletCount・budget・overBudget・当該 issues・markdown（1呼び出しで編集計画） |
| 読む | `get_deck_issues` | 診断＝CONTENT レバー（split/condense/visualize/title）＋本文 `budget`＋次の一手 `hints`。※ export 可否は `validate_deck` |
| 読む | `get_template_capabilities` | テンプレ能力サマリ＋レイアウト一覧＋deck budget |
| 読む | `get_project_info` | テンプレ名・スライド数・dirty 等 |
| 読む | `get_slide_fix_request(index)` | 修正リクエスト packet（**エージェントが LLM として埋める**） |
| 編集(内容) | `set_slide_markdown(index, markdown)` | 1スライドを差し替え（図/mermaid 自動保持・zod 検証・不正は never-silent 拒否） |
| 編集(内容) | `set_deck_markdown(markdown)` | ⚠ deck 全体を置換（図は保持されない・1枚だけなら set_slide_markdown / insert_slide） |
| 編集(内容) | `split_overflowing_slides()` | 決定論レバー：溢れた本文をフォント縮小なしで分割。`changedSlides`（新 index）を返す |
| 編集(内容) | `convert_bullets_to_table(index)` | 決定論レバー：key-value 箇条書き → GFM 表。対象なしは `{ok:true, changed:false, status:"not-applicable"}` |
| 編集(内容) | `set_slide_diagram(index, source, format, placeholderIdx?)` | 図を DiagramSpec(yaml/json)/Mermaid で設定。図ありは置換、**text スライドは body 領域へ追加**（`created` で判別）。Mermaid はブラケット `A[label]` が必要 |
| 編集(内容) | `apply_design_intent(index, intent)` | 図に**空間意図**：`regionSplit`(text-left/right/diagram-only)/`emphasize`(nodeId)/`relayout`(TB/LR/RL/BT)。図を持つスライドのみ・`changed`/`skipped` で結果が分かる |
| 構造 | `insert_slide(index, markdown, position?)` | index の前/後に1枚挿入（他スライドの図は保持＝set_deck_markdown と違い surgical） |
| 構造 | `delete_slide(index)` | 削除（最後の1枚は never-silent 拒否・`deletedMd` を返す） |
| 構造 | `move_slide(fromIndex, toIndex)` | 純並べ替え（図/レイアウト保持・from===to は no-op） |
| 構造 | `duplicate_slide(index, position?)` | 複製（structuredClone で図/表/コードを byte-identical に） |
| 検証 | `validate_deck` | deck 検証＋`exportReadiness`（変換不能 mermaid スキャン） |
| 保存 | `save_project` | `.slidecraft` を生成し `{dataBase64}` |
| 出力 | `export_pptx(onUnsupportedMermaid?)` | `.pptx` を **native-vector で headless 生成**し `{dataBase64, skipped}` |
| host 専用 | `list_documents` / `select_document` / `close_document` / `undo` / `redo` | 協働ホストの複数ドキュメント lifecycle＋サーバ側 undo。各ドキュメント行/戻りに `contract` 同梱 |

### mutation の戻り（統一 envelope）

決定論 mutation（set_slide_markdown / set_deck_markdown / split / convert / set_slide_diagram / apply_design_intent /
insert / delete / move / duplicate）は**1つの兄弟 envelope**を返す：

```
{ ok: true, changed: boolean,          // changed:false = no-op（rev を進めない・deckChanged を出さない）
  beforeMd?, afterMd?,                  // 単一スライド op
  diagnostics: DeckIssue[], budget?,    // 編集後の診断＋本文容量
  hints: NextStepHint[],                // 次の一手（下記）※ server 層で付与
  skipped?, changedSlides?, created? }  // op 固有（design intent / split / set_slide_diagram）
```

**hints**（決定論・同じ deck→同じ hints）：`{ slideIndex, tool, reason, args? }`。overflow→`split_overflowing_slides`、
key-value→`convert_bullets_to_table(index)`、長い箇条書き/タイトル無し→`get_slide_fix_request(index)`。

### エラー契約

- **ドメイン拒否** → `{ ok: false, error }`（JSON・`isError` は付かない）。例：不正 Markdown、変換不能 Mermaid、
  最後の1枚削除、図の配置先なし。`convert_bullets_to_table` の「対象なし」は失敗ではなく `{ok:true, changed:false, status:"not-applicable"}`。
- **呼び出し/クラッシュ** → `isError: true`（本文はメッセージ文字列）。例：範囲外 index、プロジェクト未オープン。
- **楽観ロック（host）** → `{ ok: false, stale: true, expectedRev, currentRev, docId }`：`expectedRev` が現在 rev と
  不一致＝別の編集が先着。クライアントは再取得する。

> 補足：ガード系（範囲外/未オープン）を `{ok:false}` に寄せる throw→envelope の完全統一は将来の磨き込み（現状は上記2カテゴリで運用）。

---

## リソース（read-only state）

deck の状態は **MCP resource** としても公開する。tool を連打せず `resources/read` で
現在状態を取得できる（同じ engine セッションなので**常に最新の編集を反映**）。

これらは `get_deck` / `get_deck_markdown` / `get_deck_issues` / `get_template_capabilities` /
`get_project_info` / `get_slide_markdown` の各ツールと**同じ読み取りのミラー**。resource を
自律的に読めるクライアントでは resource が正、resource 非対応・人手添付しかできない
クライアントでは tool が確実な経路（どちらも残す＝削らない方針）。

| URI | 内容 | mime |
|---|---|---|
| `deck://current` | DeckIR（構造化 JSON） | application/json |
| `deck://markdown` | deck 全体の Markdown | text/markdown |
| `deck://issues` | 診断（レバー付き課題一覧） | application/json |
| `deck://capabilities` | テンプレートの能力＋レイアウト一覧 | application/json |
| `deck://info` | プロジェクトのメタ（テンプレ名・枚数・dirty） | application/json |
| `slide://{index}/markdown` | 1スライドの Markdown（`resources/list` で開いた deck の枚数分を列挙） | text/markdown |

プロジェクト未オープンで read すると、エンジンの「開かれていません」エラーが返る
（空 deck を偽装しない＝never-silent）。

---

## 典型的なループ（エージェント視点）

0. テンプレを調達：既存 `.slidecraft` を base64 化して `open_project`、または `.pptx` を `new_project`。bytes が
   無ければ `create_template({preset:"midnight"})` → 返った `templateBase64` を `new_project` に渡す。
1. 開いた戻りの `contract`（レイアウト名・区切り・budget・ポインタ）を読み、`get_authoring_guide` で全書式を、
   図を入れるなら `get_diagram_types` → `get_diagram_guide(type)` で構文を得る。
2. 著作/編集：`set_slide_markdown(i, md)` で1枚ずつ（budget 内に収める）、構造は `insert_/delete_/move_/duplicate_slide`、
   図は `set_slide_diagram`（text スライドにも追加可）。1枚の状態は `get_slide(i)` で構造化して把握。
3. mutation の戻りの `hints`（次の一手）に従う：溢れ→`split_overflowing_slides`、key-value→`convert_bullets_to_table(i)`、
   文章の手直し→`get_slide_fix_request(i)` で packet を取得しエージェントが Markdown を書いて再適用。
4. `validate_deck` で `exportReadiness` を確認。
5. `export_pptx` の `dataBase64` を**自分で `.pptx` に書き出す**（または `save_project` で `.slidecraft` を保存）。

> エンジンが「正しいレイアウト・フォント維持・テンプレ準拠」を保証するので、エージェントは
> **内容に集中**できる。これが harness-over-model の狙い。

---

## PPTX 出力の制約（headless）

- 14 種のネイティブ図と表は **編集可能な PPTX シェイプ**として出る（ラスタライザ不要）。
- 変換可能な Mermaid は自動でネイティブ図になる。
- **変換不能な Mermaid（gitGraph / sankey / C4 等）は headless では描けない**ため、
  `export_pptx` は既定で **reject**（無言消失させない）。`onUnsupportedMermaid: "skip"` を
  渡すと当該スライドを省略し `skipped` で報告する。`validate_deck` の `exportReadiness` で事前に分かる。

---

## データの送信（egress）について

- `slidecraft serve` 自身はクラウドにも LLM にも送信しない。
- ただし**エージェントに接続した時点で、deck の内容はそのエージェントのモデルに渡る**。
  これは「接続する」という選択そのものが opt-in の egress。機密スライドを扱う場合は、
  どのエージェント（ローカル/クラウド）に繋ぐかで判断する。
- GUI 側の AI Assist には別途「ローカルモデル限定モード」があり、そちらは GUI→LLM の
  送信を統治する（MCP 経路とは別の境界）。

---

## v1 の制限（今後の拡張）

- `--no-fs`（base64）のみ。`--root`（プロジェクトディレクトリ配下に限定した scoped fs）は次版。
- `generate_from_plan`（DeckPlan からの新規生成）は **作らない方針**（監査結論）。DeckPlan は
  エージェントが既に書ける内容で、Markdown にして `new_project` に渡せば同じ整形パス
  （parseMd→distillDeck）を通り、しかも `autoSelectLayout` で**任意テンプレに解決される**。
  別コードパス（`slidePlanToSlide` はレイアウト名ハードコードで alien テンプレに弱い）を
  増やす redundant を避ける。構造化入力が要るなら `new_project` の任意フォーマットとして畳む。
- 読み取りツールと `deck://` リソースは意図的な二重提供（上記「リソース」節参照）。削らない。
