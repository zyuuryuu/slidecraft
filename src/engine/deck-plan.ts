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

function slidePlanToSlide(s: SlidePlan): SlideIR {
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

/** Extract a JSON object from raw model text (tolerates ``` fences / prose). */
function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
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
  return parseDeckPlan(data);
}

// ── System prompt the model fills (tiny vocabulary — no Markdown DSL) ──

export function deckPlanSystemPrompt(): string {
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
- Keep each bullet short — one idea, not a paragraph.
- Use "columns" for comparisons or two/three-sided content.
- Do NOT add any field not listed above, and do NOT invent other "kind" values.
- Output valid JSON only.`;
}
