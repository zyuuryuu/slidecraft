# グループレイアウト充填パス設計（card / step / kpi / compare）

- **Status**: **Implemented**（S1–S6 完了・2026-07-03）。`group-layout.ts`（detectGroups）＋ `group-binding.ts`（expandGroups / groupEditorPlan）、`autoSelectLayout` の groupKind ゲート、preview/export の contentFor 統合、SlideEditor のグループ単位フィールド。field-map-bijection 全緑＝ADR-0011 の 1:1 維持。
- **Date**: 2026-07-03
- **Related**: [ADR-0011](../adr/0011-placeholder-input-bijection.md)（1:1 全単射・**絶対非破壊**）／Slice A（`<!-- card -->` / `### 見出し` パーサ土台 landed, commit 425573c）
- **由来**: 設計ワークフロー（全11テンプレのグループ系レイアウトを幾何精査 → 検出/選択・バインド・エディタ/1:1非破壊を設計 → 敵対批評で統合）

> 対象: `<!-- card -->` / `<!-- step -->` / `<!-- kpi -->` ＋ `### 見出し` で書いた 1 枚の Markdown スライドを、テンプレの「グループ単位」プレースホルダ（10_カード3列＝3枚のカード、11_プロセス＝4工程、09_KPIハイライト＝ラベル+数値+補足、12_課題と対策＝2群）へ充填する。
> ハード制約: ADR-0011 の 1:1 全単射（`tests/field-map-bijection.test.ts` の injective + round-trip、full/sparse、11 テンプレ）を絶対に壊さない。`slideIdxRole` / `placeholderRole` / `buildFieldMap` / `bindContentByRole` / `contentIdxForPlaceholder` は一切変更しない。

---

## 目的

Slice-A で `SlideIR` は既に「グループ 1 群 = idx '1','2','3'… の 1 PlaceholderContent、各 `paragraphs = [heading(### 行, heading:true) , …body]`、`slide.groupKind ∈ {card,step,kpi}`」を出力する。現状はこれが `bindContentByRole` を通って「見出し付きカラム」に**縮退**する。本設計は、テンプレがグループ用レイアウトを持つとき、各群の見出しを見出し枠へ・本文を本文枠へ正しく割り付け、番号/STEP ラベル等の baked chrome は継承（上書きしない）する**別系統の充填パス**を追加する。グループ用レイアウトが無いテンプレでは現状の縮退へ安全にフォールバックする。

---

## 制約（1:1 非破壊）

XML 実測で確定した衝突の核心:

- 09_KPIハイライト L14: **idx15 = KPI補足1(body)**, **idx16 = KPIラベル2(body)**。
- 10_カード3列 L15: **idx15 = カード説明1(body)**, **idx16 = カード番号2(body)**。

正準規約 `placeholderRole`（template-catalog.ts:231-232）は `t==='body'` 分岐より**前**に idx15→title / idx16→subtitle を返す。`slideIdxRole('15')='title'`, `('16')='subtitle'`。よってグループ本文セルを `bindContentByRole` に渡すと title/subtitle と誤分類され、`buildFieldMap` の probe 全単射が崩れる（idx15/16→body へ倒すと 6 テストが落ちた既知事実と同型）。

**⇒ グループ経路は `bindContentByRole` / `buildFieldMap` を一切呼ばず、一切改変しない。**`slide.groupKind` が立ち、かつ解決レイアウトがグループ形状のときだけ発火する加算的な別系統とする。`field-map-bijection.test.ts` は groupKind 無しの title-only seed を使うため、**構造として**グループ経路を踏まず、全アサーションはグリーンを維持する。

---

## 全体設計（別系統グループ経路）

新規純関数モジュール `src/engine/group-binding.ts`（R2 純粋・DOM/Tauri 禁止）が全グループロジックを保持する。既存 3 経路（プレビュー / エクスポート / エディタ）は 1 行のゲート分岐だけを追加する。

