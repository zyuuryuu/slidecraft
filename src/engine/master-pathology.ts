/**
 * master-pathology.ts — 取り込み理解の「病理センサス」の純粋検出ロジック（R2: DOM/Tauri 非依存）。
 *
 * 任意スライドマスターの STRUCTURAL な病理（＝バグが宿る所）を、機密内容を一切読まずに列挙する。
 * 設計: docs/design/master-intake.md §3.2（病理センサス）／§2 部品0（幾何の床上げ）。
 * 各病理は「look here」＝ヒューリスティック（parse-audit と同じ哲学）で、確実なもの
 * （w/h=0・typeless・非16:9）と、当たりを付けるもの（title=staticText/body、figure=body）が混在する。
 *
 * 重要な設計判断: スライド寸法を presentationXml から実測し、全閾値を**相対化**する
 * （geometryRole の 13.333×7.5 ハードコードが 4:3/A4 を壊す問題＝部品0 の是正を、検出器自身は先取りする）。
 *
 * 用途: (1) 実テンプレ群に回して病理の実在・頻度を計測（着手判断を data 駆動に）、
 *       (2) その分布が make-dirty-fixture.ts のミューテーション群の根拠になる（証拠の連鎖）。
 */
import type { TemplateData, PlaceholderInfo, StaticText } from "./template-loader";
import { placeholderRole, typeIdxRole, geometryRole, type PlaceholderRole } from "./template-catalog";

export type PathologyKind =
  | "unresolved-geometry" // placeholder の w/h<=0（xfrm 継承未解決）→ capacity=0・isPeer 死（部品0）
  | "typeless-placeholder" // <p:ph> に type 無し（role 推定が幾何/名前だのみに）
  | "title-as-static-text" // title role が無く、上部・広幅・大フォントの staticText が実質の見出し
  | "title-as-body" // body 型 placeholder が幾何的に title（上部・広幅・最大フォント）
  | "figure-as-body" // 巨大面積×大フォントの body 型＝図/ヒーロー枠が散文 body に化ける
  | "no-title-role" // body はあるが title role が皆無（かつ static/body でも説明できない）
  | "non-standard-slide-size"; // sldSz が 16:9 でない（geometryRole 閾値がズレる）

export interface PathologyFinding {
  kind: PathologyKind;
  layout?: string; // undefined = テンプレレベル
  detail: string;
}

/**
 * #146 シグナル矛盾 — type/idx 由来のロールと幾何由来の推定ロールがクラス違いで対立する枠。
 * 層1 の first-match-wins 梯子は type が答えると幾何の異議を無言で捨てる（Dirty_AllBody:
 * type=body vs 幾何=40pt 中央見出し）ので、梯子→証拠融合の是非を判断する前にその実頻度を測る
 * （ADR-0030 Consequences — 融合の是非は本データを見て別 ADR で判断）。計測のみ・挙動変更ゼロ。
 * 各エントリ＝「幾何を優先した場合に判定が変わる枠」なので、その数は conflicts.length。
 */
export interface SignalConflict {
  layout: string;
  idx: string;
  type: string; // 生の <p:ph> type
  typeRole: PlaceholderRole; // type/idx 由来（typeIdxRole — resolvedRole/幾何 rung を含まない生シグナル）
  geoRole: PlaceholderRole; // 幾何由来（geometryRole read-only）
  fs: number;
  yRel: number; // y / スライド高さ
  hRel: number; // h / スライド高さ
}

export interface PathologyReport {
  template: string;
  slideSize: { w: number; h: number };
  total: number;
  counts: Partial<Record<PathologyKind, number>>;
  findings: PathologyFinding[];
  /** #146: シグナル矛盾（追加フィールド — total/counts/findings には混ぜない）。 */
  conflicts: SignalConflict[];
}

const EMU = 914400;

function parseSlideSize(presentationXml: string): { w: number; h: number } {
  const m = presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  return m ? { w: +m[1] / EMU, h: +m[2] / EMU } : { w: 13.333, h: 7.5 };
}

/** テキスト保持シェイプの面積（inch^2）。 */
const areaOf = (s: { w: number; h: number }) => Math.max(0, s.w) * Math.max(0, s.h);

