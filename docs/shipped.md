# SlideCraft 実装済みログ（Shipped）

これまでに完成・出荷した作業のログです。**前方向きの計画は [ROADMAP.md](ROADMAP.md)**、決定の詳細な根拠は [docs/adr/](adr/) と git（PR）履歴を参照してください。機能/フェーズ完了時にここへ1行追記します（[.claude/rules/roadmap-conventions.md](../.claude/rules/roadmap-conventions.md)）。テーマ別・各グループ内はおおむね新しい順。

## 基盤・アーキテクチャ

- **プレースホルダ⇄入力の全単射** — `buildFieldMap` がマーカープローブで `bindContentByRole` の全単射を実証、2-pass バインド（idx-exact → role）で疎カラムの漏れ/上書きを是正、敵対ファズで見つけた 9 件の実バグを不変条件テストで封鎖 （ADR-0011・2026-07-02）
- **OOXML スタイル階層＝lstStyle は差分のみ** — Theme がフォント定義、Master が参照（+mj-lt/+mn-lt）、Layout の lstStyle は差分のみ、Slide はテキストのみ。placeholder-filler は `<a:t>` のみ差し替え lstStyle/spPr を保全し master UI 編集が流れ続ける （ADR-0004）
- **主面＝視覚 deck（Markdown は入出力のみ）** — DeckIR を単一の真実とし視覚 Edit を主面に、Markdown は Initialize モーダル（入力）＋`serializeMd`（出力）に限定、統一 deck-history undo （ADR-0002・2026-06）
- **プロダクト形態＝Tauri デスクトップアプリ** — Tauri v2（com.slidecraft.desktop）＋dual-mode IPC（`__TAURI_INTERNALS__` で切替）、ブラウザは dev/demo 専用、CSP default-src 'self'＋scoped fs/dialog/http （ADR-0001・2026-06）
- **harness-over-model ＋ 自動修復ループ** — 知能をモデルでなくエンジンに：generate→diagnoseDeck（非破壊）→決定論レバー→AI 残差→再診断の閉ループ、3 段階の強度、再利用可能な slide-fix フィードバックパケット、silent-apply しない （ADR-0005・2026-06）

## 内蔵AI（llamafile）

- **内蔵オフライン AI ランタイム＋環境適応モデルティア** — llamafile サイドカー（local_ai.rs：free-port spawn＋/health poll＋crash-fast＋async）を desktop 既定 provider に、重みは pinned-URL＋SHA256 自動DL（一致時のみ atomic rename）、model_tier.rs が RAM/コアを probe し phi-3.5-mini / granite-4.1-8b を選択、`stage-llamafile.mjs` で env-free 配布 （ADR-0017・2026-07）
- **編集出力サニタイザ floor ＋ tier 既定モデル配線** — 小モデル向け出力 floor と環境適応モデル選択ポリシー（core）を tier 既定に配線 （PR #68・2026-07-05）
- **起動タイムアウト修正＋ローカルモデル限定トグル退避** — オフライン AI 起動タイムアウトを修正、ローカルモデル限定トグルを上級設定へ退避 （PR #67・2026-07-05）
- **内蔵モデルの自動ダウンロード（P5）** — 内蔵モデルの pinned-URL からの自動ダウンロードを実装 （PR #56・2026-07-01）
- **llamafile ランタイム同梱（P4 staging）** — llamafile ランタイムをパッケージに同梱（staging） （PR #57・2026-07-01）
- **起動の UI フリーズ修正（非同期化）** — 内蔵 AI 起動を非同期化し UI フリーズを解消 （PR #55・2026-07-01）
- **生成時自動起動＋停止（メモリ解放）ボタン** — 組み込み AI を生成時に自動起動、停止でメモリ解放するボタンを追加 （PR #53・2026-07-01）
- **desktop 既定 AI を組み込みオフラインモデルに** — デスクトップの既定 AI provider を組み込みオフラインモデルへ切替 （PR #51・2026-07-01）
- **内蔵 AI provider 配線** — builtin preset＋`switchToBuiltin`＋CSP を配線（roadmap #2 P2） （PR #47・2026-07-01）
- **内蔵 AI ランタイム local_ai.rs** — llamafile サイドカーの Rust ランタイム local_ai.rs を実装 （PR #46・2026-07-01）

