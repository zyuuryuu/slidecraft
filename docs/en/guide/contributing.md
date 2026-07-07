# Development & Contribution Guide

Thank you for taking part in SlideCraft's development. This page walks through the whole flow: running
SlideCraft from source, making changes, testing, and sending a Pull Request.

If you only want to *use* SlideCraft, you don't need the source (see [Installation](/en/guide/installation)
to get a prebuilt installer). Everything from here on is **for developers**.

::: tip Assumptions on this page
Run every command from the repository root. We use `npm` as the package manager.
:::

---

## 1. Setting Up the Development Environment

### Prerequisite tools

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 or later | Frontend, tests, MCP |
| Rust | 1.70 or later | Building Tauri (the desktop shell) |

On Linux, building Tauri requires the following system packages (package names for Debian/Ubuntu-based distros):

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev patchelf
```

::: details If you don't have Rust yet
The easiest way is to install it via [rustup](https://rustup.rs/). Once `cargo --version` works, you're ready.
Rust is only needed to build Tauri (the desktop app); if you only work on the frontend in a browser, you don't need it.
:::

### Clone and install dependencies

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft
npm install
```

### Running it

There are two ways to launch, depending on your goal.

```bash
npm run dev          # Vite dev server only (localhost:5173, develop in the browser)
npm run tauri dev    # Tauri + Vite together (develop as the desktop app)
```

- **`npm run dev`** — for iterating on the UI quickly in the browser alone. You skip waiting on the Tauri (Rust) build.
  Features that depend on Tauri IPC — such as the built-in offline AI or desktop-only persistence — won't work.
- **`npm run tauri dev`** — runs the actual desktop app. The first run takes a while to compile Rust.

::: tip Developing on WSL
On WSL, launching Tauri may need extra setup. A helper `npm run tauri:wsl`
(a wrapper around `scripts/tauri-dev-wsl.sh`) is provided.
:::

For the dual desktop/browser setup and the thinking behind AI integration, see [AI Setup](/en/guide/ai-setup);
for upstream agent integration, see [MCP](/en/guide/mcp).

---

## 2. Testing

SlideCraft follows a **test-first implementation** policy (rule R3, below). Write the test first, confirm it
fails, and only then implement.

### Unit tests (Vitest)

```bash
npm test              # Run all unit tests once (vitest run)
npm run test:watch    # Watch for changes and re-run (during development)
```

This is where the core logic — engine coordinate math, placeholder filling, and so on — is protected.

### Type checking

`npm test` (Vitest / esbuild) **does not check types**. Tests can be green while `tsc` is broken.
Always make the build / type check pass before calling something "done."

```bash
npm run build           # tsc -b (type check) + vite build (production frontend build)
npm run typecheck:mcp   # Type check the MCP server side (tsconfig.mcp.json)
```

::: warning Green tests don't mean green types
`npm test` can pass while `npm run build` (`tsc -b`) fails.
Make it a habit to pass both `npm run build` for the frontend and `npm run typecheck:mcp` for the MCP side.
:::

### E2E tests (Playwright)

```bash
npm run test:e2e      # E2E including browser interactions (playwright test)
```

::: warning Testing drag interactions
Native HTML5 drag-and-drop breaks in Tauri's WebView (WebKitGTK / WKWebView).
DnD is implemented with pointer events, and `dragTo` falsely turns green in E2E as well, so we don't use it
(we build up `mouse.down` / `move` / `up` directly to verify).
:::

### Linting

```bash
npm run lint          # ESLint
```

### Pre-submission checklist

Before opening a PR, make sure at least these three are green.

```bash
npm test              # Unit tests
npm run build         # Type check + frontend build
npm run typecheck:mcp # MCP type check
```

---

## 3. Branch and Pull Request Flow

### Branch naming

```
claude/<topic>-<session-id>
```

Keep `topic` short and in English. `session-id` is assigned automatically.

### Where to work

| Situation | Where to work |
|---|---|
| Independent feature additions (new theme, new icon, new test suite) | **Separate branch** |
| Tasks delegated to a Sub Agent | **Separate branch** |
| E2E tests / installer work | **Separate branch** |
| Type changes spanning multiple files inside `src/engine/` | **Directly on main** (wide blast radius) |
| Refactors that touch `schema.ts` | **Directly on main** |
| Minor changes such as typos or comment fixes | **Directly on main** |

### Merge protocol

1. **PRs are recommended** to preserve history. Minor follow-ups may be merged directly.
2. Review the diff before merging: `git diff HEAD origin/<branch> --stat`
3. If conflicts arise, confirm with the user before resolving them.
4. After merging, delete **both the remote and local** branches.

::: tip Use the gh CLI for GitHub operations
Use the `gh` CLI to create PRs / Issues and call the API. Note that interactive flags
(such as `git rebase -i`) are not supported in this environment.
:::

---

## 4. Key Coding Conventions

The full set lives in the repository's `CLAUDE.md`, but these four matter most when making changes.

