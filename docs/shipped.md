# SlideCraft 実装済みログ（Shipped）

これまでに完成・出荷した作業のログです。**前方向きの計画は [ROADMAP.md](ROADMAP.md)**、決定の詳細な根拠は [docs/adr/](adr/) と git（PR）履歴を参照してください。機能/フェーズ完了時にここへ1行追記します（[.claude/rules/roadmap-conventions.md](../.claude/rules/roadmap-conventions.md)）。テーマ別・各グループ内はおおむね新しい順。

## 基盤・アーキテクチャ

- **表と本文の共存＋列内 GFM テーブルのネイティブ保持** — `md-slide-parser` の表パースが表と周辺本文を排他扱いして本文を無言 drop していた（#148 が `table-dropped` で計上していた実バグ）根本原因を解消。新設 `md-body-table.ts`（`extractBodyTable`）で表と前後本文を分離して共存させ（#101）、separator 各カラム内の GFM 表を `colIdx` 束縛でネイティブ表として保持（#100）。single-body ガードの誤潰しは `isColumnScopedTable`（legacy/plan-driven シリアライザ共有＝R8）で判定。表なし・単一表デッキは byte-identical、`table-dropped` notice は「2枚目以降の表の破棄」へ意味を更新（診断は温存） （#100/#101・PR #207・2026-07-19）
- **グループセル内 `## 見出し`＋箇条書き記号の表示** — セル内の `## X` がリテラル表示されていた問題を、`linesToParagraphs` の `cellHeading` オプション（グループセル/カラム内容の呼び出し口限定）で GROUP 見出しへ昇格して解消（セル外・非グループは byte-identical、heading は常に `### ` へ正準化で round-trip 安定）。併せて同梱 Midnight テンプレの master `bodyStyle` lvl1 が `buNone`（#180/#137 以前の生成物）で記号が出なかったため、`scripts/add-body-bullet-style.ts`（`template-writer.ts` の `BODY_BULLET_PPR` 再利用＝R8）で `buChar「•」`＋`spcBef` を public/tests 両コピーへ byte-identical に焼き（`slideMaster1.xml` のみ差分・titleStyle は `buNone` 維持） （#102・PR #209・2026-07-19）
- **GUI 起源 comment-only 段落の round-trip 保全** — GUI で直接入力した「ちょうど1個の完全な HTML コメント」から成るプレーン段落が、ai-apply/useDeckRevise の内部 `serializeMd→parseMd` 往復で無言 drop されていた（#163 の Markdown 起源コメント drop と衝突）問題を、シリアライザが comment-only プレーン段落の先頭 `<` を `\<` へエスケープ／パーサが剥がす最小往復（案1・汎用エスケープ機構は導入しない）で解消。#163 の Markdown 起源 drop は不変・冪等 （#165・PR #208・2026-07-19）
- **ネスト箇条書き（3段・clamp・全経路貫通）** — `Paragraph.level`（optional 0–3・省略＝0）を追加し、パーサ（2/4/6スペース→lvl1–3・8スペース以上は clamp＝no-silent-drop）→ round-trip（正準2スペースで clamp 後も不動点）→ PPTX（`lvl` 属性のみ＝マスターの lvl2–4 スタイル継承任せ）→ プレビュー（インデント＋lvl 別フォントサイズ解決）を貫通。既存フラットデッキは全経路 byte-identical。GUI フィールドエディタ往復の平坦化も防止 （#103・PR #202・2026-07-19）
- **js-yaml v4→v5 移行（空入力互換の一本化）** — v5 の default export 廃止・`load("")` throw 化に対し、v4 セマンティクス（空→undefined）を `engine/yaml-io.ts` の `loadYaml` に封じて src 全 17 呼び出しを移行（R8） （#13・PR #204・2026-07-19）
- **変換レポートの完成＝パース時フォールバックの計上** — 無言で起きていた4種（2つ目以降の表で周辺本文ごと破棄＝issue 記載より広い既存バグを発見・2枚目以降の画像・非認識メタキーの本文化・distill 自動分割）を `get_deck_issues` に計上。パーサしか見えない drop は ParseNotice 側路（`parse-notice.ts` に判定を一本化＝R8）、再構成可能なものは deck-diagnostics 側（R2）、分割は `offsets` ベースで原スライド単位に正確に報告。DeckIR は byte-identical （#148・PR #197・2026-07-19）
- **章扉の全章リスト再掲＋現在章強調（ADR-0032 D2 段階3）** — `SectionNav.1TitleList.Single` レイアウト新設（テンプレはスクリプトから byte 再現可能に再生成）＋ `materializeDerivedSlides` 拡張。serializer は idx-1 が導出結果と深い一致の時のみ畳む（著者 pin＋自書き本文は no-silent-drop で保全＝レビューで是正） （#167・PR #191・2026-07-19）
- **フッタ章名の伝播（ADR-0032 D2 段階4）** — content スライドの ftr 枠へ所属章名を自動注入。導出は純関数 `sectionFooterFor` 一本を PPTX/プレビュー/HTML の全消費点が共有（R8）・DeckIR に状態を持たないため serializer 対応自体が不要。明示 `Footer:` 優先・section 無しデッキ byte-identical （#168・PR #190・2026-07-19）
- **保守性ゲートの運用整備** — arch-census（G3・churn×行数 hotspot＋jscpd コピペ率の非 fail 傾向観測スクリプト）＋ ADR 索引ドリフト是正（0019–0028 の10件補完） （#158/#130・PR #174/#172・2026-07-19）
- **CRLF 入力の正規化（layout pin 無効化の根治）** — Windows 由来の CRLF Markdown で `<!-- slide: -->` layout pin が無効化されディレクティブ行が本文に印字される既存バグを、`parseMd` 入口の CRLF→LF 正規化（行数不変＝sourceLine 非影響）で根治。front-matter の raw 行照合も同時に救済、LF 入力は `toEqual` 同値で不変を担保 （#164・PR #187・2026-07-19）
- **`<!-- section -->` 章タグ＋採番＋ `<!-- toc -->` 導出目次（乖離しない目次）** — 章扉は著者が書く普通のスライド（章名は `#` 見出しのまま）＋タグで章境界を宣言し、章番号と目次を `scanSections` 単一関数から毎回導出（`deck-sections.ts`・R2/R8）。消費 3 点（PPTX/HTML/プレビュー）とも同一の materialize を通り、md へは `<!-- toc -->` 1 行のみ書き戻す＝目次と本文の乖離が構造的に起きない。宣言なしデッキは同一参照素通り。段階 3/4（アジェンダ再掲・フッタ章名）は #167/#168 （ADR-0032・#151・PR #182・2026-07-19）
- **スピーカーノート記法 `<!-- note -->`（ブリーフィング型の土台）** — マーカー以降スライド末尾までを素の Markdown のノートとして `SlideIR.notes` へ取り込み、PPTX notesSlide/notesMaster 生成・HTML の `n` キートグル・distill 分割は先頭チャンクのみ・MCP `get_slide` 露出まで配線。ノート無しデッキの出力不変（PPTX パート不生成・HTML byte-identical）を構造的に担保。「スライドは疎に・詳細はノートへ」が成立 （ADR-0032・#150・PR #176・2026-07-19）
- **BindingPlan＝束縛の単一権威化（段階A/B）** — 束縛の観測型 `resolveBinding`/`slideBindingPlan` を導入し #97/#135/#128 系の silent-drop を全 MCP サーフェスで warn 化（段階A）、serializer と GUI の deck-level/per-slide readout を束縛と同一写像に統一し closing 語彙タイトル消失・round-trip 破壊を根治（段階B）。証拠ポリシーの層別（層2＝配管は合成 fixture で着手可）も本 ADR で明文化 （ADR-0030・PR #152/#156/#161/#162・2026-07-18〜19）
- **保守性ゲート＝構造規約の実行可能化** — 権威 import 許可リスト・R2 純度・R1 凍結リスト・循環禁止を `arch-conformance.test.ts` で CI 必須化（ratchet 運用＝リスト縮小が改善の実測値）、R8「意味の重複禁止＝一致テスト必須」を CLAUDE.md/PR テンプレに制度化 （ADR-0031・PR #157・2026-07-18）
- **敵対 fixture 第2弾（valid・見た目キレイ・慣習だけ汚い）** — Dirty_AllBody（全部 body 型）/ Dirty_Legacy43（4:3・継承だのみ・typeless/巨大 idx）/ Dirty_Grouped（スケール付きグループ内見出し＝census 盲点）を合成しコミット。#128/#144 の再現台・ADR-0030 層2ポリシーの試験台 （PR #154・2026-07-18）
- **型×幾何の矛盾センサス（層1融合判断の実測データ）** — `typeIdxRole` 抽出（byte-identical）＋ `PathologyReport.conflicts` で「type の答えに幾何が異議を唱える枠」を計上。実コーパス（会社7種＋CX）で矛盾 0・velis のみ 9 ＝「type は健全マスターで信頼できる」をデータで決着、梯子→融合の大転換を当面不要と判断 （#146・PR #166・2026-07-19）
- **非ディレクティブ HTML コメントの drop** — レビュー注記・TODO・出典 ID の comment-only 行が本文としてスライドに印字される罠を修正（fence 内素通し・WHATWG 異常終端形対応・sourceLine 維持）。上流エージェントの SSoT 運用（md に作業注記を残したまま変換）が可能に （#147・PR #163・2026-07-19）
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

