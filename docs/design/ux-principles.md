# UX 原則と UX 予算 — 機能追加で UX を悪くしないための基準

> 対象: SlideCraft デスクトップアプリ（GUI）。MCP のツール面は [ADR-0037](../adr/0037-mcp-surface-realignment.md) の「口は薄く」が担うので本書の範囲外。
> 決定の記録は [ADR-0039](../adr/0039-ux-gates.md)。本書はその根拠と運用の詳細。

## 0. なぜ要るか

2026-11-08 の Windows 実機確認でユーザから「ボタンが多くて気になり始めた。場所や機能の配置を少し整えたほうがいい」と
指摘があり、棚卸しの結果 4 件の Issue（#612〜#615）になった。上部バーの常設ボタン 12 個のうち 5 個がアプリ設定、
本文を押し下げる帯が最大 5 本、✨ が 7 か所で別の意味、i18n を通らない英語ラベルが 7 種類。どれも 1 つずつは正しい
機能追加の結果で、**悪くしたのは「足し算の総和」**だった。

コードの劣化には既に実行可能な規約がある（[ADR-0031](../adr/0031-maintainability-gates.md)：R1 400 行・凍結リスト・
R8 一致テスト・ツール説明の文字数 ratchet）。UX の劣化だけが「ユーザが実機で気づくまで誰も止められない」構造に
なっていた。本書は同じ流儀で、**UX の良さの定義を規格と研究から引き、プロジェクト固有の数値はその運用値（予算）として
ratchet で守る**ための基準を置く。

用語: **ratchet**（ラチェット）＝現在値を上限として固定し、下げるのは自由・上げるには理由と承認が要る検査。
**ヒューリスティック評価**＝評価者が原則の一覧に照らして違反を列挙し重大度を付ける手法（Nielsen）。

## 1. 「UX が良い」の定義（ISO 9241-11 / JIS Z 8521）

ISO 9241-11:2018（JIS Z 8521:2020）のユーザビリティ定義を最上位の評価軸にする。

> usability: extent to which a system, product or service can be used by specified users to achieve specified goals
> with **effectiveness, efficiency and satisfaction** in a specified context of use（3.1.1）
> JIS 訳: 特定のユーザが特定の利用状況において、システム、製品又はサービスを利用する際に、**効果、効率及び満足**を伴って
> 特定の目標を達成する度合い

| 軸 | 規格の定義（JIS 訳語） | SlideCraft での意味 | 測り方（§5） |
| --- | --- | --- | --- |
| **効果**（effectiveness） | 目標達成の正確性と完全性 | 代表タスクが**最後まで**できる（原稿→PPTX・テンプレ変更・AI で 1 枚直す）。消失系の警告 0 | 代表タスクの e2e 成否・`get_deck_issues` の消失系 0 |
| **効率**（efficiency） | 達成した結果に対して費やした資源 | 同じ結果に要する操作数・時間・迷い | KLM による予測作業時間（§5.4）・到達手数 |
| **満足**（satisfaction） | 身体的・認知的・情緒的反応が期待に合う度合い | 「ボタンが多くて気になる」の反対 | UMUX-Lite 2 問（§5.3） |

「特定のユーザ・特定の利用状況」は、本プロジェクトでは**原稿を持った業務ユーザが、1 人で、デスクトップで、AI の
助けを借りながらスライドを作る**場面。評価はこの場面に対して行い、他の場面（講演者・デザイナー）への最適化は要求が出て
から別に扱う。

## 2. 設計の原則 — 3 つの源泉を 1 枚に

ISO 9241-110:2020（JIS Z 8520:2022）の **7 つのインタラクション原則**を骨格にし、Nielsen の 10 ヒューリスティクス・
Shneiderman の 8 つの黄金律・Norman の基本原則を対応づける。原則の文言は原典どおり（§8 出典）。右 2 列が本プロジェクト
での読み替えと、2026-11-08 の棚卸しで実際に観察された違反。

