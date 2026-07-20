/**
 * issue-229-lr-varheight.test.ts — #229 (#104 slice B): the LR/RL within-layer stacking of
 * computeLayout (v1) assumed a FIXED node_height cell, so variable-height nodes (class/entity boxes
 * sized by member count, diamonds at 1.6×nh) physically overlapped their in-layer neighbours
 * (adversarial audit's "node collision"). The fix stacks cells by max(realHeight, nh) — so every
 * uniform-height diagram (flowcharts, state charts incl. markers) keeps EXACTLY its old coordinates,
 * and only taller-than-nh nodes get the extra room they render with.
 */
import { describe, it, expect } from "vitest";
import type { DiagramSpec } from "../src/engine/schema";
import { computeLayout } from "../src/engine/layout-engine";

const LAYOUT = { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 };

const mk = (partial: Partial<DiagramSpec>): DiagramSpec =>
  ({ classDefs: {}, groups: [], lanes: [], layout: LAYOUT, ...partial } as unknown as DiagramSpec);

/** All pairwise axis-aligned overlaps deeper than ε in both axes. */
function overlaps(ps: { nodeId: string; x: number; y: number; w: number; h: number }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.02 && oy > 0.02) out.push(`${a.nodeId}×${b.nodeId}`);
    }
  return out;
}

describe("LR variable-height stacking (#229)", () => {
  it("class nodes of differing heights in one LR layer no longer overlap", () => {
    const spec = mk({
      type: "class", direction: "LR", title: "Collide",
      nodes: [
        { id: "r", label: "Root", shape: "class", attributes: ["a", "b"], methods: ["m()"] },
        { id: "c1", label: "C1", shape: "class", attributes: ["a", "b", "c", "d", "e"], methods: ["m1()", "m2()"] },
        { id: "c2", label: "C2", shape: "class", attributes: ["a", "b", "c", "d", "e"], methods: ["m1()", "m2()"] },
        { id: "c3", label: "C3", shape: "class", attributes: ["a"], methods: [] },
      ],
      edges: [{ from: "r", to: "c1" }, { from: "r", to: "c2" }, { from: "r", to: "c3" }],
    });
    expect(overlaps(computeLayout(spec, 0.8))).toEqual([]);
  });

  it("diamonds (1.6×nh) in a shared LR layer no longer overlap", () => {
    const spec = mk({
      type: "flowchart", direction: "LR", title: "D",
      nodes: [
        { id: "s", label: "S", shape: "rect" },
        { id: "d1", label: "D1", shape: "diamond" },
        { id: "d2", label: "D2", shape: "diamond" },
      ],
      edges: [{ from: "s", to: "d1" }, { from: "s", to: "d2" }],
    });
    expect(overlaps(computeLayout(spec, 0.8))).toEqual([]);
  });

  // AGREEMENT with the pre-#229 engine: uniform-height diagrams keep their exact coordinates
  // (cell height = max(h, nh) degenerates to nh for every node). Literals captured from the
  // engine at main 3471592 (pre-change).
  it("uniform-height LR flowchart coordinates are unchanged", () => {
    const spec = mk({
      type: "flowchart", direction: "LR", title: "U",
      nodes: [
        { id: "a", label: "A", shape: "rect" },
        { id: "b", label: "B", shape: "rect" },
        { id: "c", label: "C", shape: "rect" },
      ],
      edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }],
    });
    const got = computeLayout(spec, 0.8).map((p) => ({ id: p.nodeId, x: +p.x.toFixed(4), y: +p.y.toFixed(4) }));
    expect(got).toEqual([
      { id: "a", x: 4.2665, y: 3.05 },
      { id: "b", x: 4.2665, y: 4.25 },
      { id: "c", x: 7.0665, y: 3.65 },
    ]);
  });

  it("state-diagram LR marker (start/end) coordinates are unchanged (markers keep an nh-tall cell)", () => {
    const spec = mk({
      type: "state", direction: "LR", title: "S",
      nodes: [
        { id: "st", label: "", shape: "start" },
        { id: "s1", label: "S1", shape: "rect" },
        { id: "s2", label: "S2", shape: "rect" },
        { id: "en", label: "", shape: "end" },
      ],
      edges: [
        { from: "st", to: "s1" }, { from: "st", to: "s2" },
        { from: "s1", to: "en" }, { from: "s2", to: "en" },
      ],
    });
    const got = computeLayout(spec, 0.8).map((p) => ({ id: p.nodeId, x: +p.x.toFixed(4), y: +p.y.toFixed(4), w: +p.w.toFixed(4), h: +p.h.toFixed(4) }));
    expect(got).toEqual([
      { id: "st", x: 3.6965, y: 3.83, w: 0.34, h: 0.34 },
      { id: "s1", x: 5.6665, y: 3.05, w: 2, h: 0.7 },
      { id: "s2", x: 5.6665, y: 4.25, w: 2, h: 0.7 },
      { id: "en", x: 9.2965, y: 3.83, w: 0.34, h: 0.34 },
    ]);
  });
});
