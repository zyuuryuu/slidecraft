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
