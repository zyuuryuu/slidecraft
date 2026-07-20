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

## セットアップ — 2 通り

MCP サーバは stdio（標準入出力）で通信し、通常はエージェントがプロセスを spawn します。**MCP サーバはアプリに同梱されている**ので、多くの場合ビルド不要です。

### A. パッケージ版から使う（ビルド不要・推奨）

配布インストーラ（brew / .msi / .AppImage）には、**自己完結した MCP サーバ（`cli.cjs`）と Node ランタイムが同梱**されています（**v0.2.0 で同梱**）。システムに Node が無くても、ソースを clone しなくても動きます。

**macOS（Homebrew）** — cask が `slidecraft-mcp` を PATH に置くので、そのまま登録できます：

```bash
brew install --cask zyuuryuu/slidecraft/slidecraft   # 済みなら不要
claude mcp add slidecraft -- slidecraft-mcp           # Claude Code の場合
```

Claude Desktop / Cursor など mcp.json で登録する場合は `{"command": "slidecraft-mcp"}` を書きます。ランチャを使わず、同梱 node ＋ cli.cjs を直接指す方法は [MCP サーバ仕様](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md) の「使い方は 2 通り」を参照してください。

### B. ソースから起動（開発版）

ソースを clone してビルドします。エージェント連携の改造や engine のデバッグ向けです。

```bash
npm install
npm run build:mcp        # → dist/mcp/cli.js を生成（esbuild, Node ESM。node_modules 外部化＝リポジトリ内で実行）
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

**パッケージ版（A・推奨）**の登録例です。macOS で brew 導入済みなら `slidecraft-mcp` がそのまま使えます。

### Claude Code

```bash
claude mcp add slidecraft -- slidecraft-mcp
```

### Claude Desktop / Cursor

`claude_desktop_config.json`（Cursor は `~/.cursor/mcp.json` またはプロジェクト直下 `.cursor/mcp.json`）の `mcpServers` に登録します。

```json
{
  "mcpServers": {
    "slidecraft": {
      "command": "slidecraft-mcp"
    }
  }
}
```

### GitHub Copilot（VS Code）

Copilot だけ**設定スキーマが違います**。キーは `mcpServers` ではなく **`servers`**、そして各サーバに **`"type": "stdio"`** が要ります。ワークスペースなら `.vscode/mcp.json` に:

```json
{
  "servers": {
    "slidecraft": {
      "type": "stdio",
      "command": "slidecraft-mcp"
    }
  }
}
```

ユーザ全体に入れる場合は VS Code の `settings.json` の `"mcp": { "servers": { ... } }` 配下でも同じ形です。

::: details Windows / Linux、またはソース版（B）で登録する
`slidecraft-mcp` の PATH 登録は現状 macOS/Homebrew のみです。Windows/Linux は **同梱 node ＋ `cli.cjs` の絶対パス**（インストール先を要確認）で登録します（`command` を同梱 node、`args` を `["/絶対パス/resources/cli.cjs"]` に）。ソース版（B）なら `command` を `node`、`args` を `["/absolute/path/to/slidecraft/dist/mcp/cli.js"]`（絶対パス）に。Claude Code では `claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js`。Copilot は上記いずれの場合も `"type": "stdio"` を併記します。直接パスの詳細は [MCP サーバ仕様](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md) を参照してください。
:::

登録後、エージェントから SlideCraft のツール群（後述）が見えるようになります。

::: warning HTTP エンドポイントを直接登録しないでください（アンチパターン）
どのクライアントでも、登録するのは上記の **stdio コマンド（`slidecraft-mcp`）1本**です。GUI 協働ホストの
**HTTP エンドポイント（`http://127.0.0.1:ポート/mcp`＋Bearer トークン）を直接**エージェントに登録しないでください。
協働ホストの**ポートはエフェメラル・トークンは起動ごとにローテーション**する設計（セキュリティ上わざと固定しません）なので、
直接登録すると **GUI を再起動するたびに設定を書き換える**羽目になります。

