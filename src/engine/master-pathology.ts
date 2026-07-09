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
import { placeholderRole } from "./template-catalog";

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

export interface PathologyReport {
  template: string;
  slideSize: { w: number; h: number };
  total: number;
  counts: Partial<Record<PathologyKind, number>>;
  findings: PathologyFinding[];
}

const EMU = 914400;

function parseSlideSize(presentationXml: string): { w: number; h: number } {
  const m = presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  return m ? { w: +m[1] / EMU, h: +m[2] / EMU } : { w: 13.333, h: 7.5 };
}

/** テキスト保持シェイプの面積（inch^2）。 */
const areaOf = (s: { w: number; h: number }) => Math.max(0, s.w) * Math.max(0, s.h);

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
  const add = (kind: PathologyKind, layout: string | undefined, detail: string) =>
    findings.push({ kind, layout, detail });

  // テンプレレベル: 非 16:9（geometryRole の 16:9 ハードコードで全幾何判定がズレる）
  if (Math.abs(SW / SH - 16 / 9) > 0.02)
    add("non-standard-slide-size", undefined, `${SW.toFixed(2)}×${SH.toFixed(2)} (aspect ${(SW / SH).toFixed(2)})`);

  const isTopWide = (s: { y: number; w: number }) => s.y < 0.22 * SH && s.w > 0.45 * SW;

  for (const l of tpl.layouts) {
    const phRoles = l.placeholders.map((ph: PlaceholderInfo) => ({ ph, role: placeholderRole(ph) }));
    const hasTitle = phRoles.some((p) => p.role === "title");
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

    // ヒューリスティック: title が placeholder でない／body 型
    //  - title=staticText: 表紙見出しは上部帯でなく垂直中央寄り(y~2.5)もある → 「広幅×大フォント×上半分」で拾う
    //    （細い accent "03" は幅フィルタで除外される）。
    //  - title=body: 図/ヒーロー枠（巨大面積）は title たり得ない → 面積で除外（figure-as-body と二重計上しない）。
    const titleStatic: StaticText | undefined = hasTitle
      ? undefined
      : l.staticTexts.find((s) => s.style.w > 0.45 * SW && s.style.fontSize >= 18 && s.style.y < 0.55 * SH);
    const titleBody = hasTitle
      ? undefined
      : phRoles.find(
          (p) =>
            p.role === "body" &&
            isTopWide(p.ph.style) &&
            p.ph.style.fontSize === maxPhFs &&
            maxPhFs > 0 &&
            areaOf(p.ph.style) < 0.3 * SW * SH,
        );
    if (titleStatic)
      add("title-as-static-text", l.name, `"${titleStatic.text.slice(0, 20)}" fs${titleStatic.style.fontSize} y${titleStatic.style.y.toFixed(1)}`);
    if (titleBody)
      add("title-as-body", l.name, `${titleBody.ph.type}@${titleBody.ph.idx} fs${titleBody.ph.style.fontSize} y${titleBody.ph.style.y.toFixed(1)}`);
    if (!hasTitle && !titleStatic && !titleBody && hasBody)
      add("no-title-role", l.name, `${l.placeholders.length}ph・title role 皆無`);

    // ヒューリスティック: 巨大面積×大フォントの body＝図枠（散文 body は fs<24 なので過検出しにくい）
    for (const p of phRoles)
      if (p.role === "body" && areaOf(p.ph.style) >= 0.35 * SW * SH && p.ph.style.fontSize >= 24)
        add("figure-as-body", l.name, `${p.ph.type}@${p.ph.idx} area${areaOf(p.ph.style).toFixed(0)} fs${p.ph.style.fontSize}`);
  }

  const counts: Partial<Record<PathologyKind, number>> = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return { template: name, slideSize: { w: SW, h: SH }, total: findings.length, counts, findings };
}