```
slide.groupKind 有り ──┐
                       ├─ detectGroups(layout) != null ─► expandGroups(slide, layout)  [新系統]
                       │                                    ├ 見出し→見出し枠 / 本文→本文枠
                       │                                    ├ chrome/picture 枠は entry 無し=継承
                       │                                    └ title/subtitle/meta は「非群サブセット」を bindContentByRole
                       └─ detectGroups(layout) == null ─► bindContentByRole(...)        [現状=縮退カラム]
slide.groupKind 無し ────────────────────────────────► bindContentByRole(...)          [現状=byte-identical]
```

公開 API:
```ts
export interface GroupSlot { phIdx: string; role: "chrome"|"picture"|"heading"|"body"; y: number; }
export interface GroupLayoutShape { kind: "card"|"step"|"kpi"|"compare"; groups: GroupSlot[][]; } // groups[col][slotStack]
export function detectGroups(layout: LayoutInfo): GroupLayoutShape | null; // null=非グループ→現状経路
export function isGroupedLayout(layout: LayoutInfo): boolean;              // detectGroups(layout)!==null
export function expandGroups(slide: SlideIR, layout: LayoutInfo): Map<string, PlaceholderContent>; // bindContentByRole と同じ形
export function groupFields(slide: SlideIR, layout: LayoutInfo | undefined): { contentIdx: string; label: string }[]; // エディタ用
```
`detectGroups` の結果はカタログには絶対に載せない（`CatalogEntry` の `bodyCount`/`placeholders`/role は ADR-0011 が凍結した通り不変）。オンデマンド計算。必要なら `LayoutInfo.index` をキーに per-template 弱キャッシュ（プレビュー/エクスポート/エディタ/選択で同一形状を共有し drift を防ぐ）。

---

## 検出とレイアウト選択

### detectGroups（幾何主導・名前は補助）

実測で確定した通り、**height/width による chrome 判定は m4（コーラル）で破綻**（カード番号 h=0.85>0.7 かつ w=3.78 フル幅）。よって chrome は「列の最上段 かつ baked が番号/STEP パターン、または名前が番号系」で判定する。手順:

1. **候補抽出（汚染除去が必須）**: `layout.placeholders` から `p.type==='body'` または `p.type==='pic'`、かつ実 xfrm（`style.w>0 && style.h>0`）を持つものを取る。次を除外:
   - `y < 0.9`（タイトル帯）または `y > 6.4`（フッタ帯）→ m9 の 資料名(y=0.28) / 出典(y=6.72) を除去。
   - `w > 0.8 * 13.333`（フル幅バー）→ m9 出典(w=12.33) を除去。
   - 名前が `/出典|資料名|注記|source|footer/i` に一致 → 二重の安全網。
   この前処理が無いと m9 L17 が {2,1,1,2} 列となり均一ゲートで誤って null 化する（＝有効レイアウトの縮退）。**汚染前処理は必須**。
   > 注: `type==='body'` で候補化するので idx15/16 のセルも幾何で拾える（`placeholderRole` を通さないため title/subtitle 誤分類は起きない）。ここが `bindContentByRole` を回避する要点。
2. **X クラスタリング**: x でソートし、x 中心が許容 `tol = max(0.5, medianPitch*0.4)` 内なら同列。列を左→右に並べる。
3. **均一ゲート**: 列が `< 2`、または各列のスロット数が全列一致しない、または列サイズ `< 2` → **null**（プレーン content/カラムとして現状経路へ）。均一 2 列×2 以上のみグループと認定。これで通常 2 カラム（各列 1 セル）や KPI 風メタ単発は弾かれる。
4. **列内 Y ソート＋スロット分類**（各列、上→下）:
   - `type==='pic'` → `picture`（m1 画像3連の画像枠）。
   - 最上段 かつ（baked が `/^(step\s*)?\d+$/i` に一致 OR 名前が `/番号|step|ラベル|label|no\.?$/i`）→ `chrome`（chrome は **最上段 1 枠のみ**取る。見出し '見出し'(baked)を誤って chrome にしないため）。
   - 以降、最初の非 chrome/非 picture → `heading`、残り → `body`（Y 順）。
   - baked は `p.shapeXml` の `<a:t>` を inline regex で連結して取得（loader 改変不要）。
