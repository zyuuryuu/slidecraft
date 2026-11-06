/**
 * skill-md.test.ts — Issue #521 (ADR-0037 D2/D3: "the server speaks the contract").
 *
 * SKILL.md is the upstream AI's order of operations, NOT a second copy of the authoring contract: the
 * contract is what `bootstrap` returns (authoring guide / diagram types / template-spec guide /
 * capabilities / templates) plus the tool descriptions in tools/list. #516 measured the old 120-line
 * SKILL.md + its referenced docs at ≈67k chars re-sent as context on every call, and an AI that
 * screenshotted slides every round (31 of 73 calls). This file ratchets:
 *   1. size      — SKILL.md ≤ 40 lines / ≤ 4k chars (the Issue's acceptance bound);
 *   2. tool names — every `snake_case` tool the file cites exists in TOOL_PROFILES (no phantom tools),
 *                   and the loop's load-bearing tools are all named;
 *   3. mandates  — bootstrap-first, "trust the diagnosis, look once", "the AI never touches bytes",
 *                   and exactly ONE pointer to the human reference docs/mcp-server.md;
 *   4. checklist — each item REMOVED from SKILL.md is still spoken by the server (bootstrap response
 *                   or a tool description), so the compression moved information, it did not drop it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { TOOL_PROFILES } from "../src/mcp/tool-profiles";

const SKILL = readFileSync(resolve(__dirname, "../SKILL.md"), "utf8");

/** Backticked snake_case identifiers — the shape every MCP tool name has (`get_deck_issues`,
 *  `split_overflowing_slides(...)`). CLI flags (`--root`), keys (`ok:false`) and schemes
 *  (`data:image`) do not match, so the extraction is exactly "cited tool names". */
function citedToolNames(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/`([a-z]+(?:_[a-z]+)+)(?:\([^`]*\))?`/g)) out.add(m[1]);
  return [...out].sort();
}

/** The loop SKILL.md must still teach (Issue #521 fix policy 1–3). */
const LOAD_BEARING_TOOLS = [
  "bootstrap",
  "list_templates",
  "use_template",
  "new_project",
  "set_slide_markdown",
  "get_deck_issues",
  "split_overflowing_slides",
  "convert_bullets_to_table",
  "get_slide_image",
  "validate_deck",
  "export_pptx",
];

describe("SKILL.md — size ratchet (#521: ≤ 40 lines, ≤ 4k chars)", () => {
  it("is at most 40 lines", () => {
    const lines = SKILL.replace(/\n$/, "").split("\n").length;
    expect(lines).toBeLessThanOrEqual(40);
  });
  it("is at most 4,000 characters", () => {
    expect(SKILL.length).toBeLessThanOrEqual(4000);
  });
  it("keeps the Agent-Skills frontmatter (name + description)", () => {
    expect(SKILL.startsWith("---\nname: slidecraft\n")).toBe(true);
    expect(SKILL).toMatch(/^description: >-/m);
  });
});

describe("SKILL.md — cited tool names are real (TOOL_PROFILES is the one table of tools)", () => {
  it("every backticked snake_case name is a registered tool", () => {
    const cited = citedToolNames(SKILL);
    expect(cited.length).toBeGreaterThan(0);
    const phantom = cited.filter((n) => !(n in TOOL_PROFILES));
    expect(phantom).toEqual([]);
  });
  it("names every load-bearing tool of the loop", () => {
    // `bootstrap` has no underscore, so this check matches the backticked name directly (with or
    // without a call signature) instead of going through the snake_case extraction above.
    for (const t of LOAD_BEARING_TOOLS) expect(SKILL, `SKILL.md no longer cites ${t}`).toMatch(new RegExp("`" + t + "[`(]"));
  });
});

describe("SKILL.md — the three #521 mandates", () => {
  it("bootstrap-first: the contract is read from `bootstrap`, not from docs", () => {
    expect(SKILL).toMatch(/`bootstrap`/);
    // the old file told the AI to read get_authoring_guide first; bootstrap now contains it
    expect(SKILL).not.toMatch(/get_authoring_guide\(\)` — this template's resolved layout names/);
  });
  it("trust the diagnosis; the visual check happens once, at the end, via the deck-wide contact sheet (#522)", () => {
    expect(SKILL).toMatch(/\bonce\b/i);
    expect(SKILL).toMatch(/never-silent/);
    // #522 shipped the deck-wide thumbnail tool as `get_deck_image` (+ browser-less `get_deck_html`):
    // the ONE visual pass names it, and the per-slide screenshot is demoted to zooming in.
    expect(SKILL).toMatch(/`get_deck_image\(\)`/);
    expect(SKILL).toMatch(/`get_deck_html\(\)`/);
    expect(SKILL).not.toMatch(/get_deck_thumbnails|get_slide_images/);
  });
  it("the AI never touches bytes: --root, use_template, export_pptx {path}, no cp/stage", () => {
    expect(SKILL).toMatch(/--root/);
    expect(SKILL).toMatch(/\{path\}/);
    expect(SKILL).toMatch(/\bcp\b/);
  });
  it("links the human reference docs/mcp-server.md exactly once", () => {
    expect(SKILL.match(/\]\(docs\/mcp-server\.md\)/g)?.length).toBe(1);
  });
});

