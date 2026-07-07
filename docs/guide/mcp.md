# MCP 連携（AI エージェントから駆動する）

SlideCraft は、Claude Desktop や Claude Code などの **上流 AI エージェント**から
スライドを組み立てられる **headless な stdio MCP サーバ**（`slidecraft serve`）を備えています。

エージェント（LLM）がスライドの「中身」を考え、SlideCraft の**決定論エンジン**が
レイアウト選択・本文の分割・検証・PPTX 生成を担当します。役割を分けることで、
テンプレートのフォントや配色を崩さずに、整ったスライドを AI に任せて作れます。

- **エージェント＝LLM**：サーバ自身は LLM を呼びません。公開するのは決定論的な engine 操作だけです。
- **headless**：webview もブラウザも不要な Node プロセスです（GUI 版とは独立して動きます）。
- **クラウド送信なし**：`slidecraft serve` 自身は外部に送信しません（後述の egress の節を参照）。

::: tip このページの位置づけ
ここは「なぜ／どう繋ぐか」を掴むための**ユーザー向けの概観**です。
全ツールの引数・戻り値・エラー契約などの**詳細仕様**は
[docs/mcp-server.md（GitHub）](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md)
にまとまっています。
:::

---

## なぜ MCP か

視覚エディタ（[Markdown 記法](/guide/markdown-authoring) で書いて WYSIWYG で確認する使い方）や、
[内蔵オフライン AI](/guide/ai-setup) とは別に、MCP には次のような場面で価値があります。

- **手元のエージェントにスライド作成を任せたい** — 会話の流れで「この内容をスライドにして」と頼み、
  エージェントが SlideCraft のツールを呼んで組み立て、`.pptx` を書き出せます。
- **GUI を立ち上げずにバッチで回したい** — headless なので、webview を起動せずに
  スクリプト／エージェントから決定論的に生成できます。
- **エンジンの保証をそのまま使いたい** — レイアウトの自動選択・本文あふれの分割・テンプレ準拠を
  エンジンが保証するので、エージェントは**内容に集中**できます（harness-over-model）。

この分業のため、サーバが公開するのは「読む」「編集する」「検証する」「出力する」といった
決定論操作だけで、賢さ（何を書くか）はエージェント側に置きます。

---

## `slidecraft serve`（stdio MCP サーバ）

MCP サーバは stdio（標準入出力）で通信します。通常はエージェントがプロセスを spawn するため、
手動で常駐させる必要はありません。まずビルドしてエントリを用意します。

```bash
npm install
npm run build:mcp        # → dist/mcp/cli.js を生成（esbuild, Node ESM）
node dist/mcp/cli.js     # stdio で MCP サーバとして待機（通常はエージェントが起動する）
```

::: warning v1 の制限（--no-fs のみ）
現行版はファイルシステムに触れません。`.slidecraft` / `.pptx` のバイト列は
**base64 で stdio 経由**にやり取りします（信頼境界は「起動した親エージェント」＝OS ユーザー）。
プロジェクトディレクトリ配下に限定する scoped fs（`--root`）は次バージョン予定で、
現状 `--root` を渡すとエラー終了します。
:::

::: details ソースから動かす前提
`slidecraft serve` は純粋 TS エンジン（`src/engine/*`）だけを import し、DOM/Tauri に依存しません。
ソースからのビルドには Node.js 20+ が必要です（[インストール](/guide/installation) の「ソースから動かす」を参照）。
:::

---

## エージェントからの接続

### Claude Desktop

`claude_desktop_config.json` の `mcpServers` に登録します（パスは**絶対パス**で指定）。

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

### Claude Code

CLI から登録できます。

```bash
claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js
```

登録後、エージェントから SlideCraft のツール群（後述）が見えるようになります。

---

## スキル（SKILL.md）のセットアップ

