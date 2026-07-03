/**
 * deck-plan.ts — DeckPlan: the small, intent-level structure the AI emits, plus
 * the deterministic engine that turns it into correct SlideIR.
 *
 * The point (project-wide priority): keep the model's job tiny. It produces a
 * DeckPlan — slide "kind" + plain title/bullets — and the ENGINE owns every
 * structural decision (which layout, which placeholder idx, bold headings,
 * column splitting). A model never has to know the SlideCraft Markdown DSL or
 * the 30 layout names, so even a small/local model can stay on-format.
 */

import { z } from "zod";
import type { DeckIR, SlideIR, PlaceholderContent, Paragraph } from "./slide-schema";
import { parseJsonLoose } from "./json-salvage";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./mermaid-to-diagram";
import { templateKinds, type LayoutCatalog } from "./template-catalog";

/** A Mermaid string → a native diagram block (if it parses) or an image fallback. */
function mermaidToFigure(mmd: string): Pick<SlideIR, "diagram" | "mermaidBlock"> {
  const spec = mermaidToDiagramSpec(mmd);
  if (spec) return { diagram: { yaml: diagramSpecToYaml(spec), placeholderIdx: "1" } };
  return { mermaidBlock: { mermaid: mmd, placeholderIdx: "1" } };
}

// ── DeckPlan schema (what the model returns) ──

const ColumnSchema = z.object({
  heading: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

export const SlidePlanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("title"),
    title: z.string(),
    subtitle: z.string().optional(),
    category: z.string().optional(),
    date: z.string().optional(),
    footer: z.string().optional(),
  }),
  z.object({
    kind: z.literal("section"),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("content"),
    title: z.string(),
    subtitle: z.string().optional(),
    bullets: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("columns"),
    title: z.string(),
    subtitle: z.string().optional(),
    columns: z.array(ColumnSchema).min(2).max(3),
  }),
  z.object({
    kind: z.literal("table"),
    title: z.string(),
    subtitle: z.string().optional(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())).default([]),
  }),
  z.object({
    kind: z.literal("diagram"),
    title: z.string(),
    subtitle: z.string().optional(),
    mermaid: z.string(), // a Mermaid diagram (flowchart / sequence / timeline / pie / gantt / …)
  }),
  z.object({
    kind: z.literal("closing"),
    title: z.string(),
    subtitle: z.string().optional(),
    bullets: z.array(z.string()).default([]),
  }),
]);
export type SlidePlan = z.infer<typeof SlidePlanSchema>;

export const DeckPlanSchema = z.object({
  slides: z.array(SlidePlanSchema).min(1),
});
export type DeckPlan = z.infer<typeof DeckPlanSchema>;

// ── Build helpers ──

function textPh(idx: string, t: string): PlaceholderContent {
  return { idx, paragraphs: [{ segments: [{ text: t }] }] };
}

function bulletParagraphs(items: string[] = []): Paragraph[] {
  return items
    .filter((b) => b.trim().length > 0)
    .map((b) => ({ segments: [{ text: b }], bullet: true }));
}

// ── DeckPlan → SlideIR (the engine owns layout + placeholder mapping) ──

