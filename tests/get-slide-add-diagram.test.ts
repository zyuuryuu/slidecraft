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

describe("get_slide — predictedSplit / capacity dry-run (#149)", () => {
  // applySlideMarkdown (NOT new_project) — new_project distills at intake (session.ts:102), which
  // would pre-split this slide before get_slide ever sees it overflowing.
  async function overstuffed() {
    const s = await opened();
    const many = Array.from({ length: 60 }, (_, i) => `- これは比較的長めの箇条書き項目その${i + 1}番目です`).join("\n");
    const r = S.applySlideMarkdown(s, 1, `# 詰め込みすぎ\n\n${many}`);
    expect(r.ok).toBe(true);
    return s;
  }

  it("predicts the SAME chunk count split_overflowing_slides actually produces (prediction == execution, R8)", async () => {
    const s = await overstuffed();
    const before = R.getSlide(s, 1);
    expect(before.overBudget).toBe(true);
    expect(before.predictedSplit).toBeTruthy();
    expect(before.predictedSplit!.chunks).toBeGreaterThanOrEqual(2);
    expect(before.predictedSplit!.boundaries).toHaveLength(before.predictedSplit!.chunks);
    expect(before.predictedSplit!.boundaries.reduce((a, b) => a + b, 0)).toBe(60); // no paragraph lost/duplicated across chunks

    const r = S.distill(s);
    expect(r.ok).toBe(true);
    expect(r.changedSlides).toHaveLength(before.predictedSplit!.chunks); // predicted == actually executed
  });

  it("does not mutate the deck / dirty flag (read-only)", async () => {
    const s = await overstuffed();
    const dirtyBefore = s.dirty;
    const deckBefore = JSON.stringify(s.deck);
    R.getSlide(s, 1);
    expect(s.dirty).toBe(dirtyBefore);
    expect(JSON.stringify(s.deck)).toBe(deckBefore);
  });

  it("has no predictedSplit and a capacity within budget for a fitting slide", async () => {
    const s = await opened(); // 3-bullet slide, well within budget
    const r = R.getSlide(s, 1);
    expect(r.overBudget).toBe(false);
    expect(r.predictedSplit).toBeUndefined();
    expect(r.capacity).toBeTruthy();
    expect(r.capacity!.usedLines).toBeLessThanOrEqual(r.capacity!.maxLines);
    expect(r.capacity!.maxLines).toBe(r.budget!.maxBullets); // same box the shared `budget` field reports
  });

  it("capacity is null for a figure slide (no measurable single text body)", async () => {
    const s = await deckWithDiagram();
    const r = R.getSlide(s, 1);
    expect(r.capacity).toBeNull();
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
