/**
 * group-layout.ts — GEOMETRIC detection of a repeated-GROUP layout (card / step / kpi / compare).
 * Design: docs/design/grouped-layout-binding.md.
 *
 * Split from group-binding.ts so template-catalog (buildCatalog) can import detectGroups WITHOUT a
 * runtime import cycle: this module has TYPE-ONLY imports (erased at runtime) apart from the leaf
 * slide-schema (zod only), whereas group-binding value-imports bindContentByRole → placeholder-binding
 * → template-catalog (which would cycle).
 *
 * Never touches slideIdxRole / placeholderRole / buildFieldMap — detection is pure geometry (idx15/16
 * group cells are read by TYPE + position, not the canonical role convention). Pure logic (R2).
 */
import type { LayoutInfo, PlaceholderInfo } from "./template-loader";
import { LAYOUT_NAMES } from "./slide-schema";

const SLIDE_W = 13.333;
const TITLE_BAND = 0.9; // y above this = title band (drop page-meta)
const FOOTER_BAND = 6.4; // y below this = footer strip (drop page-meta)

// "value" (#593): a KPI group's big-number box — see markKpiValue. Only kpi groups carry it.
export type GroupSlotRole = "chrome" | "picture" | "heading" | "value" | "body";
export interface GroupSlot { phIdx: string; role: GroupSlotRole; y: number; }
export interface GroupLayoutShape { kind: "card" | "step" | "kpi" | "compare"; groups: GroupSlot[][]; }

