# Master-Intake — 任意スライドマスター対応の方針と設計

> 位置づけ: **取り込み理解（placeholder 機能推定・binding・layout 選出）を貫く上位方針**と、
> 機密テンプレを外に出さずに精度を計測する**証拠戦略**。
> AI の関与部分の詳細ハーネスは [ai-import.md](ai-import.md)（distill→高信頼決定論→AI→検証→人間確認）が担い、
> 本書はその前提となる原則・決定論部品・計測基盤を定義する。
> 関連: [ADR-0011](../adr/0011-placeholder-input-bijection.md)（全単射）／
> [ADR-0023](../adr/0023-third-party-master-idx-convention.md)（idx 規約 gate・既知エッジ）／
> [ADR-0025](../adr/0025-placeholder-role-resolution.md)（取り込み時 stamp・gated recovery）／
> [ADR-0027](../adr/0027-remake-source-visual-preservation.md)（faithful＝視覚保持）／
> [ADR-0028](../adr/0028-retire-ai-remake-option-c.md)（AI の正しい使い所＝理解の補完）。
> ステータス: **方針ドラフト**（各部品の採用確定時に個別 ADR 化する）。

## 1. 北極星と設計原則

問題は「全 placeholder / 全 layout を正しく分類する」ことではなく、
**「重要な所は絶対外さず・間違った所には絶対入れない」**こと。満足度のコスト構造は非対称である。

| # | 原則 | 内容 |
|---|------|------|
| **P1** | **do-no-harm ＋ 可視性** | 誤注入は禁止。空欄は許容——**ただしユーザに未束縛が報告される場合のみ**。silent drop は ADR-0023 の障害の本体であり、「confidence 不足 → 黙って空欄」はそれに名前を付けただけになる。不変条件:「**全コンテンツは、束縛されるか、束縛失敗として報告されるかのどちらか**」（design-intent の `SkippedOp` と同じ規律を binding に敷く） |
| **P2** | **重要度ティア** | MUST〈title＋最大 body〉／OPTIONAL〈subtitle・caption・group〉／DO-NOT-FILL〈chrome＝footer/header/date/頁番号〉。**空欄の扱いもティア別**: MUST の空欄＝エスカレーションすべき失敗（警告表示）、OPTIONAL の空欄＝許容（報告のみ）、chrome＝そもそも注入対象外（硬除外） |
| **P3** | **属性＋相互関係で機能推定** | 固定の Title/Body ラベル照合ではなく、面積・フォント・位置の**相対関係**（同一レイアウト内での比較）でスコアリングする |
| **P4** | **決定論コア＋AI last-mile** | AI は comprehension 用途のみ（Make 禁止・ADR-0028）。決定論／AI 両経路の出口に **do-no-harm ゲート**を置き、AI は満足度キラーを構造的に起こせない |
| **P5** | **読み順 prior** | 左上→右下の読み順＝重要度 prior・binding 順・group 順の既定 |

## 2. アーキテクチャ（6部品）

### 部品0 — 幾何の床上げ（スコアラーの隠れた前提条件）

相対属性スコアリング（P3）は幾何が正しい時にしか機能しない。現行ローダーは入力自体が壊れるケースを持つ:

> **注意: 部品0 は"準備運動"ではなく最高リスク工程。** 全部品が依存する load path
> （`template-loader.ts`）を触る。特に複数 master 対応は **load 意味論の変更**であり、
> byte-identical 回帰で守れるのは single-master の既存系統のみ＝multi-master には
> **新規ゴールデンの整備が必要**。証拠ツール（§3.1-3.2）を半歩先行させ、計測付きで進める（§4）。

- **継承チェーンの完全解決**: `xfrm` 無し placeholder の master 継承が部分的で **w/h=0 のまま残る**
  （`template-loader.ts` `extractMasterPlaceholderGeometry`）。これが `isPeer`（カラム検出）と
  capacity 判定を既に殺している。layout→master→既定値の完全解決が必要。
- **sldSz 相対化**: `geometryRole` の閾値が 13.333×7.5 ハードコード（`template-catalog.ts`）。
  `presentationXml` は保持済みなので実 `sldSz` に対する相対値へ（4:3／A4 系で全判定がズレる）。
