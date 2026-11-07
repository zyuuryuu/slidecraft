# 機能面の立ち位置 — PowerPoint にある機能のうち SlideCraft は何をできるべきか（DeckCraft を参照点に）（DISCUSS）

- Status: 💬 DISCUSS（議論の材料。決定したら ADR に落とし、採用候補は Issue 化する）
- Date: 2026-11-07
- 参加: ユーザ・レビュー統括セッション
- 前編: [mcp-value-realign.md](mcp-value-realign.md)（北極星「指示→見える」）・[ADR-0037](../adr/0037-mcp-surface-realignment.md)・[ADR-0038](../adr/0038-mcp-stateless-realign.md)

## 1. 問いの立て方

SlideCraft は PowerPoint のクローンではない。**構造化テキスト（Markdown / YAML / JSON）→ 決定論レイアウト →
PPTX**、その著者は人と AI エージェント（MCP）、という前提がある。したがって「PowerPoint にある機能を
どこまで持つか」は、機能の有無ではなく **著作モデルに合うか**で決める。

比較の軸は 3 つ。

| 軸 | PowerPoint | DeckCraft（後述） | SlideCraft |
| --- | --- | --- | --- |
| 入力モデル | 自由配置 WYSIWYG | 自由配置 WYSIWYG（クローン） | 構造化テキスト → 自動配置 |
| AI の関与 | Copilot（補助） | 「全ボタン＝コマンド＝MCP」で**操作者** | MCP で**著者**（Markdown を書く・診断を読む・画像で確かめる） |
| PPTX との関係 | 本家 | 開く・直す・保存（往復） | 生成（テンプレは取り込む・内容は取り込まない） |

参照点として DeckCraft を置くのは、同じ「MCP でエージェントが動かす」文脈で**反対側の設計**（クローン）を
選んだ実例だからである。

## 2. DeckCraft（事実の要約・2026-11-07 時点）

