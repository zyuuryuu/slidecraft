/**
 * template-catalog.ts — Derive a semantic catalog from the loaded slide master.
 *
 * The harness must work with ANY template, not just the canonical one. Instead of
 * hard-coding layout names + placeholder idxs, we introspect the template into a
 * catalog: each layout gets a ROLE (title/section/content/columns/…) and each
 * placeholder a ROLE (title/subtitle/body/date/…). The DeckPlan binder then maps
 * template-agnostic intent → the best layout + the right placeholders, so the
 * model's job stays tiny and stable while the engine adapts to the master.
 *
 * Read-only: no schema change, no mutation of the template.
 */

import type { LayoutInfo, PlaceholderInfo, TemplateData } from "./template-loader";
import { detectGroups } from "./group-layout";
import { isChromeBand } from "./master-scorer";

export type LayoutRole =
  | "title"
  | "section"
  | "content"
  | "columns"
  | "kpi"
  | "chart"
  | "table"
  | "compare"
  | "process"
  | "summary"
  | "closing"
  | "code"
  | "other";

export type PlaceholderRole =
  | "title"
  | "subtitle"
  | "body"
  | "category"
  | "date"
  | "footer"
  | "slideNumber"
  | "picture"
  | "chart"
  | "table"
  | "other";

export interface CatalogPlaceholder {
  idx: string;
  role: PlaceholderRole;
  order: number; // 1-based order among same-role placeholders (body 1, 2, 3…)
  /** Rough full-width char capacity at the template's font (for split/warn, NOT shrink). */
  capacity: number;
  charsPerLine: number; // full-width chars per line at the template's font
  maxLines: number; // lines that fit the box height
}

export interface CatalogEntry {
  name: string;
  role: LayoutRole;
  bodyCount: number; // number of "body" content regions
  hasTitle: boolean;
  hasSubtitle: boolean;
  placeholders: CatalogPlaceholder[];
  // Repeated-GROUP layout (card/step/kpi/compare) — for routing a slide.groupKind slide. Additive:
  // does NOT affect role/bodyCount/placeholders, so buildFieldMap / the 1:1 bijection are untouched.
  groupKind?: "card" | "step" | "kpi" | "compare";
  groupCount?: number; // number of groups (columns)
}

export type LayoutCatalog = CatalogEntry[];

// ── Role inference ──

const FAMILY_TO_ROLE: Record<string, LayoutRole> = {
  title: "title",
  section: "section",
  sectionnav: "section",
  sectionbreak: "section",
  content: "content",
  column: "columns",
  kpi: "kpi",
  chart: "chart",
  table: "table",
  compare: "compare",
  process: "process",
  summary: "summary",
  closing: "closing",
};

/** Layout role from its name's family (the part before the first "."). */
export function layoutRole(name: string): LayoutRole {
  const family = name.split(".")[0]?.toLowerCase() ?? "";
  return FAMILY_TO_ROLE[family] ?? "other";
}

/**
 * Does this master follow SlideCraft's idx-META convention (idx 10/11/12→category/date/footer,
 * 15/16→title/subtitle for body-typed placeholders)? True for our OWN masters:
 *  (a) canonical dotted "Family.Detail" names, OR
 *  (b) template-writer output — it always emits explicit sldNum/dt/ftr meta placeholders.
 * A bare third-party PowerPoint master (e.g. CX Sample: plain names AND no typed sldNum/dt/ftr) has
 * NEITHER, so it opts out and its body-typed idx-10..16 placeholders read as real CONTENT — the fix
 * that makes such a master's content slides bind + preview follow. Stamped onto each PlaceholderInfo
 * at load so the context-free placeholderRole can honor it. Empty/no-layout ⇒ true (safe default).
 */
export function usesMetaIdxConvention(layouts: ReadonlyArray<{ name: string; placeholders: PlaceholderInfo[] }>): boolean {
  if (layouts.length === 0) return true;
  const half = layouts.length / 2;
  const dotted = layouts.filter((l) => layoutRole(l.name) !== "other").length;
  if (dotted >= half) return true;
  const typedMeta = layouts.filter((l) =>
    l.placeholders.some((p) => {
      const t = p.type.toLowerCase();
      return t === "sldnum" || t === "dt" || t === "ftr";
    }),
  ).length;
  return typedMeta >= half;
}