export function slidePlanToSlide(s: SlidePlan): SlideIR {
  switch (s.kind) {
    case "title": {
      const ph: PlaceholderContent[] = [textPh("0", s.title)];
      if (s.subtitle) ph.push(textPh("1", s.subtitle));
      if (s.category) ph.push(textPh("10", s.category));
      if (s.date) ph.push(textPh("11", s.date));
      if (s.footer) ph.push(textPh("12", s.footer));
      return { layout: "Title.1Title.Single", placeholders: ph };
    }
    case "section":
      return { layout: "Section.1Title.Single", placeholders: [textPh("15", s.title)] };
    case "content": {
      const ph: PlaceholderContent[] = [textPh("15", s.title)];
      if (s.subtitle) ph.push(textPh("16", s.subtitle));
      const body = bulletParagraphs(s.bullets);
      if (body.length) ph.push({ idx: "1", paragraphs: body });
      return { layout: "Content.1Body.Single", placeholders: ph };
    }
    case "columns": {
      const ph: PlaceholderContent[] = [textPh("15", s.title)];
      if (s.subtitle) ph.push(textPh("16", s.subtitle));
      s.columns.forEach((col, i) => {
        const paras: Paragraph[] = [];
        if (col.heading) paras.push({ segments: [{ text: col.heading, bold: true }] });
        paras.push(...bulletParagraphs(col.bullets));
        ph.push({
          idx: String(i + 1),
          paragraphs: paras.length ? paras : [{ segments: [{ text: "" }] }],
        });
      });
      const layout = s.columns.length >= 3 ? "Column.3Body.Equal" : "Column.2Body.Equal";
      return { layout, placeholders: ph };
    }
    case "table": {
      const ph: PlaceholderContent[] = [textPh("15", s.title)];
      if (s.subtitle) ph.push(textPh("16", s.subtitle));
      return {
        layout: "Content.1Body.Single",
        placeholders: ph,
        table: { rows: rectangularize([s.headers, ...s.rows]), header: true, placeholderIdx: "1" },
      };
    }
    case "diagram": {
      const ph: PlaceholderContent[] = [textPh("15", s.title)];
      if (s.subtitle) ph.push(textPh("16", s.subtitle));
      return { layout: "Content.1Body.Single", placeholders: ph, ...mermaidToFigure(s.mermaid) };
    }
    case "closing": {
      // Closing = ctrTitle namespace (title idx 0, subtitle idx 1). The message layout has no
      // dedicated body, so a subtitle + any bullets are preserved together in idx 1 (subtitle
      // paragraph first, then bullet paragraphs) — this round-trips through Markdown losslessly.
      const ph: PlaceholderContent[] = [textPh("0", s.title)];
      const secondary: Paragraph[] = [];
      if (s.subtitle) secondary.push({ segments: [{ text: s.subtitle }] });
      secondary.push(...bulletParagraphs(s.bullets));
      if (secondary.length) ph.push({ idx: "1", paragraphs: secondary });
      return { layout: "Closing.1Message.Single", placeholders: ph };
    }
  }
}

/** Pad every row (headers included) to the widest row so a ragged model table becomes a valid
 *  rectangle. Non-lossy: the width is the MAX row length, so no cell is ever truncated. */
function rectangularize(rows: string[][]): string[][] {
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill("")]));
}

/**
 * Degrade a slide the TEMPLATE can't express into content bullets (harness over model): a `table` on a
 * table-less master, `columns` on a columns-less one, or a `diagram` where no body can host a figure,
 * would otherwise be emitted blindly. The DATA is preserved as bullets so nothing is lost.
 */
function degradeForCatalog(s: SlidePlan, kinds: Set<string>): SlidePlan {
  if (s.kind === "table" && !kinds.has("table")) {
    return { kind: "content", title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      bullets: s.rows.map((row) => row.join("：")) };
  }
  if (s.kind === "columns" && !kinds.has("columns")) {
    return { kind: "content", title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      bullets: s.columns.flatMap((c) => (c.heading ? [c.heading, ...c.bullets] : c.bullets)) };
  }
  if (s.kind === "diagram" && !kinds.has("diagram")) {
    return { kind: "content", title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), bullets: [] };
  }
  return s;
}

/** Turn a DeckPlan into SlideIR. With a catalog, unsupported kinds are degraded to what the master can
 *  actually express (deterministic capability gate); without one, every kind is emitted as-is. */
export function deckPlanToDeck(plan: DeckPlan, catalog?: LayoutCatalog): DeckIR {
  const kinds = catalog ? new Set(templateKinds(catalog)) : null;
  const slides = plan.slides.map((s) => slidePlanToSlide(kinds ? degradeForCatalog(s, kinds) : s));
  return { slides };
}