出所: [README](https://github.com/storytold/deckcraft)・[docs/gaps.md](https://raw.githubusercontent.com/storytold/deckcraft/main/docs/gaps.md)・
[releases](https://github.com/storytold/deckcraft/releases)・報道（Tom's Hardware / xenospectrum / WindowsForum）。

- **何か**: ArtCraft（WordCraft / GridCraft と三部作）による「pure Rust のクリーンルーム PowerPoint 再実装」。alpha。
  MIT or Apache-2.0。約 4.7k stars・2.7k forks、公開から約 1 ヶ月、2026-10-21〜11-06 で 9 リリース（v0.9→v0.16）。
  macOS / Windows / Linux / FreeBSD / WebAssembly。wgpu による GPU 描画。
- **モデル**: `.pptx` を**開いて編集して保存**する WYSIWYG。Markdown や DSL は無い。マスター・11 レイアウト・8 テーマ・
  ネイティブ chart（データ編集は部分的）・表・SmartArt 約 15 種・150 以上の図形・画像補正・音声/動画・
  ノート・コメント・トランジション（Morph 含む）・アニメーション・発表者ビュー。出力は PPTX・PDF（ノート
  ページ／配布資料・ただし描画はラスタ）・PNG/JPEG/GIF・アウトライン。
- **AI 連携**: 「すべてのボタンはコマンド」— 200 超のコマンド（安定 ID・undo 付き）を人・スクリプト・エージェントが
  共有。`deckcraft-cli mcp`（stdio・ヘッドレス）と `--connect <port>`（起動中のアプリを操作）。
  `--automation-read-root` / `--automation-write-root` でフォルダを限定。`render --all` で全スライド PNG。
  **MCP ツールが画像を返すかは未確認**（README に screenshot の語は無い）。往復回数・トークン費用の公開数値は無い。
- **なぜ話題か**: 無料・ネイティブ・サブスクなし・クラウドなし。進捗の自己申告が率直（機能の広さ 84%・
  「実務で使える」55%）。「AI で作られたクローン」という筋で報道。
- **弱点（gaps.md）**: PPTX の忠実度は自作デッキでしか検証しておらず、企業テンプレ・SmartArt・chartex・EMF は
  「ほぼ不明」。印刷・数式・録画・MP4・パスワード・.ppt/.odp・Designer 相当は無し。英語のみ。VBA/アドインは対象外。
  Windows の GPU 依存の不具合。

**SlideCraft への含意**（事実からの読み取り）
1. 「ボタン＝コマンド＝MCP」は、SlideCraft では構造化操作（`set_slide_markdown` 等 41 ツール）として既に同型。
   差は粒度: DeckCraft は「図形を動かす」、SlideCraft は「意味を書く」。
2. `render --all` ≒ `get_deck_image`。read/write root ≒ `--root` / `--no-fs`。導入形（stdio・1 コマンド）も同じ。
3. **最大の差は「既存 .pptx を開けるか」**。DeckCraft は開く、SlideCraft はテンプレだけ取り込む。
4. DeckCraft が苦手な「企業テンプレの忠実度」は、SlideCraft がマスター取り込み（master-intake）で一番投資してきた所。
5. 動画・アニメーション・発表者ビューは DeckCraft が持ち、SlideCraft は持たない。これは「追うべき差」か
   「分業で良い差」かが本書の論点。

## 3. 比較表 — PowerPoint の機能群 × SlideCraft の現状 × 判定

判定の凡例: **維持**＝今の強み／**候補**＝SlideCraft の著作モデルに合い価値が出る／**AI 側**＝ツールではなく
エージェントが担う／**やらない**＝自由配置・本家の領域（DeckCraft 等に任せる）。現状の出所は
`docs/shipped.md`・`docs/mcp-server.md`・`docs/en/guide/*.md`・`src/engine/schema*.ts`。

### (a) コンテンツ要素

| PowerPoint | SlideCraft の現状 | DeckCraft | 判定 |
| --- | --- | --- | --- |
| テキスト（レベル・箇条書き・インライン装飾・リンク） | ✅ 4 段ネスト・太字/斜体/打消/コード/リンク・表セル内も | ✅ | 維持 |
| 図形の自由配置・結合 | ✗（図形は図の中だけ） | ✅ 150+ | **やらない**（構造の芯）。注記・吹き出し需要は md の意味要素で受ける |
| SmartArt | ✅ ネイティブ図 12 種＋Mermaid 4 種（編集可能な図形で出力） | 約 15 種 | 維持。追加は証拠（利用実測）が出てから |
| 表（結合セル・スタイル） | ✅ GFM 表→ネイティブ表。**結合セル ✗** | ✅ | **候補 S〜M**: 結合セル（見出し行の列結合など）。Markdown 記法の設計が要る |
| グラフ（ネイティブ chart オブジェクト） | **✗** pie/xychart/radar 等は図形で描く＝PowerPoint でデータ編集不可 | ✅（部分） | **候補 M〜L・最重要論点**。PptxGenJS の `addChart` で出せる。利点: 受け手が PowerPoint で数値を直せる・ネイティブの見栄え。衝突: 「プレビュー＝PPTX＝HTML を 1 つの painter で描く」原則（R8）。§5 で議論 |
| 画像（複数・補正・背景除去） | data URI のみ・**1 枚/スライド**・fit/位置/背景 ✅ | ✅ | **候補 M**: 複数画像と `--root` 配下のローカルパス（#392 のビジュアル並置と合流）。補正・背景除去はやらない |
| アイコン・ストック | 15 種（ネットワーク系） | — | 低優先。SVG 持ち込みを許す方が汎用 |
| 動画・音声 | ✗ | ✅ | **やらない**（AI 著作で価値が出ない）。リンク 1 行の案内で十分。**v0.6 / v0.7 で再議**（裁定） |
| 数式 | ✗ | ✗ | **候補・調査 S**: Markdown の `$…$` は自然。OMML 直接出力は難しく、画像化（SVG→PNG）なら既存経路で可能 |
| 3D・インク | ✗ | ✗ | やらない |
| スピーカーノート | ✅ `<!-- note -->` → PowerPoint のノート欄・HTML のパネル | ✅ | 維持 |

### (b) デザインシステム

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| テーマ・マスター・レイアウト | ✅ .pptx/.potx の忠実取り込み（健全性チェック・修復）・Re-make・内蔵 4 テンプレ・30 レイアウト・自作テンプレ | **維持・最大の強み**（DeckCraft の弱点と対照）。残課題は #97 #99 #116 #128 #143 |
| Designer（自動レイアウト提案） | ✅ 相当: プレースホルダ役割による決定論のレイアウト自動選択・`apply_design_intent` | 維持。「提案を複数見せる」は AI 側（候補 N 個の採否ゲートが既にある） |
| セクション・目次 | ✅ `<!-- section -->` / `<!-- toc -->`（自動導出） | 維持 |
| バリアント・配色切替 | Re-make で吸収。デッキ内の切替は ✗ | 低優先 |

### (c) 著作支援

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| アウトライン表示 | ＝Markdown そのもの | 維持（設計上の優位） |
| Copilot（生成・要約・書き直し） | ＝MCP ＋ `bootstrap` ＋ GUI の AI アシスト（BYOK / ローカル llamafile） | 維持。差別化は「診断を読める・画像で見える・決定論で崩れない」 |
| アクセシビリティチェッカー | 部分: alt テキスト・コントラスト保証はあるが**検査としては出ない** | **候補 S**: `get_deck_issues` に alt 欠落・コントラスト・読み順の規則を追加（#247 の lint トグルと同居） |
| 校閲・翻訳・ディクテーション | ✗ | **AI 側**（エージェントが Markdown に対して行う） |
| スライドの再利用（他デッキから挿入） | ✗（Markdown のコピーで代替） | 低優先。将来 `deck://` リソース間の複製 1 ツールで足りる |
| リハーサル・コーチ | ✗ | やらない |

### (d) モーション

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| トランジション | PPTX ✗（HTML 出力は CSS の 4 種） | **やらない**（PPTX 側）。受け手が PowerPoint で付ける領域。**v0.6 / v0.7 で再議**（裁定） |
| アニメーション・Morph・Zoom | ✗ | 原則やらない。例外候補（低）: 箇条書きの**段階表示（appear のみ）**。`<!-- step -->` が既に「段階」の意味を持つので、意味→動きの最小写像としてなら著作モデルに合う。**v0.6 / v0.7 で再議**（裁定） |

### (e) 発表・出力

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| PDF | 直接 ✗（HTML をブラウザ印刷） | **候補 S〜M**: GUI / MCP / CLI の 1 操作で PDF（既存の Chrome ラスタ経路の延長・1 ページ 1 スライド）。配布資料（ノート付き）はその派生 |
| 画像書き出し | MCP の `get_slide_image` / `get_deck_image` のみ | **候補 S**: GUI / CLI に露出（ファイルに保存・SNS/ドキュメント貼り付け用） |
| 発表者ビュー・ノート表示 | HTML 出力にノートパネル・一覧・キー操作 ✅ | 維持。全画面発表は HTML で足りる |
| 動画書き出し・録画・字幕・Teams | ✗ | やらない |

### (f) 協働

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| 共同編集 | 人（GUI）× AI（MCP）のライブ協働 ✅・楽観ロック・変更追随 | **維持・独自の強み**（ADR-0009/0033/0038）。人×人は対象外 |
| コメント | ✗ | 低優先。AI のレビュー結果は `get_deck_issues` が担う。人のコメントを md に残す記法（`<!-- review -->`）は将来候補 |
| 版履歴 | `.scft` ＋ git／MCP の undo・redo | 維持（#121 の版ゲートは別件） |

### (g) 相互運用

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| **既存 .pptx を開いて編集** | **✗**（テンプレのみ取り込み） | **やらない**（裁定・2026-11-07）。テンプレ取り込みに集中する。検討した案（テキスト・表・画像・ノートの限定取り込み）は記録のみ |
| .ppt / .odp / Keynote | ✗ | やらない |
| 埋め込み（Excel 連携等） | ✗ | やらない |

### (h) 自動化

| PowerPoint | SlideCraft の現状 | 判定 |
| --- | --- | --- |
| VBA・Office.js アドイン | ✗ | やらない |
| API / CLI | MCP 41 ツール（solo 37 / collab-ai 40 / collab-gui 41）・`slidecraft-mcp`（3 OS で PATH）・`--root` / `--no-fs` | 維持。#514（stateless 追随）・#512（計測）・#513（説明文圧縮）で磨く |

## 4. 原則の案 — 「SlideCraft はこうあるべき」

1. **芯は変えない**: 構造化入力 → 決定論レイアウト → 検証可能（診断と画像で AI が見える）。自由配置・
   モーション・メディア・本家の周辺機能は追わない。これは DeckCraft が埋める領域で、競合ではなく**分業**。
2. **「PowerPoint で開いた後に人が続けられる」形を優先する**: ネイティブの表は既にそう。次はネイティブの
   グラフ（数値を直せる）。図（SmartArt 相当）は編集可能な図形で既に出している。
3. **出口を増やす**: PDF・画像・配布資料。AI 著作の成果を PowerPoint を持たない相手にも渡せる。
4. ~~入口を少しだけ広げる（既存 .pptx の内容取り込み）~~ — **採らない**（裁定）。入口はテンプレ取り込みに集中する。
5. **品質ゲートを増やすのは安い**: アクセシビリティ規則は `get_deck_issues` の 1 規則ずつ。
6. **DeckCraft との関係は補完**: 両方 MCP。将来「SlideCraft で著作 → DeckCraft（または PowerPoint）で仕上げ」の
   連携は、SlideCraft 側はネイティブ要素で出すほど楽になる（原則 2 と同じ方向）。

## 5. 論点（ユーザと決めたいこと）

**裁定（ユーザ・2026-11-07）**: 論点 2（既存 .pptx の内容取り込み）は**やらない**。論点 3（モーション・メディア）は
**v0.6 / v0.7 の議題に後送り**（判定は「やらない」のまま、再議の時期だけ記す）。論点 1（ネイティブ chart）は
「表現力が大幅に上がるなら検討したい」→ §5.1 の調査で答える。論点 4 は未裁定。

1. **ネイティブ chart オブジェクトを出すか。** 価値は大きいが、「プレビュー＝PPTX＝HTML を同じ painter で描く」
   原則と衝突する（PPTX は PowerPoint が描き、プレビューは自前で描く＝二重描画）。取り方の候補:
   (a) chart だけ例外にし、プレビューは今の図形描画を**近似**として使い、PPTX はネイティブ chart にする
   （一致テストは「データと系列」のレベルで置く）。(b) 現状維持（図形描画＝完全一致・編集不可）。
   (c) 出力時オプション（`chart: native | shapes`）で両方。推奨は **(a) を調査 S で確かめてから** → §5.1。
2. ~~既存 .pptx の内容取り込み~~ — **やらない**（裁定）。
3. ~~モーション・メディア~~ — **v0.6 / v0.7 で再議**（裁定）。唯一の例外候補は箇条書きの段階表示（appear）。
4. **出口（PDF / 画像 / 配布資料）はどれを先にするか。** PDF 1 操作化が最小。

### 5.1 調査: ネイティブ chart で表現力はどれだけ上がるか（2026-11-07・統括）

方法: PptxGenJS 4.0.1（SlideCraft が使っている版）の `addChart` で 10 個のグラフを持つサンプル .pptx を生成し
（`ppt/charts/chart1..10.xml` を確認）、現状の図形描画グラフと能力を比べた。サンプルはユーザの PowerPoint で
開いて確かめる（数値編集・色変更・グラフスタイル適用ができる）。

| 観点 | 現状（図形描画・`diagram-pie/xychart/radar/quadrant.ts`） | ネイティブ chart（PptxGenJS `addChart`） |
| --- | --- | --- |
| 種類 | 円・棒（縦のみ・並列）・折れ線・レーダー・quadrant の点配置（4 種＋1） | 棒（縦／横・並列／**積み上げ／100% 積み上げ**）・折れ線（平滑・マーカー）・**面（積み上げ）**・円・**ドーナツ**・**散布**・**バブル**・レーダー・3D 棒/バブル・**複合（棒＋折れ線・第 2 軸）** |
| 書式 | 固定（色はテーマから・値ラベル簡易） | 値ラベルの数値書式（`0%`・桁区切り）・軸範囲／タイトル／グリッド・凡例位置・系列色と透明度・ドーナツ穴径・データラベル位置 |
| 受け手の編集 | **不可**（図形の集まり） | **可**: PowerPoint 上で数値を直す（埋め込みワークブック）・色・グラフスタイル・種類の切替 |
| 見栄え | SlideCraft の painter の品質で一定 | PowerPoint 本体の描画（テーマのフォント・効果が乗る） |
| プレビュー／HTML | PPTX と同一描画（byte 単位で一致） | **プレビュー・HTML・`get_slide_image` は自前描画が必要**（HTML にネイティブ chart は無い）＝二重描画は構造的に不可避 |
| 入力記法 | Mermaid `xychart-beta`／`pie` ＋ YAML/JSON の DiagramSpec | Mermaid は棒・折れ線・円しか表せない → 積み上げ・散布・複合は **DiagramSpec の拡張が要る（schema.ts＝R4・ユーザ確認）** |

結論: **表現力は大幅に上がる**（グラフ種 4 → 10 以上、書式、受け手が数値を直せる）。費用は 3 つに分かれる。

1. ネイティブ書き出し経路（既存 4 種を `addChart` に写す・S〜M）。一致テストは「ラベル・系列・値」のデータ水準で
   painter と突き合わせる（R8 の (b)）。PPTX の chart XML は golden で固定。
2. 新しい種類のプレビュー painter（積み上げ・面・ドーナツ・散布・複合・M）。HTML と `get_slide_image` も同じ painter
   を使うので、**プレビューは近似**という前提を docs と `get_deck_issues` の注記で明示する。
3. 記法の拡張（M）。Mermaid 互換の外に出るため、`DiagramSpec` に `stacked` / `area` / `scatter` / `secondaryAxis` 等を
   足す。schema.ts の変更はユーザ確認が要る。

進め方の案（段階化・各段で止められる）: **段 1** 既存 4 種にネイティブ出力を**オプション**で追加（`chart: native | shapes`、
既定は現状）→ 実機で PowerPoint の見栄えと編集体験を確認。**段 2** 種類の拡張（記法＋painter＋ネイティブ）。
**段 3** 既定をネイティブに切替（図形描画は「編集不可で完全一致」が要る人向けに残す）。段 1 だけなら M。

## 6. 候補一覧（GO が出たら Issue 化する）

| # | 候補 | 規模 | 原則 | 備考 |
| --- | --- | --- | --- | --- |
| 1 | ネイティブ chart オブジェクト出力 — 段 1（既存 4 種をオプションでネイティブ出力） | M | 2 | §5.1。段 2・3 は段 1 の実機確認後 |
| 2 | PDF 書き出しの 1 操作化（GUI / MCP / CLI） | S〜M | 3 | 既存 Chrome ラスタ経路の延長 |
| 3 | 画像書き出しを GUI / CLI に露出 | S | 3 | `get_slide_image` の再利用 |
| 4 | 複数画像・`--root` 配下のローカルパス画像 | M | 1 | #392 と合流 |
| 5 | 表の結合セル | S〜M | 2 | 記法設計が要る |
| 6 | アクセシビリティ規則（alt 欠落・コントラスト・読み順） | S | 5 | #247 と同居 |
| 7 | 数式（`$…$` → 画像化）の調査 | S | 1 | OMML は見送り |
| ~~8~~ | ~~既存 .pptx の内容取り込み（限定）~~ | — | — | **やらない**（裁定） |
| 9 | 箇条書きの段階表示（appear のみ） | S | 1 | **v0.6 / v0.7 で再議**（裁定） |

## References

- DeckCraft: [README](https://github.com/storytold/deckcraft)・[gaps.md](https://raw.githubusercontent.com/storytold/deckcraft/main/docs/gaps.md)・[releases](https://github.com/storytold/deckcraft/releases)
- SlideCraft の現状: [shipped.md](../shipped.md)・[mcp-server.md](../mcp-server.md)・[guide](../en/guide/)・[ROADMAP](../ROADMAP.md)
- 関連 ADR: [0008](../adr/0008-mcp-tool-surface.md)・[0022](../adr/0022-bundle-mcp-cli.md)・[0033](../adr/0033-mcp-single-control-plane.md)・[0037](../adr/0037-mcp-surface-realignment.md)・[0038](../adr/0038-mcp-stateless-realign.md)
- 関連 Issue: #392 #247 #97 #99 #116 #128 #143 #121 #514 #512 #513