## AI編集の深化

- **AI 単一スライド編集＝構造化 ops → 決定論マージ（部分生成）** — AI は変更フィールドのみ ops を出力しエンジンが決定論マージ（P1：DiagramEditOp/applyDiagramEditOps・drift ゼロ）、full-regen フォールバック保全 （ADR-0019・2026-07-05）
- **AI 編集の検証は採用ゲート（描画は止めない）** — `reconcileSlideEdit` は常に描画可能なスライド＋警告を返し、`previewSlideEdit` が AiPanel DiffView＋amber バナーで accept/reject、advisory は editNotice へ（有効なスライドを空白化しない） （ADR-0018・2026-07-04）
- **AI 編集の構造保全ハーネス** — `reconcileEdit`（存在時のみ restore・idx-Map 全単射保全）＋`validateStructure`/`mergeVerdicts` を 3 apply パス全てに配線、ロール規約を `slide-roles.ts` に集約、serializer round-trip の pinned figure/table/code 消失を修正 （ADR-0012・2026-07-03）
- **whole-deck refine と batch 一括編集に best-of-N** — まとめて整える／複数選択一括編集に best-of-N（N候補生成→採用ゲート）を展開 （ADR-0019・2026-07-06）
- **Best-of-N（単一スライド編集）** — N候補生成→採用ゲート＋候補ピッカー（Option B・clamp[1,5]） （ADR-0019・2026-07-05）
- **図編集 drift の単発自己修復リテイク** — 全文逸れ検出時に ops 再試行を 1x 自動発火（Option A・`buildOpsRetryInstruction`） （ADR-0019・2026-07-05）
- **テーマ1 プロンプト磨き込み完了** — 構造保全ハーネス・敵対検証・図生成二段構え・payload 保全 （PR #58・2026-07-03）
- **validate-and-retry ガードレール** — 内蔵小モデル向けの検証&再試行ガードレールを実装（roadmap #2 P1） （PR #42・2026-06-30）
- **refine/condense を Markdown 専用 prompt に配線** — refine/condense を Markdown 専用 prompt に配線（roadmap #2 P1b） （PR #45・2026-07-01）

## テンプレ・マスター

