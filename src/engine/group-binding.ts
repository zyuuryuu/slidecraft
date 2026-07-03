/**
 * group-binding.ts — the SEPARATE grouped-layout fill path (card / step / kpi / compare).
 * Design: docs/design/grouped-layout-binding.md.
 *
 * WHY separate: grouped layouts put per-group body cells at template idx 13-24, and idx15/16 collide
 * with the canonical convention (idx15=title / 16=subtitle) baked into slideIdxRole/placeholderRole/
 * buildFieldMap. Reclassifying those broke the 1:1 bijection (ADR-0011). So this module NEVER touches
 * that convention: it reads the layout GEOMETRICALLY and only fires when slide.groupKind is set AND the
 * layout is grouped. Non-grouped slides go through bindContentByRole exactly as before.
 *
 * Pure logic (R2): no DOM / Tauri.
 */
import type { LayoutInfo, PlaceholderInfo } from "./template-loader";
import type { SlideIR, PlaceholderContent, Paragraph } from "./slide-schema";
import { bindContentByRole } from "./placeholder-binding";

const SLIDE_W = 13.333;
const TITLE_BAND = 0.9; // y above this = title band (drop page-meta)
const FOOTER_BAND = 6.4; // y below this = footer strip (drop page-meta)

export type GroupSlotRole = "chrome" | "picture" | "heading" | "body";
export interface GroupSlot { phIdx: string; role: GroupSlotRole; y: number; }
export interface GroupLayoutShape { kind: "card" | "step" | "kpi" | "compare"; groups: GroupSlot[][]; }

/** Baked <a:t> text of a shape, concatenated + trimmed (for chrome number/STEP detection). */
function bakedText(shapeXml: string): string {
  return (shapeXml.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((m) => m.replace(/<\/?a:t>/g, "")).join("").trim();
}

const CHROME_BAKED = /^(step\s*)?\d+$/i; // "1", "STEP 1"
const CHROME_NAME = /番号|step|no\.?$/i; // NOT /ラベル/: KPIラベル is a HEADING, only STEP/番号 are chrome

/**
 * Detect whether a layout is a repeated-GROUP layout (card/step/kpi/compare) purely from geometry, and
 * return its column×slot shape (each slot tagged chrome/picture/heading/body). Returns null for a plain
 * content/columns layout — the caller then falls back to bindContentByRole. On-demand only; never stored
 * in the catalog (CatalogEntry stays as ADR-0011 froze it).
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
    let headingDone = false;
    return sorted.map((p, i): GroupSlot => {
      const t = p.type.toLowerCase();
      let role: GroupSlotRole;
      if (t === "pic") role = "picture";
      else if (i === 0 && (CHROME_BAKED.test(bakedText(p.shapeXml)) || CHROME_NAME.test(p.name))) {
        role = "chrome";
        chromeBaked = bakedText(p.shapeXml);
      } else if (!headingDone) { role = "heading"; headingDone = true; }
      else role = "body";
      return { phIdx: p.idx, role, y: p.style.y };
    });
  });

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

/**
 * Fill a grouped layout from a Slice-A SlideIR (groupKind + placeholders idx 1..N, each = [heading] +
 * body paras). Returns the SAME Map<layoutPhIdx, PlaceholderContent> shape as bindContentByRole, so the
 * preview + export loops consume it unchanged. Empty when the slide isn't grouped or the layout isn't a
 * group layout (the caller falls back to bindContentByRole).
 *
 * CRITICAL (1:1 non-breakage): title/subtitle/meta are bound by calling bindContentByRole on a
 * NON-GROUP subset (group content idx 1-9 removed, group placeholders removed) — so the canonical binder
 * never encounters a group cell (idx13-24) nor group content, and runs byte-identical. This module
 * never modifies slideIdxRole / placeholderRole / buildFieldMap.
 */
export function expandGroups(slide: SlideIR, layout: LayoutInfo): Map<string, PlaceholderContent> {
  const out = new Map<string, PlaceholderContent>();
  const shape = detectGroups(layout);
  if (!shape || !slide.groupKind) return out;

  const isGroupIdx = (i: string) => /^[1-9]$/.test(i);
  const groupPhIdxs = new Set(shape.groups.flat().map((s) => s.phIdx));

  // (a) title/subtitle/meta — bindContentByRole on the non-group subset (byte-identical canonical path).
  const metaSlide: SlideIR = { ...slide, placeholders: slide.placeholders.filter((c) => !isGroupIdx(c.idx)) };
  const metaLayoutPhs = layout.placeholders.filter((p) => !groupPhIdxs.has(p.idx));
  for (const [k, v] of bindContentByRole(metaSlide, metaLayoutPhs)) out.set(k, v);

  // (b) group content idx 1..N → column slots (heading / body / chrome).
  const contentGroups = slide.placeholders.filter((c) => isGroupIdx(c.idx)).sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
  const phByIdx = new Map(layout.placeholders.map((p) => [p.idx, p] as const));
  const n = Math.min(shape.groups.length, contentGroups.length); // overflow → extras dropped (decision ②)
  for (let i = 0; i < n; i++) {
    const col = shape.groups[i];
    const c = contentGroups[i];
    const headParas = c.paragraphs.filter((p) => p.heading);
    const bodyParas = c.paragraphs.filter((p) => !p.heading);
    const headSlot = col.find((s) => s.role === "heading");
    const bodySlots = col.filter((s) => s.role === "body");
    const chromeSlot = col.find((s) => s.role === "chrome");

    if (headSlot && headParas.length)
      out.set(headSlot.phIdx, { idx: headSlot.phIdx, paragraphs: headParas.map((p) => ({ ...p, heading: false })) });

    if (bodySlots.length === 1) {
      if (bodyParas.length) out.set(bodySlots[0].phIdx, { idx: bodySlots[0].phIdx, paragraphs: bodyParas });
    } else if (bodySlots.length >= 2) {
      // KPI: para0 → 数値枠, para1.. → 補足枠 (fill each slot, spilling extras into the last).
      const buckets: Paragraph[][] = bodySlots.map(() => []);
      bodyParas.forEach((p, j) => buckets[Math.min(j, buckets.length - 1)].push(p));
      bodySlots.forEach((s, j) => { if (buckets[j].length) out.set(s.phIdx, { idx: s.phIdx, paragraphs: buckets[j] }); });
    }

    // chrome number → EDITABLE slide content (decision ③), preserving the baked format's number
    // ("1"→"i+1", "STEP 1"→"STEP i+1"). Empty groups get no chrome → clean.
    if (chromeSlot) {
      const baked = bakedText(phByIdx.get(chromeSlot.phIdx)?.shapeXml ?? "");
      const num = String(i + 1);
      const text = /\d/.test(baked) ? baked.replace(/\d+/, num) : num;
      out.set(chromeSlot.phIdx, { idx: chromeSlot.phIdx, paragraphs: [{ segments: [{ text }] }] });
    }
    // picture slots: no entry → inherited (a Markdown deck can't fill an image).
  }
  return out;
}