// ── Validation (for model output before we trust it) ──

export type ParseResult =
  | { ok: true; plan: DeckPlan; notices?: string[] }
  | { ok: false; error: string };

export function parseDeckPlan(input: unknown): ParseResult {
  const r = DeckPlanSchema.safeParse(input);
  if (r.success) return { ok: true, plan: r.data };
  return {
    ok: false,
    error: r.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; "),
  };
}

/**
 * Parse + validate a DeckPlan from raw model output (JSON, possibly fenced).
 * RESILIENT: validates slide-by-slide so ONE malformed slide (a weak/drifting
 * model's mistake) can't reject the whole deck — invalid slides are coerced, and
 * a titled-but-still-broken slide degrades to a bare content slide rather than
 * nuking everything. (Deterministic repair: cheaper + more reliable than a model
 * round-trip.)
 */
export function extractDeckPlan(text: string): ParseResult {
  const r = parseJsonLoose(text);
  if (!r.ok) return { ok: false, error: "Invalid JSON: " + r.error };
  const rec = asRecord(r.value);
  const rawSlides: unknown[] = Array.isArray(r.value)
    ? r.value
    : rec && Array.isArray(rec.slides) ? rec.slides
      : rec && Array.isArray(rec.deck) ? rec.deck
        : [];

  const slides: SlidePlan[] = [];
  for (const raw of rawSlides) {
    const sr = SlidePlanSchema.safeParse(coerceSlide(raw));
    if (sr.success) {
      slides.push(sr.data);
      continue;
    }
    const rec2 = asRecord(raw);
    const title = rec2 && rec2.title != null ? String(rec2.title) : "";
    if (title) slides.push({ kind: "content", title, bullets: [] }); // keep the slide, drop the broken body
  }
  // Reject text units poisoned by an unrecoverable character (violation-drop), THEN prune the noise.
  let dropped = 0;
  const stripped = slides.map((s) => {
    const r = stripViolations(s);
    dropped += r.dropped;
    return r.slide;
  });
  const cleaned = cleanupSlidePlans(stripped);
  if (cleaned.length === 0) return { ok: false, error: "No usable slides in the generated plan." };
  const notices = dropped > 0 ? [`書式違反（復元不能な文字）により ${dropped} か所を除外しました。`] : undefined;
  return { ok: true, plan: { slides: cleaned }, ...(notices ? { notices } : {}) };
}

// U+FFFD is json-salvage's marker for an unrecoverable character (a malformed \uXXXX or a lone
// surrogate). It must NEVER reach a slide — treat any text carrying it as a format violation.
const CORRUPT = "�";
const hasCorrupt = (v: string | undefined): boolean => !!v && v.includes(CORRUPT);

/**
 * Drop, at the SMALLEST grain, any text unit poisoned by U+FFFD. A weak model that violated the
 * "raw UTF-8, never \uXXXX" instruction produced untrustworthy text — reject the offending bullet /
 * field (a scalar field is blanked; a list item is removed; a table cell is blanked to keep the grid)
 * rather than ship a `�` marker or a silently-wrong word. Returns the cleaned slide + units dropped.
 */
function stripViolations(s: SlidePlan): { slide: SlidePlan; dropped: number } {
  let dropped = 0;
  const scalar = (v: string): string => {
    if (hasCorrupt(v)) { dropped++; return ""; }
    return v;
  };
  const opt = (v: string | undefined): string | undefined => (v === undefined ? undefined : scalar(v));
  const list = (arr: string[]): string[] => {
    const kept = arr.filter((x) => !hasCorrupt(x));
    dropped += arr.length - kept.length;
    return kept;
  };
  let slide: SlidePlan;
  switch (s.kind) {
    case "title":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle), category: opt(s.category), date: opt(s.date), footer: opt(s.footer) };
      break;
    case "section":
      slide = { ...s, title: scalar(s.title) };
      break;
    case "content":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle), bullets: list(s.bullets) };
      break;
    case "columns":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle),
        columns: s.columns.map((c) => ({ heading: opt(c.heading), bullets: list(c.bullets) })) };
      break;
    case "table":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle),
        headers: s.headers.map(scalar), rows: s.rows.map((r) => r.map(scalar)) };
      break;
    case "diagram":
      // mermaid is structural (a corrupt char can't be removed without breaking syntax) — left intact.
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle) };
      break;
    case "closing":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle), bullets: list(s.bullets) };
      break;
  }
  return { slide, dropped };
}

