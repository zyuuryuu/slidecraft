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
  heading: z.boolean().optional(), // a `### …` group heading (card/step) — the group's title line
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
  yaml: z.string(), // raw YAML for DiagramSpec (type: "diagram")
  placeholderIdx: z.string(), // which placeholder to replace with diagram
});

export type DiagramBlock = z.infer<typeof DiagramBlockSchema>;

export const MermaidBlockSchema = z.object({
  mermaid: z.string(), // raw Mermaid syntax
  placeholderIdx: z.string(),
  svgCache: z.string().optional(), // pre-rendered SVG (set by UI before PPTX generation)
});

export type MermaidBlock = z.infer<typeof MermaidBlockSchema>;

// ── Table block (embedded in a slide) ──

export const TableBlockSchema = z.object({
  rows: z.array(z.array(z.string())), // [ [h1,h2], [a,b], ... ] — first row is the header when `header`
  header: z.boolean().default(true),
  placeholderIdx: z.string().default("1"), // which BODY region the table fills
});

export type TableBlock = z.infer<typeof TableBlockSchema>;

// ── Code / log block (embedded in a slide) ──

export const CodeBlockSchema = z.object({
  content: z.string(), // raw code/log text (newlines preserved), rendered monospace
  lang: z.string().optional(), // fence language hint (yaml/python/log/…), for future highlighting
  placeholderIdx: z.string().default("1"), // which BODY region the code fills
});

export type CodeBlock = z.infer<typeof CodeBlockSchema>;

// ── Single slide IR ──

export const SlideIRSchema = z.object({
  layout: z.string(), // layout name or "auto"
  placeholders: z.array(PlaceholderContentSchema),
  diagram: DiagramBlockSchema.optional(), // embedded diagram (DiagramSpec YAML → PptxGenJS shapes)
  mermaidBlock: MermaidBlockSchema.optional(), // embedded mermaid (raw syntax → SVG image in PPTX)
  table: TableBlockSchema.optional(), // embedded table (GFM Markdown → native OOXML table)
  code: CodeBlockSchema.optional(), // embedded code/log (```lang fence → monospace body)
  groupKind: z.enum(["card", "step", "kpi"]).optional(), // `<!-- card/step/kpi -->` groups → layout hint
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