// Real-world templates name layouts in plain language ("Title and Content",
// "Two Columns", "Section Header") — NOT the canonical "Family.Detail" convention.
// Recognize those keywords so the harness classifies ANY template, not just ours.
// English AND Japanese keywords (real templates are often localized). Only title/section/closing get
// keywords here — content vs columns is decided by STRUCTURE (body count/geometry), so e.g. a
// 「本文（1カラム）」 vs 「本文（2カラム）」 isn't forced by the word カラム.
/** Closing-slide vocabulary — the SINGLE source shared by the layout classifier (NAME_KEYWORDS below)
 *  AND the slide→role classifier (slideRoleRegions' isClosing), so both halves of the pipeline agree
 *  on what "closing" means. Word-anchored (\b) English + JA tokens. */
export const CLOSING_RE = /\bclos|\bthank|\bwrap.?up\b|\bnext steps?\b|まとめ|結び|おわりに|謝辞|ご清聴|質疑/i;

const NAME_KEYWORDS: Array<[RegExp, LayoutRole]> = [
  [/\b(?:two|three|four|2|3|4|multi)\b[\s\S]*\b(?:column|content|panel|box|option)\b|compar|versus|\bvs\b/i, "columns"],
  [/\bcolumn\b/i, "columns"],
  [/\bsection\b|\bdivider\b|\bchapter\b|\bagenda\b|章扉|セクション|区切り|中扉/i, "section"],
  [/\bcode\b|\blog\b|\bsource\b|コード|ログ|ソース/i, "code"],
  [CLOSING_RE, "closing"],
  [/\bcontent\b|\bbody\b|\bbullet|\btext\b/i, "content"],
  [/\btitle\b|\bcover\b|\bopening\b|\bintro\b|\bheader\b|表紙|タイトル|扉絵/i, "title"],
];

function nameKeywordRole(name: string): LayoutRole {
  for (const [re, role] of NAME_KEYWORDS) if (re.test(name)) return role;
  return "other";
}

type Box = { x: number; y: number; w: number; h: number };

/** Two body boxes are "columns peers": side-by-side, top-aligned, comparable size, and each
 *  big enough to be real content (excludes logo/decoration strips). Needs real geometry. */
function isPeer(a: Box, b: Box): boolean {
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false; // inherited xfrm — can't judge
  const minW = Math.min(a.w, b.w), maxW = Math.max(a.w, b.w);
  const minH = Math.min(a.h, b.h), maxH = Math.max(a.h, b.h);
  const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  return (
    overlapX < 0.25 * minW && // horizontally separated (not stacked)
    Math.abs(a.y - b.y) < 0.8 && // top-aligned
    minH >= 0.65 * maxH && // similar height
    minW >= 0.45 * maxW && // comparable width (excludes primary+sidebar, ratio ~0.37)
    minW >= 0.15 * SLIDE_W_IN && minH >= 0.15 * SLIDE_H_IN // each big enough (excludes logo strips)
  );
}
/** Size of the largest mutually-peer body group (n ≤ ~4, so O(n²) is fine). */
function peerBodyCount(boxes: Box[]): number {
  let best = boxes.length > 0 ? 1 : 0;
  for (let i = 0; i < boxes.length; i++) {
    let count = 1;
    for (let j = 0; j < boxes.length; j++) if (i !== j && isPeer(boxes[i], boxes[j])) count++;
    best = Math.max(best, count);
  }
  return best;
}

/** Structure-only role from the placeholder composition (the name-agnostic backbone). With
 *  body GEOMETRY, "columns" requires ≥2 side-by-side PEER bodies (so a 1-title+1-body or a
 *  primary+sidebar layout is "content", not "columns"); without geometry, the legacy
 *  bodyCount≥2 rule is kept for back-compat. */
function structureRole(hasTitle: boolean, hasSubtitle: boolean, bodyCount: number, bodyBoxes?: Box[]): LayoutRole {
  const isColumns = bodyBoxes && bodyBoxes.length >= 2 ? peerBodyCount(bodyBoxes) >= 2 : bodyCount >= 2;
  if (isColumns) return "columns";
  if (bodyCount >= 1) return "content"; // non-column body(s) → content
  if (hasSubtitle) return "title"; // a no-body cover usually carries a subtitle
  if (hasTitle) return "section"; // title-only, no body → a divider
  return "other";
}