| ISO 9241-110 原則（JIS 名） | 対応する Nielsen / Shneiderman / Norman | SlideCraft での意味 | 観察された違反（Issue） |
| --- | --- | --- | --- |
| **5.1 Suitability for the user's tasks**（ユーザが行うタスクへの適合性） | N7 Flexibility and efficiency of use／S2 Seek universal usability | 画面に常に見えるものは「文書を作る」操作だけ。アプリ設定は要求されたときに出す | 上部バー 12 個のうち 5 個が言語・テーマ（#614） |
| **5.2 Self-descriptiveness**（自己記述性） | N1 Visibility of system status／S3 Offer informative feedback／Norman: Feedback・Signifiers | 今何が起きているか・次に何ができるかが画面から読める。AI 待ち・取り込み中は進行が見える | 帯が 5 本重なり、どれが今の状態か読めない（#613） |
| **5.3 Conformity with user expectations**（ユーザが抱く期待への一致） | N2 Match between system and the real world／N4 Consistency and standards／S1 Strive for consistency／Norman: Conceptual model・Mapping | 同じ記号は同じ意味、同じ種類の操作は同じ場所。語は利用者の語（「原稿」） | ✨ が AI・目次生成・更新通知で別の意味、＋が取り込みと追加（#614）。「Draft」「Layout」等の英語（#615） |
| **5.4 Learnability**（ユーザによる学習性） | N6 Recognition rather than recall／N10 Help and documentation／Norman: Discoverability | 入口は役割ごとに 1 か所、見れば分かる。覚えなくてよい | AI の接続設定が 2 か所（#615）・「テンプレを強化」に届かない穴（#612） |
| **5.5 Controllability**（ユーザによる制御可能性） | N3 User control and freedom／S6 Permit easy reversal／S7 Keep users in control | 取り消せる・止められる・AI の提案は採用ゲートを通る（[ADR-0018](../adr/0018-validation-at-adoption-gate.md)） | （違反なし。Undo／Redo・採用ゲートは既に原則どおり） |
| **5.6 Use error robustness**（ユースエラーへの耐性） | N5 Error prevention／N9 Help users recognize, diagnose, and recover／S5 Prevent errors／Norman: Constraints | 壊れる操作は出さない・壊れたら理由と直し方を言う（never-silent） | （本書の範囲では違反なし。never-silent は束縛・診断で既に規約） |
| **5.7 User engagement**（ユーザエンゲージメント） | N8 Aesthetic and minimalist design／S4 Design dialogs to yield closure／S8 Reduce short-term memory load | 画面は本文（スライド）が主役。装飾・通知・補助は本文を押し下げない | 取り込み結果の「詳細」が画面高の 46% まで伸びる（#613） |

**本プロジェクトの読み替え（原則 → 設計規則）**

1. **1 画面 1 目的、主役は本文。** 本文（プレビュー・原稿）を押し下げる帯は同時に 1 本。補助情報は要求時に出す（5.7・N8）。
2. **入口は役割ごとに 1 か所。** 同じ機能に 2 つの入口を作らない。作るなら片方は他方を開くだけ（5.4・N6）。
3. **記号は 1 対 1。** ✨＝AI、＋＝追加、🗑＝削除、📥＝取り込み。新しい意味を既存の記号に重ねない（5.3・Norman の Signifier）。
4. **語は利用者の語で、辞書を通す。** 画面の文言はすべて i18n 辞書経由。英語の開発者語（Draft・Layout・Auto）を残さない（5.3・N2）。
5. **文書の操作とアプリの設定を混ぜない。** 上部バーは文書操作、設定は ⚙ の中（5.1・段階的開示）。
6. **複雑さは AI と既定値が負う。** 新機能で増える判断を利用者に渡さない。渡すなら「迷ったときの既定」を必ず置く（Tesler の法則・§3）。
7. **取り消せる・止められる・理由が分かる。** AI の結果は採用ゲートを通り、失敗は告知する（5.5・5.6・never-silent）。

