# Editing and Export

The workflow after you've built your slides—**two-stage editing** (fixing content and design separately), **slide operations** (add, duplicate, delete, reorder), and **export** (PPTX and standalone HTML)—all in one place.

For authoring itself, it helps to first get comfortable with [Markdown](/en/guide/markdown-authoring) and [diagrams](/en/guide/diagrams), plus [templates](/en/guide/templates)—the source of your slides' look.

---

## Two-Stage Editing — Separating Content from Design

Editing in SlideCraft is split into two independent layers. This division of labor is the core of how SlideCraft "produces polished slides without breaking your fonts or layout."

| Layer | What you specify | Who makes it concrete |
|---|---|---|
| **Content** | The substance of the slide — headings, bullets, tables, diagrams | You write it in Markdown |
| **Design (layout)** | Spatial intent — "text on the left, diagram on the right," "emphasize this node," "flip the diagram from vertical to horizontal" | The engine translates it into real coordinates |

### Content = Markdown

Content is edited as Markdown at the granularity of "this whole slide." Both text and diagrams (`diagram` / `mermaid` fences) live in the same Markdown. Select a slide in the visual editor and you can edit that single slide's Markdown directly.

```markdown
# Quarterly Summary
> 2026 Q2

<!-- kpi -->
- Revenue: ¥1.2M (+12%)
- Utilization: 98%

<!-- col -->
### Highlights
- New customers +18%
- Churn at an all-time low
```

### Design = Spatial Intent

In the design layer, you **specify "intent" rather than manipulating coordinates directly**. For example, an intent like "emphasize this diagram node" or "swap the left/right positions of the text and diagram" is received by the engine and converted into actual coordinates—all within the bounds that preserve the template's fonts, colors, and layout.

Diagrams and images can be dragged to move and resized right in the visual editor. Because the result of that operation is saved as attributes on the Markdown side, the two layers always stay in sync (for images, `{x=…,y=…,w=…,h=…}`; see [Images in Markdown](/en/guide/markdown-authoring) for details).

::: tip The two layers are independent
Rewriting content preserves your design intent, and conversely, adjusting the design doesn't change your content. AI can assist with either layer (see [AI Setup](/en/guide/ai-setup)). You can review the diff of an AI edit at the **adoption gate** and then accept or reject it.
:::

---

## Slide Operations

The thumbnail list (slide list) on the left side of the visual editor lets you edit the structure of the deck itself.

| Operation | How to do it |
|---|---|
| **Select** | Click a thumbnail. That slide appears in the preview |
| **Add** | Add a new slide at the end (or at the selected position) |
| **Duplicate** | Copy an existing slide and insert it right after |
| **Delete** | Remove a slide you no longer need |
| **Reorder** | **Drag** thumbnails to change their order |

### How Drag-to-Reorder Behaves

Reordering is just a matter of grabbing a thumbnail and moving it up or down. While dragging, an indicator shows the insertion point, and the slide moves to wherever you release it. Clicks and drags are distinguished by a threshold (a movement of a few pixels), so a light click keeps your selection, and only a deliberate move triggers a reorder.

::: details Pointer-based, not native HTML5 drag
On the desktop Webview (WebKitGTK / WKWebView), the browser's standard HTML5 drag-and-drop is unreliable, so SlideCraft implements reordering with pointer events. The experience is unchanged, but this design choice is why dragging follows your cursor smoothly.
:::

Your working state can be saved as a `.slidecraft` project file and resumed later.

---

## Export

A finished deck can be written out in two formats. Choose based on your use case.

| Format | Best suited for |
|---|---|
| **PPTX** | Opening and touching up in PowerPoint / internal distribution or submission |
| **Standalone HTML** | Presenting straight from the browser / sharing via a single link / print handouts |

### PPTX (PowerPoint)

Exports as `.pptx`. The key point is that **diagrams and tables are exported as editable native shapes**. They aren't pasted in as images, so in PowerPoint you can directly touch up boxes, arrows, charts, and table cells.

- The template's colors, fonts, and layout are preserved as-is.
- The 12 `diagram` types, plus convertible `mermaid` (class / state / ER / mindmap), become native shapes.
- Images (data URIs) are decoded and embedded as media.
- [Speaker notes](/en/guide/markdown-authoring#speaker-notes-note) written with `<!-- note -->` land in PowerPoint's **native notes pane**. Slides without notes get no notes part at all, so a deck without notes exports exactly as before.

### Standalone HTML

Exports as a **single HTML file**. Because it's a self-contained file with no external dependencies, you can present in the browser just by opening it. Sharing is a single file too.

At export time you can choose the default **transition style** (`fade` / `slide` / `zoom` / `push`; the default is `slide`). While presenting, the following operations are available:

| Key / Action | Behavior |
|---|---|
| `→` / `Space` / `PageDown`, click the right third of the screen | Next slide |
| `←` / `PageUp`, click the left third of the screen | Previous slide |
| `Home` / `End` | Jump to the first / last slide |
| `o` | Toggle the **overview** (a grid of all slides). Click a thumbnail / press Enter to navigate |
| `t` | Cycle through transition styles |
| `n` | Toggle the **speaker notes** panel (hidden by default; only in decks that have notes) |
| `f` | Toggle full scope (fullscreen) |
| A URL hash like `#3` | Jump directly to that slide (deep link) |

::: tip Printing is 1 slide = 1 page
When you print the HTML from a browser (or save it as a PDF), **exactly one slide becomes one page**. Transition animations and the overview are for on-screen display only and don't affect printing. You can produce a distribution handout as-is.
:::

---

## Export Constraints (Unsupported Mermaid)

::: warning gitGraph / sankey / C4 cannot be drawn in PPTX
Convertible Mermaid (`class` / `state` / `ER` / `mindmap`) automatically becomes native diagrams, but **non-convertible Mermaid such as `gitGraph` / `sankey` / `C4` cannot be converted to PPTX**.

These **never disappear silently**—by default, export is rejected. Replace the affected slides with a supported diagram—[one of the 12 `diagram` fence types](/en/guide/diagrams), or convertible Mermaid—before exporting.
:::

In addition, only embedded images that are **data URIs (`data:image/...;base64,...`)** are rendered as images. For safety, remote URLs and local paths are not turned into images and are treated as body text (see [Markdown Syntax](/en/guide/markdown-authoring)).

---

## Related Pages

- [Writing in Markdown](/en/guide/markdown-authoring) — the syntax of the content layer
- [Diagrams](/en/guide/diagrams) — the 12 native diagram types and Mermaid
- [Templates](/en/guide/templates) — the source of the look
- [AI Setup](/en/guide/ai-setup) — AI assistance for both the content and design layers
- [MCP](/en/guide/mcp) — integration from an upstream AI agent
- [FAQ](/en/guide/faq) — troubleshooting overflow, missing diagrams, and more