- **Placeholder ロール解決に gate 付き title リカバリ** — `type="body"`／idx0 でも名前が "Title"/"タイトル" の placeholder が title を受け取らずデッキ題が宙に浮く不具合を修正。ロール解決を「Phase 1: 従来の type→idx→body ラダー」＋「Phase 2: **layout に title 不在時のみ**、非meta の box を `name一致 かつ (idx0 or title 形状)` の合議で title に昇格（取込時に `resolvedRole` 確定→bind/catalog/fieldMap が共有）」に整理。gate により健全テンプレは byte-identical（全 1229 テスト・回帰ゼロ）。テストファースト（`placeholder-role-recovery.test.ts` 10 例） （ADR-0025・2026-07-08）
- **Layout 選出エンジンの gate 付き強化（Tier 1・ADR-0025 と同哲学）** — 敵対的監査（4レンズ・実 probe）で見つけた選出ミスを是正。(1) **closing 語彙を共有＋タイトル限定**：スライド側の closing 判定を `thank/感謝` の全文部分一致から、レイアウト分類と同じ `CLOSING_RE`（まとめ/おわりに/ご清聴/Next steps…）のタイトル限定・語境界に統一（`06_まとめ` 等へ正しく誘導＋本文「thank」誤検知を解消）。(2) **`classifyLayout` に geometry-backed GATE 1/2**：真の横並び peer body（`peerBodyCount≥2`）だけ misleading な名前を上書きして columns 確定・"columns" 名でも body<2 なら structure へ（**2つ縦積み/主+サイド/geometry無しは columns にしない**）。(3) **先頭 body-only スライドを表紙に誤誘導しない**（`!(hasBody && !hasCtrTitle)` で title 名前空間の表紙と区別）。単一箇条書き→1-body content を lock。gate により canonical byte-identical（全 1241 テスト・回帰ゼロ）。テストファースト（`layout-selection-tier1.test.ts` 14 例） （2026-07-08）
- **Layout 選出の degrade 末尾を適性ベースに（Tier 2）** — content/columns ロールを持たないテンプレで `autoSelectLayout` が最終 `catalog[0]`（レイアウトのファイル順で決まる位置依存の盲目選択）に落ちていたのを是正。columns への degrade を追加し、最後は `bestBodyBearing`（本文を実際に保持できるレイアウトを region 適合→usable body 数→addons→名前でランク）で**順序非依存の適性選択**に。画像スライドで picture frame 不在時は書ける body を決定論的に優先。gate（content/columns 不在時のみ発火）で canonical byte-identical（全 1249 テスト・回帰ゼロ）。テストファースト（`layout-selection-tier2.test.ts` 6 例） （2026-07-08）
- **公式ビルトインテンプレ 4本（マルチビルトイン）＋テンプレ資産の棚卸** — Midnight に加え「配布資料 公文書高密度／ビジュアルデッキ マガジン／技術報告 スタンダード水色」を公式テンプレに昇格（見本からサンプルスライドを除去した TemplateOnly を導出＝`scripts/strip-to-template.mjs`、配布資料はユーザ提供のマスター階層版を採用）。`useMasterRegistry` を `BUILTIN_MASTERS` 配列＋URL マップでマルチビルトイン化。あわせて**テスト専用フィクスチャを `public/` から `tests/fixtures/templates/` へ退避**（衛生・63 テストのパス更新）、会社 `.potx`／CX は同所で gitignore、`public/templates/slide/` は公式 `*_TemplateOnly.pptx` 4本＋CREDITS のみに。実 HTML レンダで3テンプレ目視確認 （2026-07-07）
- **スライドマスター Re-make（テーマ抽出→自前レイアウト決め打ち）** — `masterToTemplateSpec` が入力マスターからフォント＋コントラスト安全 9色 palette を抽出→`writeTemplate` で自前 canonical レイアウトに載せる新しい取り込みモード（純粋 Import と両立）。ロゴ継承（元マスターの `<p:pic>` を dark 系レイアウトへ再埋め込み）・フラット設計の吸収（ソースがバー無しなら light 系のヘッダーバーを外す）・EA/CJK フォントと dark ロゴ変種は残 （ADR-0023・2026-07-07）
- **AI 非決定 Re-make（第3の取り込み口・構造マッピング）** — 決定論 Re-make に加え、AI が入力マスターの各レイアウトを clean な canonical レイアウトへ**写像**する第3口（[ADR-0026](adr/0026-ai-remake.md)・[設計](design/ai-remake.md)）。**AI＝分類器のみ**（canonical base の選択＋source 名へ改名）、**幾何/スタイル/生成/検証＝決定論**、壊れ/未接続/全ハルシは**決定論 Re-make へフォールバック（never worse）**。取り込み時に clean なロールへ写すので実行時ヒューリスティック（ADR-0025・layout Tier1/2）の負担を予防。実装: `master-remake-ai.ts`（inventory 抽出/語彙/prompt/防御パース＝ハルシ base drop/compose＝name 単位/fallback・test-first）＋`applyTemplateBytesAsRemakeAI`（callAI 注入・単体テスト可）＋`master-remake` AiMode＋MasterPicker「AI で作り直す」。**Ollama `granite4.1:8b`（小モデル 5.3B）× CX_sample（22 レイアウト）で end-to-end 実証**（実 provider 経路 generateWithAI 経由・usedAi=true・21 レイアウト name 保持・往復 health=ok・決定論のロール誤りより賢い写像あり）。全 1262 テスト（`master-remake-ai.test.ts` 9・`apply-remake-ai.test.ts` 4） （ADR-0026・2026-07-08）
- **AI 非決定 Re-make Phase-2（説明可能性＋best-of-N）** — (1) 写像の**根拠 `reason`**（プロンプト＋`parseRemakeMapping` 捕捉＋`aiRemakeSpec.mappings` 返却＋結果トースト要約）で「なぜこの写像か」を提示。(2) **best-of-N**（`pickBestRawMapping`＝最多カバレッジ・同点はハルシ最少を採用／`applyTemplateBytesAsRemakeAI(..,{n})`／App 既定 `REMAKE_BEST_OF_N=2`・cloud/未接続は n=1）でローカル小モデルの run 間ばらつきを緩和。**5 モデル×K=3 実測**（CX_sample）: valid-JSON 全モデル 3/3、phi4=22/22・0分散／granite8b=21/21 準完璧／phi3.5・mistral は高ばらつき→best-of-N が効く（→既定 n=2 妥当）。TDZ バグ（`notify` を先行参照）を宣言順で根本修正。全 1269 テスト （ADR-0026 §Phase-2・[設計 §9](design/ai-remake.md)・2026-07-08）
- **マスター取り込みの透明化（進捗＋結果＝写像の可視化）** — .pptx 取り込み3経路（忠実 Import／決定論 Re-make／AI Re-make）で、処理中は進捗バー（`IntakeProgress`＝loading→generating 候補 i/N→composing→validating・honest monotonic fraction・`role=progressbar`）、処理後は結果要約バー（`IntakeSummaryBar`・固定トップ・モーダル上でも可視）を表示。要約＝モード・health status・レイアウト数・AI/フォールバック、「詳細」で **AI 写像表（元→標準レイアウト＋根拠 reason）**・抽出テーマ（fonts/palette swatches/logo）・修復件数・health findings。各 apply が `IntakeSummary` を返し、AI は `onProgress` で通知。AI の done-トーストはバーが恒久表示するため撤去。MasterPicker に ⓘ（結果ありのみ・再表示）。ADR-0026 §9.1 の `mappings`（reason 付き）を可視化＝Phase-3「per-layout なぜパネル」を実現。ユーザ FB「Remake 中の待機表示／結果が見えない／Import が暗黙的」への対応。test-first（apply-remake-ai +2・intake-summary-bar +3）・全 1274 テスト （2026-07-08）
- **Re-make のフォント品質 — テーマ参照解決＋日本語(EA)フォント保持** — master が `<a:latin typeface="+mj-lt">`（テーマ参照トークン）でフォント指定する型で、(1) `+mj-lt`/`+mn-lt`/`+mj-ea`/`+mn-ea` を実フォント名へ解決（`resolveFontToken`・theme fontScheme を loader が抽出＝`ThemeFonts`）。表示にも出力にもトークンを出さない。(2) 日本語ロケール Office 既定（`majorFont latin=Century Gothic ea=游ゴシック`）のように**ブランドフォントが `<a:ea>` スロットに入る**場合を保持：`TemplateSpec.fonts` に `majorEa/minorEa`（任意・additive）、`writeTemplate` が `<a:ea>` を出力、`themeSummary` は「見える」フォント（ea‖latin）を表示。従来は latin だけ拾い `<a:ea>` を空出力→再構成デッキから 游ゴシック が消えていた（敵対レビューで確定・往復テストで検証）。全 1278 テスト （2026-07-08）
- **第三者マスターの本文束縛＋反転テーマ背景 修正＋プレビュー画像描画** — idx-META 規約を自前マスター（dotted 名 or 型付き sldNum/dt/ftr メタ）限定にし、素の PowerPoint マスターの idx-10+ body を本文として束縛（プレビュー追随＋PPTX 充填）。反転テーマで暗転していたプレビュー背景を実 `<p:bg>` から解決。layout/master の `<p:pic>` ロゴ/図版をプレビュー描画（従来は全テンプレで pic 落ち） （ADR-0023・2026-07-07）
- **テンプレ作成モーダルのライブプレビュー・サブセット選択・カスタムレイアウト** — 作成モーダルに live preview（`buildTemplatePreview`＝writeTemplate→loadTemplate→distill を SlidePreview 再利用）＋レイアウトサブセット選択＋カスタム `LayoutEditor` を追加 （ADR-0014・PR #77・2026-07-07）
- **テンプレ作成補助 — 修復オファー・ゼロから生成・永続化** — `template-repair.ts` がゲート拒否を最小 type-patch 修復オファーに変換、`template-writer.ts` が TemplateSpec から 30 canonical レイアウトのフル OOXML を生成、`master-store.ts` が masters を永続化、AI は spec のみ提案（contrast-guarded） （ADR-0014・PR #64・2026-07-04）
- **マスター Initialize ゲート配線＋prompt 連動＋段組み幾何分類** — Initialize ゲートを prompt に連動、段組み幾何を分類 （PR #44・2026-07-01）
- **スライドマスター Initialize の堅牢化** — ロール復旧＋受付ゲートで Initialize を堅牢化 （PR #43・2026-07-01）
- **任意マスター（alien テンプレ）での差し替え堅牢性検証** — 任意マスターでのプレースホルダ差し替え堅牢性を検証 （PR #41・2026-06-30）