## 3. 定量化できる法則と「UX 予算」

原則は方向を示すが、どこで止めるかは決めてくれない。研究で確認された法則から**予算項目**を導き、**現在値を上限として
固定**する（ratchet）。数値そのものは法則から一意に出るものではないので、「法則が示す方向 ＋ 現在の実装の値」を初期値とし、
上げるときは PR で理由を書く（§6）。

| 法則（出典 §8） | 内容 | 導かれる予算項目 | 初期値（現在値） | 検査 |
| --- | --- | --- | --- | --- |
| **Hick の法則**（Hick 1952／Hyman 1953） | 選択肢 n に対し判断時間は log₂(n+1) に比例して増える | 上部バーに常に見えるボタン数 | **≤ 7**（#614 で 12 → 7） | 単体（`tests/toolbar-settings-614.test.tsx`）・e2e |
| **Fitts の法則**（Fitts 1954） | 標的への到達時間は距離に増え、大きさに減る | クリック標的の最小サイズ・頻用操作は近く大きく | **≥ 24×24 CSS px**（WCAG 2.2 2.5.8 と同値） | e2e で `boundingBox` 検査（未実装） |
| **Miller 7±2 → Cowan 約 4 チャンク**（1956／2001） | 一度に扱える「まとまり」は 4 前後 | メニューの区画数・1 区画の項目数 | 区画 **≤ 4**（マスターのメニュー・#612）、1 区画 **≤ 7** 項目 | 単体（`tests/master-menu.test.tsx`） |
| **段階的開示**（Nielsen 2006） | 開示の階層が 2 を超えると usability が落ちる | メニューのネストの深さ | **≤ 2**（上部バー → ⚙ → 項目） | 単体・レビュー |
| **ゲシュタルトの近接・類同**（NN/g 2020） | 近いもの・似たものは同じ群と知覚される | 役割の違う操作は離す／同じ役割は揃える | 上部バーの区切り（文書操作 ｜ AI・設定） | レビュー |
| **Tesler の法則**（複雑性保存） | 系の複雑さは消えず、誰が負うかだけ変わる | 新機能ごとに「複雑さを誰が負うか」を PR 本文に書く | — | PR テンプレ欄（§6） |
| **Doherty の閾値**（1982） | 応答が 0.3 秒程度まで速いと生産性が跳ねる（「400 ms」は後世の要約値） | 操作への即時フィードバック。長い処理は進行表示 | 400 ms 以内に状態が変わる（進行表示を含む） | レビュー・e2e の待機 |
| **認知負荷理論**（Sweller 1988／1998） | 外在的負荷（UI のせいで増える負荷）を減らし、本来の課題に注意を残す | 本文を押し下げる帯の同時表示数 | **1 本**（#613） | 単体（`noticeSlotPlan`）・e2e |
| **シグニファイアの一意性**（Norman） | 記号は行為を正しく示す | 記号 → 意味の 1 対 1 | ✨＝AI のみ、＋＝追加のみ | grep 許可リスト（`tests/toolbar-settings-614.test.tsx`） |
| **語の一致**（ISO 5.3／N2） | 利用者の語で、翻訳可能 | i18n を通らない文言 | **0**（#615） | 辞書キー検査（未実装） |
| **アクセシビリティの下限**（WCAG 2.2 AA） | 文字コントラスト 4.5:1、キーボード操作、焦点の可視 | 1.4.3／2.1.1／2.4.7／2.5.8 | AA | e2e（未実装）・レビュー |

デスクトップの HIG も同じ方向を言っている（Apple HIG Toolbars「Choose items deliberately to avoid overcrowding」、
Microsoft Command bar「add commands in order of their importance so that the most important commands are always
visible」）。予算は独自発明ではなく、これらの運用値である。

## 4. 「機能を足すと UX が悪くなる」の構造と対策

