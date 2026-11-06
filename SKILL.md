---
name: slidecraft
description: >-
  Author polished PowerPoint (.pptx) decks from Markdown via SlideCraft's MCP server. Use when the
  user wants slides built or edited from text with a template's fonts, colours and layouts preserved.
  You write Markdown and pick diagram types; the deterministic engine fills the template, keeps every
  slide on-budget and exports native (editable) PPTX shapes.
---

# SlideCraft — authoring skill (bootstrap-first)

The server speaks the full contract itself (tool descriptions + `bootstrap`); this file is only the order of operations.

1. **Connect**: register `slidecraft serve` (stdio) once; prefer `--root <dir>` so files stay on the user's machine.
2. **Bootstrap**: call `bootstrap` once per session. It returns this template's authoring guide (layout names,
   Markdown rules, body budget, review rules, result contract), the diagram type menu, the template-spec
   guide, template capabilities and the template list. Pull one type's syntax with `get_diagram_guide(type)`
   only when you place that type.
3. **Start a deck**: `list_templates` → `use_template(id, markdown?)`; or `new_project(templateBase64 |
   templatePath, markdown?)` when the user supplies a `.pptx`; or `create_template(spec)` → `new_project`.
4. **Author**: `set_slide_markdown(index, md)` per slide (figures preserved); `set_slide_diagram(index, source,
   format)` for figures; `insert_slide` / `delete_slide` / `move_slide` / `duplicate_slide` for structure.
   Avoid `set_deck_markdown` (whole-deck replace, drops figures).
5. **Fix by diagnosis, not by eye**: call `get_deck_issues` and apply the deterministic levers first —
   `split_overflowing_slides` for overflow, `convert_bullets_to_table(index)` for key-value bullets — then
   rewrite what remains as content. Repeat until the list is empty. The diagnostics are never-silent
   (overflow, collisions, unbound content and unknown layout pins all surface): do NOT screenshot each round.
6. **Look once**: when `get_deck_issues` is clean, do ONE visual pass — `get_deck_image()` (the whole deck as one
   labeled contact sheet; `get_deck_html()` without a browser), then `get_slide_image(index)` only to zoom in. Then stop.
7. **Ship**: `validate_deck` (export gate) → `export_pptx`. Both return `{path}` under `--root`, else `{dataBase64}`.

**Success / failure**: a call succeeded iff its result has neither `ok:false` nor `isError`.
`{ok:false, error, code}` is a modelled refusal (a normal result): read `error`, fix, retry.

**You never touch bytes** (cloud AI × desktop app): with `--root`, templates come from `list_templates` /
`use_template` or a bare `templatePath`; outputs are written by `export_pptx` / `save_project`. Tell the user the
returned `{path}` — never `cp`, stage or re-encode files yourself. base64 and `path` / `filename` never mix in one call.

Human reference (tool table, envelope spec, `--root` round-trip, `get_slide_image` browser setup):
[docs/mcp-server.md](docs/mcp-server.md).
