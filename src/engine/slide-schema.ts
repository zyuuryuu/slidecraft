/**
 * slide-schema.ts — SlideIR type definitions for Markdown → PPTX pipeline.
 *
 * SlideIR is the intermediate representation between parsed Markdown
 * and PPTX generation. Each SlideIR represents one slide with its
 * layout selection and placeholder text content.
 */

import { z } from "zod";

// ── Layout names (matching the 30-layout template) ──

export const LAYOUT_NAMES = [
  "Title.1Title.Single",
  "Title.1Title.Single+1Meta",
  "Title.1Title.Single+1Summary",
  "Section.1Title.Single",
  "SectionNav.1Title.Single",
  "SectionBreak.1Title.Single",
  "Content.1Body.Single",
  "Content.1Body.Single+1Notes",
  "Content.1Body.Single+1Source",
  "Content.1Body.Single+1Callout",
  "Column.2Body.Equal",
  "Column.2Body.MainSub",
  "Column.3Body.Equal",
  "KPI.1Value.Single",
  "KPI.2Value.Equal",
  "KPI.3Value.Equal",
  "KPI.4Value.Grid",
  "Chart.1Chart.Single",
  "Chart.1Chart.Single+1Analysis",
  "Chart.2Chart.Equal",
  "Table.1Table.Single+1Source",
  "Table.1Table.Single+1Notes",
  "Compare.2Option.Versus",
  "Compare.1Matrix.Single",
  "Process.4Step.Sequential",
  "Process.3Step.Sequential",
  "Summary.1Agenda.Single",
  "Summary.2Block.Equal",
  "Closing.1Message.Single",
  "Closing.1Steps.Single+1Notes",
] as const;

export type LayoutName = (typeof LAYOUT_NAMES)[number];

// ── Inline text segment (supports bold/italic) ──

export const InlineSegmentSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});

export type InlineSegment = z.infer<typeof InlineSegmentSchema>;

// ── A paragraph: array of inline segments ──

export const ParagraphSchema = z.object({
  segments: z.array(InlineSegmentSchema).min(1),
  bullet: z.boolean().optional(),
});

export type Paragraph = z.infer<typeof ParagraphSchema>;

// ── Placeholder content ──

export const PlaceholderContentSchema = z.object({
  idx: z.string(), // placeholder idx as string ("0", "1", "15", etc.)
  paragraphs: z.array(ParagraphSchema),
});

export type PlaceholderContent = z.infer<typeof PlaceholderContentSchema>;

// ── Diagram block (embedded in a slide) ──

export const DiagramBlockSchema = z.object({
  yaml: z.string(), // raw YAML for DiagramSpec
  placeholderIdx: z.string(), // which placeholder to replace with diagram
});

export type DiagramBlock = z.infer<typeof DiagramBlockSchema>;

// ── Single slide IR ──

export const SlideIRSchema = z.object({
  layout: z.string(), // layout name or "auto"
  placeholders: z.array(PlaceholderContentSchema),
  diagram: DiagramBlockSchema.optional(), // embedded diagram
  sourceLineStart: z.number().optional(), // for editor↔preview linking
  sourceLineEnd: z.number().optional(),
});

export type SlideIR = z.infer<typeof SlideIRSchema>;

// ── Deck IR (the full presentation) ──

export const DeckIRSchema = z.object({
  template: z.string().optional(), // template PPTX filename
  slides: z.array(SlideIRSchema).min(1),
});

export type DeckIR = z.infer<typeof DeckIRSchema>;

// ── Layout index lookup ──

export function layoutIndex(name: string): number {
  const idx = LAYOUT_NAMES.indexOf(name as LayoutName);
  if (idx === -1) {
    throw new Error(`Unknown layout: ${name}`);
  }
  return idx + 1; // 1-based (slideLayout1.xml, etc.)
}