- **複数 master / theme 対応**: 現状 `slideMaster1.xml`／`theme1.xml` 固定。会社テンプレは
  表紙用と本文用で master が分かれることが珍しくない。
- **idx-META 規約の per-layout gate**: ADR-0023 既知エッジ（型付き META を持ちつつ本文が
  idx 10/15/16）。レイアウトが型付き title を持つ場合は 15/16 規約を無効化。
  ※素朴な typed-title ゲートは同梱テンプレを退行させる（ROADMAP 注記）ことが実証済み。
  **R4/R5 相当の慎重さ**で扱う: テストファースト・既存系統のゴールデン先行・退行ゼロを合否条件に。

### 部品1 — 決定論スコアラー（placeholder 機能推定）

- 入力を **placeholders ∪ staticTexts に統合**（現状 staticText はロール判定に渡っていない。
  dirty fixture で title=staticText の識別 0/4 → 統合プロトタイプで 5/5 を確認済）。
- 相対属性スコア → title／primary body／chrome（硬除外）／accent／figure。読み順を prior に。
- **confidence を出力**（部品2のゲート閾値・部品5の AI 振り分けに使う）。
- **実装形態は ADR-0025 の拡張**: 取り込み時に一度確定し `resolvedRole` を stamp。
  `placeholderRole` は stamp 最優先——binding／catalog／fieldMap の全 consumer が同一ロールを
  見る（ADR-0011 の全単射維持）。実行時の新規経路は作らない。
- **staticText は読み取り専用シグナル**に留める。固定文言（「社外秘」等）への書き込みは
  誤注入の最悪形。書き込み対象への昇格は高 confidence＋人間確認（部品3）を要求する。
- **回帰基準**: 健全テンプレ（canonical／報告書／マガジン／velis 等の既存系統）は
  **byte-identical**。スコアラーは既存ラダーが低信頼な時のみ発火する形にゲートする。

> **⚠ 計測: 精度は verdict ごとに違う — 一様に信頼しない**（2026-07-17・25 テンプレ / 403 レイアウト /
> 2715 placeholder。全数値は #98 のコメント）。プロトタイプの「5/5」は **title＋chrome の verdict** の話であり、
> `ElementFunction` 全体に一般化してはいけない。
>
> - **chrome ＝ 高精度・実運用中**：部品2 の do-no-harm ゲートが依存し、#96 でロール解決（RECOVERY tier の
>   guard）にも配線済。`isChromeBand()` が唯一の定義（`master-scorer.ts`）。
> - **figure ＝ precision 35%**（20/57）。述語 `visual型 || (面積≥0.3·SA && fs≥20)` は、マスター既定の
>   本文フォントが 20–32pt であるため**ふつうの本文枠**を選ぶ（velis `Title and Content|17` fs26・
>   報告書 `08_目次|1` fs20・CX `Title_with bullet text|10` fs28）。加えて **構造的ブロッカー**：
>   `bodyPlaceholders`/`nthBody` は `role==="body"` で絞るので、図枠を別ロールにすると**図がその枠から
>   追い出される**（ADR-0025 型の取込時 stamp は取れない）。唯一の非合成な図枠（配布資料 `04_図＋説明|1`）は
>   健全な出荷テンプレで**今日すでに散文を受けている** ⇒「図枠に散文を入れない」と「byte-identical」は同時に成立しない。
> - **subtitle ＝ precision 29%・confidence が定数 0.5**（分散ゼロ ⇒ **どんな閾値でもゲート不能**。title 復元が
>   `≥0.7` で切れたのは `titleConfidence` が 0.5→0.95 と変動するから）。述語の向きも逆で、実サブタイトルは
>   title の**下**にあるのに窓は上部（`y<0.4·SH`）→ y≥3.0 の実サブタイトル **0/45**。
>
> ⇒ **どの verdict も binding/role に配線する前に、その verdict の精度をコーパスで測る**こと。
> figure/subtitle の「散文との分離」は本部品では解けない ⇒ **部品5（AI last-mile）／部品3（プロファイル）送り**が
> 正当（#98 はこの結論で close）。実バグは #124（chrome 帯が body 序数に混ざる）・#125（ctrTitle 配下の
> body 型 subtitle がラダーで body 固定）に分離済 — どちらも**ラダー/binding 側**の決定論修正で、scorer 非依存。