/** Baked <a:t> text of a shape, concatenated + trimmed (for chrome number/STEP detection). */
export function bakedText(shapeXml: string): string {
  return (shapeXml.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((m) => m.replace(/<\/?a:t>/g, "")).join("").trim();
}

const CHROME_BAKED = /^(step\s*)?\d+$/i; // "1", "STEP 1"
const CHROME_NAME = /番号|step|no\.?$/i; // NOT /ラベル/: KPIラベル is a HEADING, only STEP/番号 are chrome
// A chrome badge sits in the column's TOP BAND — at, or just below, its sibling heading (the 公文書
// masters put the number ~0.06in below the heading top). Any candidate this far under the top slot is
// still eligible; a mid-column KPI value box (≥0.45in below its label) is not, so it can't be mistaken
// for chrome even when it bakes a bare number. Measured gap across all report/公文書 templates: chrome
// ≤0.06in, KPI value ≥0.45in — 0.3 separates them with margin on both sides.
const CHROME_TOP_BAND = 0.3;

/** Tag one group's cells (chrome/heading/body), top→bottom. Shared by the x-clustered column path AND
 *  the canonical-name-hinted path (#136) so both produce identically-shaped GroupSlot[].
 *  `nameChrome`: whether a NAME match (CHROME_NAME) alone can mark a slot as chrome. Disabled for the
 *  name-hinted path — SlideCraft's own content placeholders are descriptively named ("Step1.Top",
 *  "SectionNumber.Left") and would otherwise false-positive on the "step"/"番号" substrings in their OWN
 *  name; only an actually-BAKED number/STEP badge (CHROME_BAKED) counts as chrome there. */
function tagGroupSlots(cells: PlaceholderInfo[], nameChrome = true): { slots: GroupSlot[]; chromeBaked: string } {
  const sorted = [...cells].sort((a, b) => a.style.y - b.style.y);
  const topY = sorted[0].style.y;
  let headingDone = false;
  let chromeBaked = "";
  const slots = sorted.map((p): GroupSlot => {
    const t = p.type.toLowerCase();
    const baked = bakedText(p.shapeXml);
    let role: GroupSlotRole;
    if (t === "pic") role = "picture";
    else if ((CHROME_BAKED.test(baked) || (nameChrome && CHROME_NAME.test(p.name))) && p.style.y <= topY + CHROME_TOP_BAND) {
      role = "chrome";
      chromeBaked = baked;
    } else if (!headingDone) { role = "heading"; headingDone = true; }
    else role = "body";
    return { phIdx: p.idx, role, y: p.style.y };
  });
  return { slots, chromeBaked };
}

// #136: create_template()'s OWN canonical dotted-name convention (Family.NDetail.Modifier — e.g.
// "Process.3Step.Sequential", "KPI.4Value.Grid") encodes the group kind + count directly in the name.
// The geometric algorithm below can't always recover that shape (a 2x2 KPI grid reads as 2 columns of
// 2, not 4 single-value groups; a single-placeholder-per-step layout has no [heading,body] pair to
// column-cluster on). Trust the name ONLY for this exact family+count+noun pattern — no third-party
// master is named like this (see group-detect.test.ts's untouched corpus), so this never fires outside
// SlideCraft's own generated templates. Overrides the geometric kind/grouping entirely when it matches
// (rather than patching individual mis-detections) so our own canonical set stays self-consistent.
/** #568 段 3: the name suffix layout augmentation gives a synthesized group layout — `<base> +3Card`. */
export const AUGMENT_GROUP_SUFFIX: Readonly<Record<"card" | "kpi" | "compare", string>> = { card: "Card", kpi: "KPI", compare: "Compare" };

const CANONICAL_NAME_HINTS: Array<{ re: RegExp; kind: GroupLayoutShape["kind"] }> = [
  { re: /^Process\.(\d+)Step\./, kind: "step" },
  { re: /^KPI\.(\d+)Value\./, kind: "kpi" },
  { re: /^Summary\.(\d+)Block\./, kind: "card" },
  { re: /^Compare\.(\d+)Option\./, kind: "compare" },
  // #568 段 3: layout augmentation names a synthesized group layout `<base> +3Card` / `+3KPI` / `+2Compare`
  // (AUGMENT_GROUP_SUFFIX below — ONE table for the name it writes and the hint read here, R8). Without it
  // a 3-column heading+body card row reads geometrically as kpi (no chrome/picture), so `<!-- card -->`
  // could never reach it. No third-party master ends a layout name in ` +<N>Card` (group-detect corpus).
  ...(Object.entries(AUGMENT_GROUP_SUFFIX) as Array<[GroupLayoutShape["kind"], string]>).map(([kind, word]) => ({ re: new RegExp(` \\+(\\d+)${word}$`), kind })),
];

/** SlideCraft's own layout names. For these the NAME decides group-ness: a non-group family (Section /
 *  SectionNav / Content / Column / …) is never a group layout, whatever its geometry. #396: the
 *  generated SectionNav.1Title.Single (big section number + title, two [heading, body]-shaped columns)
 *  read as a 2-group compare layout and sat before Compare.2Option.Versus in the catalog, so
 *  `<!-- compare -->` would have routed a comparison onto the chapter divider. */
const CANONICAL_NAMES: ReadonlySet<string> = new Set(LAYOUT_NAMES);

/** Build a GroupLayoutShape straight from the canonical name's group count, chunking candidate cells by
 *  idx order (our own idx assignment is always in group/reading order) instead of x-position clustering.
 *  Returns null when the geometry doesn't actually divide evenly into the named count (degrade safely —
 *  a hand-edited or unexpected layout falls through to the geometric algorithm below). */
function nameHintedGroups(name: string, cands: PlaceholderInfo[]): GroupLayoutShape | null {
  for (const { re, kind } of CANONICAL_NAME_HINTS) {
    const m = re.exec(name);
    if (!m) continue;
    const count = Number(m[1]);
    if (!(count >= 1) || cands.length === 0 || cands.length % count !== 0) return null;
    const groupSize = cands.length / count;
    const byIdx = [...cands].sort((a, b) => parseInt(a.idx, 10) - parseInt(b.idx, 10));
    const groups: GroupSlot[][] = [];
    for (let i = 0; i < count; i++) {
      const { slots } = tagGroupSlots(byIdx.slice(i * groupSize, (i + 1) * groupSize), false);
      groups.push(slots);
    }
    // Same role-sequence uniform gate as the geometric path (step 4b) — cheap safety net.
    const sig = (col: GroupSlot[]) => col.map((s) => s.role).join("|");
    if (groups.some((c) => sig(c) !== sig(groups[0]))) return null;
    return { kind, groups };
  }
  return null;
}

/**
 * Detect whether a layout is a repeated-GROUP layout (card/step/kpi/compare) purely from geometry, and
 * return its column×slot shape (each slot tagged chrome/picture/heading/body). Returns null for a plain
 * content/columns layout — the caller then falls back to bindContentByRole. On-demand only.
 */
export function detectGroups(layout: LayoutInfo): GroupLayoutShape | null {
  // 1. Candidate content cells + pollution removal (title/footer band, full-width bar, meta names).
  const cands = layout.placeholders.filter((p) => {
    const t = p.type.toLowerCase();
    if (t !== "body" && t !== "pic") return false;
    const s = p.style;
    if (!(s.w > 0 && s.h > 0)) return false; // inherited xfrm — can't cluster
    if (s.y < TITLE_BAND || s.y > FOOTER_BAND) return false; // 資料名(top) / 出典(bottom)
    if (s.w > 0.8 * SLIDE_W) return false; // full-width bar (出典)
    if (/出典|資料名|注記|source|footer/i.test(p.name)) return false;
    return true;
  });

  // #136: trust SlideCraft's OWN canonical dotted name (Family.NDetail.*) before falling back to pure
  // geometry — see nameHintedGroups' docstring for why (2x2 grids / single-slot-per-group layouts the
  // geometric clustering below can't shape correctly). No-op (returns null) for any non-canonical name.
  const hinted = nameHintedGroups(layout.name, cands);
  if (hinted) return markKpiValue(hinted, layout);
  // #593: a hand-made single hero-number layout (マガジン 05_ビッグナンバー), recognized by NAME.
  const hero = heroNumberGroup(layout);
  if (hero) return hero;
  // A canonical name outside the group families → not grouped. (A group-family name whose hint failed —
  // a hand-edited layout — still falls through to geometry, as before.)
  if (CANONICAL_NAMES.has(layout.name) && !CANONICAL_NAME_HINTS.some((h) => h.re.test(layout.name))) return null;

  if (cands.length < 4) return null; // need at least 2 columns × 2 slots

  // 2. X-cluster into columns (left→right). tol scales with the typical column pitch.
  const byX = [...cands].sort((a, b) => a.style.x - b.style.x);
  const pitches: number[] = [];
  for (let i = 1; i < byX.length; i++) {
    const d = byX[i].style.x - byX[i - 1].style.x;
    if (d > 0.1) pitches.push(d);
  }
  const medianPitch = pitches.length ? [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)] : 1;
  const tol = Math.max(0.5, medianPitch * 0.4);
  const columns: PlaceholderInfo[][] = [];
  for (const p of byX) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(p.style.x - last[0].style.x) <= tol) last.push(p);
    else columns.push([p]);
  }

  // 3. Uniform gate: ≥2 columns, all the same slot count (≥2). Else it's plain content/columns → null.
  if (columns.length < 2) return null;
  const size = columns[0].length;
  if (size < 2 || columns.some((c) => c.length !== size)) return null;

  // 4. Within each column, sort top→bottom and tag slots.
  let chromeBaked = "";
  const groups: GroupSlot[][] = columns.map((col) => {
    const { slots, chromeBaked: baked } = tagGroupSlots(col);
    if (baked) chromeBaked = baked;
    return slots;
  });

  // 4b. Role-sequence uniform gate: a genuine repeated-GROUP layout has the SAME per-column role
  // sequence in every column. Reject asymmetric layouts (e.g. a section divider whose left column is
  // [chrome, heading] and right column is [heading, body]) that only coincidentally pass the slot-COUNT
  // check in step 3 — otherwise expandGroups would pour group content into unrelated divider cells.
  const sig = (col: GroupSlot[]) => col.map((s) => s.role).join("|");
  const sig0 = sig(groups[0]);
  if (groups.some((c) => sig(c) !== sig0)) return null;

  // 5. Kind inference (informational + used by selection to match slide.groupKind).
  const hasChrome = groups.some((c) => c.some((s) => s.role === "chrome"));
  const hasPicture = groups.some((c) => c.some((s) => s.role === "picture"));
  let kind: GroupLayoutShape["kind"];
  if (hasChrome && /step/i.test(chromeBaked)) kind = "step";
  else if (hasPicture) kind = "card";
  else if (hasChrome) kind = "card"; // numbered cards
  else if (size === 2 && columns.length === 2) kind = "compare"; // 見出し+本文 ×2, no chrome
  else kind = "kpi"; // no chrome, ≥3 text slots (ラベル+数値+補足)
  return markKpiValue({ kind, groups }, layout);
}