Tesler の法則が言うとおり、機能を足せば複雑さは必ず増える。悪くなるのは複雑さが**利用者側に積まれる**ときで、
典型は次の 3 つ（2026-11-08 の棚卸しがすべて該当）。

| 積まれ方 | 例 | 対策（原則・予算） |
| --- | --- | --- |
| **常設の増加**: 新機能のボタン・帯・設定が常に見える場所に足される | 言語・テーマが上部バーに常設 | 常設の予算（ボタン ≤ 7・帯 1 本）。新機能は既存の入口の中に置く |
| **入口の重複**: 同じことができる場所が 2 つになる | AI 接続設定が 2 か所 | 入口は 1 か所（§2 規則 2）。R8（意味の重複禁止）の UI 版 |
| **記号・語の多義化**: 便利な記号を別の意味で使い回す | ✨ が 7 か所 | 記号 1 対 1・辞書経由（規則 3・4） |

対策の要点は、**足し算を止めるのではなく、足したときに誰が複雑さを負うかを決めさせる**こと。AI・既定値・段階的開示が
負えば利用者の UX は悪くならない。負えないなら、その機能は PR 本文でそう宣言し、予算の数値を上げる手続きを踏む。

## 5. 評価の方法（4 層）

### 5.1 機械検査 — UX 予算テスト（CI 必須・fail する）

§3 の予算項目のうち機械で測れるものを **`tests/ux-budget.test.tsx` の 1 ファイル**に集める（現在は #612〜#614 の PR で
個別ファイルに散在。統合は実装 Issue）。vitest 内なので既存の必須 `test` ジョブに乗る（ADR-0031 G1 と同じ）。

- 現在値を上限として固定（ratchet）。超えたら赤。
- 「上げる」変更は PR 本文に理由（どの原則をどう満たすか・複雑さを誰が負うか）を書き、統括が承認する。
- ratchet の縮小（ボタンが減る・帯が減る）は UX 改善の実測値として shipped.md に書く。

### 5.2 レビュー — ヒューリスティック評価（PR 単位）

GUI を触る PR は、レビュー Agent（または人）が **Nielsen のヒューリスティック評価**の形式で報告する:
原則（§2 の表の行）→ 違反箇所（画面・コンポーネント）→ 重大度 0〜4（Nielsen 1994: 0 問題でない／1 見た目だけ／
2 軽微／3 重大／4 致命的＝出荷前に必須修正）。**重大度 3 以上はマージ阻害**、2 以下は Issue 化して後続。
評価者の視点は「初見の業務ユーザが原稿を持って座った」場面に固定する。

### 5.3 ユーザ評価 — UMUX-Lite（節目ごと）

ユーザは 1 人なので SUS（10 問）ではなく **UMUX-Lite（2 問・7 段階）**を節目（リリース前・大きな UI 変更後）に付ける。

1. この製品の機能は私の要求を満たす（capabilities meet my requirements）
2. この製品は使いやすい（easy to use）

SUS 換算は 0.65 × ((項目1 + 項目2 − 2) × 100 / 12) + 22.9。SUS の平均 68 を参考値に、**前回より下がったら
原因の Issue を切る**（絶対値ではなく推移を見る）。実機確認のついでに 2 問答えるだけなので運用コストはほぼ無い。

### 5.4 代表タスクの効率 — KLM による予測時間

代表タスク 3 本（原稿を貼って PPTX を出す／テンプレを変える／AI に 1 枚直させる）について、操作列を KLM
（Card, Moran & Newell 1980）で積算した**予測作業時間**を記録する（K 0.2 秒・P 1.1 秒・H 0.4 秒・M 1.35 秒）。
e2e の操作列から自動で数えられるので、クリック数より原理的な「効率」の指標になる。ratchet 対象（増えたら赤）。
初期値は実装 Issue で実測して置く。

### 5.5 何を測らないか