MCP 接続で渡るのは**ツール**（エンジンの操作）です。加えて、エージェントに**「どう著作するか」の手順**を渡すと、
狙いどおりのデッキが安定して作れます。そのための手順書が
[`SKILL.md`](https://github.com/zyuuryuu/slidecraft/blob/main/SKILL.md) です — 接続 → テンプレ調達 →
`get_authoring_guide` → `set_slide_markdown` → 図 → `get_deck_issues` フィードバックループ →
`validate_deck`/`export_pptx` の流れと、never-silent・envelope・`data:image` のみ、等の契約を1枚にまとめています。

**渡し方（エージェント別）:**

- **Claude Code / Agent Skills** — `SKILL.md` を**スキルとして配置**します（frontmatter に `name` / `description` 付き）。
  リポジトリ内で作業させる場合はそのまま読まれます。
- **Claude Desktop など** — 会話の冒頭で `SKILL.md` の内容を**システム指示／コンテキストとして渡す**（貼り付け・添付）。

::: tip 実行時の契約が最優先
`SKILL.md` は**汎用の手順**です。いま読み込んでいるテンプレの**正確な書式・レイアウト名・本文 budget** は、
実行時に `get_authoring_guide()` が返す**自己記述コントラクト**が常に最新・正典です。エージェントには
「まず `get_authoring_guide` を読む」と伝えてください（`SKILL.md` にもそう明記しています）。
:::

---

## 主要ツールの概観

サーバは多数のツールを公開しますが、覚えるべき流れはシンプルです。まず **`get_authoring_guide`**
で「このテンプレでの書き方」を受け取り、それに沿って著作するのが基本です。

### 入口（プロジェクトを開く／作る）

| ツール | 役割 |
|---|---|
| `open_project(dataBase64)` | base64 の `.slidecraft` を読み込む。`{slideCount, diagnostics, contract}` を返す |
| `new_project(templateBase64, markdown?)` | base64 の `.pptx` テンプレ（＋任意の Markdown）から新規作成。GUI の Draft と同じ整形パスを通る |
| `create_template(spec?)` | テンプレの bytes が無いとき、名前＋フォント＋9 色パレットから**テンプレ PPTX を生成**して返す。欠落は preset で補完 |

### 契約を読む（書き方を知る）

| ツール | 役割 |
|---|---|
| `get_authoring_guide()` | **著作の入口**。このテンプレのレイアウト名に解決した Markdown 書式、区切りコメント（`<!-- col/kpi/step -->`）、表/コード、本文 budget、図ガイドへのポインタ |
| `get_diagram_types()` | 図の種類メニュー（authorable な **12 種**） |
| `get_diagram_guide(type)` | 選んだ図タイプの構文＋JSON 例 |

図の書き分けは視覚エディタと同じです。ネイティブ **12 種**は ` ```diagram `（DiagramSpec）に、
`class` / `state` / `ER` / `mindmap` は ` ```mermaid ` に書きます。詳しくは [図](/guide/diagrams) を参照してください。

### スライドの内容を読む／編集する

| ツール | 役割 |
|---|---|
| `get_slide(index)` | 1 スライドの**構造化 read**（解決レイアウト・図の有無・箇条書き数・budget・当該 issues・Markdown）。1 呼び出しで編集計画が立つ |
| `get_slide_markdown(index)` | 1 スライドの素の Markdown（レイアウト解決済み） |
| `set_slide_markdown(index, markdown)` | 1 スライドを差し替え（図/mermaid は自動保持・検証・不正は never-silent 拒否） |
| `set_slide_diagram(index, source, format, ...)` | 図を DiagramSpec/Mermaid で設定。図ありは置換、テキストスライドには本文領域へ追加 |
| `apply_design_intent(index, intent)` | 図に**空間意図**を反映（テキスト左/図右・ノード強調・向きの変更）※図を持つスライドのみ |

::: warning デッキ全体の置換に注意
`set_deck_markdown(markdown)` は deck 全体を置換し、**図は保持されません**。
1 枚だけ直したいときは `set_slide_markdown` や `insert_slide` を使ってください。
:::

### 構造操作（スライドの並び）

| ツール | 役割 |
|---|---|
| `insert_slide(index, markdown, position?)` | 前/後に 1 枚挿入（他スライドの図は保持＝surgical） |
| `delete_slide(index)` | 削除（最後の 1 枚は never-silent 拒否） |
| `move_slide(fromIndex, toIndex)` | 並べ替え（図/レイアウト保持） |
| `duplicate_slide(index, position?)` | 複製（図/表/コードを byte-identical に） |

### 決定論レバー（あふれ・整形の自動処理）

| ツール | 役割 |
|---|---|
| `split_overflowing_slides()` | 溢れた本文を**フォント縮小なしで**複数スライドに分割 |
| `convert_bullets_to_table(index)` | key-value の箇条書き → GFM 表（対象なしは「該当なし」で成功） |

### 検証・保存・出力

| ツール | 役割 |
|---|---|
| `validate_deck()` | deck 検証＋`exportReadiness`（変換不能な Mermaid をスキャン） |
| `save_project()` | `.slidecraft` を生成して `{dataBase64}` を返す |
| `export_pptx(onUnsupportedMermaid?)` | `.pptx` を native-vector で headless 生成して `{dataBase64, skipped}` を返す |

::: tip 変換不能な Mermaid の扱い
12 種のネイティブ図と表は編集可能な PPTX シェイプとして出ます。変換可能な Mermaid も自動でネイティブ図になります。
一方 **`gitGraph` / `sankey` / `C4` などは headless で描けない**ため、`export_pptx` は既定で reject します
（無言で消しません）。`onUnsupportedMermaid: "skip"` を渡すと当該スライドを省略し `skipped` で報告します。
事前チェックは `validate_deck` の `exportReadiness` で可能です。
:::

---

## 典型的なループ（エージェント視点）

エージェントが辿る流れは概ね次のとおりです。

0. **テンプレを調達** — 既存 `.slidecraft` を `open_project`、または `.pptx` を `new_project` に渡す。
   bytes が無ければ `create_template(...)` で生成し、返った `templateBase64` を `new_project` へ。
1. **契約を読む** — 開いた戻りの `contract` と `get_authoring_guide` で書式を把握。図を入れるなら
   `get_diagram_types` → `get_diagram_guide(type)` で構文を得る。
2. **著作／編集** — `set_slide_markdown(i, md)` で 1 枚ずつ（budget 内に収める）。構造は
   `insert_/delete_/move_/duplicate_slide`、図は `set_slide_diagram`。状態は `get_slide(i)` で構造化して確認。
3. **次の一手に従う** — 編集の戻りに付く `hints`（決定論・同じ deck なら同じ hints）に従う。
   あふれ→`split_overflowing_slides`、key-value→`convert_bullets_to_table(i)`。
4. **検証** — `validate_deck` で `exportReadiness` を確認。
5. **出力** — `export_pptx` の `dataBase64` を自分で `.pptx` に書き出す（または `save_project` で `.slidecraft` を保存）。

::: details エラーの返り方（概略）
拒否はすべて `{ ok: false }` の JSON で返り、想定外の例外だけが `isError: true` になります。
ドメイン拒否（不正 Markdown・最後の 1 枚削除など）は `error` のみ、ガード拒否（範囲外 index・未オープンなど）は
機械可読な `code` が付きます。完全な契約は
[docs/mcp-server.md](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md) を参照してください。
:::

---

## 協働ホストモード（GUI 起動 → AI が接続）

上の使い方は「エージェントがサーバを spawn する」headless 経路ですが、**GUI（デスクトップ版）が
ホストになる**協働モードもあります。GUI が起動時にサーバを内包し、そこへ AI が接続して編集する形です。

- **複数ドキュメントの lifecycle** — `list_documents` / `select_document` / `close_document` と、
  サーバ側の `undo` / `redo` を公開します（host 専用）。
- **登録済みテンプレの活用** — GUI が `register_templates` で master レジストリを host に投入すると、
  AI は `list_templates` で一覧を見て `use_template(id, markdown?)` で**新規プロジェクトを mint** できます。
  bytes を運ばずにテンプレを選べるため、host 経由ではこれが最短です。

これにより、人が GUI で見ている deck に対して AI が接続して編集し、その結果を人が確認する、
という協働が可能になります。GUI と AI で編集が競合した場合は楽観ロックで検出され、クライアントが再取得します。

---

## データの送信（egress）について

- `slidecraft serve` 自身はクラウドにも LLM にも送信しません。
- ただし**エージェントに接続した時点で、deck の内容はそのエージェントのモデルに渡ります**。
  「接続する」という選択そのものが opt-in の egress です。機密スライドを扱う場合は、
  ローカル/クラウドのどちらのエージェントに繋ぐかで判断してください。
- GUI 側の AI Assist には別途「ローカルモデル限定モード」があり、そちらは GUI → LLM の送信を統治します
  （MCP 経路とは別の境界）。詳しくは [AI設定](/guide/ai-setup) を参照してください。

---

## 関連ページ

- [図（ダイアグラム）](/guide/diagrams) — `diagram` フェンスの 12 種と `mermaid` の書き方
- [Markdown 記法](/guide/markdown-authoring) — エージェントが書く Markdown の文法
- [テンプレート](/guide/templates) — `.pptx` の取り込みと新規作成
- [AI設定](/guide/ai-setup) — 内蔵オフライン AI とローカルモデル限定モード
- [FAQ](/guide/faq) — よくある質問
- [docs/mcp-server.md（GitHub）](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md) — 全ツール・リソース・エラー契約の詳細仕様