- **先頭章扉の表紙誤解決を根治** — `<!-- section -->` を先頭に書いた title-only 章扉が表紙レイアウトに auto 解決され round-trip でタイトルが消える既存バグを、`slideRoleRegions` の表紙分岐に `!sectionBreak` ゲート1本で選出側から根治（マーカー無しデッキは byte-identical） （#195・PR #199・2026-07-19）
- **staticText のグループ変換合成（census 盲点の解消）** — `extractStaticTexts` がグループ（`<p:grpSp>` chOff/chExt スケール）内の生テキスト見出しを子座標のまま返し、幾何ベースの病理検出・ロール推定が「見た目キレイだがツールだけ誤読」する盲点を解消。`walkShapes` と同じ `composeXf` 合成則を共有（R8）し、副産物として walkShapes の自己マッチ再帰でグループ内装飾が全滅していた先在バグも `groupChildren` で根治。Dirty_Grouped の GAP テストをスライド座標側へ反転 （#142・PR #181・2026-07-19）
- **create_template の日本語ファースト体裁** — 生成マスターの bodyStyle lvl1 に buChar「•」＋段落間 spcBef を焼き（タイトルは buNone 明示）、theme の `<a:ea>` に既定 CJK フォールバック（Yu Gothic・spec 明示時は上書き）、表紙サブタイトル y を `titleTextBottomIn`（タイトル2行折返し＋gap 0.15in）と整合する 3.85in へ。幾何整合は BUILTIN_LAYOUTS 全表紙レイアウトをテストで検査 （#137・PR #180・2026-07-19）
- **closing の受け皿選択（body 保持レイアウトへ）** — closing 語彙スライドに本文があるのに body 枠ゼロの Closing レイアウトへ誘導され本文が落ちる問題を、`pickLayout` の closing 候補を usable-body 保持でフィルタして根治（`slideRoleRegions` が regions:1 を通知） （#153・PR #175・2026-07-19）
- **card/step ヒントの group 検出自己整合** — 既定テンプレで `<!-- cards -->`/`<!-- steps -->` ヒントが不発だった問題を、canonical 名ヒント付き group 検出で修正 （#136・PR #177・2026-07-19）
- **Master-Intake F1 do-no-harm ハードニング（chrome 一貫性＋実出荷テンプレの誤注入根治）** — F1 基盤の後、実出荷テンプレで踏む do-no-harm 違反4件を実測ベースで根治し、chrome シグナルを全経路で一貫させた。**#96** geometryRole が幅広 running header 帯を title 誤認 → RECOVERY tier に chrome guard（`isChromeBand` を単一定義化）。**#124** chrome 帯が visual 経路（`bodyPlaceholders`/`nthBody`）の body 序数に混ざり、出荷テンプレ（配布資料 05_比較表）で図/表が 3.1″×0.62″ のヘッダー帯に描かれていた → 序数ゲート＋`unboundVisuals`（no-silent-drop の visual 版）。**#125** ctrTitle 配下の body 型サブタイトル枠が body 判定になり subtitle 未束縛＋箇条書きを吸う → binding 両側の対称性を idx-1 規約で復元（幾何 rung は CX Quote 実測で不可＝[ADR-0029](adr/0029-cover-subtitle-role-recovery.md)）。**#127** catalog の `bodyCount`/`bodyBoxes` が chrome 未適用で binding と食い違い、実 body 0 のレイアウトへ content を誘導 → `isContentBody`（role body ∧ not chrome）を catalog と binding で共有（chrome 判定を複製しない）・layout 割り当ての golden 付き。全て実出力（python-pptx）検証・健全テンプレ byte-identical・全 1361 テスト緑 （#96/#124/#125/#127・2026-07-17〜18）
- **Master-Intake 基盤 F0/F1（任意マスターの取り込み理解）** — 「重要な所は絶対外さず・間違った所には絶対入れない」を北極星に、決定論で任意マスターの取り込み理解を底上げ。**F0a 証拠ツール**: 病理センサス（機密ゼロで実テンプレの構造病理を計測・`master-pathology.ts`／`scripts/pathology-census.ts`）＋ sanitize-master 構造双子（実物→機密ゼロの骨格双子・忠実性を parse-audit 一致で機械証明・`scripts/sanitize-master.ts`）。**F0b** geometryRole の sldSz 相対化（非16:9=A4/4:3 対応・16:9 は byte-identical）。**F1-①** 決定論スコアラー `inferFunction`（placeholders∪staticTexts の相対属性＋読み順＋confidence で title/primaryBody/chrome/accent/figure を分離・敵対 fixture で title 0/4→**5/5**）。**F1-②** do-no-harm binding ゲート（`inferredFunction=chrome` の枠へ body/title content を入れない＝**header 誤注入を根治**）＋ no-silent-drop プリミティブ（`unboundContent`＝未束縛の報告）＋ scorer 駆動 title 復元（body 見出し→title role・名前ヒント無しでも幾何で拾う）。health テンプレ byte-identical・velis(実 outlier)で content 安全を検証。設計 [master-intake.md](design/master-intake.md)（ADR-0025/0027/0028 系）。テストファースト（全 1297 テスト緑） （2026-07-13）
- **Placeholder ロール解決に gate 付き title リカバリ** — `type="body"`／idx0 でも名前が "Title"/"タイトル" の placeholder が title を受け取らずデッキ題が宙に浮く不具合を修正。ロール解決を「Phase 1: 従来の type→idx→body ラダー」＋「Phase 2: **layout に title 不在時のみ**、非meta の box を `name一致 かつ (idx0 or title 形状)` の合議で title に昇格（取込時に `resolvedRole` 確定→bind/catalog/fieldMap が共有）」に整理。gate により健全テンプレは byte-identical（全 1229 テスト・回帰ゼロ）。テストファースト（`placeholder-role-recovery.test.ts` 10 例） （ADR-0025・2026-07-08）
- **Layout 選出エンジンの gate 付き強化（Tier 1・ADR-0025 と同哲学）** — 敵対的監査（4レンズ・実 probe）で見つけた選出ミスを是正。(1) **closing 語彙を共有＋タイトル限定**：スライド側の closing 判定を `thank/感謝` の全文部分一致から、レイアウト分類と同じ `CLOSING_RE`（まとめ/おわりに/ご清聴/Next steps…）のタイトル限定・語境界に統一（`06_まとめ` 等へ正しく誘導＋本文「thank」誤検知を解消）。(2) **`classifyLayout` に geometry-backed GATE 1/2**：真の横並び peer body（`peerBodyCount≥2`）だけ misleading な名前を上書きして columns 確定・"columns" 名でも body<2 なら structure へ（**2つ縦積み/主+サイド/geometry無しは columns にしない**）。(3) **先頭 body-only スライドを表紙に誤誘導しない**（`!(hasBody && !hasCtrTitle)` で title 名前空間の表紙と区別）。単一箇条書き→1-body content を lock。gate により canonical byte-identical（全 1241 テスト・回帰ゼロ）。テストファースト（`layout-selection-tier1.test.ts` 14 例） （2026-07-08）
- **Layout 選出の degrade 末尾を適性ベースに（Tier 2）** — content/columns ロールを持たないテンプレで `autoSelectLayout` が最終 `catalog[0]`（レイアウトのファイル順で決まる位置依存の盲目選択）に落ちていたのを是正。columns への degrade を追加し、最後は `bestBodyBearing`（本文を実際に保持できるレイアウトを region 適合→usable body 数→addons→名前でランク）で**順序非依存の適性選択**に。画像スライドで picture frame 不在時は書ける body を決定論的に優先。gate（content/columns 不在時のみ発火）で canonical byte-identical（全 1249 テスト・回帰ゼロ）。テストファースト（`layout-selection-tier2.test.ts` 6 例） （2026-07-08）
- **公式ビルトインテンプレ 4本（マルチビルトイン）＋テンプレ資産の棚卸** — Midnight に加え「配布資料 公文書高密度／ビジュアルデッキ マガジン／技術報告 スタンダード水色」を公式テンプレに昇格（見本からサンプルスライドを除去した TemplateOnly を導出＝`scripts/strip-to-template.mjs`、配布資料はユーザ提供のマスター階層版を採用）。`useMasterRegistry` を `BUILTIN_MASTERS` 配列＋URL マップでマルチビルトイン化。あわせて**テスト専用フィクスチャを `public/` から `tests/fixtures/templates/` へ退避**（衛生・63 テストのパス更新）、会社 `.potx`／CX は同所で gitignore、`public/templates/slide/` は公式 `*_TemplateOnly.pptx` 4本＋CREDITS のみに。実 HTML レンダで3テンプレ目視確認 （2026-07-07）
- **スライドマスター Re-make（テーマ抽出→自前レイアウト決め打ち）** — `masterToTemplateSpec` が入力マスターからフォント＋コントラスト安全 9色 palette を抽出→`writeTemplate` で自前 canonical レイアウトに載せる新しい取り込みモード（純粋 Import と両立）。ロゴ継承（元マスターの `<p:pic>` を dark 系レイアウトへ再埋め込み）・フラット設計の吸収（ソースがバー無しなら light 系のヘッダーバーを外す）・EA/CJK フォントと dark ロゴ変種は残 （ADR-0023・2026-07-07）
- **AI Re-make（option C・構造マッピング）＝撤去（未公開）** — ADR-0026 で第3口として実装（Ollama 実証済）だが、v0.3.0 は draft のまま [ADR-0028](adr/0028-retire-ai-remake-option-c.md) で撤去。faithful Re-make が「保つ」を、決定論 Re-make が「作り直す」を満たし、構造グルーピングは detectGroups が既に解けており、canonical 写像は「間違った AI の使い所」だったため。ユーザ未到達。設計資産は AI-Import comprehension（[ai-import.md](design/ai-import.md)）に温存 （ADR-0028・2026-07-09）
- **マスター取り込みの透明化（進捗＋結果＋レイアウトのミニプレビュー）** — .pptx 取り込み経路（忠実 Import／faithful Re-make）で、処理中は進捗バー（`IntakeProgress`＝loading→composing→validating・`role=progressbar`）、処理後は結果要約バー（`IntakeSummaryBar`・ツールバー直下のフローバナー・モーダル上でも可視）を表示。要約＝モード・health status・レイアウト数、「詳細」で**各レイアウトのミニプレビュー（`SlideCard` 縮小描画＝WYSIWYG・ダミー内容）**・抽出テーマ（fonts/palette swatches/logo）・修復件数・health findings。各 apply が `IntakeSummary` を返す。MasterPicker に ⓘ（結果ありのみ・再表示）。ユーザ FB「Remake 中の待機表示／結果が見えない／Import が暗黙的」への対応。test-first（intake-summary-bar）。※当初あった AI 写像表は option C 撤去（ADR-0028）で除去、バー本体は存続 （2026-07-08→改 2026-07-09）
- **Re-make のフォント品質 — テーマ参照解決＋日本語(EA)フォント保持** — master が `<a:latin typeface="+mj-lt">`（テーマ参照トークン）でフォント指定する型で、(1) `+mj-lt`/`+mn-lt`/`+mj-ea`/`+mn-ea` を実フォント名へ解決（`resolveFontToken`・theme fontScheme を loader が抽出＝`ThemeFonts`）。表示にも出力にもトークンを出さない。(2) 日本語ロケール Office 既定（`majorFont latin=Century Gothic ea=游ゴシック`）のように**ブランドフォントが `<a:ea>` スロットに入る**場合を保持：`TemplateSpec.fonts` に `majorEa/minorEa`（任意・additive）、`writeTemplate` が `<a:ea>` を出力、`themeSummary` は「見える」フォント（ea‖latin）を表示。従来は latin だけ拾い `<a:ea>` を空出力→再構成デッキから 游ゴシック が消えていた（敵対レビューで確定・往復テストで検証）。全 1278 テスト （2026-07-08）
- **第三者マスターの本文束縛＋反転テーマ背景 修正＋プレビュー画像描画** — idx-META 規約を自前マスター（dotted 名 or 型付き sldNum/dt/ftr メタ）限定にし、素の PowerPoint マスターの idx-10+ body を本文として束縛（プレビュー追随＋PPTX 充填）。反転テーマで暗転していたプレビュー背景を実 `<p:bg>` から解決。layout/master の `<p:pic>` ロゴ/図版をプレビュー描画（従来は全テンプレで pic 落ち） （ADR-0023・2026-07-07）
- **テンプレ作成モーダルのライブプレビュー・サブセット選択・カスタムレイアウト** — 作成モーダルに live preview（`buildTemplatePreview`＝writeTemplate→loadTemplate→distill を SlidePreview 再利用）＋レイアウトサブセット選択＋カスタム `LayoutEditor` を追加 （ADR-0014・PR #77・2026-07-07）
- **テンプレ作成補助 — 修復オファー・ゼロから生成・永続化** — `template-repair.ts` がゲート拒否を最小 type-patch 修復オファーに変換、`template-writer.ts` が TemplateSpec から 30 canonical レイアウトのフル OOXML を生成、`master-store.ts` が masters を永続化、AI は spec のみ提案（contrast-guarded） （ADR-0014・PR #64・2026-07-04）
- **マスター Initialize ゲート配線＋prompt 連動＋段組み幾何分類** — Initialize ゲートを prompt に連動、段組み幾何を分類 （PR #44・2026-07-01）
- **スライドマスター Initialize の堅牢化** — ロール復旧＋受付ゲートで Initialize を堅牢化 （PR #43・2026-07-01）
- **任意マスター（alien テンプレ）での差し替え堅牢性検証** — 任意マスターでのプレースホルダ差し替え堅牢性を検証 （PR #41・2026-06-30）