- A/B テスト・利用テレメトリ: ユーザ 1 人のローカルアプリでは意味がなく、プライバシー方針（[ADR-0010](../adr/0010-security-model.md)）にも合わない。
- 美的評価の点数化: 測れないので、レビューの重大度 1（見た目だけ）として記録し、積み上がったら棚卸しの Issue にする。
- SUS 10 問の常用: 1 人には重い。UMUX-Lite で足りる。

## 6. 運用

1. **PR テンプレートに「UX への影響」欄**（`.github/PULL_REQUEST_TEMPLATE.md`）。GUI を触らない PR は「該当なし」1 行。
   - 常設のボタン・帯・モーダル・設定を足したか（足したなら予算の数値と理由）
   - 既存の入口を動かした／増やしたか
   - 新しい記号・文言は 1 対 1 か・辞書経由か
   - 新機能の複雑さを誰が負うか（AI／既定値／段階的開示／利用者）
2. **予算を上げる手続き**: PR 本文の理由 → 統括（レビュー）の承認 → `ux-budget` の数値変更をその PR に含める。
   ADR には数値を書かない（数値はテストが正本）。
3. **ユーザ実機確認は正式な評価工程**（ISO 9241-210 の「評価」）。見つかった事象は Issue に切り、直したら対応する予算項目を
   1 行足す（今日の #612〜#615 がその最初の 1 周）。
4. **レビュー Agent のプロンプト**に §5.2 のヒューリスティック評価を組み込む（統括の運用）。

## 7. 現在の予算（初期 ratchet）と実装状況

| 予算項目 | 初期値 | 実装状況 |
| --- | --- | --- |
| 上部バーの常設ボタン数 | ≤ 7 | 済（#614・PR #641） |
| 本文を押し下げる帯の同時表示 | 1 本 | 済（#613・PR #640） |
| マスターのメニュー区画 | ≤ 4 | 済（#612・PR #618） |
| 記号の 1 対 1（✨＝AI・＋＝追加） | 許可リスト | 済（PR #641） |
| メニューのネスト深さ | ≤ 2 | 済（#648・PR #651。現状 3 段の箇所は #650 で是正） |
| i18n を通らない文言 | 0 | 検査は済（#648・PR #651・現在値をファイル別に凍結）。0 への是正は #615（PR #652）で主要分、残りは ratchet が追う |
| クリック標的 ≥ 24×24 px・コントラスト 4.5:1・キーボード到達 | WCAG 2.2 AA | 未（`it.todo`・#649 で e2e 計測） |
| 代表タスク 3 本の KLM 予測時間 | 実測して固定 | 未（`it.todo`・#649） |
| UMUX-Lite | 節目ごとに記録 | 未（初回はこの文書の合意後） |

集約は PR #651（#648）で完了。PR テンプレの「UX への影響」欄も同 PR。ヒューリスティック評価は PR #652 のレビューで初適用（重大度 2 の所見は #653）。

## 8. 出典（2026-11-08 に一次資料で確認。確認できなかった点は明記）

**規格**
- ISO 9241-11:2018 *Ergonomics of human-system interaction — Part 11: Usability: Definitions and concepts*（JIS Z 8521:2020）。3.1.1 usability／3.1.12 effectiveness／3.1.13 efficiency／3.1.14 satisfaction。JIS 訳語は「効果・効率・満足」（1999 年版の「有効さ」とは異なる）。
- ISO 9241-210:2019 *Part 210: Human-centred design for interactive systems*（JIS Z 8530:2021）。原則 5.2〜5.7、活動 7.2〜7.5。
- ISO 9241-110:2020 *Part 110: Interaction principles*（JIS Z 8520:2022）。原則 5.1〜5.7。2006 年版からの変更: 個人化を制御可能性に統合、ユーザエンゲージメントを新設。JIS の原則名は三樹弘之, 人間工学 57 巻 Supplement（J-STAGE）で確認。定義文の本文は未取得。
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, Recommendation 2023-10-05（現行 2024-12-12）。1.4.3・2.1.1・2.4.7・2.5.8（24×24 CSS px）・2.5.5（44×44）。