## HTML・描画

- **プレビュー/HTML の背景画像・グラデ・図形グラデ描画（A1/A2/A3）** — レイアウト/マスターの `<p:bg>` 画像塗り(blipFill)・グラデ塗り(gradFill) を全面描画、`<p:pic>` の非web主 blip（EMF/WMF/wdp）を `svgBlip`(SVG) へフォールバック、装飾図形の `gradFill` を CSS グラデで描画。純粋 `ooxml-fill.ts` に集約（プレビュー＋HTML 共有・PPTX/golden 非影響）。実 HTML レンダで確認 （他AIレポート＋敵対検証・2026-07-07）
- **プレビュー/HTML のグループ図形・custGeom 弧の描画** — `<p:grpSp>` の子図形を chOff/chExt→off/ext の座標変換（＋ネスト合成）で正しい位置に描画（従来は child-space 座標で誤配置・velis の 26 グループ）、custGeom の `arcTo` セグメントを SVG 楕円弧に変換。純粋 `ooxml-geom.ts`（プレビュー/HTML 限定・PPTX 非影響）。velis 実レンダ＋純粋/実フィクスチャテストで確認 （2026-07-07）
- **図のエッジラベル コントラスト適応＋埋め込み図の自前タイトル抑止** — 図のエッジ/関係ラベルをスライド背景に対しコントラスト適応（低コントラスト ~2.4:1 を解消）、埋め込み図はスライド題枠に一任し自前タイトルを描かない（`omitTitle`・重複/上下逆転を解消）。共有 painter 経由でプレビュー SVG も PPTX も同一挙動（実レンダ敵対監査 M11 の高インパクト分） （PR #83／82569eb・59ef092・2026-07-07）
- **締めスライドの可読性（reconcile：非バグ確定）** — 「閉じスライドが白地に薄色文字で不可視」の起票を実データで再検証し **canonical `Midnight_Executive` の Closing レイアウト（L29/L30）は full-bleed の濃紺 BG 図形（`1E2761`・13.33×7.5in）＋アクセントバーを持ち、明色テキストが可読**と確認。レンダラも `extractDecorations`→`spToDeco`（layout/master 両方・サイズ制限なし）で同じ塗りを描画＝WYSIWYG で白地に白文字は発生しない。旧起票の「装飾0」は `<p:bg>` のみ見た誤断 （2026-07-07）

