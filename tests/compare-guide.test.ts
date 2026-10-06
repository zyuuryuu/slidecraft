/**
 * compare-guide.test.ts — #396 / #402: AI reachability is the point of both issues, so the authoring
 * contract must TEACH the markers — and only what the engine really does (drift gate, same rule as
 * authoring-contract-roundtrip.test.ts): the taught forms parse to the advertised group kind, and a
 * template without a compare layout is not told to use one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { slideSystemPrompt } from "../src/engine/llm-prompts";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, autoSelectLayout } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import * as S from "../src/mcp/session";
import * as G from "../src/mcp/guides";

const fixture = (f: string) => readFileSync(resolve(__dirname, "fixtures/templates", f));

describe("authoring guide (get_authoring_guide.format = slideSystemPrompt)", () => {
  it("canonical (no catalog): teaches <!-- compare --> and the <!-- before --> / <!-- after --> pair, naming the compare layout", () => {
    const p = slideSystemPrompt();
    expect(p).toMatch(/`Compare\.2Option\.Versus`[^\n]*<!-- compare -->/);
    expect(p).toMatch(/<!-- before -->[^\n]*<!-- after -->/);
  });

  it("a template's own compare layout is named (report → 12_課題と対策)", async () => {
    const cat = buildCatalog(await loadTemplate(fixture("報告書テンプレート_全レイアウト見本.pptx")));
    expect(slideSystemPrompt(cat)).toMatch(/`12_課題と対策`[^\n]*<!-- compare -->/);
  });

  it("a template WITHOUT a compare layout is not told to use the markers", async () => {
    const cat = buildCatalog(await loadTemplate(fixture("lrk-slides-velis_CC0.pptx")));
    expect(cat.some((e) => e.groupKind === "compare")).toBe(false);
    const p = slideSystemPrompt(cat);
    expect(p).not.toContain("<!-- compare -->");
    expect(p).not.toContain("<!-- before -->");
  });

  it("R8: for every fixture template, the layout the guide names == the one auto selection picks for 2 regions", async () => {
    const two = parseMd("# T\n\n<!-- compare -->\n### A\n- a\n\n<!-- compare -->\n### B\n- b").slides[0];
    const dir = resolve(__dirname, "fixtures/templates");
    let checked = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".pptx"))) {
      const cat = buildCatalog(await loadTemplate(fixture(f)));
      const named = slideSystemPrompt(cat).match(/Two-option comparison \(A vs B\): `([^`]+)`/)?.[1];
      if (!named) continue;
      expect(named, f).toBe(autoSelectLayout(two, 1, 3, cat));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2); // committed fixtures with a compare layout (Midnight + report family)
  });

  it("the taught forms parse to the advertised kinds", () => {
    const cmp = parseMd("# A vs B\n\n<!-- compare -->\n### A\n- a\n\n<!-- compare -->\n### B\n- b").slides[0];
    expect(cmp.groupKind).toBe("compare");
    const ba = parseMd("# Change\n\n<!-- before -->\n### Today\n- a\n\n<!-- after -->\n### Target\n- b").slides[0];
    expect(ba.groupKind).toBe("beforeAfter");
  });
});

describe("contract digest (rides every session entry)", () => {
  it("mentions compare and the before/after pair", async () => {
    const s = S.createSession(null);
    await S.newProject(s, fixture("Midnight_Executive_30_TemplateOnly.pptx"));
    const d = G.contractDigest(s);
    expect(d.separators).toContain("<!-- compare -->");
    expect(d.separators).toContain("<!-- before -->");
    expect(d.separators).toContain("<!-- after -->");
  });
});
