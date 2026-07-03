/**
 * design-intent-report.test.ts — #13: an id-referencing design op (emphasize) that can't resolve its
 * node must NOT silently no-op. This is the "diagram-edit renamed every node id → a later emphasize
 * targets an id that no longer exists → nothing happens, no feedback" bug. `applyDesignIntentReport`
 * surfaces each skipped op + the available node ids so the GUI/MCP can announce it (the notification
 * channel), while the plain `applyDesignIntent` stays a bare SlideIR for existing callers.
 */
import { describe, it, expect } from "vitest";
import { applyDesignIntentReport, applyDesignIntent } from "../src/engine/design-intent";
import type { SlideIR } from "../src/engine/slide-schema";

const DIAG = ["type: flowchart", "direction: TB", "nodes:", "  - id: A", "    label: 入力", "  - id: B", "    label: DB", "edges:", "  - from: A", "    to: B"].join("\n");
const slideWithDiagram = (): SlideIR => ({
  layout: "Content.1Body.Single",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "構成" }] }] }],
  diagram: { yaml: DIAG, placeholderIdx: "1" },
});
const slideNoFigure = (): SlideIR => ({
  layout: "Content.1Body.Single",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] }],
});

describe("#13 design ops report skips instead of silently no-op'ing", () => {
  it("emphasize on a KNOWN node applies with no skips", () => {
    const r = applyDesignIntentReport(slideWithDiagram(), [{ op: "emphasize", nodeId: "B", level: "high" }]);
    expect(r.skipped).toHaveLength(0);
    expect(r.slide.diagram!.yaml).toContain("override");
  });

  it("emphasize on an UNKNOWN node reports the skip + the available ids (the id-总入替 case)", () => {
    const r = applyDesignIntentReport(slideWithDiagram(), [{ op: "emphasize", nodeId: "db", level: "high" }]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ op: "emphasize", reason: "unknown-node", nodeId: "db" });
    expect(r.skipped[0].available).toEqual(expect.arrayContaining(["A", "B"]));
    expect(r.skipped[0].message).toContain("db"); // names the missing id
    expect(r.skipped[0].message).toContain("B"); // lists a real candidate so the user can retry
    expect(r.slide).toEqual(slideWithDiagram()); // slide untouched — no spurious override / reformat
  });

  it("a design op on a figureless slide reports no-figure (not silence)", () => {
    const r = applyDesignIntentReport(slideNoFigure(), [
      { op: "emphasize", nodeId: "A", level: "high" },
      { op: "relayout", direction: "LR" },
    ]);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped.map((s) => s.reason)).toEqual(["no-figure", "no-figure"]);
  });

  it("mixed batch: the known op applies, only the unknown op is reported (batch not aborted)", () => {
    const r = applyDesignIntentReport(slideWithDiagram(), [
      { op: "emphasize", nodeId: "A", level: "high" },
      { op: "emphasize", nodeId: "ZZZ", level: "high" },
    ]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].nodeId).toBe("ZZZ");
    expect(r.slide.diagram!.yaml).toContain("override"); // A still got emphasized
  });

  it("applyDesignIntent (compat) still returns a bare SlideIR", () => {
    const out = applyDesignIntent(slideWithDiagram(), [{ op: "emphasize", nodeId: "B" }]);
    expect(out.diagram).toBeDefined();
    expect(Array.isArray(out.placeholders)).toBe(true);
  });
});