5. **kind 推定**: chrome の baked に `/step/i` → `step`；picture スロット有り → `card`；chrome 無し・各列 3 スロット・中段が最高身長(KPI数値 h=1.1) → `kpi`；2 列×2 スロット・chrome 無し → `compare`；それ以外 → `card`。

これは名前非依存（幾何が背骨、baked/名前は chrome/heading の refine のみ）。KPI(chrome 無し・3 テキスト)、課題対策(chrome 無し・見出し+本文)も正しく形状化する。

### レイアウト選択（`slideRoleRegions` に加算ゲート）

`template-catalog.ts` に新マップだけ追加（role 規約は不変）:
```ts
const GROUP_KIND_TO_ROLE = { card: "columns", step: "process", kpi: "kpi" } as const;
```
`classifyLayout` に name キーワードを加算（`bodyCount`/`placeholderRole` 不変、pickLayout のランキングにのみ影響）:
```ts
[/カード|card/i, "columns"], [/プロセス|process|工程|手順/i, "process"], // NAME_KEYWORDS に追記
```
`slideRoleRegions`（template-loader.ts:520）の**先頭**に、既存カラム判定より前に加算:
```ts
if (slide.groupKind) {
  const regions = slide.placeholders.filter(p => /^[1-9]$/.test(p.idx)).length; // 群数
  return { role: GROUP_KIND_TO_ROLE[slide.groupKind], regions, fallback: LAYOUT_NAMES[<canonical grouped>] };
}
```
`suggestLayouts`/`pickLayout` の score に、groupKind スライド時のグループ適合ボーナスを加える（同 kind かつ列数 ≥ 群数を最優先、超過小のものを次点）:
```ts
const shape = slide.groupKind ? detectGroups(layoutInfoOf(e)) : null;
if (slide.groupKind) s += shape && shape.kind === slide.groupKind
  ? Math.max(0, shape.groups.length - regions) * 2   // 群数ちょうど最良、少し多いのは可
  : shape ? 20 : 100;                                 // kind 違い / 非グループはペナルティ
```
**非 groupKind スライドは既存コードパスと完全一致**（分岐は `if (slide.groupKind)` でのみ発火）。回帰テストで pre/post 同一レイアウト選択を保証する。

---

## グループバインド（expandGroups）

`bindContentByRole` と**同じ戻り値型** `Map<string(layoutPhIdx), PlaceholderContent>` を返す。下流ループ・XML emit は無改変。