/** A slide carries no content — pure noise a weak model emitted. Title-only slides are NOT empty
 *  (a title/section IS the content); this only catches slides with neither a title nor a body. */
function isEmptyPlan(s: SlidePlan): boolean {
  if (s.title.trim()) return false;
  switch (s.kind) {
    case "title": return !s.subtitle && !s.category && !s.date && !s.footer;
    case "section": return true; // no title → an empty divider
    case "content": return s.bullets.length === 0 && !s.subtitle;
    case "columns": return s.columns.every((c) => !c.heading && c.bullets.length === 0);
    case "table": return s.headers.length === 0 && s.rows.length === 0;
    case "diagram": return !s.mermaid.trim();
    case "closing": return !s.subtitle && s.bullets.length === 0;
  }
}

/** Drop noise a weak model repeats: empty-title section dividers and slides with no content at all,
 *  and collapse consecutive duplicate section titles (`第1部` / `第1部` → one). Preserves everything
 *  that carries data. */
function cleanupSlidePlans(slides: SlidePlan[]): SlidePlan[] {
  const out: SlidePlan[] = [];
  for (const s of slides) {
    if (isEmptyPlan(s)) continue;
    if (s.kind === "section") {
      const prev = out[out.length - 1];
      if (prev && prev.kind === "section" && prev.title.trim() === s.title.trim()) continue;
    }
    out.push(s);
  }
  return out;
}

export type SlideParseResult =
  | { ok: true; slide: SlidePlan }
  | { ok: false; error: string };

/**
 * Parse + validate ONE slide from raw model output (a single JSON Slide object).
 * Used by per-slide AI edits, where only that slide is sent + returned — far
 * cheaper in tokens than regenerating the whole deck.
 */
export function extractSlidePlan(text: string): SlideParseResult {
  const jr = parseJsonLoose(text);
  if (!jr.ok) return { ok: false, error: "Invalid JSON: " + jr.error };
  const data = jr.value;
  // Tolerate a {slides:[one]} wrapper or a bare slide object.
  const rec = asRecord(data);
  const candidate = rec && Array.isArray(rec.slides) ? rec.slides[0] : data;
  const r = SlidePlanSchema.safeParse(coerceSlide(candidate));
  if (r.success) return { ok: true, slide: stripViolations(r.data).slide };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
  };
}

// ── Deterministic salvage of common weak-model mistakes ──
// Repairs structure in code (cheaper + more reliable than a model round-trip)
// before validation: bare arrays, kind synonyms, missing kinds, string bullets.

const KIND_SYNONYMS: Record<string, string> = {
  title: "title", cover: "title", opening: "title", intro: "title", titleslide: "title",
  section: "section", divider: "section", sectionbreak: "section", sectiondivider: "section",
  content: "content", body: "content", bullets: "content", text: "content",
  point: "content", points: "content", bullet: "content", list: "content",
  columns: "columns", column: "columns", compare: "columns", comparison: "columns",
  versus: "columns", twocolumn: "columns", twocolumns: "columns", threecolumn: "columns", threecolumns: "columns",
  table: "table", grid: "table", matrix: "table", datatable: "table", spreadsheet: "table",
  diagram: "diagram", figure: "diagram", flow: "diagram", flowchart: "diagram", graph: "diagram",
  chart: "diagram", mermaid: "diagram", process: "diagram", timeline: "diagram", architecture: "diagram",
  closing: "closing", close: "closing", end: "closing", ending: "closing", thanks: "closing", thankyou: "closing",
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim().length > 0);
  if (typeof v === "string") {
    return v
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*[-*•・･‣]\s*/, "").trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

