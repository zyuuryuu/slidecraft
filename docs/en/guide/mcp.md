# MCP Integration (Drive It from an AI Agent)

SlideCraft ships a **headless stdio MCP server** (`slidecraft serve`) that lets
**upstream AI agents** such as Claude Desktop or Claude Code assemble slides.

The agent (the LLM) decides what goes into the slides, while SlideCraft's
**deterministic engine** handles layout selection, body-text splitting, validation,
and PPTX generation. Separating these roles lets you hand slide creation to an AI
that produces polished decks without breaking your template's fonts or color scheme.

- **The agent is the LLM**: The server never calls an LLM itself. It exposes only deterministic engine operations.
- **Headless**: It is a Node process that needs no webview and no browser (it runs independently of the GUI version).
- **No cloud transmission**: `slidecraft serve` itself sends nothing externally (see the egress section below).

::: tip What this page is
This is a **user-oriented overview** to help you grasp the "why and how" of connecting.
The **full specification** — every tool's arguments, return values, and error contract —
is collected in
[docs/mcp-server.md (GitHub)](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md).
:::

---

## Why MCP

Separate from the visual editor (writing in [Markdown notation](/en/guide/markdown-authoring) and checking in WYSIWYG)
and the [built-in offline AI](/en/guide/ai-setup), MCP adds value in situations like these.

- **You want to hand slide creation to your own agent** — Ask "turn this into slides" in the flow of a conversation,
  and the agent calls SlideCraft's tools to assemble them and write out a `.pptx`.
- **You want to run batches without launching the GUI** — Because it is headless, you can generate
  deterministically from a script or agent without starting a webview.
- **You want the engine's guarantees as-is** — The engine guarantees automatic layout selection, splitting of overflowing body text,
  and template compliance, so the agent can **focus on content** (harness-over-model).

Because of this division of labor, the server exposes only deterministic operations — "read," "edit," "validate," "output" —
and leaves the intelligence (what to write) on the agent side.

---

## Setup — Two Paths

The MCP server communicates over stdio (standard input/output), and the agent normally spawns the process. **The MCP server is bundled with the app**, so in most cases no build is required.

### A. Use the packaged version (no build required, recommended)

The distribution installers (brew / .msi / .AppImage) **bundle a self-contained MCP server (`cli.cjs`) together with a Node runtime** (**bundled since v0.2.0**). It works even if Node is not installed on the system and without cloning the source.

**macOS (Homebrew)** — the cask places `slidecraft-mcp` on your PATH, so you can register it as-is:

```bash
brew install --cask zyuuryuu/slidecraft/slidecraft   # skip if already installed
claude mcp add slidecraft -- slidecraft-mcp           # for Claude Code
```

When registering via mcp.json in Claude Desktop / Cursor, write `{"command": "slidecraft-mcp"}`. To point directly at the bundled node plus cli.cjs without using the launcher, see "Two ways to use it" in the [MCP server specification](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md).

### B. Launch from source (development version)

Clone the source and build it. This path is for customizing agent integration or debugging the engine.

```bash
npm install
npm run build:mcp        # → generates dist/mcp/cli.js (esbuild, Node ESM; node_modules externalized = run inside the repo)
node dist/mcp/cli.js     # waits as an MCP server over stdio (normally the agent launches it)
```

::: warning v1 limitation (--no-fs only)
The current version does not touch the filesystem. The bytes of `.slidecraft` / `.pptx`
are exchanged **as base64 over stdio** (the trust boundary is "the parent agent that launched it" = the OS user).
A scoped fs (`--root`) limited to the project directory subtree is planned for the next version;
for now, passing `--root` exits with an error.
:::

::: details Prerequisites for running from source
`slidecraft serve` imports only the pure TS engine (`src/engine/*`) and does not depend on DOM/Tauri.
Building from source requires Node.js 20+ (see "Running from source" in [Installation](/en/guide/installation)).
:::

---

## Connecting from an Agent

Below are registration examples for the **packaged version (A, recommended)**. On macOS with brew installed, `slidecraft-mcp` works as-is.

### Claude Code

```bash
claude mcp add slidecraft -- slidecraft-mcp
```

### Claude Desktop / Cursor

Register it under `mcpServers` in `claude_desktop_config.json` (`mcp.json` for Cursor).

```json
{
  "mcpServers": {
    "slidecraft": {
      "command": "slidecraft-mcp"
    }
  }
}
```

::: details Registering on Windows / Linux, or with the source version (B)
PATH registration of `slidecraft-mcp` is currently macOS/Homebrew only. On Windows/Linux, register with the **absolute path to the bundled node plus `cli.cjs`** (confirm the install location). For the source version (B), set `command` to `node` and `args` to `["/absolute/path/to/slidecraft/dist/mcp/cli.js"]` (an absolute path). In Claude Code: `claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js`. For details on direct paths, see the [MCP server specification](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md).
:::