## HTML・描画

- **実行時 CJK フォントサブセット化＋Noto 同梱（#115 中盤）** — HarfBuzz WASM（`harfbuzzjs` hb-subset 直叩き）＋`wawoff2` で deck の実使用文字だけの WOFF2 を生成する `subsetFontToWoff2`（失敗＝埋め込みスキップの do-no-harm 契約）、純粋な `collectDeckText`／`resolveFontSubsetSource` を整備。Noto Sans/Serif JP は variable font 2本を `wght` ピン（400/700）で使い、google/fonts 上流と sha256 一致を検証してコミット（OFL 1.1 全文同梱）。HTML への配線は #194 （#193・PR #200/#203・2026-07-19）
- **CJK フォールバックスタック＋ea フォントの描画配線（#115 その1）** — 素の `fontName, sans-serif` 単発だった preview/SVG の font-family を、`<a:ea>` 抽出値の `PlaceholderStyle` 配線＋ゴシック/明朝分類つきフォールバック連鎖（`font-stack.ts` に一本化・SlideCard/svg-writer 両消費＝R8）に。未解決テーマ参照 `+mj-ea` はソース側でガード。PPTX 出力非影響。後続は #193（実行時サブセット化）→ #194（@font-face 埋め込み） （#192・PR #196・2026-07-19）
- **CJK フォント実行時サブセット化＋@font-face 埋め込み配線（#115 その2/3・完了）** — WASM harfbuzz（hb-subset）でデッキ実使用文字だけのサブセットを生成する `subsetFontToTtf`（variable font の `wght` 軸ピンで Regular/Bold 両対応）と、同梱 Noto Sans/Serif JP（google/fonts 上流と sha256 照合済み・OFL 1.1）から選ぶ `resolveFontSubsetSource`（#193・PR #199/#200/#203）を、HTML 書き出しパイプラインへ配線（#194・PR #206）。`deck-html-export.tsx` が materialize 済みデッキの実使用テキストからゴシック/明朝＋bold 要否を判定してサブセット生成し、`html-shell.ts` が `font-stack.ts` の既存フォールバック名（`embedFallbackFamily`）そのままで `@font-face` 注入 — 既存の per-element CSS は無変更。デフォルト ON（トグル無し）。**WOFF2 圧縮は不採用**：当初 `wawoff2` で圧縮する設計だったが、Vite のブラウザ dep-optimizer 経由で実ブラウザから呼ぶと内部の Emscripten `onRuntimeInitialized` が発火せず永久にハングすることを実ブラウザ検証＋CI の e2e で確認（vitest/Node では発生せず、#194 が初めて実ブラウザ経路を通した）。同パッケージは2022年以降メンテなし。harfbuzz の生 sfnt(TTF) をそのまま `format("truetype")` で埋め込む方式に変更し、壊れた依存を排除（`wawoff2`/`@types/wawoff2` を削除）。do-no-harm: CJK 無しデッキは埋め込み自体スキップ（サイズ増ゼロ）・サブセット失敗時はフォールバックスタックのみで壊れない。実測: JP4スライド典型デッキで埋め込み ~43KB（Regular+Bold、生TTF）／出力 HTML 計 ~75KB。PPTX 出力非影響 （#193/#194・2026-07-19）
- **表の列幅内容比例化＋数値列右寄せ＋プレビュー折り返し** — `table-ooxml` の均等割り列幅を、新設 `table-layout.ts`（CJK=2 換算の最大セル幅重み・[8%,50%] クランプ・EMU 合計厳密一致）による内容比例に置換し、数値列（¥/％/桁区切り対応）へ `algn="r"`。プレビューは同一関数から `<colgroup>` を導出し nowrap/hidden を撤廃して折り返し表示（export と一致することをテストで検証＝R8） （#138/#139・PR #178・2026-07-19）
- **プレビュー/HTML の背景画像・グラデ・図形グラデ描画（A1/A2/A3）** — レイアウト/マスターの `<p:bg>` 画像塗り(blipFill)・グラデ塗り(gradFill) を全面描画、`<p:pic>` の非web主 blip（EMF/WMF/wdp）を `svgBlip`(SVG) へフォールバック、装飾図形の `gradFill` を CSS グラデで描画。純粋 `ooxml-fill.ts` に集約（プレビュー＋HTML 共有・PPTX/golden 非影響）。実 HTML レンダで確認 （他AIレポート＋敵対検証・2026-07-07）
- **プレビュー/HTML のグループ図形・custGeom 弧の描画** — `<p:grpSp>` の子図形を chOff/chExt→off/ext の座標変換（＋ネスト合成）で正しい位置に描画（従来は child-space 座標で誤配置・velis の 26 グループ）、custGeom の `arcTo` セグメントを SVG 楕円弧に変換。純粋 `ooxml-geom.ts`（プレビュー/HTML 限定・PPTX 非影響）。velis 実レンダ＋純粋/実フィクスチャテストで確認 （2026-07-07）
- **図のエッジラベル コントラスト適応＋埋め込み図の自前タイトル抑止** — 図のエッジ/関係ラベルをスライド背景に対しコントラスト適応（低コントラスト ~2.4:1 を解消）、埋め込み図はスライド題枠に一任し自前タイトルを描かない（`omitTitle`・重複/上下逆転を解消）。共有 painter 経由でプレビュー SVG も PPTX も同一挙動（実レンダ敵対監査 M11 の高インパクト分） （PR #83／82569eb・59ef092・2026-07-07）
- **締めスライドの可読性（reconcile：非バグ確定）** — 「閉じスライドが白地に薄色文字で不可視」の起票を実データで再検証し **canonical `Midnight_Executive` の Closing レイアウト（L29/L30）は full-bleed の濃紺 BG 図形（`1E2761`・13.33×7.5in）＋アクセントバーを持ち、明色テキストが可読**と確認。レンダラも `extractDecorations`→`spToDeco`（layout/master 両方・サイズ制限なし）で同じ塗りを描画＝WYSIWYG で白地に白文字は発生しない。旧起票の「装飾0」は `<p:bg>` のみ見た誤断 （2026-07-07）

