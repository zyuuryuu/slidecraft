# Changelog

Notable changes to SlideCraft. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/) (**the 0.x line is an early release — breaking changes are possible even in MINOR versions**).

- Full change history: [CHANGELOG.md](https://github.com/zyuuryuu/slidecraft/blob/main/CHANGELOG.md)
- Comprehensive log of shipped features: [shipped.md](https://github.com/zyuuryuu/slidecraft/blob/main/docs/shipped.md)

## [Unreleased]

### Added

- **Transparent master intake** — when you import a template, a progress bar shows while it runs and a result summary appears after (how many layouts, whether it's healthy, whether AI was used). Expand "Details" to see which source layout AI mapped to which canonical layout (with the reason), plus the extracted fonts and colors.

## [0.3.0] — 2026-07-08

A minor release adding an **AI "remake" import** for slide masters.

### Added

- **"✨ Remake with AI" for slide masters** — a new mode where AI **re-maps** each layout of a messy (e.g. third-party) template onto clean, standard layouts on import. If it can't (or AI isn't connected), it **falls back automatically** to the existing deterministic remake, so it's never worse than before. It also shows *why* each mapping was chosen.

### Changed

- **Stronger automatic layout selection** — layouts that fit the slide's content are picked more reliably (e.g. a plain bullet list is no longer needlessly assigned to a multi-column layout).

## [0.2.2] — 2026-07-08

A patch focused on bug fixes and security hardening.

### Fixed

- **A placeholder named "Title" not receiving the slide title** — on some templates the title box didn't get the title; now it does.
- **`brew upgrade` failing with "already a Binary" on macOS** is fixed.

### Security

- Resolved dev-tooling dependency vulnerabilities (none shipped in the app).
- Added secret scanning (gitleaks) to CI to block accidentally committed credentials.

## [0.2.1] — 2026-07-07

Highlights: a Japanese/English UI toggle (i18n) and English documentation, `.scft` file association, and higher-fidelity preview rendering.

### Added

- **Japanese/English UI toggle (i18n)** — Switch the whole UI between Japanese and English from the toggle in the top-right (your choice is remembered).
- **English documentation** — This documentation site now has an English edition (switch languages from the top-right nav).
- **Associate `.scft` files with the app (open on double-click)** — Project files (`.scft`) now launch and open in SlideCraft via **double-click / "Open with"**. If the app is already running, it opens as a **new tab** without disturbing what you currently have open.
- **Surface AI-authored decks from Live MCP in a GUI background tab** — When an upstream AI creates a new deck during collaboration, it appears as a background tab in the GUI (the active view does not switch).
- **Four built-in templates** — Added "配布資料 公文書高密度 / ビジュアルデッキ マガジン / 技術報告 スタンダード水色" alongside the existing Midnight Executive. See [Templates](/en/guide/templates).
- **Higher-fidelity preview/HTML rendering** — Renders template background images and gradients, group shapes, and shapes (ellipse / arrow / custom geometry).
- **Starts empty** — Removed the default sample Markdown so you can start from a blank state.

### Changed

- **Shortened the project file extension from `.slidecraft` to `.scft`** — A shorter, easier-to-handle 4-character extension.

### Fixed

- Fixed **"+ Add slide" doing nothing on an empty deck**.
- Fixed **AI-authored decks always being named "Untitled" on the collaboration host** (now named from the first heading).

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