After registration, SlideCraft's tools (described below) become visible to the agent.

---

## Setting Up the Skill (SKILL.md)

An MCP connection hands over **tools** (engine operations). In addition, giving the agent **a procedure for "how to author"**
lets it reliably produce the deck you intend. That procedure lives in
[`SKILL.md`](https://github.com/zyuuryuu/slidecraft/blob/main/SKILL.md) — it condenses onto a single page the flow of
connect → provision a template → `get_authoring_guide` → `set_slide_markdown` → diagrams → the `get_deck_issues` feedback loop →
`validate_deck`/`export_pptx`, along with contracts such as never-silent, the envelope, and `data:image` only.

**How to hand it over (by agent):**

- **Claude Code / Agent Skills** — **place `SKILL.md` as a skill** (with `name` / `description` in the frontmatter).
  When working inside the repository, it is read as-is.
- **Claude Desktop and the like** — at the start of the conversation, **hand over the contents of `SKILL.md` as system instructions / context** (paste or attach).

::: tip The runtime contract takes precedence
`SKILL.md` is a **generic procedure**. The **exact formatting, layout names, and body budget** for the template currently loaded
are always most-current and authoritative in the **self-describing contract** that `get_authoring_guide()` returns at runtime.
Tell the agent to "read `get_authoring_guide` first" (`SKILL.md` states this too).
:::

---

## Overview of the Main Tools

The server exposes many tools, but the flow you need to remember is simple. First, use **`get_authoring_guide`**
to receive "how to write for this template," then author accordingly. That is the basic loop.

### Entry points (open / create a project)

| Tool | Role |
|---|---|
| `open_project(dataBase64)` | Loads a base64 `.slidecraft`. Returns `{slideCount, diagnostics, contract}` |
| `new_project(templateBase64, markdown?)` | Creates a new project from a base64 `.pptx` template (plus optional Markdown). Goes through the same formatting path as the GUI's Draft |
| `create_template(spec?)` | When there are no template bytes, **generates a template PPTX** from a name, fonts, and a 9-color palette and returns it. Missing pieces are filled from a preset |

### Read the contract (learn how to write)

| Tool | Role |
|---|---|
| `get_authoring_guide()` | **The entry point for authoring.** Markdown formatting resolved to this template's layout names, separator comments (`<!-- col/kpi/step -->`), tables/code, the body budget, and pointers to the diagram guide |
| `get_diagram_types()` | The menu of diagram kinds (the **12** authorable types) |
| `get_diagram_guide(type)` | The syntax plus a JSON example for the chosen diagram type |

Choosing between diagram styles works the same as in the visual editor. The **12** native types go in ` ```diagram ` (DiagramSpec),
while `class` / `state` / `ER` / `mindmap` go in ` ```mermaid `. See [Diagrams](/en/guide/diagrams) for details.

### Read / edit slide content

| Tool | Role |
|---|---|
| `get_slide(index)` | A **structured read** of one slide (resolved layout, presence of a diagram, bullet count, budget, capacity — measured body usage, predictedSplit — a split dry-run, that slide's issues, Markdown). One call is enough to plan an edit |
| `get_slide_markdown(index)` | The raw Markdown of one slide (layout already resolved) |
| `set_slide_markdown(index, markdown)` | Replaces one slide (diagrams/mermaid are auto-preserved, validated, and invalid input is never-silent rejected) |
| `set_slide_diagram(index, source, format, ...)` | Sets a diagram from DiagramSpec/Mermaid. Replaces an existing diagram, or adds to the body area on a text slide |
| `apply_design_intent(index, intent)` | Applies **spatial intent** to a diagram (text left / diagram right, node emphasis, orientation change). *Only for slides that have a diagram* |

::: warning Beware of replacing the whole deck
`set_deck_markdown(markdown)` replaces the entire deck, and **diagrams are not preserved**.
When you want to fix just one slide, use `set_slide_markdown` or `insert_slide`.
:::

### Structure operations (slide order)

| Tool | Role |
|---|---|
| `insert_slide(index, markdown, position?)` | Inserts one slide before/after (other slides' diagrams are preserved = surgical) |
| `delete_slide(index)` | Deletes (the last remaining slide is never-silent rejected) |
| `move_slide(fromIndex, toIndex)` | Reorders (diagrams/layout preserved) |
| `duplicate_slide(index, position?)` | Duplicates (diagrams/tables/code byte-identical) |

### Deterministic levers (automatic handling of overflow and formatting)

| Tool | Role |
|---|---|
| `split_overflowing_slides()` | Splits overflowing body text across multiple slides **without shrinking the font** |
| `convert_bullets_to_table(index)` | Key-value bullets → GFM table (succeeds with "nothing applicable" when there is no target) |

### Validate, save, and output

| Tool | Role |
|---|---|
| `validate_deck()` | Deck validation plus `exportReadiness` (scans for un-convertible Mermaid) |
| `save_project()` | Generates a `.slidecraft` and returns `{dataBase64}` |
| `export_pptx(onUnsupportedMermaid?)` | Generates a `.pptx` headlessly as native vectors and returns `{dataBase64, skipped}` |

::: tip Handling un-convertible Mermaid
The 12 native diagram types and tables come out as editable PPTX shapes. Convertible Mermaid also becomes native diagrams automatically.
On the other hand, **`gitGraph` / `sankey` / `C4` and the like cannot be drawn headlessly**, so `export_pptx` rejects them by default
(it does not silently drop them). Passing `onUnsupportedMermaid: "skip"` omits those slides and reports them in `skipped`.
You can check in advance via `exportReadiness` from `validate_deck`.
:::

---

## The Typical Loop (from the Agent's Point of View)

The flow an agent follows is roughly as follows.

0. **Provision a template** — Pass an existing `.slidecraft` to `open_project`, or a `.pptx` to `new_project`.
   If there are no bytes, generate one with `create_template(...)` and pass the returned `templateBase64` to `new_project`.
1. **Read the contract** — Grasp the formatting from the `contract` returned on open and from `get_authoring_guide`. To include a diagram,
   get the syntax via `get_diagram_types` → `get_diagram_guide(type)`.
2. **Author / edit** — One slide at a time with `set_slide_markdown(i, md)` (stay within the budget). For structure,
   `insert_/delete_/move_/duplicate_slide`; for diagrams, `set_slide_diagram`. Check state as a structured read with `get_slide(i)`.
3. **Follow the next move** — Follow the `hints` attached to each edit's return (deterministic — the same deck yields the same hints).
   Overflow → `split_overflowing_slides`; key-value → `convert_bullets_to_table(i)`.
4. **Validate** — Check `exportReadiness` with `validate_deck`.
5. **Output** — Write out the `dataBase64` from `export_pptx` to a `.pptx` yourself (or save a `.slidecraft` with `save_project`).

::: details How errors are returned (overview)
Every rejection returns as JSON with `{ ok: false }`, and only unexpected exceptions become `isError: true`.
Domain rejections (invalid Markdown, deleting the last remaining slide, etc.) carry only `error`; guard rejections (out-of-range index, not open, etc.)
carry a machine-readable `code`. For the full contract, see
[docs/mcp-server.md](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md).
:::

---

## Collaborative Host Mode (GUI Launches → AI Connects)

The usage above is the headless path where "the agent spawns the server," but there is also a collaborative mode where **the GUI (desktop version)
becomes the host**. The GUI embeds the server at launch, and the AI connects to it to edit.

- **Lifecycle for multiple documents** — Exposes `list_documents` / `select_document` / `close_document`, along with
  server-side `undo` / `redo` (host-only).
- **Using registered templates** — Once the GUI feeds a master registry into the host with `register_templates`,
  the AI can browse the list with `list_templates` and **mint a new project** with `use_template(id, markdown?)`.
  Because it can pick a template without carrying the bytes, this is the shortest path via the host.

This enables collaboration where the AI connects to and edits a deck the human is viewing in the GUI, and the human reviews the result.
When the GUI and AI edits conflict, it is detected via optimistic locking and the client re-fetches.

---

## About Data Transmission (Egress)

- `slidecraft serve` itself sends nothing to the cloud or to an LLM.
- However, **the moment you connect to an agent, the deck's contents are passed to that agent's model**.
  The very choice to "connect" is opt-in egress. When handling confidential slides,
  make the call based on whether you are connecting to a local or cloud agent.
- The GUI's AI Assist has a separate "local-model-only mode," which governs GUI → LLM transmission
  (a different boundary from the MCP path). See [AI Setup](/en/guide/ai-setup) for details.

---

## Related Pages

- [Diagrams](/en/guide/diagrams) — the 12 kinds of the `diagram` fence and how to write `mermaid`
- [Markdown Notation](/en/guide/markdown-authoring) — the grammar of the Markdown the agent writes
- [Templates](/en/guide/templates) — importing `.pptx` and creating new ones
- [AI Setup](/en/guide/ai-setup) — the built-in offline AI and local-model-only mode
- [FAQ](/en/guide/faq) — frequently asked questions
- [docs/mcp-server.md (GitHub)](https://github.com/zyuuryuu/slidecraft/blob/main/docs/mcp-server.md) — the full specification of all tools, resources, and the error contract
