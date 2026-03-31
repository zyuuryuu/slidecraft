/**
 * llm-prompts.ts — Generate prompts for LLM-assisted slide/diagram creation.
 *
 * Two prompt types:
 * 1. Slide deck generation: user topic → Markdown output
 * 2. Diagram generation: user description → DiagramSpec JSON output
 */

import { LAYOUT_NAMES } from "./slide-schema";

// ── Slide deck prompt ──

export function generateSlidePrompt(userRequest: string): string {
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

## User Request

${userRequest}`;
}

// ── Diagram prompt ──

export function generateDiagramPrompt(userRequest: string): string {
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

## Rules

- Use meaningful, short IDs (lowercase, underscores OK)
- Labels can include \\n for line breaks
- Use classDefs to define reusable styles, then reference with "class"
- Use groups to visually organize related nodes
- For network diagrams, use type "network"
- For org charts, use type "orgchart"
- Keep the diagram focused — typically 5-20 nodes
- Return ONLY the JSON object, no explanation

## User Request

${userRequest}`;
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
