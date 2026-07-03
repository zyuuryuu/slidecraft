/**
 * group-layout.ts — GEOMETRIC detection of a repeated-GROUP layout (card / step / kpi / compare).
 * Design: docs/design/grouped-layout-binding.md.
 *
 * Split from group-binding.ts so template-catalog (buildCatalog) can import detectGroups WITHOUT a
 * runtime import cycle: this module has TYPE-ONLY imports (erased at runtime), whereas group-binding
 * value-imports bindContentByRole → placeholder-binding → template-catalog (which would cycle).
 *
 * Never touches slideIdxRole / placeholderRole / buildFieldMap — detection is pure geometry (idx15/16
 * group cells are read by TYPE + position, not the canonical role convention). Pure logic (R2).
 */
import type { LayoutInfo, PlaceholderInfo } from "./template-loader";

const SLIDE_W = 13.333;
const TITLE_BAND = 0.9; // y above this = title band (drop page-meta)
const FOOTER_BAND = 6.4; // y below this = footer strip (drop page-meta)

export type GroupSlotRole = "chrome" | "picture" | "heading" | "body";
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
    const sorted = [...col].sort((a, b) => a.style.y - b.style.y);
    const topY = sorted[0].style.y;
    let headingDone = false;
    return sorted.map((p): GroupSlot => {
      const t = p.type.toLowerCase();
      const baked = bakedText(p.shapeXml);
      let role: GroupSlotRole;
      if (t === "pic") role = "picture";
      // chrome = a number/STEP badge in the column's TOP BAND. Position-independent (the badge may sort
      // just BELOW its sibling heading — see 公文書 masters), but the top-band gate keeps a mid-column
      // KPI value box out of chrome even when it bakes a bare number.
      else if ((CHROME_BAKED.test(baked) || CHROME_NAME.test(p.name)) && p.style.y <= topY + CHROME_TOP_BAND) {
        role = "chrome";
        chromeBaked = baked;
      } else if (!headingDone) { role = "heading"; headingDone = true; }
      else role = "body";
      return { phIdx: p.idx, role, y: p.style.y };
    });
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
  return { kind, groups };
}

/** True when the layout is a repeated-group layout (has a group fill path). */
export function isGroupedLayout(layout: LayoutInfo): boolean {
  return detectGroups(layout) !== null;
}
