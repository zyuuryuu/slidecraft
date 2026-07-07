/**
 * authoring-guide.test.ts — Theme 3 / S1: the self-describing authoring contract handlers
 * (src/mcp/guides.ts). These EXPOSE existing engine prompts as MCP tools; the tests lock the
 * contract's shape (menu of all 12 diagram types, per-type pull, catalog-resolved L1 guide + budget
 * + figure pointer, never-silent when no project is open). See docs/design/mcp-brushup.md §F.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import * as G from "../src/mcp/guides";
import { VALID_TYPES } from "../src/engine/schema-constants";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

describe("get_diagram_types — L2 menu (stage 1)", () => {
  it("lists all 12 authorable types with type/label/hint", () => {
    const { types } = G.getDiagramTypes();
    expect(types.map((t) => t.type).sort()).toEqual([...VALID_TYPES].sort());
    for (const t of types) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("get_diagram_guide — L2 per-type (stage 2)", () => {
  it("returns the base + the chosen type's shape/example", () => {
    const r = G.getDiagramGuide("sequence");
    expect(r).toHaveProperty("guide");
    if (!("guide" in r)) throw new Error("expected success shape");
    expect(r.type).toBe("sequence");
    expect(r.guide).toContain("sequence");
    expect(r.guide.length).toBeGreaterThan(100);
  });

  it("rejects an unknown type never-silently, pointing at get_diagram_types", () => {
    const r = G.getDiagramGuide("uml");
    expect(r).toMatchObject({ ok: false });
    if ("error" in r) expect(r.error).toContain("get_diagram_types");
  });
});

describe("get_authoring_guide — L1 + manifest", () => {
  it("requires an open project (never-silent)", () => {
    expect(() => G.getAuthoringGuide(S.createSession(null))).toThrow(/開かれていません/);
  });

  it("returns the catalog-resolved format (with tables/code) + budget + figure pointer", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes);
    const g = G.getAuthoringGuide(s);
    expect(g.format).toContain("<!-- slide:");
    expect(g.format).toContain("## Tables");
    expect(g.format).toContain("## Code");
    expect(g.seeAlso.figures).toContain("get_diagram_types");
    expect(g.seeAlso.templateSpec).toContain("get_template_spec_guide");
    // budget is this template's body capacity (or null on a degenerate master)
    expect(g.budget === null || typeof g.budget.maxBullets === "number").toBe(true);
  });
});