```ts
export function expandGroups(slide: SlideIR, layout: LayoutInfo): Map<string, PlaceholderContent> {
  const shape = detectGroups(layout);
  const out = new Map<string, PlaceholderContent>();
  if (!shape || !slide.groupKind) return out; // 呼び出し側で bindContentByRole に丸ごとフォールバック

  // (a) title/subtitle/meta のみ、正準 binder を「非群サブセット」で再利用。
  //     グループ content idx '1'..'9' を除去したクローンを渡すので、binder は idx13-24 群セルにも
  //     群 content にも触れない ⇒ slideIdxRole/placeholderRole/buildFieldMap は byte-identical 動作。
  const isGroupIdx = (i: string) => /^[1-9]$/.test(i);
  const groupPhIdxs = new Set(shape.groups.flat().map(s => s.phIdx));
  const metaSlide: SlideIR = { ...slide, placeholders: slide.placeholders.filter(c => !isGroupIdx(c.idx)) };
  const metaLayoutPhs = layout.placeholders.filter(p => !groupPhIdxs.has(p.idx));
  for (const [k, v] of bindContentByRole(metaSlide, metaLayoutPhs)) out.set(k, v);

  // (b) 群 content（idx '1'..'N'）を列に割付。
  const contentGroups = slide.placeholders.filter(c => isGroupIdx(c.idx))
    .sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
  const n = Math.min(shape.groups.length, contentGroups.length);
  if (contentGroups.length > shape.groups.length && import.meta.env?.DEV)
    console.warn(`expandGroups: ${contentGroups.length} groups > ${shape.groups.length} columns; extras editable but dropped on export`);

  for (let i = 0; i < n; i++) {
    const col = shape.groups[i];
    const c = contentGroups[i];
    const headParas = c.paragraphs.filter(p => p.heading);
    const bodyParas = c.paragraphs.filter(p => !p.heading);
    const headSlot = col.find(s => s.role === "heading");
    const bodySlots = col.filter(s => s.role === "body");
    // 見出し: heading フラグを落として見出し枠へ（枠自身の lstStyle で描画）
    if (headSlot && headParas.length)
      out.set(headSlot.phIdx, { idx: headSlot.phIdx, paragraphs: headParas.map(p => ({ ...p, heading: false })) });
    // 本文分配: 1 枠→全部; K 枠→para j を bodySlots[min(j,K-1)] へ（余りは最終枠へ）。
    if (bodySlots.length === 1) {
      if (bodyParas.length) out.set(bodySlots[0].phIdx, { idx: bodySlots[0].phIdx, paragraphs: bodyParas });
    } else if (bodySlots.length >= 2) { // KPI: 数値枠 + 補足枠
      const buckets: Paragraph[][] = bodySlots.map(() => []);
      bodyParas.forEach((p, j) => buckets[Math.min(j, buckets.length - 1)].push(p));
      bodySlots.forEach((s, j) => { if (buckets[j].length) out.set(s.phIdx, { idx: s.phIdx, paragraphs: buckets[j] }); });
    }
    // chrome / picture 枠: entry を作らない ⇒ 継承（番号 '1'、STEP 1、画像枠はテンプレのまま）。
  }
  return out;
}
```

**KPI マッピング**: `### ラベル` → heading → KPIラベル枠。本文 para[0] → KPI数値枠、para[1..] → KPI補足枠（`bodySlots.length>=2` 分岐、`min(j,K-1)` バケツ）。authoring 規約は `### ラベル` ＋ 数値行 ＋ 補足行。

**課題と対策(compare)**: groupKind='card' で到達。detectGroups は 2 列×[heading,body]、chrome 無し（見出しは baked '課題 / Before' が番号パターンに一致しないので chrome 化しない）。heading→見出し枠、body→本文枠。

**エッジケース**:
- 群数 < 列数（2 カードを 3 カードレイアウトに）: 先頭 N 群のみ充填。残り列は entry 無し→ baked '見出し'/'説明文を記入' 継承。**未解決の UX 判断**（継承 vs 空白化）。既定は継承（非破壊）。
- 群数 > 列数: N まで充填、超過群はエクスポートで drop（DEV warn）。ただしエディタでは超過群も idx '4' 等で見えて編集可能（データ黙殺しない）。理想は選択段で群数に合う列数のレイアウトを選ぶこと（上記 score ボーナス）。
- 見出しのみ/本文のみの群: 片方だけ充填、他方は継承。
- グループレイアウト非搭載テンプレ: `autoSelectLayout` が content/columns を選び `detectGroups`→null → `bindContentByRole` の縮退（既存・landed）。回帰なし。

---

## エディタ（グループ単位フィールド）

`slide.groupKind && layout && isGroupedLayout(layout)` のときだけ、`buildFieldMap` 由来のフィールドの**うち群 content idx '1'..'N' を担うもの**をグループ単位フィールドに置換する（title/subtitle/meta フィールドは `buildFieldMap` のまま＝今日と同一）。

