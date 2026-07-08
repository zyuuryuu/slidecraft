# Starter Guide

Write Markdown, pour it into your company template (the PowerPoint look and feel), and produce a polished `.pptx` — this guide walks you through the full SlideCraft flow as the fastest path to a first success. Let's start by taking a single slide all the way to `.pptx`.

The core idea of SlideCraft is a division of labor: you write the text in Markdown and leave placement and styling to the template and the engine. You get to focus purely on content, without breaking fonts or layouts.

## Why SlideCraft

Plenty of tools let you "write slides in Markdown." What makes SlideCraft different is that **it inherits your company's slide master as-is and produces real, editable PowerPoint — indistinguishable from something a human made — with the least possible computation.**

- **🎯 Pour into the template, don't break it** — Markdown flows into the placeholders of your existing `.pptx` template. Fonts, colors, layouts, and master decorations stay intact. No wrestling with PowerPoint.
- **✏️ Not images — editable shapes** — Figures, tables, and diagrams are output as **native PPTX shapes**. Whoever receives the file can tweak them directly in PowerPoint (these are not pasted screenshots).
- **🧠 A deterministic engine handles placement** — Layouts are auto-selected from the template's roles (**works with any master**), body text is fit within capacity, overflow is automatically split instead of shrinking fonts, and color choices guarantee contrast.
- **⚡ Minimal computation, guaranteed quality** — Because a **deterministic engine** handles formatting, placement, and validation, all the AI needs to do is write Markdown. That means **a small local model is enough, and tokens stay minimal**. What's more, the AI's output is **validated by an "adoption gate" before it is applied**, and the engine guarantees overflow, formatting, and contrast. The design bets on "the harness guaranteeing quality" rather than "betting on a smart model" (*harness over model*).
- **👁 Preview = output** — The preview, PPTX, and HTML all share the **same rendering engine**. There's no "the preview looked different from the real thing."
- **📊 12 native diagram types + Mermaid** — Flowcharts, Gantt charts, KPIs, radar charts, and more, from a few lines of YAML as editable shapes.
- **🔒 Local-first + AI** — Desktop plus a built-in offline AI (llamafile). Your data stays with you. You can also drive it from an upstream AI via [MCP](/en/guide/mcp).

::: tip Haven't installed it yet?
Complete the [Installation Guide](/en/guide/installation) first (Windows `.msi` / Linux `.AppImage` and `.deb` / macOS via Homebrew cask).
:::

## The Big Picture — a 4-step flow

SlideCraft's basic cycle has four steps.

1. **Draft** — Enter your Markdown.
2. **Turn it into slides** — Pick a template, parse the Markdown, and convert it into a deck (a set of slides).
3. **Review and adjust in the visual editor** — Check it in a what-you-see-is-what-you-get preview, then add, reorder, and use two-stage editing.
4. **Export** — Write out `.pptx` (PowerPoint) or standalone HTML.

```
 ┌─────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────┐
 │ ① Draft │ → │② スライドにする │ → │ ③ 視覚エディタ │ → │ ④ 出力     │
 │ Markdown│   │ +テンプレート │   │ 確認・調整     │   │ PPTX / HTML│
 └─────────┘   └──────────────┘   └───────────────┘   └────────────┘
```

Markdown (the input) and the deck (the source of truth) hold the same content and can be moved back and forth. Day to day, the visual editor is the main surface, and Markdown is always available for input and export.

## ① Draft — Write Markdown

When you launch SlideCraft, the first thing you do is prepare a draft in Markdown. For a new deck, start from the Initialize modal; you can also load an existing `.md` file.

Markdown is interpreted as blocks, one per slide. At a minimum, learning the following is enough to get started.

- `---` (a horizontal rule) separates one slide
- `# Heading` is the slide's title
- Bullet lists (`- ` / `* `) and paragraphs are the body

Here's an example you can paste as-is for your very first deck.

```markdown
# 2026年 事業計画
> 第2四半期レビュー

Category: 経営会議
Date: 2026-07-07

---

# 今期の3本柱

- 品質 — 不良率を半減
- 速度 — リードタイム短縮
- コスト — 原価 10% 削減

---

# 売上推移

```diagram
type: xychart
nodes: []
xychart:
  xlabel: 四半期
  ylabel: 売上
  categories: [Q1, Q2, Q3, Q4]
  series:
    - { kind: bar, name: "2024", values: [10, 14, 13, 18] }
```
```

::: tip Metadata on the title slide
On the title slide, lines like `Category:` / `Date:` / `Footer:` are treated as metadata. A `## Heading` or `> Quote` becomes the subtitle.
:::

The full picture of the syntax (tables, images, multi-column, KPIs, code fences) is collected in the [Markdown Authoring Guide](/en/guide/markdown-authoring). For the 12 diagram types and the 4 available via `mermaid`, see [Diagrams](/en/guide/diagrams).

