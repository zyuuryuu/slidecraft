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
    kind: z.literal("closing"),
    title: z.string(),
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

function bulletParagraphs(items: string[]): Paragraph[] {
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
    case "closing":
      return { layout: "Closing.1Message.Single", placeholders: [textPh("0", s.title)] };
  }
}

export function deckPlanToDeck(plan: DeckPlan): DeckIR {
  return { slides: plan.slides.map(slidePlanToSlide) };
}

// ── Validation (for model output before we trust it) ──

export type ParseResult =
  | { ok: true; plan: DeckPlan }
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

/** Extract a JSON object or array from raw model text (tolerates ``` fences / prose). */
function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const firstObj = body.indexOf("{");
  const firstArr = body.indexOf("[");
  const start = [firstObj, firstArr].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? -1;
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

/** Parse + validate a DeckPlan from raw model output (JSON, possibly fenced). */
export function extractDeckPlan(text: string): ParseResult {
  const json = extractJsonObject(text);
  if (json === null) return { ok: false, error: "No JSON object found in the response." };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: "Invalid JSON: " + (e instanceof Error ? e.message : String(e)) };
  }
  return parseDeckPlan(coerceDeckPlanInput(data));
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
  const json = extractJsonObject(text);
  if (json === null) return { ok: false, error: "No JSON object found in the response." };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: "Invalid JSON: " + (e instanceof Error ? e.message : String(e)) };
  }
  // Tolerate a {slides:[one]} wrapper or a bare slide object.
  const rec = asRecord(data);
  const candidate = rec && Array.isArray(rec.slides) ? rec.slides[0] : data;
  const r = SlidePlanSchema.safeParse(coerceSlide(candidate));
  if (r.success) return { ok: true, slide: r.data };
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
      .map((s) => s.replace(/^\s*[-*•]\s*/, "").trim())
      .filter((s) => s.length > 0);
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
    if (Array.isArray(s.columns)) kind = "columns";
    else if (s.bullets != null) kind = "content";
    else if (s.subtitle != null || s.category != null || s.footer != null) kind = "title";
    else kind = "content";
  }
  out.kind = kind;

  if (s.title != null) out.title = String(s.title);
  if (kind === "content") out.bullets = toStringArray(s.bullets);
  if (kind === "columns") {
    out.columns = Array.isArray(s.columns)
      ? s.columns.map((c) => {
          const col = asRecord(c) ?? {};
          return {
            heading: col.heading != null ? String(col.heading) : undefined,
            bullets: toStringArray(col.bullets),
          };
        })
      : [];
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

// ── System prompt the model fills (tiny vocabulary — no Markdown DSL) ──

export function deckPlanSystemPrompt(today?: string): string {
  return `You generate a slide deck as a JSON "DeckPlan". Output ONLY the JSON object — no prose, no code fence.

Shape:
{ "slides": [ Slide, ... ] }

Each Slide is exactly one of:
- {"kind":"title","title":"...","subtitle":"...","category":"...","date":"...","footer":"..."}  // opening slide; all but title optional
- {"kind":"section","title":"..."}                                                                // a section divider
- {"kind":"content","title":"...","subtitle":"...","bullets":["...","..."]}                       // a normal slide; subtitle optional
- {"kind":"columns","title":"...","subtitle":"...","columns":[{"heading":"...","bullets":["..."]}, ...]}  // 2 or 3 columns for comparison; subtitle/heading optional
- {"kind":"closing","title":"..."}                                                                // closing message

Rules:
- Write in the SAME language as the user's request.
- Typically 6-10 slides. Start with a "title" slide and end with a "closing" slide.
- Each bullet is a SHORT key phrase, not a full sentence: aim for ≤ ~20 full-width
  characters (~6-8 words). Drop filler words and any trailing "。"/".". 3-5 bullets per slide.
  Bad: "情報共有の遅れによるプロジェクトの遅延が発生しています。"  Good: "情報共有の遅れ→遅延"
- Headings/labels stay short too (a few words), so they fit the placeholder.
- Use "columns" for comparisons or two/three-sided content.
- "section" is JUST a divider (title only, no body). Only use it to separate major
  parts. If a topic has actual content, use "content" with bullets — never an empty "section".
- The "closing" title is a CONCISE takeaway in ONE short line (not a single word like
  "Summary"/"まとめ", and not a long sentence that overflows).${today ? `\n- Use ${today} (or a future date) for any "date" field — never a past year.` : ""}
- Do NOT add any field not listed above, and do NOT invent other "kind" values.
- Output valid JSON only.`;
}

// ── Single-slide edit prompt (token-cheap: one slide in, one slide out) ──

export function slidePlanSystemPrompt(): string {
  return `You revise ONE slide. Output ONLY a single JSON Slide object — no prose, no code fence, and NOT a {"slides":[...]} array.

The Slide is exactly one of:
- {"kind":"title","title":"...","subtitle":"...","category":"...","date":"...","footer":"..."}
- {"kind":"section","title":"..."}
- {"kind":"content","title":"...","subtitle":"...","bullets":["...","..."]}
- {"kind":"columns","title":"...","subtitle":"...","columns":[{"heading":"...","bullets":["..."]}, ...]}
- {"kind":"closing","title":"..."}

You are given the current slide and an instruction. Apply ONLY what the instruction asks; keep everything else as-is. Return the FULL revised slide.

Rules:
- Write in the SAME language as the slide / instruction.
- Each bullet is a SHORT key phrase (≤ ~20 full-width chars), not a full sentence; no trailing "。"/".".
- Do NOT add fields not listed above, and do NOT invent other "kind" values.
- Output valid JSON only (a single object).`;
}