```ts
const grouped = !!slide.groupKind && !!layout && isGroupedLayout(layout);
// title/meta: 既存 buildFieldMap から群 idx を除く（群は別 UI）
const metaFields = fields.filter(f => !grouped || !/^[1-9]$/.test(f.contentIdx));
// group fields: レイアウトの列数だけ「グループ k」テキストエリアを出す
export function groupFields(slide, layout) {
  const shape = layout ? detectGroups(layout) : null;
  const n = shape ? shape.groups.length : slide.placeholders.filter(p=>/^[1-9]$/.test(p.idx)).length;
  return Array.from({length:n}, (_,k) => ({
    contentIdx: String(k+1),
    label: shape?.groups[k]?.find(s=>s.role==="heading") ? phName(...) : `グループ ${k+1}`,
  }));
}
```
各グループフィールドの value = `paragraphsToText(slide.placeholders.find(p=>p.idx===String(k+1))?.paragraphs ?? [])`（既存 paragraphsToText が '### ' を出力）、onChange = `updatePlaceholder(String(k+1), text)`（既存 textToParagraphs が '### '→heading:true）。**新プラミング不要**。超過群（N > 列数）も placeholders に idx '4' 等で存在すればフィールドを出し、over-capacity バッジを付ける（黙殺回避）。

重要: `grouped` が false（テンプレ非搭載 / layout 読込中で undefined）のときは `buildFieldMap` 100% 経路＝ADR-0011 の 1:1 UI が今日通り動く。

---

## 描画・エクスポート

WYSIWYG のため、プレビューとエクスポートは**同一の contentFor 構築**を共有する。両呼び出し site を同一ゲートに:

```ts
// placeholder-filler.ts buildSlideXml :131 を差し替え
import { isGroupedLayout, expandGroups } from "./group-binding";
const contentFor = (slide.groupKind && isGroupedLayout(layout))
  ? expandGroups(slide, layout)
  : bindContentByRole(slide, layout.placeholders);

// SlidePreview.tsx SlideCard :121 を差し替え
const contentFor = (slide.groupKind && layout && isGroupedLayout(layout))
  ? expandGroups(slide, layout)
  : bindContentByRole(slide, layoutPhs);
```
以降（`for (ph of layout.placeholders) { contentFor.get(ph.idx) }`、diagram/table/code、XML emit、preview div）は完全に無改変。chrome/picture 枠は contentFor に entry が無い → 既存の「content=null なら継承（shapeXml の baked をそのまま）」経路で番号 '1'/STEP 1/画像枠がそのまま出る。見出しは別枠へ入るので、SlidePreview.tsx:90 の heading 太字ロジックは（heading フラグを落とすため）見出し枠内では太字化されず枠自身の lstStyle で描かれる＝設計意図通り。

---

## 1:1 非破壊の担保

構造的保証（コードレビューで検証すべき不変条件）:

1. `group-binding.ts` は `bindContentByRole` を**読むだけ**で、`buildFieldMap` / `contentIdxForPlaceholder` / `slideIdxRole` / `placeholderRole` を import しても**呼ぶのは role 判定と bindContentByRole のみ**、いずれも**改変しない**。
2. `expandGroups` の (a) は群 content idx '1'..'9' を除いたクローン ＋ 群 ph を除いたレイアウト ph を `bindContentByRole` に渡す ⇒ binder は idx13-24 群セルにも群 content にも遭遇しない ⇒ title/subtitle/meta のみ処理 ⇒ **byte-identical**。
3. グループ経路は `slide.groupKind && isGroupedLayout(layout)` でのみ発火。`field-map-bijection.test.ts` の seed は groupKind 無し ⇒ 経路を踏まない。
4. `template-catalog.ts` の変更は `GROUP_KIND_TO_ROLE` マップ追加と `NAME_KEYWORDS` 追記のみ（role 分類の refine）で、`placeholderRole`/`slideIdxRole`/`buildFieldMap` の**関数本体は不変**。

