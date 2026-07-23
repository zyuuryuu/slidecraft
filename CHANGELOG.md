# Changelog

このプロジェクトの主要な変更点を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います（**0.x 系は早期版＝MINOR でも破壊的変更があり得る**）。

出荷済み機能の網羅的な履歴は [docs/shipped.md](docs/shipped.md)、決定の記録は [docs/adr/](docs/adr/) を参照。

## [Unreleased]

## [0.4.1] - 2026-07-23

早期版（0.x）のパッチ。**MCP の大きなデータをファイルで授受**（`--root`）、**単独モードでの組み込みテンプレ利用**、表紙まわりの描画修正、Windows での `npm install` 失敗の修正、依存の脆弱性更新が中心。

### Added

- **MCP のバルクデータをファイルシステム経由で授受（`slidecraft serve --root <dir>`）**（[ADR-0035](docs/adr/0035-mcp-bulk-data-exchange.md)・#299・PR #304/#306）— テンプレ `.pptx` や生成物のような大きな入出力を base64 で往復させず、`--root` で明示的に許可したディレクトリ配下の**ファイルパス**で受け渡せる。入力・出力とも `--root` 配下にスコープし、外へのアクセスは never-silent に拒否。
- **単独（solo）モードでも組み込みテンプレートを列挙・利用できる**（[#298](https://github.com/zyuuryuu/slidecraft/issues/298)・PR #300）— GUI 非稼働の単独 MCP でも `list_templates` / `use_template` が組み込みプリセットにフォールバックする。

### Fixed

- **章名フッタが表紙スライドの本文枠へ誤注入される不具合**（[#292](https://github.com/zyuuryuu/slidecraft/issues/292)）— 組み込みレイアウトの idx-12 body 枠に章名フッタが入り込むのを防止。
- **組み込みレイアウトの idx 10/11/12 に明示ロールを付与し、`idx`-META 規約の誤爆を根治**（PR #296）— テンプレ由来でない枠が meta 扱いされる問題を解消。
- **MCP のファイル出力を絶対 `file://` URI で返す**（scoped-fs 出力・PR #305）— bare-root ではなく絶対パスにし、呼び出し側が確実に開ける。
- **MCP 登録手順を stdio コマンド正面に**（`CollabPanel`・PR #302）— 起動ごとに port/token が変わる HTTP 直結を上級者向けの折りたたみへ降格し、既定を stdio 1 本に。
- **Windows で `npm install` が code 1 で失敗する不具合**（[#272](https://github.com/zyuuryuu/slidecraft/issues/272)・PR #318）— POSIX シェル前提の `prepare` スクリプトを OS 非依存の Node スクリプトへ置換。
- **リリースノート生成の堅牢化** — CHANGELOG の相対リンクをリリース本文用に絶対 URL 化（[#289](https://github.com/zyuuryuu/slidecraft/issues/289)・PR #308）、CHANGELOG 節欠落時の never-silent fail が Windows ランナーだけ効かない問題を根本修正（[#316](https://github.com/zyuuryuu/slidecraft/issues/316)・PR #319）。

### Security

- **fast-uri を 3.1.4 に更新**（PR #314）— host confusion（GHSA-4c8g-83qw-93j6 / GHSA-v2hh-gcrm-f6hx, high）。`@modelcontextprotocol/sdk → ajv` 経由の推移的依存。
- **dompurify を 3.4.12 に更新**（PR #313）— `CUSTOM_ELEMENT_HANDLING` バイパス（GHSA-c2j3-45gr-mqc4, moderate）。HTML 書き出しのサニタイズに同梱。

### Changed

- **実ブラウザ・ラスタライズの CI テストを必須 `test` ジョブから外し、非必須の `browser-smoke` ジョブへ分離**（[#281](https://github.com/zyuuryuu/slidecraft/issues/281)・PR #312）— Chrome 描画の非決定タイムアウトが必須ゲートをランダムに落とすのを解消（利用者影響なし・開発/CI の安定化）。

## [0.4.0] - 2026-07-20

早期版（0.x）。**AI 協働（MCP）の視覚レビューと単一エンドポイント化**、**既存コンテンツからの便利スライド生成**、**Mermaid 図の大幅拡張**、**CJK フォント埋め込み**、**リリース成果物の完全性シグナル**が目玉のマイナー版。（**v0.3.0 は公開を取り止め、その存続機能も本版に含む** — AI 非決定 Re-make は下記のとおり撤去済み。）

### Added

**AI 協働（MCP）**

- **スライドの見た目を画像で確認できる `get_slide_image`**（[#109](https://github.com/zyuuryuu/slidecraft/issues/109)・PR #239）— 上流 AI が「自分の編集でレイアウトが崩れていないか」を実際の描画（PNG）で確認できるツール。撮る対象は preview / HTML 書き出しと同一の共有描画（第2の描画経路を作らない＝WYSIWYG 単一源）。ラスタ化はマシンにある **Chrome / Edge だけ**を使い、ブラウザの**同梱・自動ダウンロードはしない**（陳腐化＝穴の開いたブラウザを配らないため）。未検出は never-silent（`browser-not-found`）で案内。使い捨てプロファイル・ネット遮断・ページ CSP で JS ゼロ。任意機能＝ブラウザ無しでも著作/出力は成立。
- **ブラウザ無しでも見た目を確認できる `get_slide_html`**（[#242](https://github.com/zyuuryuu/slidecraft/issues/242)・PR #252）— `get_slide_image` と同じ共有描画を **HTML 文字列**で返すツール（script ゼロ・フォント埋め込み済）。CI などブラウザ未導入環境でも呼び出し側の任意手段でラスタ化できる。
- **MCP の接続がコマンド1つに（adaptive front）**（[ADR-0033](docs/adr/0033-mcp-single-control-plane.md)・#222/#224）— エージェントに登録するのは `slidecraft serve` の1つだけ。GUI 稼働中は自動で相乗り（forward）、無ければ単独（solo）で動く。**管制（deck 権威＋undo）を1つに統一**し、単独モードでも**サーバ側 `undo`/`redo`** が効くように。
- **MCP の細かな改善** — スライド分割後の旧→新 index 対応表 `indexMap`（[#243](https://github.com/zyuuryuu/slidecraft/issues/243)・PR #249）、`get_authoring_guide` の `activeReviewRules`（レビュー規則を編集前に一覧提示・[#244](https://github.com/zyuuryuu/slidecraft/issues/244)・PR #253）、成否判定の明文化＋`isOk` helper（[#246](https://github.com/zyuuryuu/slidecraft/issues/246)・PR #250）。
- **MCP クライアント別セットアップ手順**（[#283](https://github.com/zyuuryuu/slidecraft/pull/283)）— Claude Code / Claude Desktop / Cursor / GitHub Copilot（VS Code）の登録レシピと、「HTTP エンドポイント直登録はアンチパターン（port/token が起動ごとに変わる）→ stdio コマンド1本に寄せる」勘所をユーザガイドに追記。

**便利スライドの生成・章立て**

- **便利スライドの生成メニュー（目次 live/static）**（[ADR-0034](docs/adr/0034-convenience-slide-generation.md)・[#277](https://github.com/zyuuryuu/slidecraft/issues/277)・PR #280）— スライド一覧の ✨ から、既存の章立てをもとに**目次**を生成して挿入。「自動更新（章に追随・直接編集不可）」と「固定（普通に編集できる・"作り直す"で再生成）」を選べる。特殊記法（`<!-- toc -->`）の手書きは不要に（後方互換で読み続ける）。
- **目次見出しの言語自動切替**（[#184](https://github.com/zyuuryuu/slidecraft/issues/184)・PR #234）— 章タイトルが英語だけのデッキでは目次見出しが自動で "Table of Contents" に（日本語を含めば「目次」）。
- **スピーカーノート `<!-- note -->` ＋ 章タグ `<!-- section -->` ＋ 導出目次 `<!-- toc -->`**（[ADR-0032](docs/adr/0032-authoring-notes-and-sections.md)・#150/#151）— 「スライドは疎に・詳細はノートへ」を可能にし、章番号・目次・章扉再掲・フッタ章名を単一関数から毎回導出（本文との乖離が構造的に起きない）。

**図（Mermaid / ネイティブ）**

- **Mermaid 図の対応拡張** — フローチャートの太矢印 `==>`・可変長 `--->`・丸/バツ端点 `--o`/`--x`・双方向 `<-->`（[#255](https://github.com/zyuuryuu/slidecraft/issues/255)・PR #264）、クラス図の generics `List~T~`・`<<interface>>` stereotype 保持（[#256](https://github.com/zyuuryuu/slidecraft/issues/256)・PR #263）、ノード形状 **stadium `([ ])`・subroutine `[[ ]]`・parallelogram `[/ /]`・cylinder `[( )]`**（従来は四角に潰れていた・[#269](https://github.com/zyuuryuu/slidecraft/issues/269)・PR #271）、**シーケンス図の注釈 `Note over`/`Note left of`/`Note right of`**（従来は無視・[#270](https://github.com/zyuuryuu/slidecraft/issues/270)・PR #273）を正しく解釈・描画。
- **CJK フォントの実行時サブセット化＋HTML への `@font-face` 埋め込み**（[#115](https://github.com/zyuuryuu/slidecraft/issues/115)・#192/#193/#194）— デッキの実使用文字だけの Noto Sans/Serif JP サブセットを生成して HTML に埋め込み、環境にフォントが無くても CJK が文字化けしない（CJK 無しデッキは埋め込みスキップ＝サイズ増ゼロ）。

**取り込み・テンプレート**

- **faithful Re-make（デザインを保持して取り込む）**（[ADR-0027](docs/adr/0027-remake-source-visual-preservation.md)）— テンプレートの装飾・背景・レイアウトをそのまま保持し、フォントだけ整えて取り込む新モード。日本語（EA）ブランドフォントも保持。
- **マスター取り込みの透明化（進捗＋結果＋ミニプレビュー）** — 取り込み時に進捗バー、完了後に結果要約バーを表示。「詳細」で各レイアウトのミニプレビュー（実描画＝WYSIWYG）・抽出テーマ（フォント/配色/ロゴ）・修復件数・健全性の指摘を確認できる。

**オーサリング・編集**

- **表と本文の共存＋列内 GFM テーブルのネイティブ保持**（#100/#101・PR #207）、**グループセル内 `## 見出し` 表示**（[#102](https://github.com/zyuuryuu/slidecraft/issues/102)・PR #209）、**ネスト箇条書き（3段）**（[#103](https://github.com/zyuuryuu/slidecraft/issues/103)・PR #202）。
- **スライドの句読点に警告** — 句読点はスライドで読みにくいため、レビューで読点「、」は強い警告・句点「。」は軽い注意を表示（「✨直す」で AI が整形）。
- **非ディレクティブ HTML コメントの本文混入を解消＋変換レポートの完成**（#147/#148/#165）— レビュー注記・TODO を md に残したまま変換できるように。無言で起きていた drop を `get_deck_issues` に計上。

**UX**

- **初回起動オンボーディング**（[#259](https://github.com/zyuuryuu/slidecraft/issues/259)・PR #265）— 初回に最小の起点パネル（新規／`.pptx` を開く／サンプル＋簡単な手順とドキュメント導線）を表示。「次回以降表示しない」でスキップ。
- **「新版あり」通知バナー**（[ADR-0021](docs/adr/0021-auto-update-strategy.md)・[#113](https://github.com/zyuuryuu/slidecraft/issues/113)・PR #236）— 公開リリースが現行版より新しいとき dismissible バナーで通知（**通知のみ・自動更新や署名は伴わない**）。CSP `connect-src` に `api.github.com` のみ追加。

### Changed

- **macOS の公式ビルドは Apple Silicon（arm64）のみに**（[#112](https://github.com/zyuuryuu/slidecraft/issues/112)）— Intel Mac 向けインストーラの提供を終了（Intel はソースからのビルドで利用）。Windows・Linux は従来どおり。
- **レイアウト選出エンジンの gate 付き強化（Tier1/2）**（[ADR-0025](docs/adr/0025-placeholder-role-resolution.md)・v0.3.0 由来）— スライドの中身に合ったレイアウトが選ばれやすく（単純な箇条書きが不必要に段組へ割り当てられる問題を是正・degrade 末尾を適性ベースに）。健全テンプレは byte-identical。
- **README を英語既定に**（[#260](https://github.com/zyuuryuu/slidecraft/issues/260)）— トップの `README.md` を英語に、日本語は `README.ja.md` に（相互リンクあり）。
- **リリース成果物の完全性シグナル**（#257/#258・PR #266）— 各リリースに `SHA256SUMS`・ビルド来歴の証明（`attest-build-provenance`）・SBOM（CycloneDX）を添付（**コード署名は行わない**）。リリースノートは CHANGELOG の当該タグ節から自動生成。

### Removed

- **AI 非決定 Re-make（試験・v0.3.0 で新設）を撤去**（[ADR-0028](docs/adr/0028-retire-ai-remake-option-c.md)）— 入力レイアウトを標準レイアウトへ「写像」する試験機能は、faithful Re-make（保つ）＋決定論 Re-make（作り直す）が明確な代替となり削除。v0.3.0 が公開されなかったためユーザには未到達。取り込みは「忠実 Import／faithful Re-make／決定論 Re-make」に整理。

### Fixed

- **図の重なりを修正（横向きレイアウト）**（#104/#229・PR #237）— 横方向（LR/RL）で高さの違うノード（クラス図・状態図・ひし形など）が同じ段で重なることがあった問題を修正。縦向き・均一高の図は座標バイト不変。
- **グループの反転（鏡像）指定がプレビュー/HTML で正しく反転**（[#241](https://github.com/zyuuryuu/slidecraft/issues/241)・PR #248）。PPTX 出力は不変。
- **同梱テンプレ「Midnight Executive」で白タイトルが不可視だった不具合**（[#274](https://github.com/zyuuryuu/slidecraft/issues/274)・PR #278）— 19 レイアウトに正しい暗色下地（`TitleBackdrop`）を補って修正（回帰テスト付き）。
- **スライド一覧のサムネイルと右プレビューの表示一致**（[#275](https://github.com/zyuuryuu/slidecraft/issues/275)・PR #279/#280）— 目次・章扉再掲が左サムネイルで空/素に見えていた不一致を、表示用 materialize を1本化して解消。一覧＝プレビュー＝書き出しが一致。
- **先頭に置いた章扉の表紙誤解決**（[#195](https://github.com/zyuuryuu/slidecraft/issues/195)・PR #199）、**closing スライドの本文落ち**（[#153](https://github.com/zyuuryuu/slidecraft/issues/153)・PR #175）、**CRLF 入力での layout pin 無効化**（[#164](https://github.com/zyuuryuu/slidecraft/issues/164)・PR #187）、**複数ドキュメント切替時の snapshot 損失**（[#160](https://github.com/zyuuryuu/slidecraft/issues/160)・PR #173）を修正。

## [0.3.0] - 2026-07-08

早期版（0.x）。**AI による非決定 Re-make**（スライドマスターの第3の取り込み口）を新設し、レイアウト選出エンジンを gate 付きで強化したマイナー版。

### Added

- **AI 非決定 Re-make（第3の取り込み口「AI で作り直す」）**（[ADR-0026](docs/adr/0026-ai-remake.md)）— 乱雑な第三者マスターを、AI が各レイアウトを整った標準（canonical）レイアウトへ**写像**して取り込む新モード（忠実 Import／決定論 Re-make に続く3番目の選択肢）。**AI は分類器のみ**（どの標準レイアウトに当てるか＋元レイアウト名の保持）で、幾何・配色・検証・生成はすべて決定論——壊れた/未接続/全ハルシネーション応答は決定論 Re-make へ**フォールバック（現状より悪くならない）**。取り込み時に clean なロールへ揃えるため、実行時のロール推定ズレ（[ADR-0025](docs/adr/0025-placeholder-role-resolution.md)・下記 Tier1/2）を根本予防。**写像根拠（reason）**の提示と、ローカル小モデルの run 間ばらつきを均す **best-of-N**（既定 2・cloud/未接続は 1）を同梱。Ollama 実測（`granite4.1:8b`・`phi4` ほか5モデル×K=3）で valid-JSON 全モデル安定・往復 health=ok を確認。UI は MasterPicker の「✨ AI で作り直す」。

### Changed

- **レイアウト選出エンジンの gate 付き強化（Tier1/2）**（[ADR-0025](docs/adr/0025-placeholder-role-resolution.md) と同哲学）— スライドのロール領域からレイアウトを選ぶ際、幾何裏付けのある gate で誤選択を抑制（単純な箇条書きが複数 body 段組レイアウトへ誤割り当てされる問題を是正・degrade 末尾を適性ベースに）。健全テンプレは不変・ゴールデン安全。

## [0.2.2] - 2026-07-08

早期版（0.x）。バグ修正・セキュリティ強化・Windows コード署名（SignPath）の申請準備が中心のパッチ。

### Fixed

- **名前が「Title」/「タイトル」の placeholder にタイトルが入らない不具合**（[ADR-0025](docs/adr/0025-placeholder-role-resolution.md)）— `type="body"` や idx 0 のプレースホルダでも、名前が Title 系で（かつそのレイアウトに title 枠が無いとき）タイトルを受け取るように。第三者テンプレでタイトルが宙に浮く問題を解消（健全テンプレは不変・gate 付き）。
- **macOS の `brew upgrade` が「already a Binary」で失敗する不具合** — 旧 `slidecraft-mcp` シンボリックリンクを preflight で掃除してから貼り直すよう Homebrew cask を修正。

### Security

- **依存脆弱性を解消**（出荷アプリには非含有）: `vitepress` 1.6.4 → 2.0.0-alpha.18 で脆弱な `vite@5.4.21`（high: `server.fs.deny` bypass ほか）/`esbuild@0.21.5` を依存木から排除（`npm audit` = 0）、Rust の `rand` 0.8.5 → 0.8.6。残る `glib`（medium）は gtk-rs/Tauri スタックに固定のため Tauri 更新待ち。
- **CI に secret-scan（gitleaks）を追加** — 秘密鍵・クレデンシャルが誤って commit された場合に block する多層防御（Windows 署名鍵自体は SignPath の HSM にあり CI には来ない）。

### Docs

- v0.2.0 まで起動時に表示していた全機能デモを [`samples/sample-deck.md`](samples/sample-deck.md) として保全し、スターターガイドから参照。
- **Windows コード署名（[SignPath Foundation](https://signpath.org/)）の申請準備** — コード署名ポリシー・行動規範（CODE_OF_CONDUCT）・SECURITY・CONTRIBUTING・issue/PR テンプレを整備。

## [0.2.1] - 2026-07-07

早期版（0.x）。**UI の日英切替（i18n）と英語ドキュメント**、**`.scft` ファイル関連付け**、**プレビュー/HTML 描画の忠実化**が目玉。

### Added

- **UI の日英切替（i18n）** — 画面右上のトグルで UI 全体を日本語⇄英語に切り替え（react-i18next・選択は記憶）。全コンポーネントに加え、フック/モジュール由来の状態・通知文言（接続ステータス「接続OK」等）まで翻訳済み。
- **英語ドキュメント** — ドキュメントサイトに英語版ユーザーガイドを追加（ナビ右上の言語スイッチャで日⇄英を切替）。README・第三者通知（THIRD-PARTY-NOTICES）も英訳し、GitHub 上で言語リンクを相互往来。
- **`.scft` をアプリに関連付け（ダブルクリックで開く）**（ADR-0024）— プロジェクトファイルを**ダブルクリック / 「プログラムから開く」**で SlideCraft が起動して開く。起動済みなら**新しいタブ**として開き、現在の作業を壊さない。Windows/Linux はウォーム起動（起動中にもう 1 つ開く）も `single-instance` で単一ウィンドウに集約、macOS は Apple の open イベント、Windows/Linux コールドは argv で受ける。
- **AI が Live MCP で作った Deck を GUI の背景タブに出す**（モード b）— 協働接続中に上流 AI が `new_project` で新しいデッキを作ると GUI に**背景タブ**として現れる（表示は切り替えない）。以前はタブが増えず見えなかった。
- **公式ビルトインテンプレートを 4 本に** — 「配布資料 公文書高密度／ビジュアルデッキ マガジン／技術報告 スタンダード水色」を追加（従来の Midnight Executive に加え、起動時に選択可能）。
- **プレビュー/HTML の描画忠実度を向上** — スライドマスター/レイアウトの**背景画像・グラデーション**、**グループ図形**（座標変換）、**custGeom の弧**、テンプレの**図形（楕円・矢印・カスタム幾何）**を描画。共有エンジン由来のため PPTX/プレビュー/HTML が一致。
- **空の状態で起動** — 起動時に読み込んでいた既定サンプル Markdown を廃止し、空から始められるように。

### Changed

- **プロジェクトファイルの拡張子を `.slidecraft` → `.scft` に短縮**（ADR-0024）— 4 文字の慣用的レンジへ。初回リリース直後で野良ファイルが無い今のうちに改名。保存名・ピッカー・起動時オープンは単一定数（`PROJECT_EXT`）を参照。
- 開発ツール `esbuild` を 0.28.1 に更新（devDependency のみ・出荷アプリ / dev サーバには非含有）。

### Fixed

- **空のデッキで「＋ スライド追加」が効かない不具合**を修正（デッキが無い状態でも 1 枚目を作成する）。
- **協働ホストで AI が作った Deck のタブ名が常に「Untitled」になる不具合**を修正（先頭スライドの見出しから命名・B4）。

## [0.2.0] - 2026-07-07

早期版（0.x）。**第三者スライドマスター対応**と、上流 AI 向けの **MCP CLI 同梱**が目玉。

### Added

- **MCP サーバをアプリに同梱**（ADR-0022）— 配布インストーラに自己完結した MCP サーバ（`cli.cjs`）と Node ランタイムを同梱。上流 AI（Claude Code / Cursor / Claude Desktop）から **ソースのビルドもシステム Node も不要**で SlideCraft を駆動できる。macOS は Homebrew cask が `slidecraft-mcp` を PATH に登録（`claude mcp add slidecraft -- slidecraft-mcp`）。Windows/Linux は同梱 node ＋ `cli.cjs` を直接登録（正確なパスはインストール先を要確認・現状未検証）。
- **スライドマスター Re-make（テーマだけ取り込む）**（ADR-0023）— 実マスターの構造を忠実に活かす従来の「取り込み」に加え、**フォント・配色・背景・ロゴだけ抽出して SlideCraft 自前レイアウトで作り直す**第2の取り込み口を追加（両方の口を提供）。第三者マスターの idx/テーマの癖を構造的に回避。ロゴ継承、フラット設計（ヘッダーバー有無）の吸収、コントラスト安全な配色マッピング付き。
- **プレビュー/HTML でスライドマスターのロゴ・図版（`<p:pic>`）を描画** — 従来はレイアウト/マスターの画像をプレビューで落としていたのを data-URI として描画。忠実取り込みでも会社ロゴが見えるように。

### Fixed

- **反転テーマのマスターでプレビュー背景が暗転する不具合を修正** — テーマを反転させたマスター（例: `clrMap bg1→lt1=濃紺`／実マスター背景は `bg2→lt2=白`）で、プレビュー/HTML の背景を `themeColors.bg1` から導いていたため、マスター背景を継承する本文スライドが濃紺で描画され本文が読めなくなっていた（PPTX は白で正しい）。マスターの実際の `<p:bg>` を読むよう修正。
- **素の第三者スライドマスターで本文が入らない不具合を修正**（ADR-0023）— 知財情報を剥がした実テンプレート（本文 placeholder が idx 10 以降）で、SlideCraft 内部の idx-META 規約（idx 10/11/12/15/16 を META とみなす）が本文を誤って META と解釈し、content レイアウトの本文が空になっていた。規約を「自前マスター（canonical ドット名 or 型付き sldNum/dt/ftr メタ）」だけに限定し、素のマスターでは idx 10 以降の body を本文として束縛。プレビュー・PPTX 出力とも追随するように。
- `update-cask.mjs` が arm64-only（sha256 1 行）のテンプレートで失敗する潜在バグを是正（1〜2 行を許容）。

## [0.1.0] - 2026-07-07

初回パブリックリリース（**早期版** — 0.x のため MINOR でも破壊的変更があり得ます）。

### Added

- Markdown/YAML → PPTX 変換（テンプレート placeholder 埋め・native OOXML 生成）
- 視覚エディタ（deck = 単一の真実）＋二段階編集（内容＝Markdown／デザイン＝空間意図→座標）
- 図：ネイティブ **12 種**（` ```diagram `）＋ mermaid 経由の class/state/ER/mindmap・GFM 表・コード・画像（自己完結 data URI）
- スタンダロン HTML 出力／PPTX native-vector export
- 内蔵オフライン AI（llamafile 同梱・環境適応モデルティア）＋AI 編集の採用ゲート
- テンプレ作成・取込・修復（作成モーダルのライブプレビュー／レイアウトサブセット／カスタムレイアウト）
- 協働ホスト（MCP）：上流 AI が Tools で編集し GUI がライブ反映
- 詳細は [docs/shipped.md](docs/shipped.md)、使い方は [ユーザーガイド](docs/user-guide.md)

### Notes

- **macOS**: ad-hoc 署名（未ノータライズ・本ビルドは実機未検証）。初回起動は Finder で右クリック →「開く」、
  または `xattr -dr com.apple.quarantine /Applications/SlideCraft.app`。不具合は Issue で歓迎します。
- 更新は当面**手動**（macOS は将来 Homebrew cask 予定）— [RELEASING.md](RELEASING.md) / [ADR-0021](docs/adr/0021-auto-update-strategy.md)。