- **図テキストを SVG `<text>` に統一** — svg-writer の text() を `<foreignObject>`+XHTML から native `<text>`/`<tspan>`（dy-stacked・ASCENT=0.875 baseline）＋決定論 wrap＋font-size shrink に移行、preview/HTML/print/canvas が一つの SVG を共有、PPTX golden 不変 （ADR-0013・PR #62・2026-07-04）
- **HTML 出力：印刷を 1 枚 1 ページに修正** — 全スライドが 1 ページに潰れる致命バグを修正 （PR #63・2026-07-04）
- **HTML 出力：表現力アップ** — リッチなスライド遷移＋オーバービューグリッド＋遷移選択 UI （PR #61・2026-07-04）
- **スタンダロン HTML 出力 MVP** — SlideCard を SSR 再利用＋Mermaid 事前 SVG 描画で単体 HTML を出力 （PR #60・2026-07-04）

## スライド編集・画像

- **画像埋め込み＝data URI 埋め込み** — 自己完結 data-URI SlideIR image ブロック（Markdown `![alt](src)` round-trip・SlideCard `<img>`／HTML 自動・PPTX decode → media/pic）、paste＋Tauri/browser file-drop 挿入、picture 枠優先バインド、rect/fit/aspect 手動幾何＋pointer drag/resize、既存を壊さない最背面（behind）モード （ADR-0020・2026-07-06）
- **スライドのドラッグ並べ替え** — pointer イベント方式・PowerPoint 風インジケータでスライドを並べ替え （2026-07-06）
- **useAiGeneration 分割** — `useAiGeneration` をモジュール分割 （2026-07-06）
- **スライドの追加・複製・削除を GUI に** — Undo 可・エンジン共有でスライド構造編集を GUI に （2026-07-05）
- **配色モード切替（Dark/Light/Modern）** — UI 配色モード切替＋色のトークン化 （2026-07-05）
- **Slides↔Editor の仕切りをドラッグ可動に** — 仕切りをドラッグ可動にしサムネを枠に収める （2026-07-05）
- **UI 磨き込み** — AI Assist＋協働の統合・テンプレピッカー刷新・Draft ヘッダ整理 （PR #59・2026-07-04）