**グリーンを維持すべき具体アサーション**（`tests/field-map-bijection.test.ts`）: 全 11 テンプレ×全レイアウトで (i) `buildFieldMap` が injective（phIdx→contentIdx 単射）、(ii) round-trip（FIELD_MARK probe が自枠へ）、(iii) FULL と SPARSE の両方、(iv) 編集列安定性、(v) 病的合成レイアウト。これらの seed に groupKind を**足さない**こと自体が担保。加えて新テスト `tests/group-binding-noncontamination.test.ts` で「4 グループレイアウト（L14/15/16/17）を groupKind 無しで `buildFieldMap` に通した結果が本ブランチ前後で不変」をスナップショットする。

---

## 段階実装計画（test-first）

R3 に従い各スライスで**先にテスト**を書く。

- **S1 detectGroups（純検出）**: `tests/group-detect.test.ts` — 実 4 レイアウト（報告書 L14/15/16/17）＋ m1 画像3連 ＋ m4 コーラル ＋ m9 論点対応 を fixture 化し、(a) 群数・列数、(b) スロット role（chrome/heading/body/picture）、(c) m4 で番号がフル幅でも chrome 判定、(d) m9 で出典/資料名が除外され L17 が 2×2 と認識、(e) 通常 content レイアウトは null を assert。→ `group-layout`/`group-binding.ts` の detectGroups 実装。
- **S2 expandGroups（純バインド）**: `tests/group-expand.test.ts` — Slice-A 形の SlideIR（card/step/kpi/compare）から Map<phIdx,content> を作り、見出し→見出し枠 idx、本文→本文枠 idx、chrome/picture 枠は entry 無し、KPI の para0→数値/para1→補足、群数<列数の継承、群数>列数の clamp+warn を assert。→ expandGroups 実装。
- **S3 非汚染ガード**: `tests/group-binding-noncontamination.test.ts` — S1/S2 追加後、`field-map-bijection.test.ts` 全緑を確認 ＋ 4 グループレイアウトの buildFieldMap 出力スナップショット不変を assert。
- **S4 選択**: `tests/group-layout-select.test.ts` — groupKind='card' の 3 群スライドが 10_カード3列 を選ぶ、'step' 4 群 → 11_プロセス、'kpi' → 09_KPI、compare(card 2 群) → 12_課題と対策、**かつ非 groupKind スライドの選択が pre/post 完全一致**を assert。→ slideRoleRegions/pickLayout/suggestLayouts の加算ゲート実装。
- **S5 呼び出し site 統合**: placeholder-filler / SlidePreview の 1 行差し替え。ゴールデン PPTX（既存 diagram-golden 流儀）で グループスライドの XML を検証、chrome baked 継承をバイト確認。
- **S6 エディタ**: `tests/group-editor-fields.test.ts` — グループフィールドの value/onChange 往復、超過群の可視性、非グループスライドの buildFieldMap フィールド不変を assert。→ SlideEditor のフィールド分岐実装。

---

## テスト計画

| テスト | 主張 |
|---|---|
| `group-detect.test.ts` | 実 4+3 レイアウトの群数/列数/スロット role；m4 フル幅 chrome；m9 汚染除去；非群→null |
| `group-expand.test.ts` | 見出し/本文/chrome-継承/picture-継承の割付；KPI 数値+補足分配；partial/overflow ポリシー |
| `group-binding-noncontamination.test.ts` | `field-map-bijection` 全緑維持；4 群レイアウトの buildFieldMap 出力スナップショット不変 |
| `group-layout-select.test.ts` | groupKind→正しいグループレイアウト選択；**非 groupKind の選択 pre/post 同一**（回帰） |
| グループ PPTX ゴールデン | エクスポート XML で見出し/本文が正枠、chrome baked がバイト継承、WYSIWYG（プレビューと同 contentFor） |
| `group-editor-fields.test.ts` | グループフィールド往復；超過群の可視編集；非群フィールド不変 |
| （既存）`field-map-bijection.test.ts` | **無改変で全緑**（injective+round-trip、full+sparse、11 テンプレ） |
| （既存）`duplicate-idx-guardrail.test.ts` | m9 dedup 維持（detectGroups は dedup 後 ph 前提） |

---

## 決定事項（2026-07-03・ユーザ判断）