// ── #146 シグナル矛盾の判定式 ──
// ロールをクラスに束ねて比較する。同クラス内の食い違い（footer vs date 等、下端帯の x 位置による
// サブ分類差）は「どちらもメタ帯」で一致しており矛盾ではない — 実測（同梱4種＋実テンプレ census）で
// 素の geometryRole 直比較は Midnight だけで 31 件の擬陽性を出した（大半がこのサブ分類ノイズ）。
type RoleClass = "heading" | "content" | "meta" | "visual";
const ROLE_CLASS: Partial<Record<PlaceholderRole, RoleClass>> = {
  title: "heading",
  subtitle: "heading",
  body: "content",
  category: "meta",
  date: "meta",
  footer: "meta",
  slideNumber: "meta",
  picture: "visual",
  chart: "visual",
  table: "visual",
};

/**
 * type/idx と幾何がクラス違いで対立するか。過検出しない（クリーンな同梱マスターで 0）ための
 * 決定的証拠ゲート付き:
 *  - 幾何の見出し主張（title/subtitle 帯）は「レイアウト最大フォント × 18pt 以上」の時だけ決定的。
 *    素の帯判定はメタ chrome（fs10-13 の細帯）やリード文（fs14-16）を見出しと誤読する。
 *    maxTextFs は TEXT 系 ph の最大フォント — loader は pic/chart/tbl にも継承 body フォントを
 *    stamp するため（テキストは描画しないのに）、視覚型を含めると幻フォントが本物の見出し矛盾を隠す。
 *  - 幾何のメタ帯主張 vs 明示 body 型は矛盾に数えない: placeholderRole の body 枝が既に幾何で
 *    footer/date/slideNumber へ再分類しており（AI-Import P1 rung）、幾何の異議は捨てられていない。
 *    typeless×慣習 idx の body（idx rung 経由）はこの再分類を受けない＝異議が捨てられる → 数える。
 */
function isSignalConflict(
  typeRole: PlaceholderRole,
  geoRole: PlaceholderRole,
  fs: number,
  maxTextFs: number,
  bodyTyped: boolean,
): boolean {
  const tc = ROLE_CLASS[typeRole];
  const gc = ROLE_CLASS[geoRole];
  if (!tc || !gc || tc === gc) return false;
  if (gc === "heading") return fs >= 18 && fs === maxTextFs;
  if (gc === "meta") return tc !== "content" || !bodyTyped;
  return false; // geometryRole は content/visual を主張しない
}

/**
 * TemplateData（＋テンプレ名）→ 病理レポート。純粋関数。テンプレ内容（テキスト/画像/色）は読まない。
 * 閾値はスライド寸法 SW×SH に対する相対値（寸法非依存）。
 */