// ── 4. checklist: every item removed from SKILL.md is still spoken by the server ──
type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
let bootstrapText = "";
let toolText = "";

beforeAll(async () => {
  const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  const template = await loadTemplate(tBytes);
  const bytes = await bundleProject(parseMd("# 表紙\n\n---\n\n# 中身\n\n- 速度: 0.8秒"), template, { templateName: "T", savedAt: "2026-06-28T00:00:00Z" });
  const server = buildServer(createSession(null));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  await client.callTool({ name: "open_project", arguments: { dataBase64: Buffer.from(bytes).toString("base64") } });
  const b = (await client.callTool({ name: "bootstrap", arguments: {} })) as unknown as CallRes;
  expect(b.isError).toBeFalsy();
  bootstrapText = b.content[0]?.text ?? "";
  toolText = (await client.listTools()).tools.map((t) => `${t.name}: ${t.description ?? ""}`).join("\n");
});

/** Item removed from SKILL.md → the needle that proves the server still says it, and where. */
const MOVED_TO_BOOTSTRAP: Array<[item: string, needle: string]> = [
  ["speaker notes marker", "<!-- note -->"],
  ["sparse slides + rich notes", "SPARSE slides + RICH notes"],
  ["section cover tag", "<!-- section -->"],
  ["derived TOC (never hand-written)", "<!-- toc -->"],
  ["compare regions", "<!-- compare -->"],
  ["before/after regions", "<!-- before -->"],
  ["col/kpi/step separators", "<!-- col -->"],
  ["GFM tables render native", "## Tables"],
  ["code blocks", "## Code"],
  ["body budget", "\"budget\""],
  ["capacity / predictedSplit", "predictedSplit"],
  ["review rules the diagnosis applies", "activeReviewRules"],
  ["12 authorable diagram types (menu)", "\"xychart\""],
  ["per-type syntax via get_diagram_guide", "get_diagram_guide"],
  ["templates: builtin presets solo", "\"builtin\": true"],
  ["template-spec guide (create_template)", "Palette keys"],
  // #521: contract lines that lived ONLY in SKILL.md, now in get_authoring_guide (= bootstrap.authoringGuide)
  ["success = no ok:false, no isError", "isError"],
  ["mutation envelope: changed:false = no-op, hints = next tool", "changed:false"],
  ["images are data:image URIs only", "data:image/"],
  ["unknown layout pin degrades to auto (schema frozen)", "unknown-layout-pin"],
  ["unconvertible Mermaid list for export", "gitGraph"],
  ["prefer set_slide_markdown over set_deck_markdown", "set_deck_markdown"],
];

const MOVED_TO_TOOL_DESCRIPTIONS: Array<[item: string, needle: string]> = [
  ["spec/source/intent are JSON STRINGS", "JSON 文字列"],
  ["apply_design_intent ops example", "[{\"op\":\"relayout\",\"direction\":\"LR\"}]"],
  ["class/state/ER/mindmap are Mermaid-only", "class/state/ER/mindmap"],
  ["get_slide_image needs a LOCAL Chrome/Edge; SLIDECRAFT_BROWSER", "SLIDECRAFT_BROWSER"],
  ["export: unconvertible mermaid reject (default) / skip", "reject / skip"],
  ["--root: path/templatePath instead of base64, both = error", "templatePath"],
  ["{path} vs {dataBase64}", "{path"],
  ["delete_slide: last slide refused", "最後の1枚"],
  ["set_deck_markdown drops figures", "図は自動保持されない"],
  ["get_slide: structured edit plan", "predictedSplit"],
  ["bootstrap pre-open: doc sections carry {ok:false, code}", "{ok:false, code}"],
];

describe("SKILL.md compression moved information, it did not drop it (R8 checklist vs the live server)", () => {
  for (const [item, needle] of MOVED_TO_BOOTSTRAP) {
    it(`bootstrap response still says: ${item}`, () => {
      expect(bootstrapText, `needle ${JSON.stringify(needle)} missing from bootstrap`).toContain(needle);
    });
  }
  for (const [item, needle] of MOVED_TO_TOOL_DESCRIPTIONS) {
    it(`a tool description still says: ${item}`, () => {
      expect(toolText, `needle ${JSON.stringify(needle)} missing from tools/list`).toContain(needle);
    });
  }
});
