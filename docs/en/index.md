---
layout: home

hero:
  name: SlideCraft
  text: Markdown → PowerPoint
  tagline: Your template stays untouched. Your editing stays the same. Only the finish looks handcrafted.
  actions:
    - theme: brand
      text: Starter Guide
      link: /en/guide/getting-started
    - theme: alt
      text: Install
      link: /en/guide/installation
    - theme: alt
      text: GitHub
      link: https://github.com/zyuuryuu/slidecraft

features:
  - icon: 📝
    title: Write in Markdown
    details: Headings, bullet lists, tables, and diagrams — all in Markdown. Leave layout and styling to the template and the engine, so you can focus on the content.
  - icon: 📊
    title: 12 native diagrams + Mermaid
    details: Flowcharts, sequence diagrams, Gantt charts, KPIs, and 8 more — output as editable PPTX shapes. class/state/ER/mindmap come through via Mermaid.
  - icon: 🎨
    title: Template-driven fill
    details: Import your company's .pptx and its colors, fonts, and layouts are applied as-is. Turn content into slides without breaking the template's look.
  - icon: 🤖
    title: Built-in offline AI
    details: Ships with llamafile. It assists generation and editing right on your machine, without sending anything to the cloud. External providers (Anthropic/OpenAI/OpenRouter/Ollama) are also available.
  - icon: 🖥
    title: Refine it your way
    details: What the AI or the engine builds isn't the end of the story. Working from the slide in front of you, adjust content and design separately, and put the final touches in yourself while the styling stays intact.
  - icon: 🔌
    title: Agent integration (MCP)
    details: With slidecraft serve, an upstream AI (such as Claude) edits through Tools. It also works as a collaboration host where the GUI reflects changes live.
---

## What is SlideCraft

**SlideCraft** is a desktop app (Tauri v2 + React + TypeScript) that fills slides written in Markdown/YAML into a **company PowerPoint template** to produce a
`.pptx`. You write the text in Markdown while the template and the engine handle placement and styling — a division of labor that lets you build polished slides **without breaking fonts or layouts**.

- **Write** — Markdown ([Authoring Guide](/en/guide/markdown-authoring) · [Diagrams](/en/guide/diagrams))
- **See / Refine** — a preview that reflects the template's colors and fonts, where you adjust content and design separately ([Two-Stage Editing](/en/guide/editing-and-export))
- **Ship** — a `.pptx` made of editable shapes, or a standalone HTML deck with transitions

Start with [Install](/en/guide/installation) → [Starter Guide](/en/guide/getting-started).

::: tip Early release (v0.1.0)
Since this is a 0.x release, breaking changes may occur even in MINOR updates. Please send bugs and requests via [Reporting Issues](/en/guide/reporting-issues).
:::
