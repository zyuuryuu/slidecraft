# SlideCraft MCP サーバ（`slidecraft serve`）

上流の AI エージェント（Claude Desktop / Claude Code など）から SlideCraft を駆動するための
**headless な stdio MCP サーバ**。エージェントがスライドの「中身」を考え、SlideCraft の
**決定論エンジン**がレイアウト・分割・検証・PPTX 生成を担う（harness-over-model）。

- **エージェント＝LLM**：サーバ自身は LLM を呼ばない。公開するのは決定論的な engine 操作だけ。
- **headless**：webview もブラウザも不要（Node プロセス）。WSL2 の GUI 問題とは無関係。
- **--no-fs（既定）**：`.scft` / `.pptx` のバイト列は **base64 で stdio をやり取り**する。
  サーバはファイルシステムに一切触れない（信頼境界は「起動した親エージェント」＝OSユーザ）。
- **`--root <dir>`（opt-in・ADR-0035）**：指定すると `export_pptx`/`save_project`（出力）と
  `open_project`/`new_project`（入力）は base64 の代わりに **`<dir>` 配下のファイルで受け渡し**できる
  （大きいデッキで base64 の +33% と AI コンテキスト圧迫を避ける）。既定（`--no-fs`）は非破壊で温存。
  詳細は下記「scoped fs 入出力」。

---

## 使い方は 2 通り

MCP サーバはアプリに**同梱**されているので、通常はビルド不要です。開発者はソースから起動もできます。

### A. パッケージ版から使う（ビルド不要・推奨）

配布インストーラ（brew / .msi / .AppImage）には、**自己完結した MCP サーバ（`cli.cjs`）と Node ランタイムが同梱**されています。システムに Node が無くても、ソースを clone しなくても動きます（v0.1.1 以降）。

**macOS（Homebrew）** — cask が `slidecraft-mcp` を PATH に置くので、そのまま登録できます：

```bash
brew install --cask zyuuryuu/slidecraft/slidecraft   # 済みなら不要
claude mcp add slidecraft -- slidecraft-mcp
```

**macOS** はランチャを使わず**直接**登録することもできます（同梱 node ＋ 同梱 cli.cjs を指す。パスは検証済み）：

```json
{
  "mcpServers": {
    "slidecraft": {
      "command": "/Applications/SlideCraft.app/Contents/MacOS/node",
      "args": ["/Applications/SlideCraft.app/Contents/Resources/cli.cjs"]
    }
  }
}
```

**Windows（`.exe` / `.msi`）・Linux（`.deb` / `.rpm`）** — **v0.5.1 以降**のインストーラは macOS と同じく **`slidecraft-mcp` を PATH に置きます**（ユーザ単位・アンインストールで除去・インストーラのログに表示）。登録は同じ 1 行です（#519）：

```bash
claude mcp add slidecraft -- slidecraft-mcp
```

インストール先を調べる必要はありません。仕組みは次のとおり（ランチャは同梱 Node で同梱 `cli.cjs` を起動するだけ。system Node 不要）：

