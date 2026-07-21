# SlideCraft MCP サーバ（`slidecraft serve`）

上流の AI エージェント（Claude Desktop / Claude Code など）から SlideCraft を駆動するための
**headless な stdio MCP サーバ**。エージェントがスライドの「中身」を考え、SlideCraft の
**決定論エンジン**がレイアウト・分割・検証・PPTX 生成を担う（harness-over-model）。

- **エージェント＝LLM**：サーバ自身は LLM を呼ばない。公開するのは決定論的な engine 操作だけ。
- **headless**：webview もブラウザも不要（Node プロセス）。WSL2 の GUI 問題とは無関係。
- **--no-fs（v1）**：`.scft` / `.pptx` のバイト列は **base64 で stdio をやり取り**する。
  サーバはファイルシステムに一切触れない（信頼境界は「起動した親エージェント」＝OSユーザ）。

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

**Windows / Linux** — 同梱 node と `cli.cjs` はインストール先（アプリ本体と同じフォルダ、および `resources/` サブフォルダ）に入っています。ただし**正確なパスはインストーラ・バージョンで変わり、現状デバイス未検証**です（アプリのバイナリ名は `diagram-pipeline-desktop` で、Linux の `.deb`/`.rpm` はこの名前のディレクトリ配下に入る可能性が高い）。次のいずれかを推奨します:

- インストール先を実際に確認し、`cli.cjs`（`resources/` 配下）と `node`（アプリ本体と同階層）の絶対パスを見つけて登録する。
- 分からなければ**ソースからの起動（B）**を使う（確実）。
- AppImage は展開先が起動ごとに変わるため、直接パス指定は不向き → **B** を使う。

> Windows/Linux 向けの PATH ランチャ（macOS の `slidecraft-mcp` 相当）は follow-up 予定です。

### B. ソースから起動（開発版）

```bash
npm install
npm run build:mcp        # → dist/mcp/cli.js を生成（esbuild, Node ESM。node_modules は外部化＝リポジトリ内で実行）
node dist/mcp/cli.js      # stdio で MCP サーバとして待機（通常はエージェントが spawn する）
```

登録は `claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js` 相当。

> **`build:mcp`（B）** は node_modules を外部化した開発用（リポジトリ内でのみ動く）。**アプリ同梱（A）** は `build:mcp:bundled` で全依存を内包した `cli.cjs`。用途が違うので混同しないこと。

`--root` を渡すと現状はエラー終了する（scoped fs は次バージョン）。v1 は `--no-fs` のみ。登録後、エージェントから下記ツールが見える。

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
| 入口 | `open_project(dataBase64)` | base64 の `.scft` を読み込み。`{slideCount, diagnostics, contract}` |
| 入口 | `new_project(templateBase64, markdown?)` | base64 の `.pptx` テンプレ＋（任意）Markdown から新規（GUI の Draft と同じ parseMd→distill）。`{slideCount, diagnostics, contract}` |
| 調達 | `create_template(spec?)` | `spec` は `TemplateSpec` の **JSON 文字列**（オブジェクト不可・例 `spec: '{}'`。name＋fonts＋9色 palette・layouts 既定30）からテンプレ PPTX を生成し `{templateBase64, health, notices}`。欠落は MIDNIGHT preset 補完＋コントラスト自動修正。返り値を `new_project` に渡す |
| 調達 | `get_template_spec_guide()` | `create_template` 用 spec の書式ガイド＋MIDNIGHT preset 値 |
| 調達 | `list_templates()` | テンプレ一覧 `{templates:[{id,name,builtin}]}`。host（GUI が `register_templates` で投入した master レジストリ）が接続済みならそれを、**単独（GUI 未接続の stdio）は組み込みプリセット**（`builtin:true`、既定 `midnight`）を返す（#298）。id を `use_template` へ |
| 調達 | `use_template(id, markdown?)` | テンプレ（`list_templates` の id）から**新規プロジェクトを mint**（bytes 不要・GUI の Draft と同じ整形）。単独の組み込み id は `create_template` と同じハーネスで生成（R8）。未知 id は never-silent `{ok:false, code:"unknown-template"}`。既存 doc のテンプレ入替ではない |
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
| 保存 | `save_project` | `.scft` を生成し `{dataBase64}` |
| 出力 | `export_pptx(onUnsupportedMermaid?)` | `.pptx` を **native-vector で headless 生成**し `{dataBase64, skipped}` |
| lifecycle | `list_documents` / `select_document` / `close_document` / `undo` / `redo` | 複数ドキュメント lifecycle＋サーバ側 undo/redo。各ドキュメント行/戻りに `contract` 同梱。**solo stdio でも additive に有効**（1 doc なので list/select/close は実質 no-op・**undo/redo は solo でも本当に効く**＝ADR-0033 D1）。collab では複数 doc を跨ぐ |
| host 専用(GUI) | `register_templates(templates[])` | GUI のみ：webview の master レジストリを host へ投入（`{id,name,builtin,bytesBase64}` の配列・呼ぶ度に全置換）。AI ロールには非公開。これで AI が `list_templates`/`use_template` で選べる |

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
1. 開いた戻りの `contract`（レイアウト名・区切り・budget・ポインタ）を読み、`get_authoring_guide` で全書式を、
   図を入れるなら `get_diagram_types` → `get_diagram_guide(type)` で構文を得る。
2. 著作/編集：`set_slide_markdown(i, md)` で1枚ずつ（budget 内に収める）、構造は `insert_/delete_/move_/duplicate_slide`、
   図は `set_slide_diagram`（text スライドにも追加可）。1枚の状態は `get_slide(i)` で構造化して把握。
3. mutation の戻りの `hints`（次の一手）に従う：溢れ→`split_overflowing_slides`、key-value→`convert_bullets_to_table(i)`、
   文章の手直し→`get_slide_fix_request(i)` で packet を取得しエージェントが Markdown を書いて再適用。
4. `validate_deck` で `exportReadiness` を確認。
5. `export_pptx` の `dataBase64` を**自分で `.pptx` に書き出す**（または `save_project` で `.scft` を保存）。

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

## スクショの前提（`get_slide_image` のブラウザ）

`get_slide_image` は「AI が自分の編集で崩れていないか」を視覚確認するための任意機能（#109）。撮る対象は
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

## v1 の制限（今後の拡張）

- `--no-fs`（base64）のみ。`--root`（プロジェクトディレクトリ配下に限定した scoped fs）は次版。
- `generate_from_plan`（DeckPlan からの新規生成）は **作らない方針**（監査結論）。DeckPlan は
  エージェントが既に書ける内容で、Markdown にして `new_project` に渡せば同じ整形パス
  （parseMd→distillDeck）を通り、しかも `autoSelectLayout` で**任意テンプレに解決される**。
  別コードパス（`slidePlanToSlide` はレイアウト名ハードコードで alien テンプレに弱い）を
  増やす redundant を避ける。構造化入力が要るなら `new_project` の任意フォーマットとして畳む。
- 読み取りツールと `deck://` リソースは意図的な二重提供（上記「リソース」節参照）。削らない。