- **図テキストを SVG `<text>` に統一** — svg-writer の text() を `<foreignObject>`+XHTML から native `<text>`/`<tspan>`（dy-stacked・ASCENT=0.875 baseline）＋決定論 wrap＋font-size shrink に移行、preview/HTML/print/canvas が一つの SVG を共有、PPTX golden 不変 （ADR-0013・PR #62・2026-07-04）
- **HTML 出力：印刷を 1 枚 1 ページに修正** — 全スライドが 1 ページに潰れる致命バグを修正 （PR #63・2026-07-04）
- **HTML 出力：表現力アップ** — リッチなスライド遷移＋オーバービューグリッド＋遷移選択 UI （PR #61・2026-07-04）
- **スタンダロン HTML 出力 MVP** — SlideCard を SSR 再利用＋Mermaid 事前 SVG 描画で単体 HTML を出力 （PR #60・2026-07-04）

## スライド編集・画像

- **クロス doc 切替の snapshot データ損失を修正** — 複数ドキュメント切替時に他 doc の snapshot が現 doc の状態で上書きされ編集が失われる GUI コントローラのバグを修正 （#160・PR #173・2026-07-19）
- **画像埋め込み＝data URI 埋め込み** — 自己完結 data-URI SlideIR image ブロック（Markdown `![alt](src)` round-trip・SlideCard `<img>`／HTML 自動・PPTX decode → media/pic）、paste＋Tauri/browser file-drop 挿入、picture 枠優先バインド、rect/fit/aspect 手動幾何＋pointer drag/resize、既存を壊さない最背面（behind）モード （ADR-0020・2026-07-06）
- **スライドのドラッグ並べ替え** — pointer イベント方式・PowerPoint 風インジケータでスライドを並べ替え （2026-07-06）
- **useAiGeneration 分割** — `useAiGeneration` をモジュール分割 （2026-07-06）
- **スライドの追加・複製・削除を GUI に** — Undo 可・エンジン共有でスライド構造編集を GUI に （2026-07-05）
- **配色モード切替（Dark/Light/Modern）** — UI 配色モード切替＋色のトークン化 （2026-07-05）
- **Slides↔Editor の仕切りをドラッグ可動に** — 仕切りをドラッグ可動にしサムネを枠に収める （2026-07-05）
- **UI 磨き込み** — AI Assist＋協働の統合・テンプレピッカー刷新・Draft ヘッダ整理 （PR #59・2026-07-04）