/**
 * Classify a layout robustly for ANY template: the canonical dotted convention
 * first, then plain-language name keywords, then the placeholder STRUCTURE as the
 * name-agnostic fallback. Canonical layouts keep their exact role (step 1).
 */
export function classifyLayout(
  name: string,
  info: { hasTitle: boolean; hasSubtitle: boolean; bodyCount: number; bodyBoxes?: Box[] },
): LayoutRole {
  const byName = layoutRole(name);
  if (byName !== "other") return byName; // T1: canonical dotted family — authoritative, byte-identical
  const struct = structureRole(info.hasTitle, info.hasSubtitle, info.bodyCount, info.bodyBoxes);
  const byKeyword = nameKeywordRole(name);
  // GATE 1 (ADR-0025-style, GEOMETRY-BACKED): ≥2 genuine side-by-side PEER bodies are unambiguously
  // columns, so they override a misleading non-columns name (a 2-col layout named "Section"/"Agenda").
  // Keyed on peer GEOMETRY (not bare bodyCount), so a stacked / primary+sidebar / no-geometry 2-body
  // layout is NEVER forced to columns.
  if (info.bodyBoxes && peerBodyCount(info.bodyBoxes) >= 2 && byKeyword !== "columns") return "columns";
  // GATE 2: a "columns" NAME with <2 real bodies falls back to structure — a 1-body layout mislabeled
  // "columns" would otherwise be picked for a 2-column slide and silently drop the 2nd column on bind.
  if (byKeyword === "columns" && struct !== "columns") return struct;
  if (byKeyword !== "other") return byKeyword; // T2: keyword
  return struct; // T3: structure (name-agnostic backbone)
}

// Slide geometry facts (inches, 16:9 13.333×7.5) — kept LOCAL so this pure role module
// stays lean (no import of the heavy layout-engine). Cross-ref: layout-engine.ts SLIDE_*.
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;

/** Best-effort role from POSITION/size — a BONUS recovery tier for type-stripped masters
 *  that still carry explicit xfrm (e.g. canonical). Returns null when geometry is absent
 *  (inherited xfrm → w/h 0, the common real-world case) or the box is large/central (left
 *  to the area→body fallback), so it never misfires on a healthy or geometry-less master. */
function geometryRole(
  s: { x: number; y: number; w: number; h: number },
  sw: number = SLIDE_W_IN,
  sh: number = SLIDE_H_IN,
): PlaceholderRole | null {
  // F0b (§2 部品0): thresholds are RATIOS of the slide dims. sw/sh default to canonical 16:9, so a
  // 16:9 master (slideSize not stamped) is byte-identical; a non-16:9 master passes its real size.
  if (s.w <= 0 || s.h <= 0) return null; // inherited xfrm — no geometry to judge
  const lowStrip = s.h <= 0.08 * sh && s.y >= 0.82 * sh; // 0.08*7.5=0.6 (byte-identical at 16:9)
  if (lowStrip && s.w <= 0.25 * sw && s.x >= 0.6 * sw) return "slideNumber";
  if (lowStrip && s.x <= 0.3 * sw) return "date";
  if (lowStrip) return "footer";
  if (s.y <= 0.18 * sh && s.w >= 0.55 * sw && s.h <= 0.22 * sh) return "title";
  if (s.y <= 0.42 * sh && s.w >= 0.5 * sw && s.h <= 0.18 * sh) return "subtitle";
  return null;
}

// Placeholder NAME keywords — the LAST-RESORT signal (the probe proved names are noise for
// binding, so this sits BELOW geometry). JA + EN. Subtitle before title (so "subtitle" never
// matches the title rule).
const PH_NAME_ROLE: Array<[RegExp, PlaceholderRole]> = [
  [/subtitle|サブ|副題/i, "subtitle"],
  [/title|見出し|タイトル|表題/i, "title"],
  [/category|カテゴリ/i, "category"],
  [/slide.?num|page.?num|ページ番号/i, "slideNumber"],
  [/footer|フッ?ター/i, "footer"],
  [/date|日付/i, "date"],
  [/body|content|本文|コンテンツ|箇条/i, "body"],
];
function nameRole(name: string): PlaceholderRole | null {
  for (const [re, r] of PH_NAME_ROLE) if (re.test(name)) return r;
  return null;
}