/** A KPI value box's font must dominate every other text slot of its group by this ratio. Measured:
 *  canonical KPI.1 72pt vs 18/13, KPI.2 60 vs 14, KPI.3 52 vs 13, report 09_KPI 72 vs 13, マガジン
 *  05_ビッグナンバー 150 vs 15/14 — all ≥ 3.7×; equal-font groups (KPI.4Value.Grid's 14pt cells) are 1×. */
const VALUE_FONT_RATIO = 1.5;

/** The group's VALUE box: the text slot whose font dominates every other text slot, else undefined. */
function dominantValueSlot(group: GroupSlot[], layout: LayoutInfo): GroupSlot | undefined {
  const text = group.filter((s) => s.role === "heading" || s.role === "body");
  if (text.length < 2) return undefined;
  const fontOf = new Map(layout.placeholders.map((p) => [p.idx, p.style.fontSize] as const));
  const fs = (s: GroupSlot) => fontOf.get(s.phIdx) ?? 0;
  const value = text.reduce((a, b) => (fs(b) > fs(a) ? b : a));
  return text.every((s) => s === value || fs(value) >= VALUE_FONT_RATIO * fs(s)) ? value : undefined;
}

/**
 * #593 — fix a KPI group whose VALUE box (dominant font) was tagged as the heading. The top→bottom tagging
 * assumes the label sits on top: true for the report masters' 09_KPIハイライト (label above value), where
 * binding's "body para0 → first body slot" already lands the number in the value box — those groups are
 * left exactly as they were. It is inverted on the canonical KPI.*Value layouts (value box ABOVE its
 * label): Midnight / generated templates put the `###` heading into the 72pt box and the number into the
 * small label. There the value box is re-tagged "value" (binding gives it body para0) and the next text slot
 * becomes the heading. Non-kpi shapes and groups without a dominant font are untouched. Pure (R2).
 */
