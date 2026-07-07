# Changelog

Notable changes to SlideCraft. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/) (**the 0.x line is an early release — breaking changes are possible even in MINOR versions**).

- Full change history: [CHANGELOG.md](https://github.com/zyuuryuu/slidecraft/blob/main/CHANGELOG.md)
- Comprehensive log of shipped features: [shipped.md](https://github.com/zyuuryuu/slidecraft/blob/main/docs/shipped.md)

## [Unreleased]

### Added

- **Associate `.scft` files with the app (open on double-click)** — Project files (`.scft`) now launch and open in SlideCraft via **double-click / "Open with"**. If the app is already running, it opens as a **new tab** without disturbing what you currently have open.
- **Surface AI-authored decks from Live MCP in a GUI background tab** — When an upstream AI creates a new deck during collaboration, it appears as a background tab in the GUI (the active view does not switch).

### Changed

- **Shortened the project file extension from `.slidecraft` to `.scft`** — A shorter, easier-to-handle 4-character extension.

## [0.2.0] — 2026-07-07

Highlights: third-party slide master support and a bundled MCP CLI for upstream AI.

### Added

- **Bundled MCP server in the app** — The distributed installer now includes a self-contained MCP server and Node runtime. Upstream AI (Claude Code / Cursor / Claude Desktop) can drive SlideCraft **without building from source or a system Node**. On macOS, Homebrew registers `slidecraft-mcp` on your PATH (`claude mcp add slidecraft -- slidecraft-mcp`). See the [MCP guide](/en/guide/mcp).
- **Slide master Re-make (import theme only)** — A second import path that inherits only a corporate template's fonts, colors, background, and logo, then rebuilds with SlideCraft's own layouts. Coexists with faithful import. See [Templates](/en/guide/templates).
- **Render slide master logos and figures in the preview** — Template logos that were previously dropped now appear in the preview/HTML.

## [0.1.0] — 2026-07-07

First public release (early version).

### Added

- Markdown/YAML → PPTX conversion (template placeholder filling, native OOXML generation)
- Visual editor (deck = single source of truth) plus [two-stage editing](/en/guide/editing-and-export) (content = Markdown / design = spatial intent → coordinates)
- [Diagrams](/en/guide/diagrams): **12** native types (` ```diagram `) plus class/state/ER/mindmap via Mermaid, GFM tables, code, and images (self-contained data URIs)
- Standalone HTML output / PPTX native-vector export
- [Built-in offline AI](/en/guide/ai-setup) (bundled llamafile, environment-adaptive model tiers) plus an adoption gate for AI edits
- [Template](/en/guide/templates) creation, import, and repair (live preview in the creation modal, layout subsets, custom layouts)
- Collaboration host ([MCP](/en/guide/mcp)): upstream AI edits via Tools and the GUI reflects changes live

### Notes

::: warning macOS
Ad-hoc signed (not notarized). **Launch confirmed on Apple Silicon.** On newer macOS (15 Sequoia and later), a first-run "not notarized" warning appears, so open it via **System Settings → Privacy & Security → "Open Anyway"** (right-click → "Open" alone may not get through). No Intel Mac build is provided. Bug reports are welcome via [Issues](/en/guide/reporting-issues).
:::

Updates are **manual** for now (a Homebrew cask is planned for macOS in the future). See the
[release procedure](https://github.com/zyuuryuu/slidecraft/blob/main/RELEASING.md).