下記「未解決」のうちプロダクト判断を確定:

- **① 群数 < 列数（空群）＝ A. 継承（空のまま）**。空プレースホルダは出力非表示・カード枠（装飾）は残る。**加えて選択段で「群数にフィットするレイアウト」を優先**（例: 2 カードなら 2 群レイアウトがあればそちらへ誘導＝Auto Selector の役割）。exact group-count 一致を最優先、無ければ nearest（列数 ≥ 群数の最小）で partial（A）にフォールバック。
- **② 群数 > 列数（あふれ）＝ A. ドロップ＋警告（v1）**。先頭 N を充填、超過群は出力から落ちるがエディタに残し「超過」バッジで可視化（黙殺しない）。自動分割(B)は将来。
- **③ chrome 番号（1/2/3）＝ 実質 A（1,2,…）だが「編集可能なスライドオブジェクト」として実装**。カード番号は**プレースホルダ**（マスター装飾ではない）なので、エクスポート後の PowerPoint 上で**マスターを触らず選択・編集・削除できる**（ユーザ条件を満たす）。番号を確実に表示し空カードを綺麗に保つため、`expandGroups` は**充填した群のみ**、番号をその位置番号（"1"/"2"/…）で**スライド content として書き込む**（空群は番号なし）。※空でない placeholder が baked 数字を描画するか（＝書込み不要か）は S5 ゴールデン PPTX で実測し、不要なら継承へ寄せる。番号の**丸（cardnum デコ）**はレイアウト装飾で常時表示（ただの円）。

---

## リスク・未解決

**リスク**
- baked-text 抽出は `shapeXml` の `<a:t>` inline regex に依存。名前も baked も無い alien 最上段は chrome 判定不能 → 既定は heading 扱い（誤って content を落とさない；cosmetic な二重見出しを許容）。
- `detectGroups` は実 xfrm（w/h>0）必須。inherited xfrm の alien グループマスターは候補ゼロ→null→カラム縮退（クラッシュせず、機能は静かに不発）。health note 化。
- 均一列サイズゲートは m9 汚染と通常 2 カラムを弾く反面、ragged なグループレイアウト（1 群だけ副見出し）も弾く。同梱 9 マスターは ragged 無しで安全。将来 ragged はカラム縮退（文書化済トレードオフ）。
- `NAME_KEYWORDS` 追記（カード→columns、プロセス/工程→process）は pickLayout ランキングに影響。プレーン columns スライドが groupKind 未設定なら score でグループ非搭載を優先する（tie は非グループ勝ち）ことを S4 で保証必須。
- 群数>列数の DEV-only warn は本番でサイレント欠落。エディタで超過群を可視化して緩和するが、根本は選択段の群数フィット（score ボーナス）。
- KPI は 3 テキスト枠でchrome 無し。`### ラベル`＋数値行＋補足行の authoring 規約を前提に para0→数値/para1→補足。ユーザが値を見出し行に書くとズレる（v1 許容、規約を文書化）。

**未解決**
- partial fill の空群を継承（baked '見出し'/'説明文を記入' 表示）にするか空白化するか＝UX 判断。既定は継承（非破壊）。
- chrome 番号を実群順で再ベイク（2 カードなら '1','2' のみ）すべきか、baked のまま残すか。detectGroups は chrome phIdx を露出するので binder 側で決定可能。
- 群数>列数の overflow を (a) clamp+drop、(b) より大きいグループレイアウトへ自動昇格、(c) 複数スライド分割 のいずれにするか。S4 の score ボーナスは (b) 寄り。分割機構と合わせて決定。
- m1 画像3連（picture-per-group）を text-only card スライドで選ぶべきか。detectGroups は picture ラベルを付けるが、画像枠は Markdown から埋められない → text-only card では番号型カードより下位にランクするのが妥当（プロダクト判断）。
- detectGroups の per-template キャッシュ（LayoutInfo.index キー）を入れるか。suggestLayouts が全カタログ反復するため、cheap でも per-template キャッシュ推奨。