## 協働・MCP

- **host `new_project` のタブ名を先頭見出しから導出（B4）** — host モードで AI が作った Deck のタブが常に「Untitled」だった（`session.ts` が templateName を "" にリセット）のを、純粋ヘルパ `deckTitle`（先頭スライドの title placeholder＝idx 0/15）で先頭見出しから命名。`use_template`/`open_project` は既存の templateName 名が優先、見出し無しは「Untitled」にフォールバック。golden 非影響 （他AIレポート・2026-07-07）
- **Live MCP で AI が作った Deck を GUI タブに（モード b）** — 協働ホストの multi-doc を GUI に橋渡し。AI が `new_project` で作った Deck を**背景タブ**として開く（表示は切り替えない＝押すと開く）。タブ切替で projection のミラー先を `setTargetDoc`、ローカルタブは pause して clobber 防止。seed は `open_project` の戻り docId で race-free に link。`makeDoc` が新フィールドを落とすバグをテストで検出→修正 （2026-07-07）
- **MCP CLI 同梱（ビルド不要のエージェント駆動）** — 自己完結 `cli.cjs`＋Node ランタイムをインストーラに同梱、macOS は Homebrew cask が `slidecraft-mcp` を PATH 登録。ソース build もシステム Node も不要で上流 AI（Claude Code/Cursor/Claude Desktop）が駆動可。update-cask に fail-closed guard （ADR-0022・2026-07-07）
- **MCP テンプレ選択 list/use/register_templates** — GUI が collab 開始時に master レジストリを host へ upload するプロトコル越し橋渡し（S2 増分2） （ADR-0015・PR #76・2026-07-07）
- **MCP エラー契約統一** — guard 失敗を `{ok:false,code}` に、isError=crash 専用 （2026-07-05）
- **MCP ブラッシュアップ — 統一 mutation envelope・構造操作・read 粒度** — S1–S6：自己記述契約（get_authoring_guide/get_diagram_types/get_diagram_guide）、テンプレ調達（create_template＋list/use/register_templates）、統一 envelope `{ok,changed,...}`＋commitMutation no-op 修正、4 構造 ops（insert/delete/move/duplicate）、get_slide＋text-slide figure-add、決定論 hints （ADR-0015・PR #65・2026-07-04）
- **P2 協働ホストモデル（sidecar=真実・双方向・配布）** — GUI 自動起動の Node サイドカー（dist/mcp/host.cjs）を単一真実（DocRegistry・multi-doc・共有 history-core の server-side undo・forward-only rev）、loopback Streamable-HTTP＋per-launch 256-bit bearer token、人↔AI を一本のタイムラインで双方向、Rust はライフサイクルのみ（DeckIR に触れない） （ADR-0009・2026-06）
- **MCP ツール/リソース面（監査結論）** — 6-agent 監査（PR #25）で構造的重複ゼロ→削除なし、dual read（get_* tools＋deck:// resources）を互換フロアとして維持、generate_from_plan は DO-NOT-BUILD （ADR-0008・PR #25・2026-06-29）
- **MCP サーバ設計（決定論レバー・native-only export）** — resource-centric stdio MCP、18 決定論ツール（split_overflowing_slides / convert_bullets_to_table 含む）、反転 aiFix（get_slide_fix_request）、native-vector-only export_pptx（mermaid は reject/skip・never-silent）、--no-fs のみ （ADR-0007・2026-06）
- **AI 統合＝Core+Adapters・headless MCP 先行** — Core（pure engine＋共有 state＋既存契約）＋Adapters、headless stdio MCP 先行（slidecraft serve・src/mcp/・--no-fs）、OS ユーザ=信頼境界、local-model-only を単一チョークポイント generateWithAI/isLocalTarget で強制 （ADR-0006・2026-06）
- **P2 協働の増分**（協働ホスト実装の内訳）:
  - P2.5a 接続中の協働編集＝per-slide 往復＋Undo を host へ再ルート （PR #36・2026-06-30）
  - P2.3 サイドカー spawn＋P2.4 GUI ライブ更新 （PR #35・2026-06-30）
  - P2.4a collab-client（webview 用 MCP クライアント） （PR #31・2026-06-29）
  - P2.2b host.ts（初の collab listen サーバ） （PR #30・2026-06-29）
  - P2.2a host-security＋host-json（admission 境界） （PR #29・2026-06-29）
  - P2.1b buildServer host モード（multi-doc＋server-side undo/redo） （PR #28・2026-06-29）
  - P2.1a host-core（DocRegistry＋server-side undo/redo） （PR #27・2026-06-29）
  - P2.0 シーム（history-core 共有化＋onMutate/resources opt-out） （PR #26・2026-06-29）
  - MCP deck:// resources（read-only deck 状態の公開） （PR #24・2026-06-29）

