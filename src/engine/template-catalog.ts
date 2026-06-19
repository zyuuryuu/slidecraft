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

/** Placeholder role from its PPTX type, with idx conventions as refinement. */
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
  if (t === "body") return "body";
  if (/^\d+$/.test(idx) && Number(idx) >= 1 && Number(idx) <= 9) return "body";
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

  return {
    name: layout.name,
    role: layoutRole(layout.name),
    bodyCount: placeholders.filter((p) => p.role === "body").length,
    hasTitle: placeholders.some((p) => p.role === "title"),
    hasSubtitle: placeholders.some((p) => p.role === "subtitle"),
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
/**
 * A short capability summary of the loaded template, for the deck-generation AI
 * prompt: which slide kinds it offers, the column limit, and rough body capacity.
 * Lets the model use only what THIS template supports and keep slides within
 * capacity (split, don't overflow — we never shrink the template's fonts).
 */
export function deckCapabilities(catalog: LayoutCatalog): string {
  const roles = new Set(catalog.map((e) => e.role));
  const maxCols = Math.max(0, ...catalog.filter((e) => e.role === "columns").map((e) => e.bodyCount));
  const kinds = ["title"];
  if (roles.has("section")) kinds.push("section");
  kinds.push("content");
  if (maxCols >= 2) kinds.push("columns");
  if (roles.has("closing")) kinds.push("closing");

  const bodyCap = catalog.find((e) => e.role === "content")?.placeholders.find((p) => p.role === "body")?.capacity ?? 0;

  let s = `This template supports these slide kinds: ${kinds.join(", ")}.`;
  s += maxCols >= 2 ? ` "columns" can have up to ${maxCols}.` : ` It has NO multi-column layout — use "content" instead of "columns".`;
  if (bodyCap > 0) {
    s += ` A content slide's body holds roughly ${bodyCap} full-width characters — keep each slide within that and SPLIT into more slides rather than overflowing.`;
  }
  return s;
}

export function pickLayout(
  catalog: LayoutCatalog,
  role: LayoutRole,
  regions?: number,
): CatalogEntry | undefined {
  const candidates = catalog.filter((e) => e.role === role);
  if (candidates.length === 0) return undefined;
  const score = (e: CatalogEntry): number => {
    let s = e.name.match(/\+/g)?.length ?? 0; // prefer fewer addons
    if (regions !== undefined) s += Math.abs(e.bodyCount - regions) * 10;
    return s;
  };
  return [...candidates].sort((a, b) => score(a) - score(b))[0];
}