## 協働・MCP

- **MCP client 側 1エンドポイント（adaptive front：discover→solo or forward）** — `slidecraft mcp`（`cli.ts`）が起動時に GUI ホストの `host.json` を discover し、稼働中なら**透過リレー**（`mcp-relay.ts`：stdio⇄host HTTP の Transport↔Transport 純パイプ・状態ゼロ）、居なければ D1 の solo host ctx で動く。discovery（`host-discovery.ts`）は `collab.rs` の `app_local_data_dir()` 書き込み先と一致するパス解決＋軽 ping で liveness 判定、stale は never-silent に solo へフォールバック（hang しない）。「1アプリに MCP 設定が複数」の違和感を解消 （ADR-0033 D2・#224）
- **MCP 管制の単一化（stdio が commitMutation に合流）** — stdio（cli.ts）専用の「単一 Session 直いじり」mutate 経路を廃止し、buildServer は常に HostContext を解決（collab は既存の DocRegistry、stdio は `createSoloHostContext` が回りに mint するソロ版）して全 mutation を commitMutation 経由に統一。stdio も undo/redo/list/select_document を additive に獲得し、resources.ts は固定 Session でなく sole doc を都度読む。口（stdio/HTTP）はそのまま維持・廃止したのは「2つ目の管制」のみ （ADR-0033 D1・#222）
- **`get_slide` に容量ドライラン（capacity / predictedSplit）** — 本文容量の実測 `capacity.usedLines/maxLines` と、`split_overflowing_slides` を実行せず何枚に割れるかの `predictedSplit`（chunks/boundaries）を追加。予測は distill.ts の `splitSlideToFit` そのものを呼ぶため実行結果と構造的に一致（R8・予測==実行の同値性テスト付き）。read-only（deck/dirty 不変） （#149・PR #188・2026-07-19）
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