`slidecraft-mcp` を登録しておけば、CLI が起動時に自動でホストを discover し、GUI 稼働中はその HTTP ホストへ
**中継（forward）**します（ポート/トークンは CLI が内部で取得＝**あなたは触りません**）。GUI が無ければ solo で動きます。
＝**1つの静的設定のまま、協働も単独も自動で切り替わり、port/token を追いかける作業が消えます**（アダプティブ・フロント・ADR-0033）。

もし既に HTTP 直登録している場合は、その登録を削除して stdio コマンドに置き換えてください
（Claude Code: `claude mcp remove slidecraft` → `claude mcp add slidecraft -- slidecraft-mcp`）。
:::

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
| `get_slide(index)` | 1 スライドの**構造化 read**（解決レイアウト・図の有無・箇条書き数・budget・capacity（本文容量の実測）・predictedSplit（分割ドライラン）・当該 issues・Markdown）。1 呼び出しで編集計画が立つ |
| `get_slide_markdown(index)` | 1 スライドの素の Markdown（レイアウト解決済み） |
| `get_slide_image(index)` | 1 スライドの**現在の描画を PNG で返す**（AI の視覚デザインチェック）。preview / HTML 書き出しと同じ共有描画をローカルの Chrome/Edge で撮る。任意機能（後述） |
| `get_slide_html(index)` | 1 スライドの**現在の描画を自己完結 HTML 文字列で返す**（`get_slide_image` と同じ共有描画・script ゼロ・フォント埋め込み済）。ローカルに Chrome/Edge が無い環境でも、呼び出し側の任意の手段でラスタ化できる |
| `set_slide_markdown(index, markdown)` | 1 スライドを差し替え（図/mermaid は自動保持・検証・不正は never-silent 拒否） |
| `set_slide_diagram(index, source, format, ...)` | 図を DiagramSpec/Mermaid で設定。図ありは置換、テキストスライドには本文領域へ追加 |
| `apply_design_intent(index, intent)` | 図に**空間意図**を反映（テキスト左/図右・ノード強調・向きの変更）※図を持つスライドのみ |

::: warning デッキ全体の置換に注意
`set_deck_markdown(markdown)` は deck 全体を置換し、**図は保持されません**。
1 枚だけ直したいときは `set_slide_markdown` や `insert_slide` を使ってください。
:::

::: tip 視覚チェック（`get_slide_image`）にはブラウザが要る
`get_slide_image` はマシンに既にある **Chrome/Edge だけ**で撮ります（**同梱も自動ダウンロードもしません** —
陳腐化した＝穴の開いたブラウザを配らないため）。未検出でも黙って失敗せず `{ok:false, code:"browser-not-found"}` で
案内します（`SLIDECRAFT_BROWSER` でパス指定可）。撮影はネット遮断・使い捨てプロファイルで行い、埋め込みフォントの
おかげで CJK でも文字化けしません。**任意機能**なので、ブラウザが無くても著作・出力は成立します。
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

## 協働ホストモード（GUI 起動 → AI が同じ deck へ相乗り）

登録するコマンドは1つ（`slidecraft serve` / `slidecraft mcp`）で、**GUI が起動中かどうかを起動時に自動判定**します
（アダプティブ・フロント・ADR-0033）。GUI が協働ホストを稼働していれば AI はそこへ**相乗り**し、人が見ている deck を
一緒に編集できます（居なければ単独で動く）。**MCP 設定を2つ書き分ける必要はありません**。

- **複数ドキュメントの lifecycle** — `list_documents` / `select_document` / `close_document`。GUI 協働では
  複数 doc を跨げます（単独モードでも同じツールは在りますが 1 doc なので実質 no-op）。
- **サーバ側 `undo` / `redo`** — deck の真実を1手戻す／やり直す。**単独モードでも効きます**（管制を1つに統一した
  ADR-0033 D1 の成果）。
- **登録済みテンプレの活用** — GUI が `register_templates` で master レジストリを host に投入すると、
  AI は `list_templates` で一覧を見て `use_template(id, markdown?)` で**新規プロジェクトを mint** できます。
  bytes を運ばずにテンプレを選べるため、host 経由ではこれが最短です（単独モードはテンプレ bytes か `create_template`）。

人が GUI で見ている deck に AI が相乗りして編集し、人が結果を確認する協働が成立します。編集が競合した場合は
楽観ロックで検出され、クライアントが再取得します。

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
