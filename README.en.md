<p align="right">
  <a href="README.md"><kbd>日本語</kbd></a>
  <kbd><b>English</b></kbd>
</p>

# SlideCraft

**Your template stays yours. Your workflow stays yours. Only the finished slides look hand-crafted.**
SlideCraft inherits the design from your company's slide master, keeps you in the deck-editing flow you already know, and turns diagrams and tables alike into **editable PPTX** — slides indistinguishable from ones a person built one at a time.

> 📖 Learn how to use it at the **[documentation site](https://zyuuryuu.github.io/slidecraft/en/)** —
> [Installation](https://zyuuryuu.github.io/slidecraft/en/guide/installation.html) ·
> [Getting Started](https://zyuuryuu.github.io/slidecraft/en/guide/getting-started.html) ·
> [Markdown](https://zyuuryuu.github.io/slidecraft/en/guide/markdown-authoring.html) ·
> [Diagrams](https://zyuuryuu.github.io/slidecraft/en/guide/diagrams.html) ·
> [AI setup](https://zyuuryuu.github.io/slidecraft/en/guide/ai-setup.html) ·
> [MCP](https://zyuuryuu.github.io/slidecraft/en/guide/mcp.html) ·
> [FAQ](https://zyuuryuu.github.io/slidecraft/en/guide/faq.html)

Built with Tauri v2 + React + TypeScript. **Apache-2.0**.

## Why SlideCraft

Plenty of tools let you "write slides in Markdown." What makes SlideCraft different: **it inherits your company's slide master as-is, produces real, editable PowerPoint that's indistinguishable from hand-built decks, and does it with the least computation possible.**

- 🎯 **Fill the template, never break it** — Pour Markdown into the placeholders of your existing `.pptx` template. Fonts, colors, layouts, and master styling stay exactly as they were.
- ✏️ **Not images — editable shapes** — Diagrams, tables, and charts are emitted as **native PPTX shapes**. Whoever receives the deck can tweak them right inside PowerPoint.
- 🧠 **A deterministic engine handles placement** — Layouts are chosen automatically from the template's roles (**works with any master**), body text is fit within its capacity, overflow is split automatically without shrinking fonts, and color contrast is guaranteed.
- ⚡ **Minimal computation, guaranteed quality** — Because a deterministic engine handles formatting, placement, and validation, all the AI has to do is write Markdown. **A small local model is enough, and token use stays minimal.** AI output is checked by an adoption gate before it's applied (*harness over model*).
- 👁 **Preview = output** — Preview, PPTX, and HTML share the **same rendering engine**. No more "the preview didn't match the real thing."
- 📊 **12 native diagram types + Mermaid** — Flowcharts, Gantt charts, KPIs, radar charts, and more — from a few lines of YAML, as editable shapes.
- 🔒 **Local-first + AI** — A desktop app with built-in offline AI (llamafile). Your data stays with you. You can also drive it from an upstream AI over [MCP](https://zyuuryuu.github.io/slidecraft/en/guide/mcp.html).

## Installation

### End users (distributed builds)

- **macOS (Apple Silicon)** — The Homebrew tap is the cleanest route (`brew` strips the quarantine attribute, so even an ad-hoc-signed build opens without a first-run warning):

  ```bash
  brew install --cask zyuuryuu/slidecraft/slidecraft
  ```

  If you downloaded the `.dmg` directly, on first launch right-click in Finder → "Open", or run `xattr -dr com.apple.quarantine /Applications/SlideCraft.app`. An Intel Mac build is not currently available.
- **Windows / Linux** — Grab `.msi` / `.exe` (Windows) or `.AppImage` / `.deb` / `.rpm` (Linux) from [Releases](https://github.com/zyuuryuu/slidecraft/releases).

See the [installation guide](https://zyuuryuu.github.io/slidecraft/en/guide/installation.html) for details.

### Development (from source)

Prerequisites: Node.js 20+ / Rust 1.70+ / on Linux, `libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev patchelf`.

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft && npm install
npm run tauri dev    # Launches Tauri + Vite together (npm run dev is the browser demo)
```

## Development commands

```bash
npm test             # Unit tests (Vitest)
npm run typecheck:mcp # Type-check the MCP layer (app build excludes src/mcp)
npm run lint         # ESLint
npm run test:e2e     # E2E (Playwright)
npm run build        # Frontend build (tsc + vite)
npm run tauri build  # Generate installers
npm run docs:dev     # Run the documentation site (VitePress) locally
```

For contribution steps and coding conventions, see the [development & contribution guide](https://zyuuryuu.github.io/slidecraft/en/guide/contributing.html).

## Project structure

```text
src/
  engine/            # Pure logic (no DOM/Tauri API dependencies)
    diagram-painter.ts # Shared painter (preview SVG = native PPTX shapes)
    placeholder-filler.ts # Markdown → PPTX template fill
    template-writer.ts # TemplateSpec → template PPTX generation
    …
  components/        # React UI / ipc/ # Tauri IPC / mcp/ # MCP server
src-tauri/           # Rust backend (sidecar, keychain, model download)
tests/ · tests/e2e/  # Vitest / Playwright
docs/                # Documentation site (VitePress), ADRs, design
public/templates/    # Slide masters (.pptx)
```

## Tech stack

Tauri v2 (Rust) / React 19 + TypeScript 5.9 / Vite 8 / CodeMirror 6 / shared painter (native-shape SVG) plus Mermaid.js in places / PptxGenJS / Zod / Tailwind CSS 4 / Vitest + Playwright / built-in AI = llamafile.

## Documentation

- 📖 **[Documentation site](https://zyuuryuu.github.io/slidecraft/en/)** — how to use it (installation, getting started, Markdown, diagrams, templates, AI, MCP, FAQ)
- [SKILL.md](SKILL.md) — usage skill for upstream AI (the procedure and contract for authoring decks over MCP)
- [MCP server spec](docs/mcp-server.md) — all tools, resources, and error contracts
- [Architecture Decision Records (ADRs)](docs/adr/) / [Roadmap](docs/ROADMAP.md) / [Shipped log](docs/shipped.md) / [Detailed design](docs/design/)
- [Releasing](RELEASING.md) — versioning policy and release procedure

## Code signing

Windows installers will be Authenticode-signed with the [SignPath Foundation](https://signpath.org/)
certificate once the project is approved (currently unsigned). See the
[Code Signing Policy](CODE_SIGNING_POLICY.md) for the build, signing, and key-management approach.
macOS uses ad-hoc signing + Homebrew; Linux is unsigned.

## License

**Apache License 2.0** — full text in [LICENSE](LICENSE). For attribution of third-party components, bundled binaries, and
AI model weights downloaded at runtime, see [NOTICE](NOTICE) / [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Community: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · security reports: [SECURITY.md](SECURITY.md) · contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
