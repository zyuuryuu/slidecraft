# SlideCraft Code Review Guidelines

## Always check

- New `src/engine/` modules have corresponding tests in `tests/`
- OOXML placeholder styles use lstStyle with **diffs only** from master — never hardcode full font/size/color (breaks slide master editing)
- `DiagramSpec` / `Node` / `Edge` type changes are flagged (R4: schema.ts changes have wide impact)
- Markdown parser changes preserve round-trip fidelity (parseMd → serializeMd → parseMd)
- Template PPTX modifications preserve all 151 placeholders across 30 layouts
- Mermaid reserved words (end, graph, etc.) are escaped in preview

## Skip

- `src-tauri/target/` and `src-tauri/gen/` (Rust build artifacts)
- `node_modules/`, `dist/`, `test-results/`
- `reference/` (Python reference code, not part of TS build)
- `package-lock.json` changes (auto-generated)

## Style

- 400-line file limit (R1)
- `src/engine/` is pure logic — no DOM, no Tauri API, no browser APIs (R2)
- Commit messages follow `<type>: <description>` convention
- No `console.log` in production code
- No `@vitest.skip` or weakened assertions

## OOXML-specific

- Template style hierarchy: Theme (font names) → Master (default size/color) → Layout lstStyle (diffs only) → Slide (text only)
- Slide XML should have empty `<p:spPr/>` to inherit from layout
- Always use `p:ph idx="N"` to reference layout placeholders, never create new shapes