### R1: 400 lines or fewer per file

A maintainability cap. Split into modules once you exceed it. `layout-engine.ts` is historically on the
large side, but **any further bloat is prohibited**.

### R2: `engine/` is pure logic (no DOM / Tauri API)

Everything under `src/engine/` must be pure computation logic that depends on none of the Node.js, browser,
or Tauri APIs. Confine DOM manipulation and Tauri IPC to `src/components/` or `src/ipc/`. This lets the engine
be reused as-is across tests, MCP, and preview.

### R3: Test-first

For both new features and bug fixes, **write the test first and confirm it fails** before implementing (see Section 2).

### R4/R5: Diagram coordinates within ±1% of the Python reference

The coordinate math in `layout-engine.ts` must match the Python reference implementation (`diagram_renderer.py`)
**within ±1%**. This is verified by golden-file tests, so whenever you touch the coordinate logic, confirm you
don't break this tolerance.

::: warning Changes that require user confirmation
Changes to the types in `schema.ts` (`DiagramSpec` / `Node` / `Edge`, etc.) ripple across every module.
Always confirm with the user before you start. Coordinate-logic changes in `layout-engine.ts`, and refactors
spanning multiple `engine/` files, are also handled in the main session rather than delegated to a Sub Agent.
:::

### What not to do

- Overusing the `any` type (keep it to the bare minimum)
- Careless use of `// @ts-ignore` / `// @ts-expect-error`
- Leaving `console.log` debugging in place (temporary use during development aside)
- Hardcoded secrets / API keys
- Disabling tests with `.skip`
- Weakening test assertions (e.g. downgrading `toEqual` to `toBeTruthy`)
- Settling for workarounds — **identify the cause and fix it at the root** (R6)

For diagram specs and types (the 12 `diagram` types plus 4 via `mermaid`), see [Diagrams](/en/guide/diagrams).
Constraints such as embedded images being `data:` URIs only, and `gitGraph` / `sankey` / `C4` not being exportable
to PPTX, are collected in [Markdown](/en/guide/markdown-authoring) and the [FAQ](/en/guide/faq).

---

## 5. Commit Message Convention

```
<type>: <簡潔な説明>

<詳細（任意）>

NEXT: <次にやるべきこと — ファイル名と変更内容を1行で>
```

**type** is one of: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`.

The `NEXT:` line is for handoff when you pause work. Leave a one-line note of the next file you'll touch and what changes.

```text
feat(image): 最背面レイヤー — 既存を壊さず画像を背面に敷く

コンテンツありのスライドは自動で behind に切り替える。

NEXT: image-layer.ts のリセットボタン挙動をラベルと一致させる
```

---

## 6. Working with ADRs (Architecture Decision Records)

When you make a design decision that is important or irreversible and whose rationale isn't self-evident,
add **one ADR** under `docs/adr/`.

### How to write them, and the principles

- Number it by incrementing the last one (e.g. next is `0022-...md`).
- Write each ADR in four sections: **`Context / Decision / Consequences / References`**.
- ADRs are **immutable** in principle (don't change them). When you reverse a decision, don't rewrite the old ADR;
  **supersede it with a new ADR** and change the old one's Status to `Superseded`.
- Add one line to the index (`docs/adr/README.md`) as well.

### Separate documents by their role

| Kind | Location | Nature |
|---|---|---|
| Record of decisions | `docs/adr/` | Decided & implemented. Immutable |
| Forward-looking plans | `docs/ROADMAP.md` | Future items only. **Remove from the table once done** (history stays in ADR + git) |
| Detailed design | `docs/design/` | Supporting material referenced from ADRs |
| How-to | `docs/mcp-server.md`, etc. | Guides for end users / integrators |

Once a feature or phase is complete, (1) add or update the relevant ADR, (2) remove the completed item from the
ROADMAP, and (3) record the test count in the git commit / PR.

::: tip When should you write an ADR?
The criteria are two axes — **is it important/irreversible?** × **is the rationale non-obvious?**
Only make an ADR out of things that fit both. There's no need to turn every obvious small change into an ADR.
:::

---

## 7. About Releases

Releases are done by maintainers. The version has a single source of truth in `src-tauri/tauri.conf.json`,
and propagates automatically to other files via `npm run version:set <x.y.z>` (don't rewrite them by hand
individually). For the detailed procedure, see the repository's `RELEASING.md`.

---

## Related Pages

- [Installation](/en/guide/installation) — Getting the distributed build (for users who don't need to develop)
- [Markdown](/en/guide/markdown-authoring) — Syntax and constraints
- [Diagrams](/en/guide/diagrams) — 12 native diagram types plus 4 via `mermaid`
- [Templates](/en/guide/templates) — The source of the look
- [AI Setup](/en/guide/ai-setup) — Built-in offline AI
- [MCP](/en/guide/mcp) — Upstream agent integration
- [FAQ](/en/guide/faq) — Frequently asked questions