## リリース・配布

- **生成 PPTX の PowerPoint 実機開封チェック** — 出力 .pptx を実 PowerPoint / PowerPoint for the web で開き見た目を確認済（従来の python-pptx＋wellformed-gate に加え実機で確認・ユーザ確認 2026-07-07）
- **v0.1.0 初回パブリックリリース＋工程化（M0–M13）** — バージョン単一ソース化（`bump-version.mjs`）・CI 軽量化（push=Linux 限定・release は tag 限定）＆再有効化・`npm audit` triage＋security ゲート required・LICENSE(Apache-2.0)＋第三者/モデル重み attribution（THIRD-PARTY-NOTICES）・セキュリティ再チェック（画像 `src` を data:image 制約・export nonce-CSP・data-URI サイズ上限）・ユーザマニュアル＋VitePress ドキュメントサイト（GitHub Pages）＋上流 AI 向け SKILL.md・`release.yml` 4-OS installer 実走・軽量自動更新方針・Homebrew tap/cask 構築 （ADR-0021・2026-07-07）

## UX・配布

- **UI 日英切替（i18n・react-i18next）— 全 UI ＋ .ts 状態文言まで** — JA\|EN トグル（テーマトグル隣・localStorage 永続・既定 ja）で UI 全体が日⇄英に切替。.tsx 25 コンポーネントに加え、フック/モジュール由来の状態・通知文言（`ai-generation-types.ts` の接続ステータス・`useCollab.ts`「未接続」・`useDeckController` notice・AI タスクラベル・修復プラン説明）まで `i18n.t()` 化し、**39 名前空間 379 キー**を `ja/en.json` に集約。`MODE_LABEL` を object→`modeLabel(mode)` 関数化して EN 時の混在を解消。型安全キー（`i18next.d.ts` で ja.json に対し `t()` を型検査）・補間 {{var}}・ハイフンキー（`aiMode.diagram-edit`）を EN/JA 両方で runtime 検証。全展開はワークフロー並列＋決定論マージ（辞書は競合回避で親がマージ） （2026-07-07）
- **英語ドキュメント（VitePress 二言語サイト＋README＋第三者通知）** — docs サイトを VitePress ネイティブ i18n 化（root=日本語／`/en`=English・ナビ右上の言語スイッチャ自動表示）。公開13ページを `docs/en/` にミラーし、サイト内絶対リンクは `/en` 接頭辞へ書換。`README.en.md`（GitHub 慣習・`<kbd>` ボタン風言語切替）＋`THIRD-PARTY-NOTICES.en.md`（ライセンス名・数値は verbatim、説明文のみ英訳）。並列翻訳（1ファイル=1エージェント・別ファイル出力で競合なし）。`npm run docs:build` 成功（`ignoreDeadLinks` 未設定＝全 `/en` リンク検証）、本番 Pages に配信済 （2026-07-07）
- **デフォルトのサンプル Markdown 廃止＝空起動** — 起動時に読み込んでいたサンプルデッキ（`sample-deck.ts`）を削除し、アプリは空状態で開始（既存のプレースホルダで graceful）。あわせて**空デッキで「＋ スライド追加」が no-op だった不具合を修正**（純粋 `addBlankSlide` が deck=null なら1スライドを mint）。vite preview＋Playwright で実操作確認 （2026-07-07）