export function detectPathologies(
  tpl: Pick<TemplateData, "layouts" | "presentationXml">,
  name: string,
): PathologyReport {
  const { w: SW, h: SH } = parseSlideSize(tpl.presentationXml);
  const findings: PathologyFinding[] = [];
  const conflicts: SignalConflict[] = [];
  const add = (kind: PathologyKind, layout: string | undefined, detail: string) =>
    findings.push({ kind, layout, detail });

  // テンプレレベル: 非 16:9（geometryRole の 16:9 ハードコードで全幾何判定がズレる）
  if (Math.abs(SW / SH - 16 / 9) > 0.02)
    add("non-standard-slide-size", undefined, `${SW.toFixed(2)}×${SH.toFixed(2)} (aspect ${(SW / SH).toFixed(2)})`);

  const isTopWide = (s: { y: number; w: number }) => s.y < 0.22 * SH && s.w > 0.45 * SW;

  for (const l of tpl.layouts) {
    const phRoles = l.placeholders.map((ph: PlaceholderInfo) => ({ ph, role: placeholderRole(ph) }));
    const maxPhFs = Math.max(0, ...l.placeholders.map((p) => p.style.fontSize));
    const hasBody = phRoles.some((p) => p.role === "body");

    // 確実: w/h<=0（継承未解決）
    for (const ph of l.placeholders)
      if (ph.style.w <= 0 || ph.style.h <= 0)
        add("unresolved-geometry", l.name, `${ph.type || "typeless"}@${ph.idx} w=${ph.style.w.toFixed(2)} h=${ph.style.h.toFixed(2)}`);

    // 確実: typeless placeholder — ただし idx 1-9 の typeless は placeholderRole が body に回収する
    // （＝正常）ので除外。非慣習 idx（0・10+・非数値）の typeless だけが role 推定を崩す。
    for (const ph of l.placeholders)
      if (ph.type === "" && !/^[1-9]$/.test(ph.idx))
        add("typeless-placeholder", l.name, `idx=${ph.idx} name="${ph.name}"`);

    // title の病理（title=生text / title=body 型）。F1-②b の scorer 復元が load 時に body 見出しを
    // title role へ昇格する（resolvedRole）ため、role だけ見ると病理が消える。よって「genuine title
    // （実型 ctrtitle/title、または idx-META 慣習の idx15）」と「body 見出し（＝②b 昇格 or 未昇格の
    // 幾何的見出し）」を区別し、後者を raw 病理として検出する（復元後でも計測が安定）。
    const isRealTitleType = (p: PlaceholderInfo) => { const t = p.type.toLowerCase(); return t === "title" || t === "ctrtitle"; };
    const isMetaTitle = (p: PlaceholderInfo) => (p.metaIdxConvention ?? true) && p.idx === "15";
    const genuine = (p: PlaceholderInfo) => isRealTitleType(p) || isMetaTitle(p);
    const hasGenuineTitle = phRoles.some((p) => p.role === "title" && genuine(p.ph));

    // title=body: title ROLE だが型/慣習では title でない（②b 昇格された body 見出し）
    const bodyTitles = phRoles.filter((p) => p.role === "title" && !genuine(p.ph)).map((p) => p.ph);
    // 未昇格の幾何的見出し（②b の confidence 未満で昇格しなかった場合）も 1 件だけ拾う
    if (!hasGenuineTitle && bodyTitles.length === 0) {
      const geo = phRoles.find(
        (p) => p.role === "body" && isTopWide(p.ph.style) && p.ph.style.fontSize === maxPhFs && maxPhFs > 0 && areaOf(p.ph.style) < 0.3 * SW * SH,
      );
      if (geo) bodyTitles.push(geo.ph);
    }
    for (const p of bodyTitles) add("title-as-body", l.name, `${p.type || "body"}@${p.idx} fs${p.style.fontSize}`);

    // title=生text: genuine title 枠が無く、上部・広幅・大フォントの staticText が実質の見出し
    //   （細い accent "03" は幅フィルタで除外）。
    const titleStatic: StaticText | undefined = hasGenuineTitle
      ? undefined
      : l.staticTexts.find((s) => s.style.w > 0.45 * SW && s.style.fontSize >= 18 && s.style.y < 0.55 * SH);
    if (titleStatic)
      add("title-as-static-text", l.name, `"${titleStatic.text.slice(0, 20)}" fs${titleStatic.style.fontSize} y${titleStatic.style.y.toFixed(1)}`);

    if (!hasGenuineTitle && !titleStatic && bodyTitles.length === 0 && hasBody)
      add("no-title-role", l.name, `${l.placeholders.length}ph・title role 皆無`);

    // ヒューリスティック: 巨大面積×大フォントの body＝図枠（散文 body は fs<24 なので過検出しにくい）
    for (const p of phRoles)
      if (p.role === "body" && areaOf(p.ph.style) >= 0.35 * SW * SH && p.ph.style.fontSize >= 24)
        add("figure-as-body", l.name, `${p.ph.type}@${p.ph.idx} area${areaOf(p.ph.style).toFixed(0)} fs${p.ph.style.fontSize}`);

    // #146: シグナル矛盾（type/idx vs 幾何）— counts/findings には混ぜず conflicts に列挙する。
    // typeRole は typeIdxRole の生シグナル（②b の resolvedRole 昇格に依らない＝復元後でも計測が安定）、
    // geoRole は geometryRole を実測スライド寸法で read-only 評価（非16:9 でも相対化される）。
    // 最大フォントは TEXT 系 ph に限定（既存病理の maxPhFs とは別勘定 — あちらは凍結済みの既存挙動）。
    const maxTextFs = Math.max(
      0,
      ...l.placeholders
        .filter((p) => { const tr = typeIdxRole(p); return !(tr && ROLE_CLASS[tr] === "visual"); })
        .map((p) => p.style.fontSize),
    );
    for (const ph of l.placeholders) {
      const tr = typeIdxRole(ph);
      const gr = geometryRole(ph.style, SW, SH);
      if (tr && gr && isSignalConflict(tr, gr, ph.style.fontSize, maxTextFs, ph.type.toLowerCase() === "body"))
        conflicts.push({
          layout: l.name,
          idx: ph.idx,
          type: ph.type,
          typeRole: tr,
          geoRole: gr,
          fs: ph.style.fontSize,
          yRel: ph.style.y / SH,
          hRel: ph.style.h / SH,
        });
    }
  }

  const counts: Partial<Record<PathologyKind, number>> = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return { template: name, slideSize: { w: SW, h: SH }, total: findings.length, counts, findings, conflicts };
}