### 部品2 — do-no-harm binding ゲート（決定論の不変条件）

- chrome には content を**絶対に**入れない（role 完全性は不要——header role を新設せずとも
  chrome 硬除外で header バグは消える）。
- confidence < τ は空欄——**ただし P1 の可視性不変条件とセット**。未束縛コンテンツ・
  MUST ティアの空欄はプレビュー／取り込み結果バーに警告表示する。
  現行の silent drop 箇所（`bindContentByRole` の受け皿無し捨て、`placeholder-filler.ts` の
  `if (!content) continue`、visual の `nthBody` undefined 素通り）を報告付きに改める。

### 部品3 — テンプレプロファイル（人間修正の資産化）

会社テンプレは「1回取り込んで何百回も使う」。取り込み時にロール解釈（＋confidence）を提示し、
**ユーザ修正を master registry（`master-store.ts`）にプロファイルとして永続化**する。

- 2回目以降は修正済みマップに対する**完全決定論**の束縛——「一度合意したテンプレは以後壊れない」。
- τ・AI 精度の要求水準を根本から下げる（低 confidence → 空欄＋警告 → 一度直せば恒久解決）。
- 副産物として**人手正解ラベル**が溜まる（§3.3）。
- プレビュー＋ロールラベルの確認 UI は ai-import.md §3 の第5段（人間 in the loop）と同一導線。

### 部品4 — layout 選出（content→layout）

- **4a メニュー理解**: messy テンプレで layout メニュー自体を誤認する問題
  （`classifyLayout` の bodyCount 汚染）は部品0＋1 の資産で解ける。
- **容量適合をスコアに追加**: スライドのテキスト量 vs body 群 capacity 合計。現行 `pickLayout` は
  bodyCount 距離＋名前 regex が主で「本文過多 × 小箱レイアウト」を選び得る。
- レイアウトを**特徴ベクトル化**（title/body/pic 数・カラム構成・容量・group 種別）し、
  選出理由をログに残す説明可能スコアリングへ。選出精度も parse-audit の計測対象に。
- **4b 意味的アップグレード**（plain prose → cards/steps/comparison/kpi）＝ DISTILL の本丸・
  AI 主戦場。内容を作り替えるため危険 → **adopt ゲート必須**（best-of-N／picker の既存基盤を転用）。
  per-slide AI か導出 routing table かは未決（§5）。

### 部品5 — AI last-mile（comprehension 残余）

subtitle・caption・figure vs 散文・group の意味づけ等、幾何で割れない曖昧のみ。
ゲート付き・迷えば空欄（安全側）。ハーネスは [ai-import.md](ai-import.md) §3 の通り。
着手条件は data 駆動（§3 の計測で語彙外／曖昧の binding 失敗が実証されてから）。

## 3. 証拠戦略 — 機密テンプレを外に出さずに計測する

**原理**: パーサ／スコアラーが消費するのは type・idx・幾何・フォントサイズ・継承関係という
**構造**であり、テキスト内容・画像・ブランドは（ほぼ）読まない。バグは構造に宿り、構造は秘密ではない。
検証に必要なのはテンプレ実物ではなく **(a) 構造的病理 と (b) 正解ラベル** の2つ。

### 3.1 構造双子（sanitize-master）

実テンプレから骨格（レイアウト構成・placeholder の type/idx/幾何/フォントサイズ・master 継承・
staticText の位置と種類）だけを抽出し、テキスト・画像・配色を捨てて合成 .pptx を再生成するツール。
ADR-0023 の CX Sample（知財を剥がした側だけのマスター）を手作業でやったことの道具化であり、
生成部品（`template-writer`・`make-dirty-fixture.ts`）は既にある。

- **忠実性の機械的証明**: ローカルで実物と双子の両方に `loadTemplate`→`buildCatalog`→parse-audit を
  掛け、ロール判定・flag の一致を assert。一致すれば「双子はパーサ検証用途で実物と等価」。