- **`.scft` アプリ関連付け（ダブルクリックで開く）＋拡張子短縮** — プロジェクト拡張子を `.slidecraft`→`.scft` に短縮し、OS 関連付けで**ダブルクリック/「プログラムから開く」**が起動＝新タブで開く。Win/Linux ウォーム起動は `single-instance` で単一ウィンドウ、macOS は open イベント、Win/Linux コールドは argv。fs スコープ動的付与でダイアログ選択と同じ信頼境界 （ADR-0024・2026-07-07）
- **`.scft` バンドルへ schema version を埋め込み（前方互換の土台）** — プロジェクト（`.scft`）の `meta.json` に `version`（`PROJECT_VERSION`）を書き込み・zod 検証・開封時に読み出す。前方互換の土台を敷設（version を使った互換ゲート/マイグレーションは残＝ROADMAP） （`project-io.ts`・2026-07-07）
- **AI が Live MCP で作った Deck を GUI 背景タブに出す（モード b）** — 協働中に上流 AI が `new_project` すると背景タブとして出現（表示は切替えない）。マルチドキュメント基盤（`openDoc` activate:false）＋ミラー先の per-tab 切替 （2026-07-07）
- **改行を LF 固定（.gitattributes）** — Windows CRLF churn を .gitattributes で根治 （PR #69・2026-07-05）
- **配布 — パッケージ版で collab を動かす** — node externalBin 同梱＋host.cjs resource でパッケージ版 collab を稼働 （PR #37・2026-06-30）
- **配布をクロスプラットフォーム化＋CI で node 同梱** — mac/linux 対応の土台として配布をクロスプラットフォーム化 （PR #39・2026-06-30）
- **eslint 10＋react-hooks 7.1 移行** — eslint/react-hooks を更新し露出した 14 件のアンチパターンを修正 （PR #32・2026-06-29）

## セキュリティ

- **セキュリティレビュー（テーマ4）＋F1〜F4 是正** — 5-surface 監査で ADR-0010 コアガードを確認、F1 https-only baseURL＋egress consent、F2 svgCache 開封時 distrust＋export-HTML CSP＋DOMPurify、F3 OS keychain（localStorage fallback）、F4 stage-node SHA256 pinning。残は F1'（egress hard boundary）のみバックログ （ADR-0016・PR #66・2026-07-04）
- **セキュリティモデル（token 境界・loopback・no-fs/zip 硬化）** — per-launch 256-bit bearer token（timing-safe safeEqual）＋Origin-allowlist、host.json handshake 0600、arbitrary read/write_file 撤去→scoped tauri-plugin-fs、csp:null→default-src 'self'、zip 硬化（100MB/5000 entries/≤2000 slides・stream-abort） （ADR-0010・2026-06）
