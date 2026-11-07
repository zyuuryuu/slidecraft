/**
 * diagram-invalid.test.ts — #587 never-silent: a ```diagram block that DiagramSpecSchema rejects
 * (e.g. `type: flow` — the valid name is `flowchart`) used to be swallowed: parseDiagramYaml squashed
 * the zod failure to `undefined`, diagnoseDeck skipped it as "not a figure", validate_deck said ok,
 * and export drew an empty body. This locks:
 *   - parseDiagramYamlResult keeps the failure reason (the ONE parse path; parseDiagramYaml wraps it, R8)
 *   - get_deck_issues reports `diagram-invalid` with the zod reason + slide number
 *   - validate_deck turns ok:false and lists the slide
 *   - a valid figure stays silent (no new issue, ok:true)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { parseDiagramYaml, parseDiagramYamlResult } from "../src/engine/diagram-node-shrink";
import * as S from "../src/mcp/session";

const fence = "```";
const diagramSlide = (type: string) =>
  [
    "# しくみ",
    "",
    `${fence}diagram`,
    `type: ${type}`,
    "direction: LR",
    "nodes:",
    "  - { id: a, label: A }",
    "  - { id: b, label: B }",
    "edges:",
    "  - { from: a, to: b }",
    fence,
  ].join("\n");
const deckMd = (type: string) => ["# 表紙", diagramSlide(type)].join("\n\n---\n\n");

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

describe("parseDiagramYamlResult (#587) — keeps the failure reason", () => {
  it("returns ok:false with the zod path + reason for an unknown type", () => {
    const r = parseDiagramYamlResult("type: flow\nnodes: []\n");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/^type: /);
      expect(r.error).toContain("flowchart"); // the expected enum values are named
    }
  });

  it("returns ok:false with a reason for YAML that does not even load", () => {
    const r = parseDiagramYamlResult("type: [flowchart\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("returns ok:true + the spec for a valid figure, and parseDiagramYaml agrees on both outcomes (R8)", () => {
    const good = "type: flowchart\nnodes:\n  - { id: a, label: A }\n";
    const r = parseDiagramYamlResult(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parseDiagramYaml(good)).toEqual(r.spec);
    expect(parseDiagramYaml("type: flow\nnodes: []\n")).toBeUndefined();
  });
});

describe("get_deck_issues — diagram-invalid (#587)", () => {
  it("is registered in REVIEW_RULES (#244/#247)", () => {
    expect(REVIEW_RULES.some((r) => r.id === "diagram-invalid")).toBe(true);
  });

  it("flags `type: flow` on the right slide with the zod reason", () => {
    const issues = diagnoseDeck(parseMd(deckMd("flow"))).filter((x) => x.id === "diagram-invalid");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(1);
    expect(issues[0].message).toContain("type: ");
    expect(issues[0].message).toContain("flowchart");
  });

  it("stays silent for a valid figure", () => {
    const issues = diagnoseDeck(parseMd(deckMd("flowchart")));
    expect(issues.filter((x) => x.id === "diagram-invalid")).toEqual([]);
  });

  it("surfaces through the MCP session's get_deck_issues", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, deckMd("flow"));
    const hits = S.getDiagnostics(s).issues.filter((x) => x.id === "diagram-invalid");
    expect(hits).toHaveLength(1);
    expect(hits[0].slideIndex).toBe(1);
  });

  it("rides the slide's fix packet (get_slide_fix_request.issues) with the reason", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, deckMd("flow"));
    const hit = S.getSlideFix(s, 1).issues.find((x) => x.id === "diagram-invalid");
    expect(hit?.message).toContain("flowchart");
  });
});

describe("validate_deck — an invalid figure makes the deck not ok (#587)", () => {
  it("ok:false and names the slide (0-based slideIndex, like get_deck_issues) + reason", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, deckMd("flow"));
    const v = S.validate(s);
    expect(v.ok).toBe(false);
    expect(v.diagramErrors).toHaveLength(1);
    expect(v.diagramErrors[0].slideIndex).toBe(1);
    expect(v.diagramErrors[0].message).toContain("flowchart");
  });

  it("ok:true with no diagramErrors for a valid figure", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, deckMd("flowchart"));
    const v = S.validate(s);
    expect(v.ok).toBe(true);
    expect(v.diagramErrors).toEqual([]);
  });
});
