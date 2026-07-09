/**
 * llm-prompts.ts — Generate prompts for LLM-assisted slide/diagram creation.
 *
 * Two prompt types:
 * 1. Slide deck generation: user topic → Markdown output
 * 2. Diagram generation: user description → DiagramSpec JSON output
 */

import { LAYOUT_NAMES } from "./slide-schema";
import { deckPlanSystemPrompt, slideMarkdownEditPrompt, slideCondensePrompt } from "./deck-plan-prompts";
import { diagramSystemPrompt, diagramEditSystemPrompt, diagramRoutePrompt, type DiagramType } from "./diagram-type-prompts";
import { templateSpecSystemPrompt } from "./template-spec-prompts";
import type { LayoutCatalog, LayoutRole } from "./template-catalog";

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
  mode: "slides" | "slide" | "condense" | "diagram" | "diagram-edit" | "diagram-route" | "template-spec",
  today: string,
  diagramType?: DiagramType,
): string {
  return mode === "slides"
    ? deckPlanSystemPrompt(today)
    : mode === "slide"
      ? slideMarkdownEditPrompt()
      : mode === "condense"
        ? slideCondensePrompt()
        : mode === "template-spec"
          ? templateSpecSystemPrompt()
          : mode === "diagram-route"
              ? diagramRoutePrompt()
              : mode === "diagram-edit"
                ? diagramEditSystemPrompt(diagramType)
                : diagramSystemPrompt(diagramType);
}

// ── Slide deck prompt ──

export function slideSystemPrompt(catalog?: LayoutCatalog): string {
  // Advertise the ACTUAL template's layouts when we have a catalog (alien-safe); else the canonical set
  // (manual copy with no template loaded). Same rule for the role-based selection guidance below.
  const names = catalog && catalog.length ? catalog.map((e) => e.name) : [...LAYOUT_NAMES];
  const layoutList = names.map((n, i) => `  ${i}. ${n}`).join("\n");

  const rule = (role: LayoutRole, canonical: string, desc: string, sep?: string): string | undefined => {
    const name = catalog ? catalog.find((e) => e.role === role)?.name : canonical;
    return name ? `- ${desc}: \`${name}\`${sep ? ` — put one \`${sep}\` before EACH region (content before the first is ignored)` : ""}` : undefined;
  };
  const layoutRules = [
    rule("title", "Title.1Title.Single", "First slide (opening)"),
    rule("section", "Section.1Title.Single", "Section dividers"),
    rule("content", "Content.1Body.Single", "Content with bullet points"),
    rule("columns", "Column.2Body.Equal", "Two/three-column comparison", "<!-- col -->"),
    rule("kpi", "KPI.*", "KPI / metrics", "<!-- kpi -->"),
    rule("process", "Process.*", "Process steps", "<!-- step -->"),
    rule("closing", "Closing.1Message.Single", "Last slide (closing)"),
  ].filter(Boolean).join("\n");

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

${layoutRules}

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

## Tables

For structured data — comparisons, key-value specs, schedules — use a GFM table (rendered as a NATIVE PowerPoint table, not an image):

\`\`\`
| 指標 | 値 |
| --- | --- |
| 売上 | ¥1.2M |
| 前年比 | +12% |
\`\`\`

## Code / Logs

For code or log output, use a fenced code block with a language (rendered monospace):

\`\`\`\`
\`\`\`python
def greet(name):
    return f"Hello, {name}"
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

export function generateSlidePrompt(userRequest: string, catalog?: LayoutCatalog): string {
  return `${slideSystemPrompt(catalog)}\n\n## User Request\n\n${userRequest}`;
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
  catalog?: LayoutCatalog,
): string {
  return mode === "slides"
    ? generateSlidePrompt(userRequest, catalog)
    : generateDiagramPrompt(userRequest, diagramType);
}