| 形式 | PATH に載るもの | ランチャの実体 |
|---|---|---|
| Windows NSIS（`*_x64-setup.exe`） | インストール先フォルダ（既定 `%LOCALAPPDATA%\SlideCraft`）を**ユーザ PATH**（`HKCU\Environment\Path`）に追加。インストーラの「詳細」に表示され、アンインストールで除去 | `slidecraft-mcp.cmd` — 同じフォルダの `node.exe` で `cli.cjs` を実行（Tauri は resources と sidecar をインストール先に**平置き**する） |
| Windows MSI（`*_x64_en-US.msi`） | インストール先（既定 `C:\Program Files\SlideCraft\`）をユーザ PATH に追加（Windows Installer の Environment テーブル＝アンインストール/失敗時ロールバックで除去） | 同上 |
| Linux `.deb` / `.rpm` | `/usr/bin/slidecraft-mcp`（sh） | `/usr/bin/node`（同梱 sidecar）で `/usr/lib/SlideCraft/cli.cjs` を実行 |
| Linux AppImage | 自動では載らない（マウント先が起動ごとに変わる）。`./SlideCraft_<ver>_amd64.AppImage --appimage-extract` で展開し、`squashfs-root/usr/bin/slidecraft-mcp` の**絶対パス**を `command` に登録する | 同上（展開先相対で解決） |

Windows の注意点：

- PATH の反映は**インストール後に新しく開いたターミナル**から（開いたままのターミナルには反映されない）。
- インストール先にあるランチャは `slidecraft-mcp.cmd` の 1 つだけです（`where slidecraft-mcp` は 1 件を返します）。macOS 用の sh 版 `slidecraft-mcp` は Windows には入りません（#537）。
- `slidecraft-mcp` は `.cmd` ファイルです。クライアントが `.cmd` を直接 spawn できない場合（Claude Code の Windows ネイティブ版で `npx` に `cmd /c` が要るのと同じ事情）は `claude mcp add slidecraft -- cmd /c slidecraft-mcp`、mcp.json なら `{"command": "cmd", "args": ["/c", "slidecraft-mcp"]}` を使ってください。1 行登録で接続に失敗する場合はこの形を試し、結果を Issue で知らせてもらえると助かります。
- ユーザ PATH が極端に長い（約 1,000 文字超）場合、NSIS インストーラは **PATH を壊さないために編集を見送り**、追加すべきフォルダをダイアログで案内します。その場合は手で追加してください。
- ランチャを使わず直接登録するなら `command` = `<インストール先>\node.exe`、`args` = `["<インストール先>\cli.cjs"]`（両方とも同じフォルダ）。

> **v0.5.0 以前**のインストーラにはランチャが入っていません（`.deb` に `/usr/bin/slidecraft-mcp` は無い）。その場合は上の直接パス指定（Linux: `/usr/bin/node` ＋ `/usr/lib/SlideCraft/cli.cjs`）か、**ソースからの起動（B）**を使ってください。

### B. ソースから起動（開発版）

```bash
npm install
npm run build:mcp        # → dist/mcp/cli.js を生成（esbuild, Node ESM。node_modules は外部化＝リポジトリ内で実行）
node dist/mcp/cli.js      # stdio で MCP サーバとして待機（通常はエージェントが spawn する）
```

登録は `claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js` 相当。

> **`build:mcp`（B）** は node_modules を外部化した開発用（リポジトリ内でのみ動く）。**アプリ同梱（A）** は `build:mcp:bundled` で全依存を内包した `cli.cjs`。用途が違うので混同しないこと。

既定は `--no-fs`（base64）。`--root <dir>` を渡すと scoped fs 入出力（下記）が有効になる。登録後、エージェントから下記ツールが見える。

---

## 接続モデル — 口は1つ・管制も1つ（アダプティブ・フロント）

エージェント側に登録するコマンドは **`slidecraft serve`（別名 `slidecraft mcp`）の1つだけ**。「1アプリに
MCP 設定を複数」書く必要はない（ADR-0033 D2）。このコマンドは**起動時に**、デスクトップ GUI が協働ホストを
稼働中か discover（`host.json` を読む）し、状況で振る舞いを変える：

- **GUI 稼働中 → forward**：この stdio セッションを GUI の HTTP ホストへ**状態ゼロで中継**する。deck の真実と
  undo 履歴は GUI 側の管制（`DocRegistry`）にだけ在り、人は編集をライブで見る。doc は `select_document`
  （または sole doc 自動解決）で選ぶ。
- **GUI 無し / stale → solo**：同じコマンドが**自前の単一ドキュメント管制**を建てる。著作一式に加えサーバ側
  `undo`/`redo` も効く（ADR-0033 D1）。

どちらでも**管制（deck 権威＋undo）は常に1つ**で、モードは利用者が選ばない（rendezvous は起動時に1度だけ決まる。
GUI が途中で立ち上がっても再アタッチはしない＝D2 の明示スコープ）。discovery のための `host.json` 読取は
`--no-fs` 方針の**狭い意図的例外**（0600 のハンドシェイクファイルを1回読むだけ・deck 内容には触れない）。

---

## ツール一覧

まず **`get_authoring_guide`** で「このテンプレでの書き方」を受け取ってから著作する。テンプレ base64 が無ければ
`create_template` で生成できる（テーマ3 で自己記述・構造操作・テンプレ調達・per-slide read・次の一手 hints を追加）。

| 種別 | ツール | 内容 |
|---|---|---|
| 入口 | `open_project(dataBase64?, path?)` | `.scft` を読み込み。既定は base64。`--root` scope 起動時は `path`（scope 配下のファイル名）でも渡せる（両方指定はエラー・下記「scoped fs 入出力」）。`{slideCount, diagnostics, contract}` |
| 入口 | `new_project(templateBase64?, templatePath?, markdown?)` | `.pptx` テンプレ＋（任意）Markdown から新規（GUI の Draft と同じ parseMd→distill）。既定は base64。`--root` scope 起動時は `templatePath` でも渡せる（両方指定はエラー）。`{slideCount, diagnostics, contract}` |
| コールド一括 | `bootstrap(docId?)` | **セッション開始時に1回**：コールド系（調達・契約）を1レスポンスで返す＝`authoringGuide`・`diagramTypes`・`templateSpecGuide`・`templateCapabilities`・`templates` の各節（内容は同名の旧 `get_*`/`list_*` ツールと deep-equal 同一・R8）＋ `toolNotes`（ツール説明文から移したツール共通の約束＝docId 解決・opId/expectedRev・0-based・get_slide の返却項目・図/配置の op 文法・構造操作の保持規則。doc 未オープンでも返る・#513）。図タイプ別構文のみ `get_diagram_guide(type)` で個別取得（12種同梱は実測約22,400字のため見送り・#464）。doc 未オープン時は doc 依存節（`authoringGuide`/`templateCapabilities`）が `{ok:false, code}` で埋まり他節は返る。旧6ツールは alias として存続（ADR-0037 D2/D4・ADR-0008 フロア） |
| 調達 | `create_template(spec?)` | `spec` は `TemplateSpec` の **JSON 文字列**（オブジェクト不可・例 `spec: '{}'`。name＋fonts＋9色 palette・layouts 既定30）からテンプレ PPTX を生成し `{templateBase64, health, notices}`。欠落は MIDNIGHT preset 補完＋コントラスト自動修正。返り値を `new_project` に渡す |
| 調達 | `get_template_spec_guide()` | `create_template` 用 spec の書式ガイド＋MIDNIGHT preset 値 |
| 調達 | `list_templates()` | テンプレ一覧 `{templates:[{id,name,builtin}], note?}`。host（GUI が `register_templates` で投入した master レジストリ）が接続済みならそれを、**単独（GUI 未接続の stdio）は組み込みプリセット**（`builtin:true`、既定 `midnight`）を返す（#298）。**`--root` 起動時は `<root>/templates/*.{pptx,potx}` も反映**（`builtin:false`・`id` は `file:` 始まり・`path` にベア名。下記「scope テンプレ discovery」#332）。builtin のみに見える単独では `note` で回避策を案内。id を `use_template` へ |
| 調達 | `use_template(id, markdown?)` | テンプレ（`list_templates` の id）から**新規プロジェクトを mint**（bytes 不要・GUI の Draft と同じ整形）。単独の組み込み id は `create_template` と同じハーネスで生成（R8）、**`file:` 始まりの id は `--root` 配下 `templates/` のファイルから起票**（#332）。未知 id は never-silent `{ok:false, code:"unknown-template"}`、`file:` で scope 未設定は `scope-not-configured`・不在は `scope-file-not-found`。既存 doc のテンプレ入替ではない |
| 契約 | `get_authoring_guide()` | **著作の入口**：このテンプレのレイアウト名に解決した Markdown 書式・`<!-- col/kpi/step -->`・表/コード・`<!-- note -->` スピーカーノート・本文 budget・`activeReviewRules:[{id,level}]`（`get_deck_issues` と同一レジストリ由来のレビュー規則一覧・#244）＋図/spec ガイドへのポインタ |
| 契約 | `get_diagram_types()` | 図の種類メニュー（authorable な12種＝type/label/hint） |
| 契約 | `get_diagram_guide(type)` | 選んだ図タイプの構文＋JSON例（`` ```diagram `` に書く DiagramSpec。他は `` ```mermaid `` で） |
| 読む | `get_deck` / `get_deck_markdown` | deck（DeckIR JSON）/ deck 全体の round-trip Markdown |
| 読む | `get_slide_markdown(index)` | 1スライドの素の Markdown（auto レイアウト解決済み） |
| 読む | `get_slide(index)` | 1スライドの**構造化 read**：resolvedLayout・hasFigure/figureKind・bulletCount・budget・overBudget・**capacity**（`{usedLines, maxLines}`＝本文容量の実測、残容量% = usedLines/maxLines。図/複数本文スライドは null）・**predictedSplit**（`{chunks, boundaries}`＝`split_overflowing_slides` を実行せず何枚に割れるかの dry-run。溢れなければ undefined。予測は distill.ts の実装関数そのものを呼ぶので実行結果と必ず一致・#149）・当該 issues・notes（`<!-- note -->` スピーカーノート本文、無ければ null）・sectionBreak（章扉宣言）・derived（`"toc"`=導出専用の目次スライド、markdown はマーカー 1 行）・markdown（1呼び出しで編集計画） |
| 読む | `get_deck_issues` | 診断＝CONTENT レバー（split/condense/visualize/title）＋本文 `budget`＋次の一手 `hints`。※ export 可否は `validate_deck` |
| 読む | `get_template_capabilities` | テンプレ能力サマリ＋レイアウト一覧＋deck budget |
| 読む | `get_project_info` | テンプレ名・スライド数・dirty 等 |
| 読む | `get_slide_fix_request(index)` | 修正リクエスト packet（**エージェントが LLM として埋める**） |
| 視覚 | `get_slide_image(index)` | 1スライドの**現在の描画を PNG**（image content）で返す＝AI の視覚デザインチェック用。共有 HTML 描画（フォント埋め込み済・preview/HTML 書き出しと同一の painter）をローカルの Chrome/Edge で撮る。ブラウザ調達・閉じ込めは下記「スクショの前提」参照。tool-only（`deck://` ミラー無し・ADR-0008） |
| 視覚 | `get_slide_html(index)` | 1スライドの**現在の描画を自己完結 HTML 文字列**で返す＝`get_slide_image` と同一の共有 HTML（script ゼロ・CSP・フォント埋め込み済）。ローカル Chrome/Edge が無い環境向け＝呼び出し側の任意の手段でラスタ化できる。`slide://{index}/html` リソースにも同じ内容がある |
| 視覚 | `get_deck_image(start?, columns?, maxSlides?)` | deck **全枚（または `start` からの範囲）のサムネイルを 1 枚の PNG**（image content＋`{from,count,total,columns,width,height,truncated,nextStart?}` の text 1 行）で返す＝**仕上がり確認は最後にこれを 1 回**（#522・1 枚ずつ `get_slide_image` を呼ぶ 29 往復を 1 往復に）。各セルは `get_slide_image` と**同一の共有描画**を CSS で縮小したもの（第 2 の描画経路なし・R8）で、左上に 0-based index を描く。既定 5 列・最大 30 枚・幅 1920px（30 枚で約 180KB・画素予算 3.2Mpx を超える列数指定は幅を自動縮小）。超過分は `truncated:true`＋`nextStart` で続きを取る。ブラウザ要件・未検出時の案内は `get_slide_image` と同じ。細部を読むなら `get_slide_image(index)` |
| 視覚 | `get_deck_html(start?, columns?, maxSlides?)` | `get_deck_image` と同一のコンタクトシートを**自己完結 HTML 文字列**で返す（`{html, from, count, total, columns, width, height, truncated, nextStart?}`・script ゼロ・CSP・フォント埋め込み済）。ブラウザ無し環境向け |
| 編集(内容) | `set_slide_markdown(index, markdown)` | 1スライドを差し替え（図/mermaid 自動保持・zod 検証・不正は never-silent 拒否） |
| 編集(内容) | `set_deck_markdown(markdown)` | ⚠ deck 全体を置換（図は保持されない・1枚だけなら set_slide_markdown / insert_slide） |
| 編集(内容) | `split_overflowing_slides()` | 決定論レバー：溢れた本文をフォント縮小なしで分割。`changedSlides`（新 index）を返す |
| 編集(内容) | `convert_bullets_to_table(index)` | 決定論レバー：key-value 箇条書き → GFM 表。対象なしは `{ok:true, changed:false, status:"not-applicable"}` |
| 編集(内容) | `set_slide_diagram(index, source, format, placeholderIdx?)` | `source` は DiagramSpec(yaml/json)/Mermaid の **JSON/YAML/Mermaid 文字列**（オブジェクト不可・例 `source: '{"type":"flowchart","nodes":[...],"edges":[...]}'`）。図ありは置換、**text スライドは body 領域へ追加**（`created` で判別）。Mermaid はブラケット `A[label]` が必要 |
| 編集(内容) | `apply_design_intent(index, intent)` | `intent` は ops 配列の **JSON 文字列**（オブジェクト不可・例 `intent: '[{"op":"relayout","direction":"LR"}]'`）で**空間意図**：`regionSplit`(text-left/right/diagram-only)/`emphasize`(nodeId)/`relayout`(TB/LR/RL/BT)。図を持つスライドのみ・`changed`/`skipped` で結果が分かる |
| 構造 | `insert_slide(index, markdown, position?)` | index の前/後に1枚挿入（他スライドの図は保持＝set_deck_markdown と違い surgical） |
| 構造 | `delete_slide(index)` | 削除（最後の1枚は never-silent 拒否・`deletedMd` を返す） |
| 構造 | `move_slide(fromIndex, toIndex)` | 純並べ替え（図/レイアウト保持・from===to は no-op） |
| 構造 | `duplicate_slide(index, position?)` | 複製（structuredClone で図/表/コードを byte-identical に） |
| 検証 | `validate_deck` | deck 検証＋`exportReadiness`（変換不能 mermaid スキャン） |
| 保存 | `save_project(filename?)` | `.scft` を生成。既定 `{dataBase64}`。`--root` scope 起動時は scope 配下へ書き出し `{path}`（下記「scoped fs 出力」） |
| 出力 | `export_pptx(onUnsupportedMermaid?, filename?)` | `.pptx` を **native-vector で headless 生成**。既定 `{dataBase64, skipped}`。`--root` scope 起動時は `{path, skipped}` |
| lifecycle | `list_documents` / `select_document` / `close_document` / `undo` / `redo` | 複数ドキュメント lifecycle＋サーバ側 undo/redo。各ドキュメント行/戻りに `contract` 同梱。**doc 切替 3 本（list/select/close）は collab 専用** — solo（stdio 単独）は常に 1 doc なので登録されない（プロファイル別登録・ADR-0037 D2／#465）。**`undo`/`redo` は solo でも登録され本当に効く**（ADR-0033 D1）。collab では複数 doc を跨ぐ |
| host 専用(GUI) | `register_templates(templates[])` | GUI のみ：webview の master レジストリを host へ投入（`{id,name,builtin,bytesBase64}` の配列・呼ぶ度に全置換）。AI ロール・solo には非公開（solo は GUI が繋がらずレジストリの投入元が無い）。これで AI が `list_templates`/`use_template` で選べる |

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
- **ガード拒否** → `{ ok: false, error, code }`（JSON・`isError` は付かない）。例：範囲外 index（`code:"index-out-of-range"`）、
  プロジェクト未オープン（`code:"project-not-opened"`）、host の doc 未選択（`code:"document-not-selected"`）。`code` は機械可読な理由で、ガード拒否にのみ付く（ドメイン拒否には付かない）。
- **未モデル化クラッシュ** → `isError: true`（本文はメッセージ文字列）。想定外の例外のみ（ガード/ドメイン拒否は上記の通り `{ok:false}` で返る）。
- **楽観ロック（host）** → `{ ok: false, stale: true, expectedRev, currentRev, docId }`：`expectedRev` が現在 rev と
  不一致＝別の編集が先着。クライアントは再取得する。

> 契約：拒否は全て `{ok:false}`（ドメイン＝`error` のみ／ガード＝`error`＋`code`）で返り、`isError:true` は未モデル化クラッシュ専用。
> engine/session の直接呼び出しはガードで throw（`GuardError`）するが、MCP サーバの `fail()` が envelope に変換する。

**成功側の判定（Issue #246）**：**成功 = `{ok:false}` でも `isError:true` でもない**。この1行だけで
全ツールの成否判定が閉じる — `create_template`/`close_document`/mutation 系のように payload に
`ok` フィールドがある場合は `ok:false` かどうかを見ればよく、`run()` を通る read 系（`get_deck` 等）と
`export_pptx` は payload をそのまま返し `ok` キー自体を持たない＝`ok:false` が無い時点で成功。read 系に
`ok:true` を後付けで巻かない方針（下記リソースの節と対称・巻くと `deck://current` 等のミラー等価が
崩れる）。判定を機械化したい場合は `src/mcp/result-contract.ts` の `isOk(result)` を使う（生 payload・
`CallToolResult` のどちらを渡しても同じ規約で判定する）。

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

0. テンプレを調達：既存 `.scft` を base64 化して `open_project`、または `.pptx` を `new_project`。bytes が
   無ければ `create_template({preset:"midnight"})` → 返った `templateBase64` を `new_project` に渡す。
   `list_templates` → `use_template(id, markdown?)` で選ぶのが最短（bytes を運ばない）：host（GUI 協働）では
   登録済みテンプレを、**単独（GUI 未接続）でも組み込みプリセット**（`midnight` 等）を一覧できるので同じ流れで着手できる。
   サーバが `--root <dir>` scope で起動していれば、base64 の代わりに `open_project({path})` /
   `new_project({templatePath})` で scope 配下のファイルを直接開ける（下記「scoped fs 入出力」）。
1. 開いた戻りの `contract`（レイアウト名・区切り・budget・ポインタ）を読み、`get_authoring_guide` で全書式を、
   図を入れるなら `get_diagram_types` → `get_diagram_guide(type)` で構文を得る。
   **往復を減らすなら `bootstrap()` 1回**で 0〜1 のコールド読み（書式・図メニュー・spec ガイド・能力・テンプレ一覧）を
   まとめて受け取れる（各節は旧ツールと同一内容・ADR-0037 D2）。
2. 著作/編集：`set_slide_markdown(i, md)` で1枚ずつ（budget 内に収める）、構造は `insert_/delete_/move_/duplicate_slide`、
   図は `set_slide_diagram`（text スライドにも追加可）。1枚の状態は `get_slide(i)` で構造化して把握。
3. mutation の戻りの `hints`（次の一手）に従う：溢れ→`split_overflowing_slides`、key-value→`convert_bullets_to_table(i)`、
   文章の手直し→`get_slide_fix_request(i)` で packet を取得しエージェントが Markdown を書いて再適用。
4. `validate_deck` で `exportReadiness` を確認。
5. `export_pptx` の `dataBase64` を**自分で `.pptx` に書き出す**（または `save_project` で `.scft` を保存）。
   サーバが `--root <dir>` scope で起動していれば、代わりに `{path}` が返る（下記「scoped fs 入出力」）。

> エンジンが「正しいレイアウト・フォント維持・テンプレ準拠」を保証するので、エージェントは
> **内容に集中**できる。これが harness-over-model の狙い。

---

## PPTX 出力の制約（headless）

- 12 種の authorable ネイティブ図（`VALID_TYPES`）と表は **編集可能な PPTX シェイプ**として出る（ラスタライザ不要）。
- 変換可能な Mermaid は自動でネイティブ図になる。
- **変換不能な Mermaid（gitGraph / sankey / C4 等）は headless では描けない**ため、
  `export_pptx` は既定で **reject**（無言消失させない）。`onUnsupportedMermaid: "skip"` を
  渡すと当該スライドを省略し `skipped` で報告する。`validate_deck` の `exportReadiness` で事前に分かる。

---

## scoped fs 入出力（`--root`・ADR-0035）

大きい `.pptx`/`.scft`（テンプレ／画像入りデッキ）を base64 で往復すると **+33%** の肥大化が MCP チャネルと
上流 AI のコンテキストを圧迫する（#299 実機フィードバック）。`slidecraft serve --root <dir>` で起動すると、
入出力とも base64 の代わりに **`<dir>` 配下のファイルで受け渡し**できる：

- **出力**（段階1・PR #304/#305）：`export_pptx` / `save_project` は `<dir>` 配下へファイルを書き、参照
  （`{path}`）を返す。
- **入力**（段階3）：`open_project` / `new_project` は `<dir>` 配下のファイルを直接読み込める
  （`open_project` の `path`／`new_project` の `templatePath`）。

- **opt-in・非破壊**：`--root` を渡さない既定は従来どおり base64（`{dataBase64}`/`{templateBase64}`、
  byte-identical）。
- **スコープは 1 ディレクトリに封じる**：`--root` に渡したディレクトリの**実体パス**（symlink 解決済み）だけが
  読み書き対象。`../` traversal・絶対パス・サブディレクトリ・symlink 越えは**すべて拒否**（`{ok:false,
  code:"scope-violation"}`・never-silent）。ファイル名は拡張子（`.pptx` / `.scft`）込みのベア名のみ許可。
  読み取り側は symlink を**内向き（scope 内を指す）でも**拒否する（情報漏洩防止の対称ハードニング — 「scope
  内のファイルだけを渡している」という前提を symlink で崩させない）。
- **出力の `filename` は任意**：省略するとテンプレ名/タイトルとタイムスタンプから自動生成。返り値は
  `{path: "file://<root>/<filename>"}` — **絶対** file URI（`<root>` は `--root` の実体パス）。
  `file:///<filename>` のような bare 形式は RFC 8089／`new URL()` 解釈では「絶対パス `/<filename>`」になり
  fs ルート直下を誤って指すため使わない。標準パーサ（`new URL(path).pathname` / Node の
  `fileURLToPath(path)`）でそのまま実ファイルに解決できる。`root` は呼び出し側が自分で渡した `--root` の
  値なので、絶対パスの echo はリークにならない。`path` フィールドは scope 起動時のみ現れ、未指定時は代わり
  に `dataBase64` が現れる（両方が同時に返ることはない）。
- **入力の `path`／`templatePath` はベア名**（出力の `filename` と同じ形式）：scope 直下のファイル名を渡す
  （`save_project` が返す絶対 `path` をそのまま渡すのではなく、書いた時の `filename` を渡す — write→read の
  往復例は下記）。
- **base64 とパスは排他**：両方指定は `{ok:false, code:"ambiguous-input"}`。どちらも未指定は
  `{ok:false, code:"missing-input"}`。scope 未設定なのにパスを渡すとエラー（`code:"scope-not-configured"`）
  ＝黙って無視しない。存在しないファイルは `code:"scope-file-not-found"`。
- data plane は **fs（`--root`・入出力とも）→ base64**（fs を使えない時）の 2 段。loopback binary 配信（②）は
  **不採用**（forward 経由の AI は token を持てず届かず、他は fs で足りる＝ADR-0035 addendum）。

```bash
slidecraft serve --root /path/to/scope   # scoped fs 入出力を有効化
```

write→read の往復例（同じ `--root` で動くエージェント/セッション間で完結）：

```
save_project({filename: "deck.scft"})       → {path: "file:///path/to/scope/deck.scft"}
open_project({path: "deck.scft"})           → {slideCount, diagnostics, contract, docId}
```

### scope テンプレ discovery（`--root/templates/`・#332）

GUI 非依存の stdio クライアント（Cursor・Claude Code CLI 単体）は `register_templates`（GUI 専用）の投入元が
無いため、`list_templates`/`use_template` が組み込みプリセットにしか届かず、**自分の `.potx` テンプレが実質
使えない**という体験になっていた。`--root` 起動時に **`<root>/templates/*.{pptx,potx}` を規約ディレクトリとして
スキャン**し、レジストリに合流させることでこれを埋める（GUI の register_templates とは独立経路。`--root` は
solo 時のみ有効＝live host へ forward 中は無効なので両者は共存しない）。

- **一覧**：`list_templates()` は builtin プリセットに続けて `{id:"file:<name>", name:"<stem>", builtin:false,
  path:"<name>"}` を返す。`path` は `new_project(templatePath)` がそのまま受けるベア名（両入口を相互参照できる）。
- **起票**：`use_template({id:"file:<name>", markdown?})` は `<root>/templates/<name>` を読んで mint。既存の
  `templatePath` 読み込みと同じ `fs-scope.ts` ハードニングを踏襲＝ベア名のみ・拡張子 allowlist（`.pptx`/`.potx`）・
  symlink 非追従（`O_NOFOLLOW`）・`../`/絶対パス拒否。scope 未設定で `file:` は `scope-not-configured`、不在は
  `scope-file-not-found`、symlink や不正名は `scope-violation`（すべて never-silent）。
- **専用サブディレクトリの理由**：`export_pptx`/`save_project` は `<root>` 直下へ `.pptx`/`.scft` を書くため、
  直下スキャンだと出力デッキがテンプレに紛れる。`templates/` に閉じることでこれを避ける。
- **note（Never-silent 案内）**：discovery が空（builtin のみ）の単独起動では、`list_templates` の `note` に
  「`--root` 配下 `templates/` に `.pptx`/`.potx` を置けば一覧に出る／`new_project(templatePath)` で直接指定」
  と回避策を添える。

```bash
slidecraft serve --root /path/to/scope        # <scope>/templates/*.{pptx,potx} が list_templates に出る
```

```
list_templates()                              → {templates:[{id:"midnight",…,builtin:true},
                                                             {id:"file:tech-report.potx", name:"tech-report",
                                                              builtin:false, path:"tech-report.potx"}]}
use_template({id:"file:tech-report.potx"})    → {slideCount, diagnostics, contract, docId}
```

---

## スクショの前提（`get_slide_image` / `get_deck_image` のブラウザ）

`get_slide_image` は「AI が自分の編集で崩れていないか」を視覚確認するための任意機能（#109）。`get_deck_image`（#522・
全枚を 1 枚の格子画像で）も同じ前提・同じ rasterizer・同じ未検出時の案内で動く。撮る対象は
**共有 HTML 描画そのもの**（`SlideCard` の SSR＝preview / HTML 書き出しと同一の painter・フォント埋め込み済）で、
第2の描画経路は作らない＝WYSIWYG 単一源。ラスタ化は近似ライブラリでなく**ブラウザのネイティブ描画**で行う。

- **ブラウザは調達しない**：マシンに既にある **システムの Chrome/Edge だけ**を使う。**同梱も自動ダウンロードも
  しない**（固定版を抱えると陳腐化した＝既知の穴が開いたブラウザを配ることになる。内蔵 AI の pinned-DL＝ADR-0017 は
  ブラウザには適用しない）。探索順：環境変数 `SLIDECRAFT_BROWSER`（明示パス）→ システム Chrome/Edge。
- **未検出は never-silent**：黙って空画像を返さず `{ok:false, code:"browser-not-found"}` で「Chrome を入れて／
  `SLIDECRAFT_BROWSER` でパス指定を」と案内する。スクショが無くても**本体の著作は成立**（丁寧に劣化）。
- **閉じ込め**：使い捨てプロファイル・拡張/sync オフ・**ネット遮断**（外部リクエストが飛ばないことをテストで担保）。
  サンドボックス既定 ON（root コンテナ向けに `SLIDECRAFT_BROWSER_NO_SANDBOX=1` の明示 opt-out）。ページ側 CSP で
  JS ゼロ（`script-src 'none'`）。
- 埋め込みフォントのおかげで **CJK デッキでも文字化けしない**。返りは image content（PNG base64）＝tool-only
  （バイナリ resource はクライアント互換が薄いため `deck://` ミラーは持たない・ADR-0008）。

---

## データの送信（egress）について

- `slidecraft serve` 自身はクラウドにも LLM にも送信しない。
- ただし**エージェントに接続した時点で、deck の内容はそのエージェントのモデルに渡る**。
  これは「接続する」という選択そのものが opt-in の egress。機密スライドを扱う場合は、
  どのエージェント（ローカル/クラウド）に繋ぐかで判断する。
- GUI 側の AI Assist には別途「ローカルモデル限定モード」があり、そちらは GUI→LLM の
  送信を統治する（MCP 経路とは別の境界）。

---

## 呼出ログ（計測・既定 OFF・#512）

ツール呼出 1 回を JSON Lines 1 行で**ローカルファイルに追記**するだけの監査ログ（外部送信なし）。
ADR-0037 の指標（time-to-first-visual・往復数・増分性）と、ツール削除の証拠（呼出率）を集めるために使う。
有効にしない限りファイルは作られず、ツールの応答も変わらない。

- 有効化: solo は `slidecraft serve --metrics ./mcp-calls.jsonl`。協働ホスト（GUI の sidecar）は環境変数
  `SLIDECRAFT_MCP_METRICS=<path>` を設定して起動する。forward モード（GUI 稼働中の stdio）では `--metrics` は
  無視され、ホスト側のログに残る。
- 1 行の中身: `ts`・`tool`・`profile`・`doc`（docId）・`ms`・`outcome`（ok / reject / error）・reject の `code`・
  入出力の文字数（`inChars`/`outChars`）・mutation なら `mut`/`changed`/`changedN`/`wholeDeck`。
  **deck 本文・Markdown・base64・エラーメッセージは載せない。**
- 集計: `npm run mcp:metrics -- ./mcp-calls.jsonl [--window-min 30] [--profile solo,collab-ai] [--json]`。
  ツール別呼出率・時間窓ごとの往復数と time-to-first-visual・deck 丸ごと再生成の比率・削除候補の証拠比率
  （[design/mcp-value-realign.md](design/mcp-value-realign.md) §7.4）を Markdown で出す。
- 単位はセッションではなく **docId × 時間窓**（ADR-0038・無呼出が `--window-min` 分続いたら次の窓）。
  トークンはサーバから見えないため、呼出数と文字数で代理する。

---

## v1 の制限（今後の拡張）

- scoped fs（`--root`）は入出力とも実装済み（ADR-0035 段階1＝出力・PR #304/#305、段階3＝入力・#306）。
  `--root/templates/` の template discovery（#332・ADR-0036）も実装済み。MCP `roots`（クライアント
  advertise・`--root` の代替 scope 源）は follow-up。loopback binary 配信（②）は **不採用**（ADR-0035 addendum）。
- `register_templates` の AI ロール公開（GUI マスターレジストリを AI からも編集）は **不採用/優先度低**：
  `--root/templates/` discovery（#332）で「自分のテンプレを AI に選ばせる」体験は GUI 一貫性を崩さず得られる。
- `generate_from_plan`（DeckPlan からの新規生成）は **作らない方針**（監査結論）。DeckPlan は
  エージェントが既に書ける内容で、Markdown にして `new_project` に渡せば同じ整形パス
  （parseMd→distillDeck）を通り、しかも `autoSelectLayout` で**任意テンプレに解決される**。
  別コードパス（`slidePlanToSlide` はレイアウト名ハードコードで alien テンプレに弱い）を
  増やす redundant を避ける。構造化入力が要るなら `new_project` の任意フォーマットとして畳む。
- 読み取りツールと `deck://` リソースは意図的な二重提供（上記「リソース」節参照）。削らない。