// A weak model puts the body under any of these keys — read whichever it used so an
// unknown-kind / off-schema slide keeps its content instead of coercing to an empty one.
const BODY_FIELDS = ["bullets", "body", "content", "text", "points", "items", "lines", "notes"] as const;
function bodyStringArray(s: Record<string, unknown>): string[] {
  for (const k of BODY_FIELDS) {
    if (s[k] != null) {
      const a = toStringArray(s[k]);
      if (a.length) return a;
    }
  }
  return [];
}

function coerceSlide(raw: unknown): unknown {
  const s = asRecord(raw);
  if (!s) return raw;
  const out: Record<string, unknown> = { ...s };

  const rawKind = typeof s.kind === "string" ? s.kind.toLowerCase().replace(/[^a-z]/g, "") : "";
  let kind = KIND_SYNONYMS[rawKind];
  if (!kind) {
    if (Array.isArray(s.headers) || (Array.isArray(s.rows) && Array.isArray((s.rows as unknown[])[0]))) kind = "table";
    else if (typeof s.mermaid === "string") kind = "diagram";
    else if (Array.isArray(s.columns)) kind = "columns";
    else if (s.bullets != null) kind = "content";
    else if (s.subtitle != null || s.category != null || s.footer != null) kind = "title";
    else kind = "content";
  }
  out.kind = kind;

  // Always give a title (empty allowed by the schema) so a titleless-but-content-bearing slide
  // VALIDATES and is kept — instead of failing validation and being dropped by the fallback below.
  out.title = s.title != null ? String(s.title) : "";
  if (s.subtitle != null) out.subtitle = String(s.subtitle);
  if (kind === "content") out.bullets = bodyStringArray(s);
  if (kind === "closing") out.bullets = bodyStringArray(s);
  if (kind === "table") {
    const rows2d = Array.isArray(s.rows) ? (s.rows as unknown[]).map(toStringArray) : [];
    if (Array.isArray(s.headers) && s.headers.length) {
      out.headers = toStringArray(s.headers);
      out.rows = rows2d;
    } else {
      // model put everything in `rows` — first row is the header
      out.headers = rows2d[0] ?? [];
      out.rows = rows2d.slice(1);
    }
  }
  if (kind === "diagram") out.mermaid = String(s.mermaid ?? s.diagram ?? s.figure ?? "");
  if (kind === "columns") {
    const cols = Array.isArray(s.columns)
      ? s.columns.map((c) => {
          const col = asRecord(c) ?? {};
          return {
            heading: col.heading != null ? String(col.heading) : undefined,
            bullets: toStringArray(col.bullets),
          };
        })
      : [];
    if (cols.length >= 2) {
      out.columns = cols;
    } else {
      // a 0/1-column "columns" can't validate (needs ≥2) — flatten to content so
      // the slide (and the whole deck) survives instead of being rejected.
      out.kind = "content";
      out.bullets = cols[0] ? [...(cols[0].heading ? [cols[0].heading] : []), ...cols[0].bullets] : toStringArray(s.bullets);
      delete out.columns;
    }
  }
  return out;
}

/** Normalize loosely-shaped model output toward a valid DeckPlan before zod. */
export function coerceDeckPlanInput(input: unknown): unknown {
  const rec = asRecord(input);
  let slides: unknown[] | null = null;
  if (Array.isArray(input)) slides = input;
  else if (rec && Array.isArray(rec.slides)) slides = rec.slides;
  else if (rec && Array.isArray(rec.deck)) slides = rec.deck;
  if (!slides) return input; // leave it to zod to produce a clear error
  return { slides: slides.map(coerceSlide) };
}

// Prompts live in deck-plan-prompts.ts (R1); re-exported so importers are unchanged.
export * from "./deck-plan-prompts";
