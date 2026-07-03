/**
 * llm-prompts.ts — Generate prompts for LLM-assisted slide/diagram creation.
 *
 * Two prompt types:
 * 1. Slide deck generation: user topic → Markdown output
 * 2. Diagram generation: user description → DiagramSpec JSON output
 */

import { LAYOUT_NAMES } from "./slide-schema";
import { deckPlanSystemPrompt, slideMarkdownEditPrompt, slideCondensePrompt } from "./deck-plan-prompts";
import { diagramSystemPrompt, diagramEditSystemPrompt, type DiagramType } from "./diagram-type-prompts";

// The diagram prompt surface moved to diagram-type-prompts.ts (two-stage per-type design); re-export so
// existing importers of these names keep resolving them from here.
export { diagramSystemPrompt, diagramEditSystemPrompt, diagramRoutePrompt, parseDiagramType, DIAGRAM_TYPES } from "./diagram-type-prompts";
export type { DiagramType, DiagramTypeInfo } from "./diagram-type-prompts";

/** The SYSTEM prompt actually sent for a given AI mode — the SAME selection ipc/ai.ts
 *  uses, exported so the task panel can show exactly what was sent. `today` is only used
 *  by the "slides" (whole-deck generation) prompt; `diagramType` picks the ONE diagram shape
 *  fragment for the diagram / diagram-edit modes (Stage 2 of the two-stage design). "condense" is the
 *  harness refine residue: a Markdown-ONLY sub-prompt (no design-ops branch) so a small model stays on format. */
export function systemPromptForMode(
  mode: "slides" | "slide" | "condense" | "diagram" | "diagram-edit",
  today: string,
  diagramType?: DiagramType,
): string {
  return mode === "slides"
    ? deckPlanSystemPrompt(today)
    : mode === "slide"
      ? slideMarkdownEditPrompt()
      : mode === "condense"
        ? slideCondensePrompt()
        : mode === "diagram-edit"
          ? diagramEditSystemPrompt(diagramType)
          : diagramSystemPrompt(diagramType);
}

// ── Slide deck prompt ──

export function slideSystemPrompt(): string {
  const layoutList = LAYOUT_NAMES.map((n, i) => `  ${i}. ${n}`).join("\n");

  return `You are a presentation assistant. Generate a slide deck in SlideCraft Markdown format based on the user's request.

## Output Format

Use this exact Markdown format:

\`\`\`
<!-- slide: LayoutName -->
# Slide Title
## Subtitle (for title slides)
> Subtitle (for content slides)

Body text with **bold** and *italic*.

- Bullet points
- Like this

Category: LABEL (title slides only)
Date: date info (title slides only)
Footer: footer text (title slides only)
\`\`\`

## Slide Separators

Use \`---\` between slides.

## Available Layouts

${layoutList}

## Layout Selection Rules

- First slide: use \`Title.1Title.Single\` or similar Title layout
- Section dividers: use \`Section.1Title.Single\`
- Content with bullet points: use \`Content.1Body.Single\`
- Two-column comparison: use \`Column.2Body.Equal\` with \`<!-- col -->\` separators
- KPI/metrics: use \`KPI.*\` layouts with \`<!-- kpi -->\` separators
- Process steps: use \`Process.*\` layouts with \`<!-- step -->\` separators
- Last slide: use \`Closing.1Message.Single\`

## Embedded Diagrams

For flowcharts or network diagrams, use fenced code blocks:

\`\`\`\`
\`\`\`diagram
type: flowchart
direction: TB
nodes:
  - id: a
    label: Node A
    shape: rounded_rect
  - id: b
    label: Node B
edges:
  - from: a
    to: b
    label: "connection"
groups:
  - id: group1
    label: "Group Name"
\`\`\`
\`\`\`\`

Or use Mermaid syntax (rendered as image):

\`\`\`\`
\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[End]
\`\`\`
\`\`\`\`

## Rules

- Write in the same language as the user's request
- Use 6-10 slides for a typical presentation
- Include a title slide and closing slide
- Be concise — slides should not be walls of text
- Use bullet points, not paragraphs, for content slides
- Always specify the layout with \`<!-- slide: LayoutName -->\`

Output ONLY the SlideCraft Markdown — no preamble, no explanation, and do not wrap the whole document in a code fence.`;
}

export function generateSlidePrompt(userRequest: string): string {
  return `${slideSystemPrompt()}\n\n## User Request\n\n${userRequest}`;
}

// ── Diagram prompt (manual-copy) — the SHAPE prompts moved to diagram-type-prompts.ts ──

export function generateDiagramPrompt(userRequest: string, type?: DiagramType): string {
  return `${diagramSystemPrompt(type)}\n\n## User Request\n\n${userRequest}`;
}

// ── Combined prompt (user can choose) ──

export function generateCombinedPrompt(
  mode: "slides" | "diagram",
  userRequest: string,
  diagramType?: DiagramType,
): string {
  return mode === "slides"
    ? generateSlidePrompt(userRequest)
    : generateDiagramPrompt(userRequest, diagramType);
}