/**
 * Placeholder role from its PPTX type, idx conventions as refinement, then a RECOVERY
 * ladder (geometry → name → area) reached ONLY when the type is "" (a typeless ph, the
 * loader no longer fakes "body") AND the idx is non-conventional. Every explicit-type /
 * conventional-idx branch returns exactly as before → healthy masters are byte-identical.
 */
export function placeholderRole(ph: PlaceholderInfo): PlaceholderRole {
  // ADR-0025: a load-time role resolved by the gated title recovery (recoverLayoutTitle) wins over
  // the context-free ladder, so binding/catalog/fieldMap all see the SAME promoted role (bijection).
  if (ph.resolvedRole) return ph.resolvedRole;
  const t = ph.type.toLowerCase();
  const idx = ph.idx;
  // Explicit placeholder TYPE is authoritative — it must win over the idx convention (a template
  // whose footer is type="ftr" at idx 11 must be footer, not "date" from the idx-11 rule).
  if (t.includes("ctrtitle") || t === "title") return "title";
  if (t.includes("subtitle")) return "subtitle";
  if (t === "sldnum") return "slideNumber";
  if (t === "dt") return "date";
  if (t === "ftr") return "footer";
  if (t === "pic") return "picture";
  if (t === "chart") return "chart";
  if (t === "tbl") return "table";
  if (idx === "50") return "slideNumber"; // universal slide-number convention (never a content body)
  // idx-META CONVENTION — SlideCraft's OWN encoding (canonical: category/date/footer/title/subtitle
  // meta are body-typed at these idxs; template-writer output matches). ONLY applied when the loaded
  // master opts in (usesMetaIdxConvention → stamped on each ph). A bare third-party master (CX Sample:
  // no dotted names, no typed sldNum/dt/ftr) opts OUT, so its body#10/11/12/13/16 read as REAL content
  // below, not meta — which is what makes its content slides bind + preview follow. Undefined ⇒ true,
  // so synthetic/test placeholders and canonical masters are byte-identical.
  if (ph.metaIdxConvention ?? true) {
    if (idx === "11") return "date";
    if (idx === "12") return "footer";
    if (idx === "10") return "category";
    if (idx === "15") return "title";
    if (idx === "16") return "subtitle";
  }
  if (t === "body") {
    // AI-Import P1 (docs/design/ai-import.md §4-A): a body-TYPED placeholder that is geometrically a
    // footer-band strip (a rule / footer / label — e.g. body@30 at y=6.7 h=0.3 on EVERY layout) is a
    // design/meta element, NOT content. Reclassify by geometry so it doesn't inflate bodyCount, skew
    // column detection, or steal binding. GATED to geometryRole's meta band (thin + very bottom) — a
    // real content body (taller / higher) yields null here and stays "body". Title/subtitle promotion
    // is left to the gated recoverLayoutTitle, so only the 3 unambiguous META roles trigger.
    const gm = geometryRole(ph.style, ph.slideSize?.w, ph.slideSize?.h);
    if (gm === "footer" || gm === "date" || gm === "slideNumber") return gm;
    return "body"; // a REAL body type
  }
  if (/^\d+$/.test(idx) && Number(idx) >= 1 && Number(idx) <= 9) return "body"; // conventional body idx
  // ── RECOVERY (only a typeless ph with a non-conventional idx falls through to here) ──
  const g = geometryRole(ph.style, ph.slideSize?.w, ph.slideSize?.h); // T3 geometry (bonus; null when xfrm inherited)
  // A meta STRIP recovers first and is ORDER-CRITICAL: a bottom footer/date/番号 strip IS itself a chrome
  // band, so letting the chrome guard below run first would strip 127 corpus placeholders (Midnight/velis,
  // via type-loss) of their meta role → editor fields on slide-number strips + template-repair candidates.
  if (g === "footer" || g === "date" || g === "slideNumber") return g;
  // #96: a chrome band (tiny font × edge-hugging) is DECORATION — never a content/heading role. The scorer
  // already calls this band "chrome"; the ladder used to call a wide one "title" (geometryRole's title
  // pattern can't tell a title from a running header), so the layout looked like it already HAD a title →
  // both title recoveries were gated off → the real heading was never restored and the deck title went
  // unbound. Gating T3-title/subtitle, T4 name AND T5 area TOGETHER is required: a header named
  // 「資料タイトル」 reproduces the same bug through nameRole, so a geometry-only guard is not enough.
  // "other" (not "footer") is deliberate — contentIdxForPlaceholder maps footer→idx 12, which would write
  // the deck's FOOTER text into a TOP header band (a new mis-injection). "other" attracts no canonical
  // content yet keeps the band hand-editable via Pass-1 idx-exact (the 資料番号=13 precedent).
  if (isChromeBand(ph.style, ph.slideSize?.h)) return "other";
  if (g) return g;
  const n = nameRole(ph.name); // T4 name keyword (last resort)
  if (n) return n;
  if (ph.style.w > 0 && ph.style.h > 0 && ph.style.w * ph.style.h >= 1.0) return "body"; // T5 area
  return "other";
}

