---
name: slidecraft
description: >-
  Author polished PowerPoint (.pptx) decks from Markdown via SlideCraft's MCP server. Use when the
  user wants slides/a presentation built or edited from text, with a company template's fonts, colours
  and layouts preserved. You write Markdown + pick diagram types; SlideCraft's deterministic engine
  fills the template, keeps everything on-budget, and exports native (editable) PPTX shapes.
---

# SlideCraft — authoring skill for upstream AI

SlideCraft turns **Markdown/YAML → PowerPoint**, filling a template's placeholders so **fonts and
layouts never break**. You (the AI) are the language model; the MCP tools are the deterministic engine
ops — the server never calls a model. Your job: acquire a template, learn its authoring contract,
write slide Markdown, and follow the never-silent feedback loop until the deck is clean.

## Connect

One command — `slidecraft serve` (alias `slidecraft mcp`) — speaks MCP over stdio; register it **once**.
At startup it discovers whether the desktop GUI is already hosting a live collab session and adapts:

- **GUI running → you join it**: your edits relay to the GUI's control plane and the human sees them
  live. Pick the doc the GUI opened via `select_document` (or the sole doc resolves automatically).
- **No GUI → solo**: the same command runs its own single-doc control plane — full authoring, plus
  server-side `undo` / `redo`. No second config, no second endpoint.

Either way there is **one control plane** (deck authority + undo history); you don't pick the mode —
rendezvous is decided once, at startup. By default (`--no-fs`) bytes cross as base64, no filesystem
touched. If the server was started with `--root <dir>` (ADR-0035), both directions can use that scoped
directory instead of base64: `export_pptx`/`save_project` write under it and return a `{path}`
reference (pass an optional `filename` or let one be auto-generated), and `open_project`/`new_project`
can read a file already placed there via `path`/`templatePath` (a bare filename, not the `path` you got
back — see [`docs/mcp-server.md`](docs/mcp-server.md) for the write→read round-trip). base64 and a
scoped path/filename are mutually exclusive on every call — passing both is a never-silent error.

## Core contracts (read once)

- **Never-silent**: a modelled precondition failure returns `{ ok:false, error, code }` (a normal
  result, not a crash). `isError:true` is reserved for genuine crashes. Never assume a no-op succeeded.
- **Success = no `ok:false`, no `isError`**: reads (`get_deck` etc.) and `export_pptx` return their
  payload as-is with no `ok` key at all — its absence already means success; it is not backfilled onto
  reads, since that would break the tool↔resource mirror equality.
- **Mutation envelope**: content mutations return `{ ok, changed, beforeMd?, afterMd?, diagnostics,
  budget?, hints, ... }`. `changed:false` = a real no-op (nothing to undo). `hints` tells you the next tool.
- **schema is frozen**: you author *content*; you cannot change slide roles/layout names arbitrarily —
  `autoSelectLayout` resolves any template role-based (alien-safe).
- **Budget-aware**: each `get_deck_issues` / envelope carries the deck's body budget. Author within it;
  when a slide overflows, use the deterministic split lever rather than shrinking fonts.

## The authoring loop

1. **Acquire a template** (one of):
   - **Solo (no GUI) → start from `create_template`**: `create_template(spec?)` — no bytes needed:
     `spec` is a **JSON string** (not an object), e.g. `spec: '{}'` for the MIDNIGHT preset, or a
     partial TemplateSpec string with name + 2 fonts + a 9-colour palette; the harness
     contrast-guards + writes the PPTX. Then `new_project(templateBase64)`. Format via
     `get_template_spec_guide`.
   - `list_templates` → `use_template(id, markdown?)` — discover a template, then start from it in one
     call. In a collab host this lists the GUI's registered templates; solo (no GUI attached) it
     returns built-in presets (`builtin:true`, e.g. `midnight`) and mints via the same
     `create_template` harness — no bytes needed either way.
   - `new_project(templateBase64, markdown?)` — you already have `.pptx` bytes. If the server has a
     `--root` scope, `new_project(templatePath, markdown?)` reads the template file from that
     directory instead (and `open_project(path)` likewise for an existing `.slidecraft`) — no base64.
2. **Read the contract**: `get_authoring_guide()` — this template's resolved layout names, the Markdown
   rules (slide separators, `<!-- col/kpi/step -->` region markers, GFM tables, code, `<!-- note -->`
   speaker notes), body budget, and pointers. This is your single entry point; read it before authoring.