::: tip Try the full showcase deck
For a richer example, there's a **full showcase deck** (~30 slides covering native diagrams, `mermaid`, tables, multi-column, and every layout). Paste [**`samples/sample-deck.md`**](https://github.com/zyuuryuu/slidecraft/blob/main/samples/sample-deck.md) into Draft and hit "Turn it into slides" to see SlideCraft's full range at once. (This is the sample that used to load on startup through v0.2.0. Its content is in Japanese — feel free to replace the text.)
:::

## ② Turn it into slides — Pick a template and convert

Once you've written your Markdown, pick a template and run "Turn it into slides." Here's what happens.

- The Markdown is parsed and split into individual slides
- The engine **auto-selects the optimal layout** for each slide (`auto`)
- The template's colors, fonts, and layouts are applied

After conversion, you get a WYSIWYG preview with the template's colors and fonts applied as-is. Fonts don't shrink and layouts don't break, because styling is left to the template.

::: details Which template should I choose?
If you have your company's standard `.pptx` on hand, you can import and use it. A `.pptx` with broken roles can be repaired on import with "Clean up and import." For a template with an unusual frame structure that doesn't pour in cleanly, use "**Import theme only (Re-make)**" to inherit just its colors, fonts, and logo. If you're starting from scratch, you can also create a new one by simply choosing a color scheme (a 9-color palette) and fonts. For details, see [Templates](/en/guide/templates).
:::

::: tip When you want to specify a layout
If you want to use a specific layout rather than leave it to auto-selection, write `<!-- slide: レイアウト名 -->` on the first line of that slide. Normally you can omit this.
:::

## ③ Review and adjust in the visual editor

Converting takes you into the visual editor. This is SlideCraft's main surface.

- **Thumbnail list** — Select each slide from the list on the left and review it as-is in the preview on the right
- **Deck operations** — Add, duplicate, and delete slides, and reorder them by dragging
- **Two-stage editing** — Adjust content and design (placement) independently

Editing is split into two layers.

- **Content = Markdown** — Edit the slide's content (headings, bullets, tables, figures) as Markdown, at the granularity of "this whole slide"
- **Design = spatial intent** — Specify placement intent like "text on the left, figure on the right," "emphasize this node," or "change the figure's orientation from vertical to horizontal," and the engine translates it into actual coordinates

These two layers are independent: rewriting the content preserves the design intent, and vice versa. AI can assist with either layer (see the [AI Setup Guide](/en/guide/ai-setup)). For details on two-stage editing, see [Two-Stage Editing and Export](/en/guide/editing-and-export).

## ④ Export — Write out PPTX / HTML

When you're satisfied, export. There are two output targets.

- **`.pptx` (PowerPoint)** — Figures and tables are output as **editable native shapes**, so you can tweak them directly in PowerPoint (they are not pasted as images). The template's colors, fonts, and layouts are preserved.
- **Standalone HTML** — A single file with no external dependencies. It supports rich slide transitions and an overview grid, and printing produces one page per slide.

You can save and resume your working state as a `.scft` project file (the deck plus the template bundled into one file). In the installed version, this extension is associated with the app, so **double-clicking** a `.scft` opens it directly in SlideCraft (or as a new tab if the app is already running).

::: warning Some Mermaid diagrams can't be turned into PPTX
Mermaid types that can't be converted, such as `gitGraph` / `sankey` / `C4`, can't be drawn in PPTX and are **rejected** on export (they never disappear silently). Replace them with a supported diagram — [one of the 12 `diagram` types](/en/guide/diagrams), or a convertible Mermaid type (`class` / `state` / `ER` / `mindmap`).
:::

## If you get stuck

- **An image shows up as body text** — Only `data:image/...;base64,...` data URIs are rendered as images. Remote URLs and local paths are not, for safety.
- **A diagram doesn't render** — If the YAML/JSON in a `diagram` fence has a syntax error, it won't render. The editor shows the reason, so check `type:` and the required fields.
- **The body overflows** — The engine deterministically splits the content across multiple slides. Summarizing or converting to a table also helps.

Other questions are collected in the [FAQ](/en/guide/faq).

## What to read next

Once you've run through the full flow, dive deeper.

- [Markdown Authoring Guide](/en/guide/markdown-authoring) — the full picture of the syntax, including tables, images, multi-column, KPIs, and separator comments
- [Diagrams](/en/guide/diagrams) — the 12 native `diagram` types and the 4 available via `mermaid`
- [Templates](/en/guide/templates) — importing an existing `.pptx`, repair-import, and creating from scratch
- [Two-Stage Editing and Export](/en/guide/editing-and-export) — the two-layer content/design editing model, and exporting to PPTX / HTML
- [AI Setup Guide](/en/guide/ai-setup) — assisting generation and editing with the built-in offline AI
- [MCP Guide](/en/guide/mcp) — integration from agents such as Claude Desktop and Claude Code
