/**
 * get-slide-add-diagram.test.ts — Theme 3 / S5: get_slide (structured per-slide read) + the
 * set_slide_diagram relaxation that ADDS a figure to a text-only slide. Locks: get_slide's composed
 * fields (resolvedLayout / figureKind / bulletCount / budget / overBudget / this-slide issues /
 * markdown), and add-vs-replace with alien-safe body-ordinal resolution + no-body reject. See
 * docs/design/mcp-brushup.md §C / §D.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import * as R from "../src/mcp/reads";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

async function opened() {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 中身\n\n- 一\n- 二\n- 三"); // 0=title (no body), 1=content (3 bullets)
  return s;
}
async function deckWithDiagram() {
  const s = await opened();
  s.deck = { ...s.deck!, slides: s.deck!.slides.map((sl, k) => (k === 1 ? { ...sl, diagram: { yaml: "type: flowchart\nnodes:\n  - id: a\n    label: A\n", placeholderIdx: "1" } } : sl)) };
  return s;
}

describe("get_slide — structured per-slide read", () => {
  it("returns resolvedLayout / figureKind=null / bulletCount / budget / overBudget / issues / markdown for a content slide", async () => {
    const s = await opened();
    const r = R.getSlide(s, 1);
    expect(r.index).toBe(1);
    expect(typeof r.resolvedLayout).toBe("string");
    expect(r.resolvedLayout).not.toBe("auto"); // 'auto' is resolved
    expect(r.hasFigure).toBe(false);
    expect(r.figureKind).toBe(null);
    expect(r.bulletCount).toBe(3);
    expect(Array.isArray(r.issues)).toBe(true);
    expect(r.issues.every((iss) => iss.slideIndex === 1)).toBe(true); // this slide only
    expect(typeof r.markdown).toBe("string");
    expect("budget" in r).toBe(true);
    expect(typeof r.overBudget).toBe("boolean");
  });

  it("reports figureKind='diagram' + hasFigure for a diagram slide", async () => {
    const s = await deckWithDiagram();
    const r = R.getSlide(s, 1);
    expect(r.hasFigure).toBe(true);
    expect(r.figureKind).toBe("diagram");
  });

  it("throws never-silently on an out-of-range index", async () => {
    const s = await opened();
    expect(() => R.getSlide(s, 99)).toThrow(/範囲外/);
  });
});

describe("set_slide_diagram — add to a text-only slide (S5 relaxation)", () => {
  it("ADDS a diagram to a text slide and COEXISTS with the bullets (regionSplit, no silent clobber; created:true)", async () => {
    const s = await opened();
    expect(s.deck!.slides[1].diagram).toBeUndefined();
    const r = S.setDiagram(s, 1, "flowchart TD\n  A[開始]-->B[終了]", "mermaid");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.changed).toBe(true);
    const slide = s.deck!.slides[1];
    expect(slide.diagram).toBeTruthy();
    expect(slide.diagram!.placeholderIdx).toBe("2"); // figure to col 2 (regionSplit text-left) — does NOT clobber col-1 text
    const bodyText = slide.placeholders.flatMap((p) => p.paragraphs).flatMap((par) => par.segments).map((seg) => seg.text).join("");
    expect(bodyText).toMatch(/一|二|三/); // the bullets SURVIVED (relocated, not silently dropped)
  });

  it("REPLACES an existing figure (created:false)", async () => {
    const s = await deckWithDiagram();
    const r = S.setDiagram(s, 1, "flowchart TD\n  X[X]-->Y[Y]", "mermaid");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.created).toBe(false);
  });

  it("rejects adding a figure to a layout with NO body region (alien-safe, role-based)", async () => {
    const s = await opened();
    // slide 0 is the title/cover — its resolved layout has no 'body' role
    const r = S.setDiagram(s, 0, "flowchart TD\n  A[A]-->B[B]", "mermaid");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/body 領域|範囲外/);
  });
});