/**
 * ADR-0025 — GATED title recovery over ONE layout's placeholders. `title` is a critical layout
 * attribute, so identify it by every means; but names are noise for binding, so promotion is gated:
 *
 *   - fires ONLY when the layout has NO title-role placeholder (can never steal a real title →
 *     healthy templates are byte-identical, since they carry a title type/idx),
 *   - only a PROMOTABLE box (base role body/other — never a meta role like date/footer/subtitle),
 *   - CONSENSUS: the name must say "title" (nameRole excludes subtitle) AND it must sit at idx 0
 *     (PowerPoint's title slot) OR have title geometry (top band, wide, short).
 *   - never a chrome band (#96) — see below.
 *
 * Mutates the winner's `resolvedRole` so every role consumer (bind/catalog/fieldMap) agrees.
 * Idempotent: a second call sees the promoted title via the gate and no-ops. Pure (R2).
 */
export function recoverLayoutTitle(placeholders: PlaceholderInfo[]): void {
  if (placeholders.some((p) => placeholderRole(p) === "title")) return; // gate: a real title exists
  let best: PlaceholderInfo | null = null;
  let bestScore = -1;
  for (const p of placeholders) {
    // #96: a chrome band is never the title. Load-bearing BECAUSE of the recovery-tier fix above: it
    // resolves a band to "other", which is exactly this loop's promotable set — so a running header named
    // 「資料タイトル」 at idx 0 would satisfy name ∧ idx0 and be promoted, re-creating #96 (the layout would
    // look titled → the real heading never restored). isChromeBand is pure and reads no load-time stamp, so
    // this holds wherever recoverLayoutTitle runs.
    if (isChromeBand(p.style, p.slideSize?.h)) continue;
    const base = placeholderRole(p);
    if (base !== "body" && base !== "other") continue; // promotable, non-meta only
    if (nameRole(p.name) !== "title") continue; // name says title (nameRole checks subtitle first)
    const idx0 = p.idx === "0";
    const geo = geometryRole(p.style, p.slideSize?.w, p.slideSize?.h) === "title";
    if (!idx0 && !geo) continue; // consensus: name AND (idx0 OR title geometry)
    const score = (idx0 ? 2 : 0) + (geo ? 1 : 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  if (best) best.resolvedRole = "title";
}

/**
 * #125 — GATED subtitle recovery, the subtitle twin of recoverLayoutTitle (ADR-0025 left it as YAGNI;
 * a probe of type-stripped covers then measured the hole). On a COVER (ctrTitle), a subtitle box that
 * is body-typed or typeless reads as role "body", which is worse than a lost title: the deck's
 * subtitle goes unbound AND the box eats the bullets.
 *
 * The root cause is an ASYMMETRY between the two sides of binding, not a missing heuristic: the
 * content side (slideIdxRole) already says "on a ctrTitle layout, idx 1 IS the subtitle", while the
 * layout side reads type="body" / idx 1–9 as absolute. This restores the symmetry, so both sides
 * agree and the pair round-trips (ADR-0011 bijection).
 *
 * Gates, mirroring ADR-0025:
 *   - the layout has a ctrTitle (a cover) AND no subtitle role at all → a REAL subtitle is never
 *     stolen. Every healthy cover carries a subTitle type, so this fires 0× across the corpus and
 *     bundled output is unchanged.
 *   - promotes ONE box: idx "1", PowerPoint's subtitle slot — the same convention slideIdxRole uses.
 *   - only a promotable base role (body/other) — a meta role (date/footer/…) is inviolable.
 *   - never a chrome band (#96): a decoration band is not a subtitle.
 *
 * Why the idx convention and NOT geometry: on the real corpus, "below the title, short, smaller font"
 * cannot separate a subtitle from CX Sample's quote-attribution line (ctrTitle quote + body idx=11 at
 * y=6.04), which ADR-0023 deliberately binds as CONTENT — a geometry rung would silently re-role it.
 * The idx-1 convention is the signal that carries actual authorial intent here.
 *
 * Mutates the winner's `resolvedRole` so every consumer (bind/catalog/fieldMap) agrees. Idempotent:
 * a second call sees the promoted subtitle via the gate and no-ops. Pure (R2).
 */
export function recoverLayoutSubtitle(placeholders: PlaceholderInfo[]): void {
  if (!placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle"))) return; // gate: covers only
  if (placeholders.some((p) => placeholderRole(p) === "subtitle")) return; // gate: a real subtitle exists
  const cand = placeholders.find((p) => p.idx === "1"); // the cover's subtitle slot (≤1 by construction)
  if (!cand || isChromeBand(cand.style, cand.slideSize?.h)) return;
  const base = placeholderRole(cand);
  if (base !== "body" && base !== "other") return; // promotable, non-meta only
  cand.resolvedRole = "subtitle";
}

/**
 * Rough fit box: full-width chars per line × lines that fit the box at its font
 * (conservative, full-width assumption). For deciding "too much → split/warn",
 * NOT for shrinking. Half-width (latin) text fits more, so this errs toward early
 * splitting rather than overflow.
 */
export function placeholderFitBox(style: { w: number; h: number; fontSize: number }): {
  charsPerLine: number;
  maxLines: number;
} {
  const fontIn = style.fontSize / 72;
  if (fontIn <= 0) return { charsPerLine: 0, maxLines: 0 };
  const pad = 0.1;
  const charsPerLine = Math.floor(Math.max(style.w - 2 * pad, 0) / fontIn);
  const maxLines = Math.floor(Math.max(style.h - 2 * pad, 0) / (fontIn * 1.2));
  return { charsPerLine, maxLines };
}

export function placeholderCapacity(style: { w: number; h: number; fontSize: number }): number {
  const { charsPerLine, maxLines } = placeholderFitBox(style);
  return Math.max(0, charsPerLine * maxLines);
}

/**
 * Role of a SlideIR content placeholder from its (canonical) idx convention.
 * The SlideIR has no PPTX `type`, so we map by idx: 0/15=title, 16=subtitle,
 * 1=body (or subtitle on a title slide), 2-9=body, 10=category, 11=date,
 * 12=footer, 50=slideNumber. Lets injection bind by ROLE into any template.
 */
export function slideIdxRole(idx: string, hasCtrTitle: boolean): PlaceholderRole {
  switch (idx) {
    case "0":
    case "15":
      return "title";
    case "16":
      return "subtitle";
    case "1":
      return hasCtrTitle ? "subtitle" : "body";
    case "10":
      return "category";
    case "11":
      return "date";
    case "12":
      return "footer";
    case "50":
      return "slideNumber";
    default:
      return /^\d+$/.test(idx) && Number(idx) >= 2 && Number(idx) <= 9 ? "body" : "other";
  }
}

function catalogEntry(layout: LayoutInfo): CatalogEntry {
  const roleCounts: Record<string, number> = {};
  const placeholders: CatalogPlaceholder[] = layout.placeholders
    .map((ph) => {
      const role = placeholderRole(ph);
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
      const { charsPerLine, maxLines } = placeholderFitBox(ph.style);
      return {
        idx: ph.idx,
        role,
        order: roleCounts[role],
        capacity: Math.max(0, charsPerLine * maxLines),
        charsPerLine,
        maxLines,
      };
    })
    .sort((a, b) => (a.idx.length - b.idx.length) || a.idx.localeCompare(b.idx));

  const bodyCount = placeholders.filter((p) => p.role === "body").length;
  const hasTitle = placeholders.some((p) => p.role === "title");
  const hasSubtitle = placeholders.some((p) => p.role === "subtitle");
  // Body geometry lets classifyLayout tell true side-by-side columns from a primary+sidebar
  // or 1-body content layout (only matters on the name-less/degraded path).
  const bodyBoxes = layout.placeholders
    .filter((ph) => placeholderRole(ph) === "body")
    .map((ph) => ({ x: ph.style.x, y: ph.style.y, w: ph.style.w, h: ph.style.h }));
  const shape = detectGroups(layout); // geometric group detection (on-demand; never mutates the above)
  return {
    name: layout.name,
    role: classifyLayout(layout.name, { hasTitle, hasSubtitle, bodyCount, bodyBoxes }),
    bodyCount,
    hasTitle,
    hasSubtitle,
    placeholders,
    ...(shape ? { groupKind: shape.kind, groupCount: shape.groups.length } : {}),
  };
}

/** Build the semantic catalog for a loaded template (one entry per layout). */
export function buildCatalog(template: TemplateData): LayoutCatalog {
  return template.layouts.map(catalogEntry);
}

// ── Layout selection (used by the binder) ──

/**
 * Pick the best layout for a desired role and number of content regions, from
 * whatever the template actually offers. Prefers an exact body-count match and
 * the simplest variant (fewest "+addon" sections).
 */
// ── Acceptance gate (Initialize health) ──

export type HealthStatus = "ok" | "degraded" | "rejected";
export interface HealthFinding {
  code: string;
  level: "block" | "warn" | "info";
  message: string; // JP, user-facing
}
export interface TemplateHealth {
  status: HealthStatus;
  findings: HealthFinding[];
  usableKinds: string[]; // the slide kinds this master can actually express
}

/** Slide kinds THIS master can actually express (role-gated) — shared by the gate + the
 *  AI prompts so we advertise only what the template supports. */
export function templateKinds(catalog: LayoutCatalog): string[] {
  const roles = new Set(catalog.map((e) => e.role));
  const maxCols = Math.max(0, ...catalog.filter((e) => e.role === "columns").map((e) => e.bodyCount));
  const kinds = ["title"];
  if (roles.has("section")) kinds.push("section");
  kinds.push("content");
  if (maxCols >= 2) kinds.push("columns");
  if (roles.has("table")) kinds.push("table");
  if (catalog.some((e) => e.bodyCount >= 1)) kinds.push("diagram"); // a figure rides a content body
  if (roles.has("code")) kinds.push("code");
  if (roles.has("closing")) kinds.push("closing");
  return kinds;
}

/**
 * Acceptance gate: judge a loaded master OK / DEGRADED / REJECTED, AFTER role recovery.
 * LENIENT by design — blocks ONLY on the two structural minima (a title role AND a body
 * role must exist SOMEWHERE in the catalog), keyed on ROLE, never on names / idx / layout
 * count — so it cannot false-reject an unusual-but-valid master (a minimalist or non-JP
 * master whose title/body come from TYPE all pass). Everything else proceeds as degraded.
 * Pure (R2). The caller surfaces a rejection (GUI parseError / MCP throw) — never silent.
 */
export function assessTemplateHealth(catalog: LayoutCatalog): TemplateHealth {
  const findings: HealthFinding[] = [];
  const hasTitle = catalog.some((e) => e.hasTitle);
  const hasBody = catalog.some((e) => e.bodyCount >= 1);
  if (!hasTitle)
    findings.push({ code: "NO_TITLE_ROLE", level: "block", message: "タイトル枠が見つかりません（プレースホルダが種別 type を持っていない可能性）。PowerPoint で開いて再保存すると改善する場合があります。" });
  if (!hasBody)
    findings.push({ code: "NO_BODY_ROLE", level: "block", message: "本文（body）枠が見つかりません。コンテンツスライドを作成できません。別のテンプレートをお使いください。" });

  // Capacity caution — a body box whose geometry is inherited from the master has unknown
  // capacity (usable, just unverifiable). Common + fine; NEVER a block.
  const hasUsableBody = catalog.some((e) => e.placeholders.some((p) => p.role === "body" && p.charsPerLine > 0 && p.maxLines > 0));
  if (hasBody && !hasUsableBody)
    findings.push({ code: "BODY_CAPACITY_UNKNOWN", level: "warn", message: "本文枠のサイズがマスター継承で、文字容量を判定できません（通常は問題ありません）。" });

  const blocked = findings.some((f) => f.level === "block");
  const status: HealthStatus = blocked ? "rejected" : !hasUsableBody ? "degraded" : "ok";
  return { status, findings, usableKinds: templateKinds(catalog) };
}

/**
 * A short capability summary of the loaded template, for the deck-generation AI
 * prompt: which slide kinds it offers, the column limit, and rough body capacity.
 * Lets the model use only what THIS template supports and keep slides within
 * capacity (split, don't overflow — we never shrink the template's fonts).
 */
export function deckCapabilities(catalog: LayoutCatalog, health?: HealthStatus): string {
  const kinds = templateKinds(catalog);
  const maxCols = Math.max(0, ...catalog.filter((e) => e.role === "columns").map((e) => e.bodyCount));
  const bodyCap = catalog.find((e) => e.role === "content")?.placeholders.find((p) => p.role === "body")?.capacity ?? 0;

  let s = `This template supports these slide kinds: ${kinds.join(", ")}.`;
  s += maxCols >= 2 ? ` "columns" can have up to ${maxCols}.` : ` It has NO multi-column layout — use "content" instead of "columns".`;
  if (!kinds.includes("table")) s += ` It has NO table layout — present tabular data as bullets, not a "table" slide.`;
  if (bodyCap > 0) {
    s += ` A content slide's body holds roughly ${bodyCap} full-width characters — keep each slide within that and SPLIT into more slides rather than overflowing.`;
  }
  if (health === "degraded") s += ` Note: this template's layout metadata is partial — rely only on the kinds listed above.`;
  return s;
}

export function pickLayout(
  catalog: LayoutCatalog,
  role: LayoutRole,
  regions?: number,
  hasImage?: boolean,
): CatalogEntry | undefined {
  const candidates = catalog.filter((e) => e.role === role);
  if (candidates.length === 0) return undefined;
  const usableBody = (e: CatalogEntry) =>
    e.placeholders.some((p) => p.role === "body" && p.charsPerLine > 0 && p.maxLines > 0);
  const hasPictureFrame = (e: CatalogEntry) => e.placeholders.some((p) => p.role === "picture");
  const score = (e: CatalogEntry): number => {
    let s = e.name.match(/\+/g)?.length ?? 0; // prefer fewer addons
    if (regions !== undefined) s += Math.abs(e.bodyCount - regions) * 10;
    if (hasImage) {
      // An image slide PREFERS a layout with a real picture frame (the image binds there), and does
      // NOT avoid picture/degenerate "bodies" — an image is happy in one (the text-body penalty below
      // would wrongly push it back to a text layout).
      if (hasPictureFrame(e)) s -= 100;
      else if (!usableBody(e)) s += 5; // no picture frame → deterministically prefer a writable body
    } else if ((role === "content" || role === "columns") && !usableBody(e)) {
      // For TEXT roles, avoid picture/degenerate layouts whose "body" holds no text
      // (e.g. an alien template's "Two Pictures" with maxLines=0) — they break split + bind.
      s += 1000;
    }
    if (role === "content" && !/content|body|text/i.test(e.name)) s += 1; // tie-break to an obviously-named one
    return s;
  };
  return [...candidates].sort((a, b) => score(a) - score(b))[0];
}

/**
 * Last-resort body-bearing pick, ROLE-AGNOSTIC — used by autoSelectLayout when no content/columns
 * layout exists, to replace a blind positional `catalog[0]` with a SUITABILITY choice. Ranks any
 * layout that can actually hold the slide's payload (a usable text body, or a picture frame for an
 * image slide) by: closest body-region fit → most usable bodies → fewest addons → name. Returns
 * undefined only when nothing in the template can hold a body (the caller then keeps catalog[0]).
 */
export function bestBodyBearing(catalog: LayoutCatalog, regions?: number, hasImage?: boolean): CatalogEntry | undefined {
  const bodyN = (e: CatalogEntry) => e.placeholders.filter((p) => p.role === "body" && p.charsPerLine > 0 && p.maxLines > 0).length;
  const hasPic = (e: CatalogEntry) => e.placeholders.some((p) => p.role === "picture");
  const cands = catalog.filter((e) => bodyN(e) > 0 || (hasImage && hasPic(e)));
  if (cands.length === 0) return undefined;
  const dist = (e: CatalogEntry) => (regions !== undefined ? Math.abs(bodyN(e) - regions) : 0);
  const addons = (e: CatalogEntry) => e.name.match(/\+/g)?.length ?? 0;
  return [...cands].sort((a, b) => dist(a) - dist(b) || bodyN(b) - bodyN(a) || addons(a) - addons(b) || a.name.localeCompare(b.name))[0];
}