function markKpiValue(shape: GroupLayoutShape, layout: LayoutInfo): GroupLayoutShape {
  if (shape.kind !== "kpi") return shape;
  const groups = shape.groups.map((group) => {
    const value = dominantValueSlot(group, layout);
    if (!value || value.role !== "heading") return group;
    const label = group.find((s) => s !== value && s.role === "body");
    return group.map((s): GroupSlot => (s === value ? { ...s, role: "value" } : s === label ? { ...s, role: "heading" } : s));
  });
  return { ...shape, groups };
}

// #593: localized/plain names of a single hero-number layout (one huge KPI + its label/notes).
const HERO_NUMBER_NAME = /ビッグナンバー|big\s*number|hero\s*(?:number|kpi|stat)/i;

/**
 * #593 — a hand-made "big number" layout as ONE kpi group, recognized by NAME (マガジン 05_ビッグナンバー:
 * 注記 15pt / ビッグナンバー 150pt / 補足 14pt). Geometry alone can't see it (one column, and the 注記 name
 * is filtered as pollution above), so a `<!-- kpi -->` slide never reached it. Only kpi slides route by
 * groupKind (autoSelectLayout), so a slide without the marker is unaffected. Needs a dominant value box —
 * otherwise null (the name alone is not trusted).
 */
function heroNumberGroup(layout: LayoutInfo): GroupLayoutShape | null {
  if (!HERO_NUMBER_NAME.test(layout.name)) return null;
  const cells = layout.placeholders.filter((p) => {
    const s = p.style;
    return p.type.toLowerCase() === "body" && s.w > 0 && s.h > 0 && s.y >= TITLE_BAND && s.y <= FOOTER_BAND;
  });
  if (cells.length < 2) return null;
  const group = tagGroupSlots(cells, false).slots;
  return dominantValueSlot(group, layout) ? markKpiValue({ kind: "kpi", groups: [group] }, layout) : null;
}

/** True when the layout is a repeated-group layout (has a group fill path). */
export function isGroupedLayout(layout: LayoutInfo): boolean {
  return detectGroups(layout) !== null;
}