3. **Write slides**: `set_slide_markdown(index, markdown)` per slide (figures/mermaid on a slide are
   auto-preserved). `get_slide(index)` gives a one-call structured edit plan (resolvedLayout, hasFigure,
   bulletCount, budget, overBudget, this slide's issues, notes, markdown).
   - **Speaker notes / briefing style**: put `<!-- note -->` on its own line; everything after it
     (until the next `---`) is that slide's speaker notes — plain Markdown, invisible on the slide,
     exported as native PPTX notes. Prefer **sparse slides + rich notes**: keep the slide to the
     takeaway, move the narration into notes instead of overflowing the body budget.
   - **Sections & TOC (drift-proof)**: tag an author-written chapter-cover slide with
     `<!-- section -->` (chapter name stays a `#` heading); a block holding ONLY `<!-- toc -->`
     becomes a derived TOC slide whose content (numbers + names) is always re-derived from the
     section-tagged slides. Never write TOC content by hand — rename a chapter cover and the TOC
     follows automatically, so the TOC can never diverge from the deck (G2).
4. **Add figures**: `get_diagram_types()` → pick from the **12 authorable types** (flowchart, network,
   orgchart, sequence, timeline, quadrant, pie, gantt, journey, xychart, radar, kpi) → `get_diagram_guide(type)`
   for its syntax → `set_slide_diagram(index, source, "yaml"|"json"|"mermaid")`. `source` is a **JSON/YAML
   or Mermaid string** (not an object), e.g. `source: '{"type":"flowchart","nodes":[...],"edges":[...]}'`.
   class/state/ER/mindmap are Mermaid-only. Positioning/layout of a figure = `apply_design_intent(index, intent)`
   (regionSplit/emphasize/relayout) — `intent` is also a **JSON string** of an ops array, e.g.
   `intent: '[{"op":"relayout","direction":"LR"}]'`.
5. **Structure ops** (figures preserved, unlike a whole-deck rewrite): `insert_slide` / `delete_slide`
   (last slide never-silent refused) / `move_slide` / `duplicate_slide`.
6. **Feedback loop**: after edits call `get_deck_issues()` → it returns CONTENT levers (split / condense /
   visualize / title) + budget + `hints`. Apply the deterministic levers where they fit —
   `split_overflowing_slides()` (overflow), `convert_bullets_to_table(index)` (key-value bullets) — then
   fix the rest as content. Re-diagnose. Repeat until clean.
7. **Validate + export**: `validate_deck()` (EXPORT gate: schema + unsupported-mermaid scan →
   `exportReadiness`) → `export_pptx(onUnsupportedMermaid?)`. Native-vector only; unconvertible Mermaid
   (gitGraph/sankey/C4) is `reject` (default, precise error) or `skip` (drops that slide + reports it) —
   **never silently lost**. `save_project()` returns the round-trippable `.slidecraft` bytes. Both
   return `{dataBase64}` by default, or `{path}` (an absolute `file://` URI under the scope — nothing
   on the wire) when the server has a `--root` scope configured.

## Rules of thumb

- **See your work**: `get_slide_image(index)` returns a PNG of a slide's *current* shared rendering
  (fonts embedded — the same painter as the preview / HTML export, so #105's drawing fixes apply for
  free) so you can visually check an edit didn't break the layout. It uses a **locally installed
  Chrome/Edge only** — never bundled or auto-downloaded (a stale bundled browser is a security risk).
  Absent → never-silent `{ok:false, code:"browser-not-found"}` guiding you to set `SLIDECRAFT_BROWSER`.
  Optional: authoring never depends on a screenshot.
- Embedded images are **`data:image/…` data URIs only** (portable, XSS-safe). Other schemes become text.
- Prefer `set_slide_markdown` (surgical, figure-preserving) over `set_deck_markdown` (whole-deck replace,
  drops figures) for single-slide edits.
- Trust the harness: it guarantees "right layout, fonts kept, template-compliant". Keep the Markdown
  clean and on-budget; let the engine place it.

## References

- Full tool list, envelope spec, resources, typical loop: [`docs/mcp-server.md`](docs/mcp-server.md)
- End-user context (what the deck/app can do): [ドキュメントサイト](https://zyuuryuu.github.io/slidecraft/)
  ／[MCP ガイド](https://zyuuryuu.github.io/slidecraft/guide/mcp.html)
- The authoring contract is self-describing at runtime via `get_authoring_guide` — always prefer it over
  this file for the *current* template's exact rules.
