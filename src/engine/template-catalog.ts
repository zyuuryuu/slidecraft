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

// Real-world templates name layouts in plain language ("Title and Content",
// "Two Columns", "Section Header") — NOT the canonical "Family.Detail" convention.
// Recognize those keywords so the harness classifies ANY template, not just ours.
const NAME_KEYWORDS: Array<[RegExp, LayoutRole]> = [
  [/\b(?:two|three|four|2|3|4|multi)\b[\s\S]*\b(?:column|content|panel|box|option)\b|compar|versus|\bvs\b/i, "columns"],
  [/\bcolumn\b/i, "columns"],
  [/\bsection\b|\bdivider\b|\bchapter\b|\bagenda\b/i, "section"],
  [/\bclos|\bthank|\bwrap.?up\b|\bnext steps?\b/i, "closing"],
  [/\bcontent\b|\bbody\b|\bbullet|\btext\b/i, "content"],
  [/\btitle\b|\bcover\b|\bopening\b|\bintro\b|\bheader\b/i, "title"],
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
  if (byName !== "other") return byName;
  const byKeyword = nameKeywordRole(name);
  if (byKeyword !== "other") return byKeyword;
  return structureRole(info.hasTitle, info.hasSubtitle, info.bodyCount, info.bodyBoxes);
}

// Slide geometry facts (inches, 16:9 13.333×7.5) — kept LOCAL so this pure role module
// stays lean (no import of the heavy layout-engine). Cross-ref: layout-engine.ts SLIDE_*.
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;

/** Best-effort role from POSITION/size — a BONUS recovery tier for type-stripped masters
 *  that still carry explicit xfrm (e.g. canonical). Returns null when geometry is absent
 *  (inherited xfrm → w/h 0, the common real-world case) or the box is large/central (left
 *  to the area→body fallback), so it never misfires on a healthy or geometry-less master. */
function geometryRole(s: { x: number; y: number; w: number; h: number }): PlaceholderRole | null {
  if (s.w <= 0 || s.h <= 0) return null; // inherited xfrm — no geometry to judge
  const lowStrip = s.h <= 0.6 && s.y >= 0.82 * SLIDE_H_IN;
  if (lowStrip && s.w <= 0.25 * SLIDE_W_IN && s.x >= 0.6 * SLIDE_W_IN) return "slideNumber";
  if (lowStrip && s.x <= 0.3 * SLIDE_W_IN) return "date";
  if (lowStrip) return "footer";
  if (s.y <= 0.18 * SLIDE_H_IN && s.w >= 0.55 * SLIDE_W_IN && s.h <= 0.22 * SLIDE_H_IN) return "title";
  if (s.y <= 0.42 * SLIDE_H_IN && s.w >= 0.5 * SLIDE_W_IN && s.h <= 0.18 * SLIDE_H_IN) return "subtitle";
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
  const t = ph.type.toLowerCase();
  const idx = ph.idx;
  if (t.includes("ctrtitle") || t === "title") return "title";
  if (t.includes("subtitle")) return "subtitle";
  if (t === "sldnum" || idx === "50") return "slideNumber";
  if (t === "dt" || idx === "11") return "date";
  if (t === "ftr" || idx === "12") return "footer";
  if (t === "pic") return "picture";
  if (t === "chart") return "chart";
  if (t === "tbl") return "table";
  // Meta fields that are often a generic "body" type but at known idxs.
  if (idx === "10") return "category";
  if (idx === "15") return "title";
  if (idx === "16") return "subtitle";
  if (t === "body") return "body"; // a REAL body type
  if (/^\d+$/.test(idx) && Number(idx) >= 1 && Number(idx) <= 9) return "body"; // conventional body idx
  // ── RECOVERY (only a typeless ph with a non-conventional idx falls through to here) ──
  const g = geometryRole(ph.style); // T3 geometry (bonus; null when xfrm inherited)
  if (g) return g;
  const n = nameRole(ph.name); // T4 name keyword (last resort)
  if (n) return n;
  if (ph.style.w > 0 && ph.style.h > 0 && ph.style.w * ph.style.h >= 1.0) return "body"; // T5 area
  return "other";
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
  return {
    name: layout.name,
    role: classifyLayout(layout.name, { hasTitle, hasSubtitle, bodyCount, bodyBoxes }),
    bodyCount,
    hasTitle,
    hasSubtitle,
    placeholders,
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
): CatalogEntry | undefined {
  const candidates = catalog.filter((e) => e.role === role);
  if (candidates.length === 0) return undefined;
  const usableBody = (e: CatalogEntry) =>
    e.placeholders.some((p) => p.role === "body" && p.charsPerLine > 0 && p.maxLines > 0);
  const score = (e: CatalogEntry): number => {
    let s = e.name.match(/\+/g)?.length ?? 0; // prefer fewer addons
    if (regions !== undefined) s += Math.abs(e.bodyCount - regions) * 10;
    // For text roles, AVOID picture/degenerate layouts whose "body" holds no text
    // (e.g. an alien template's "Two Pictures" with maxLines=0) — they break split + bind.
    if ((role === "content" || role === "columns") && !usableBody(e)) s += 1000;
    if (role === "content" && !/content|body|text/i.test(e.name)) s += 1; // tie-break to an obviously-named one
    return s;
  };
  return [...candidates].sort((a, b) => score(a) - score(b))[0];
}