- **仮名化の注意**: `nameRole` は名前を読むため、名前は**キーワード級で仮名化**
  （「〇〇社見出し」→「見出しA」——ロール関連クラスを保存）。contrast 系は色を読むため、
  色は輝度関係を保って色相のみ潰す。
- 障害対応のたびに「再現ケースを機密ゼロで恒久テスト化」できる——コーパスが育つループの要石。

### 3.2 病理センサス

ローカルで実テンプレ群に監査を掛け、**病理チェックリストのみ**を出力する
（「型なし placeholder あり」「本文が idx 10–16」「title が staticText」「w/h 継承未解決」
「複数 master」…の有無とカウント）。ai-import.md §4 の棚卸しの一般化・道具化。

- このチェックリストが `make-dirty-fixture.ts` を**病理ミューテーションのライブラリ**に育てる根拠になる。
  各ミューテーションが実テンプレでの観測に紐づく＝自作 fixture が現実の代理として成立する（証拠の連鎖）。

### 3.3 プロファイル＝正解ラベル（ローカルゴールデン）

部品3 のユーザ修正1件＝人手正解ラベル1件。プロファイル（正解）とパーサ出力の差分をローカルで
集計すれば束縛正解率の計測になる。ゴールデン集を「作る作業」が、テンプレを業務投入する自然な
流れの中で溜まる。既存のローカル資産（会社 `.potx` 7本＋CX＝`tests/fixtures/templates/`・
gitignore・skipIf テスト参照）がその置き場。

### 3.4 公開乱雑コーパス

共有可能なベースライン: 官公庁・自治体配布の pptx テンプレ、大学・学会テンプレ、
公開企業ブランドテンプレ。「実在の・人が手作りした乱雑さ」として fixture より筋が良く、
リポジトリに入れられる。

### 境界の定義

| 置き場 | 中身 |
|--------|------|
| **リポジトリ（共有）** | 公開テンプレ・病理注釈付き合成 fixture・構造双子・監査/生成ツール |
| **ローカルのみ** | 実テンプレ（.potx）・テンプレプロファイル（正解ラベル） |
| **境界を越えて良いもの** | 構造双子・病理チェックリスト・精度メトリクスの数字 |

開発・CI は双子＋fixture で回帰を回し、実テンプレに対する数字はローカル計測の報告
（例「flag 17→10」）だけで足りる。

## 4. フェーズと依存

```
F0a: sanitize-master／病理センサス（§3.1-3.2）      ← 半歩先行（幾何修正の計測手段を先に）
      ↓
F0b: 幾何の床上げ（部品0）                          ← 最高リスク工程・F0a の計測付きで
      ↓
F1: 決定論スコアラー（部品1）＋ do-no-harm ゲート＆no-silent-drop（部品2） ← 実証済みの基盤
      ↓                                   ＋並走: テンプレプロファイル（部品3・独立で安い）
F2: layout 選出 4a＝メニュー理解・容量適合（部品4 決定論分）
      ↓
F3: AI last-mile（部品5）＋ 4b 意味的アップグレード                      ← data 駆動で着手判断
```

計測（§3）は全フェーズを貫く: F0/F1 の合否は自作 fixture ではなく
**実テンプレ双子＋parse-audit の flag 差分＋既存系統の byte-identical** で判定する。
双子ツール自体が F0 の成果物という鶏卵は **F0a→F0b の順序**で解く（証拠ツールが先、
幾何修正は盲目でなく計測付きで）。multi-master は既存 byte-identical 基準の外＝新規ゴールデンを併設。

## 5. 未決の判断

| 論点 | 現時点の傾き |
|------|--------------|
| confidence 閾値 τ の初期値 | プロファイル（部品3）前提で**保守的**に置く（誤注入回避優先。空欄→警告→一度直せば恒久解決） |
| header を role 追加 or chrome 統合 | **chrome 統合**（P2 的に筋。role 完全性は不要） |
| 4b: per-slide AI vs 導出 routing table | 未決。プロファイル永続化と相性が良いのは routing table 側 |
| cohesive（高凝集）fixture | 実装前に1枚作る（推奨）。ただし合否判定は実テンプレ双子で |
| ADR 化のタイミング | 部品ごとに採用確定時（P1 可視性不変条件＋部品2、部品3 プロファイル、§3 証拠戦略が候補） |
