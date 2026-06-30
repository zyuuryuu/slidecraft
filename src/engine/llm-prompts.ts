/**
 * llm-prompts.ts — Generate prompts for LLM-assisted slide/diagram creation.
 *
 * Two prompt types:
 * 1. Slide deck generation: user topic → Markdown output
 * 2. Diagram generation: user description → DiagramSpec JSON output
 */

import { LAYOUT_NAMES } from "./slide-schema";
import { iconCatalogPromptList } from "./icon-catalog";
import { deckPlanSystemPrompt, slideMarkdownEditPrompt, slideCondensePrompt } from "./deck-plan-prompts";

/** The SYSTEM prompt actually sent for a given AI mode — the SAME selection ipc/ai.ts
 *  uses, exported so the task panel can show exactly what was sent. `today` is only used
 *  by the "slides" (whole-deck generation) prompt. "condense" is the harness refine residue:
 *  a Markdown-ONLY sub-prompt (no design-ops branch) so a small in-app model stays on format. */
export function systemPromptForMode(mode: "slides" | "slide" | "condense" | "diagram" | "diagram-edit", today: string): string {
  return mode === "slides"
    ? deckPlanSystemPrompt(today)
    : mode === "slide"
      ? slideMarkdownEditPrompt()
      : mode === "condense"
        ? slideCondensePrompt()
        : mode === "diagram-edit"
          ? diagramEditSystemPrompt()
          : diagramSystemPrompt();
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

// ── Diagram prompt ──

export function diagramSystemPrompt(): string {
  return `You are a technical diagram assistant. Generate a DiagramSpec JSON for SlideCraft based on the user's description.

## Output Format

Return a single JSON object with this schema:

\`\`\`json
{
  "type": "flowchart",       // "flowchart", "network", or "orgchart"
  "direction": "TB",         // "TB", "LR", "BT", "RL"
  "title": "Diagram Title",
  "classDefs": {
    "className": {
      "fill": "#1E2761",     // background color (hex)
      "border": "#3B82F6",   // border color (hex, optional)
      "font_color": "#FFFFFF", // text color (hex)
      "font_size": 10        // font size in pt
    }
  },
  "nodes": [
    {
      "id": "unique_id",     // lowercase, no spaces
      "label": "Display Name",
      "shape": "rect",       // "rect", "rounded_rect", "diamond", "circle", "oval", "hexagon"
      "icon": "server",      // optional, a built-in icon name (see "Available Icons")
      "class": "className",  // references classDefs
      "group": "groupId"     // optional, references groups
    }
  ],
  "edges": [
    {
      "from": "node_id_1",
      "to": "node_id_2",
      "label": "optional label",
      "style": { "dash": true }  // optional, for dashed lines
    }
  ],
  "groups": [
    {
      "id": "groupId",
      "label": "Group Display Name"
    }
  ],
  "layout": {
    "node_width": 2.0,       // inches
    "node_height": 0.7,
    "h_gap": 0.5,
    "v_gap": 0.8
  }
}
\`\`\`

## Color Palette (Midnight Executive Theme)

Use these colors for a professional look:
- Navy: #1E2761 (primary dark)
- Dark Navy: #141B41
- Accent Blue: #3B82F6
- Teal: #06B6D4
- Amber: #F59E0B
- White: #FFFFFF
- Light Gray: #F5F7FA
- Mid Gray: #94A3B8
- Dark Text: #1E293B

## Available Icons

Set a node's "icon" to one of these built-in names to draw a small native glyph
inside the node (ideal for network / system / infrastructure diagrams):

${iconCatalogPromptList()}

## Rules

- Use meaningful, short IDs (lowercase, underscores OK)
- Labels can include \\n for line breaks
- Use classDefs to define reusable styles, then reference with "class"
- Use groups to visually organize related nodes
- For network diagrams, use type "network"
- For org charts, use type "orgchart"
- For network/system diagrams, add an "icon" to each node from the list above
- Use ONLY icon names from "Available Icons"; omit "icon" if none fits
- Keep the diagram focused — typically 5-20 nodes
- Return ONLY the JSON object, no explanation`;
}

export function generateDiagramPrompt(userRequest: string): string {
  return `${diagramSystemPrompt()}\n\n## User Request\n\n${userRequest}`;
}

/** Edit an EXISTING diagram: same schema, but apply one change and keep the rest. */
export function diagramEditSystemPrompt(): string {
  return `${diagramSystemPrompt()}

## Editing mode
You are given the CURRENT diagram (as YAML) and an instruction. Apply ONLY what the
instruction asks, keep everything else (ids, labels, styles, layout) intact, and
return the FULL updated DiagramSpec as a single JSON object.`;
}

// ── Combined prompt (user can choose) ──

export function generateCombinedPrompt(
  mode: "slides" | "diagram",
  userRequest: string,
): string {
  return mode === "slides"
    ? generateSlidePrompt(userRequest)
    : generateDiagramPrompt(userRequest);
}

/** System prompt (instructions only) for direct Claude API calls. */
export function systemPromptFor(mode: "slides" | "diagram"): string {
  return mode === "slides" ? slideSystemPrompt() : diagramSystemPrompt();
}