**原則**
- Nielsen, J. (1994, 2020 更新, 2024 最終レビュー) "10 Usability Heuristics for User Interface Design", NN/g. 原則自体は 1994 年から不変。
- Nielsen, J. (1994) "Severity Ratings for Usability Problems", NN/g. 重大度 0〜4。
- Shneiderman, B. ほか (2016) *Designing the User Interface*, 6th ed., Pearson. Eight Golden Rules（6 版の文言。UMD 一次ページは取得時 503、ミラーで確認）。
- Norman, D. A. (2013) *The Design of Everyday Things*, Revised and Expanded Edition, Basic Books. Ch.1 の Affordances／Signifiers／Mapping／Feedback／Conceptual Models、Ch.2 の 7 原則（名称は二次資料で一致、本文の定義文は未取得）。
- Nielsen, J. (2006) "Progressive Disclosure", NN/g. "designs that go beyond 2 disclosure levels typically have low usability."
- Harley, A. (2020) "The Principle of Proximity" / "The Principle of Similarity", NN/g.

**法則**
- Hick, W. E. (1952) "On the Rate of Gain of Information", *QJEP* 4(1), 11–26. Hyman, R. (1953) *J Exp Psychol* 45(3), 188–196.
- Fitts, P. M. (1954) "The information capacity of the human motor system in controlling the amplitude of movement", *J Exp Psychol* 47(6), 381–391.
- Miller, G. A. (1956) "The magical number seven, plus or minus two", *Psychol Rev* 63(2), 81–97. Cowan, N. (2001) "The magical number 4 in short-term memory", *BBS* 24(1), 87–114.
- Tesler の法則（複雑性保存）: Saffer, D. *Designing for Interaction* の Tesler インタビュー（lawsofux.com 経由）。
- Doherty, W. J. & Thadani, A. J. (1982) *The Economic Value of Rapid Response Time*, IBM GE20-0752-0. **原文に「400 ms」の記述は無い**（0.3 秒で 371 トランザクション/時 vs 3 秒で 180 の実測）。400 ms は lawsofux.com の要約値。
- Sweller, J. (1988) "Cognitive Load During Problem Solving", *Cognitive Science* 12(2), 257–285. 内在／外在／学習関連の 3 分類は Sweller, van Merriënboer & Paas (1998) *Educ Psychol Rev* 10, 251–296（本書では未検証）。

**測定**
- Brooke, J. (1996) "SUS: A 'quick and dirty' usability scale", in *Usability Evaluation in Industry*, Taylor & Francis. 平均 68 は Sauro (measuringu.com) の約 500 研究の集計。
- Lewis, J. R., Utesch, B. S. & Maher, D. E. (2013) "UMUX-LITE: when there's no time for the SUS", *CHI '13*, 2099–2102. 換算式 0.65×((I1+I2−2)×100/12)+22.9。
- Card, S. K., Moran, T. P. & Newell, A. (1980) "The keystroke-level model for user performance time with interactive systems", *CACM* 23(7), 396–410. 標準値 K≈0.2 s・P 1.1 s・H 0.4 s・M 1.35 s（Wikipedia 表経由、原著 PDF は未照合）。
- Rodden, K., Hutchinson, H. & Fu, X. (2010) "Measuring the User Experience on a Large Scale: User-Centered Metrics for Web Applications", *CHI 2010*. HEART と Goals-Signals-Metrics。本書では Task success と Happiness だけ採る。

**デスクトップ HIG**
- Apple, *Human Interface Guidelines — Toolbars*: "Choose items deliberately to avoid overcrowding." "prioritize the commands that people are most likely to want."
- Microsoft, *Windows App SDK — Command bar*（2026-10-13 更新）: "add commands in order of their importance so that the most important commands are always visible." "Button labels should be short, preferably a single word."
