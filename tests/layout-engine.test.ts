import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  findBackEdges,
  isBackEdge,
  assignLayers,
  orderWithinLayers,
  computeLayout,
  computeLayoutWithLanes,
  cpCoords,
  detectCp,
  classifyEdgeRoute,
  planEdgeRoute,
  computePortOffsets,
  computeGroupBboxes,
  SLIDE_W,
  SLIDE_H,
  type NodePosition,
} from "../src/engine/layout-engine";
import { parseDiagramJson, type DiagramSpec } from "../src/engine/schema";

// ── Helper to create specs ──

function makeSpec(json: Record<string, unknown>): DiagramSpec {
  return parseDiagramJson(JSON.stringify(json));
}

const SIMPLE_FLOW = makeSpec({
  type: "flowchart",
  direction: "TB",
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
});

const DIAMOND_FLOW = makeSpec({
  type: "flowchart",
  direction: "TB",
  nodes: [
    { id: "start", label: "Start", shape: "rounded_rect" },
    { id: "check", label: "OK?", shape: "diamond" },
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ],
  edges: [
    { from: "start", to: "check" },
    { from: "check", to: "yes", label: "Yes" },
    { from: "check", to: "no", label: "No" },
  ],
});

const GROUPED_FLOW = makeSpec({
  type: "flowchart",
  direction: "TB",
  nodes: [
    { id: "n1", label: "N1", group: "g1" },
    { id: "n2", label: "N2", group: "g1" },
    { id: "n3", label: "N3", group: "g2" },
  ],
  edges: [
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ],
  groups: [
    { id: "g1", label: "Group 1" },
    { id: "g2", label: "Group 2" },
  ],
});

const SWIMLANE_FLOW = makeSpec({
  type: "flowchart",
  direction: "TB",
  nodes: [
    { id: "a", label: "A", lane: "l1" },
    { id: "b", label: "B", lane: "l2" },
    { id: "c", label: "C", lane: "l1" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
  lanes: [
    { id: "l1", label: "Lane 1" },
    { id: "l2", label: "Lane 2" },
  ],
});

// ── Tests ──

describe("buildAdjacency", () => {
  it("builds forward and reverse adjacency lists", () => {
    const { fwd, rev } = buildAdjacency(SIMPLE_FLOW);
    expect(fwd.get("a")).toEqual(["b"]);
    expect(fwd.get("b")).toEqual(["c"]);
    expect(rev.get("b")).toEqual(["a"]);
    expect(rev.get("c")).toEqual(["b"]);
    expect(rev.has("a")).toBe(false);
  });
});

describe("findBackEdges", () => {
  it("returns empty for acyclic graph", () => {
    const { fwd } = buildAdjacency(SIMPLE_FLOW);
    const backEdges = findBackEdges(fwd, ["a", "b", "c"]);
    expect(backEdges.size).toBe(0);
  });

  it("detects back edges in cyclic graph", () => {
    const cyclic = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    const { fwd } = buildAdjacency(cyclic);
    const backEdges = findBackEdges(fwd, ["a", "b", "c"]);
    expect(backEdges.size).toBe(1);
    expect(isBackEdge(backEdges, "c", "a")).toBe(true);
  });
});

describe("assignLayers", () => {
  it("assigns sequential layers for linear chain", () => {
    const layers = assignLayers(SIMPLE_FLOW);
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(1);
    expect(layers.get("c")).toBe(2);
  });

  it("handles branching correctly", () => {
    const layers = assignLayers(DIAMOND_FLOW);
    expect(layers.get("start")).toBe(0);
    expect(layers.get("check")).toBe(1);
    // yes and no should be at layer 2
    expect(layers.get("yes")).toBe(2);
    expect(layers.get("no")).toBe(2);
  });

  it("assigns disconnected nodes to layer 0", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [],
    });
    const layers = assignLayers(spec);
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(0);
  });

  it("handles cycles without infinite loop", () => {
    const cyclic = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    const layers = assignLayers(cyclic);
    // Should complete without infinite loop
    expect(layers.size).toBe(3);
    expect(layers.get("a")).toBe(0);
  });
});

describe("orderWithinLayers", () => {
  it("assigns orders within each layer", () => {
    const layers = assignLayers(DIAMOND_FLOW);
    const orders = orderWithinLayers(DIAMOND_FLOW, layers);
    // yes and no are in the same layer, should have different orders
    const yesOrder = orders.get("yes")!;
    const noOrder = orders.get("no")!;
    expect(yesOrder).not.toBe(noOrder);
    expect([yesOrder, noOrder].sort()).toEqual([0, 1]);
  });

  it("respects group constraints", () => {
    const layers = assignLayers(GROUPED_FLOW);
    const orders = orderWithinLayers(GROUPED_FLOW, layers);
    expect(orders.size).toBe(3);
  });
});

describe("computeLayout", () => {
  it("dispatches to v1 for simple flow (no groups, no lanes)", () => {
    const positions = computeLayout(SIMPLE_FLOW);
    expect(positions).toHaveLength(3);
    for (const p of positions) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });

  it("dispatches to v2 for grouped flow", () => {
    const positions = computeLayout(GROUPED_FLOW);
    expect(positions).toHaveLength(3);
  });

  it("dispatches to swimlane layout when lanes exist", () => {
    const positions = computeLayout(SWIMLANE_FLOW);
    expect(positions).toHaveLength(3);
  });

  it("all nodes within slide bounds", () => {
    const positions = computeLayout(SIMPLE_FLOW);
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(SLIDE_W + 0.01);
      expect(p.y + p.h).toBeLessThanOrEqual(SLIDE_H + 0.01);
    }
  });

  it("TB direction: nodes stack vertically", () => {
    const positions = computeLayout(SIMPLE_FLOW);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const a = posMap.get("a")!;
    const b = posMap.get("b")!;
    const c = posMap.get("c")!;
    // In TB, y increases with layer
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it("LR direction: nodes stack horizontally", () => {
    const spec = makeSpec({
      type: "flowchart",
      direction: "LR",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    const positions = computeLayout(spec);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const a = posMap.get("a")!;
    const b = posMap.get("b")!;
    const c = posMap.get("c")!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });

  it("diamond nodes get extra height", () => {
    const positions = computeLayout(DIAMOND_FLOW);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const start = posMap.get("start")!;
    const check = posMap.get("check")!;
    // Diamond should be taller (before scaling, it's 1.6x)
    // After scaling, the ratio should be preserved
    expect(check.h / start.h).toBeGreaterThan(1.3);
  });

  it("handles large graph without error", () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
    }));
    const edges = Array.from({ length: 49 }, (_, i) => ({
      from: `n${i}`,
      to: `n${i + 1}`,
    }));
    const spec = makeSpec({ type: "flowchart", nodes, edges });
    const positions = computeLayout(spec);
    expect(positions).toHaveLength(50);
  });
});

describe("node overrides", () => {
  it("uses an explicit full override for position and size", () => {
    const spec = makeSpec({
      type: "flowchart",
      direction: "TB",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B", override: { x: 9.1, y: 5.2, w: 1.3, h: 0.9 } },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const b = computeLayout(spec).find((p) => p.nodeId === "b")!;
    expect(b.x).toBe(9.1);
    expect(b.y).toBe(5.2);
    expect(b.w).toBe(1.3);
    expect(b.h).toBe(0.9);
  });

  it("applies a partial override (position only) and keeps computed size", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B", override: { x: 2.0, y: 3.0 } },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const base = computeLayout(makeSpec({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
    })).find((p) => p.nodeId === "b")!;
    const b = computeLayout(spec).find((p) => p.nodeId === "b")!;
    expect(b.x).toBe(2.0);
    expect(b.y).toBe(3.0);
    expect(b.w).toBe(base.w); // size untouched
    expect(b.h).toBe(base.h);
  });

  it("leaves non-overridden nodes exactly as auto-computed", () => {
    const base = computeLayout(SIMPLE_FLOW);
    const withOv = computeLayout(makeSpec({
      type: "flowchart",
      direction: "TB",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B", override: { x: 0.5, y: 0.5 } },
        { id: "c", label: "C" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    }));
    const baseMap = new Map(base.map((p) => [p.nodeId, p]));
    const ovMap = new Map(withOv.map((p) => [p.nodeId, p]));
    for (const id of ["a", "c"]) {
      expect(ovMap.get(id)).toEqual(baseMap.get(id));
    }
    expect(ovMap.get("b")!.x).toBe(0.5);
  });

  it("honors overrides on the swimlane path too", () => {
    const spec = makeSpec({
      type: "flowchart",
      direction: "LR",
      nodes: [
        { id: "a", label: "A", lane: "l1", override: { x: 7.7, y: 1.1 } },
        { id: "b", label: "B", lane: "l2" },
      ],
      edges: [{ from: "a", to: "b" }],
      lanes: [{ id: "l1", label: "L1" }, { id: "l2", label: "L2" }],
    });
    const a = computeLayoutWithLanes(spec).positions.find((p) => p.nodeId === "a")!;
    expect(a.x).toBe(7.7);
    expect(a.y).toBe(1.1);
  });
});

describe("computeLayoutWithLanes", () => {
  it("returns lane info alongside positions", () => {
    const { positions, laneInfos } = computeLayoutWithLanes(SWIMLANE_FLOW);
    expect(positions).toHaveLength(3);
    expect(laneInfos).toHaveLength(2);
    expect(laneInfos[0].laneId).toBe("l1");
    expect(laneInfos[1].laneId).toBe("l2");
    expect(laneInfos[0].crossSize).toBeGreaterThan(0);
  });

  it("nodes stay within their lane band", () => {
    const { positions, laneInfos } = computeLayoutWithLanes(SWIMLANE_FLOW);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const laneInfoMap = new Map(laneInfos.map((l) => [l.laneId, l]));

    const nodeA = posMap.get("a")!;
    const lane1 = laneInfoMap.get("l1")!;
    // Node A is in lane 1; its x should be within lane 1's cross band
    expect(nodeA.x).toBeGreaterThanOrEqual(lane1.crossOrigin - 0.01);
    expect(nodeA.x + nodeA.w).toBeLessThanOrEqual(
      lane1.crossOrigin + lane1.crossSize + 0.01,
    );
  });
});

describe("cpCoords", () => {
  const pos: NodePosition = {
    nodeId: "test", x: 2, y: 3, w: 2, h: 0.7,
    layer: 0, order: 0, scale: 1,
  };

  it("returns top center for cp 0", () => {
    const cp = cpCoords(pos, 0);
    expect(cp.x).toBeCloseTo(3); // x + w/2
    expect(cp.y).toBeCloseTo(3); // top
  });

  it("returns right center for cp 1", () => {
    const cp = cpCoords(pos, 1);
    expect(cp.x).toBeCloseTo(4); // x + w
    expect(cp.y).toBeCloseTo(3.35); // y + h/2
  });

  it("returns bottom center for cp 2", () => {
    const cp = cpCoords(pos, 2);
    expect(cp.x).toBeCloseTo(3);
    expect(cp.y).toBeCloseTo(3.7); // y + h
  });

  it("returns left center for cp 3", () => {
    const cp = cpCoords(pos, 3);
    expect(cp.x).toBeCloseTo(2); // left
    expect(cp.y).toBeCloseTo(3.35);
  });

  it("returns diamond vertices", () => {
    const cp0 = cpCoords(pos, 0, "diamond");
    expect(cp0.y).toBeCloseTo(3); // top vertex
    const cp1 = cpCoords(pos, 1, "diamond");
    expect(cp1.x).toBeCloseTo(4); // right vertex
  });

  it("applies port offset to rect", () => {
    const cp = cpCoords(pos, 0, "rect", 0.25);
    expect(cp.x).toBeCloseTo(3 + 0.25 * 2); // center + offset * width
    expect(cp.y).toBeCloseTo(3);
  });
});

describe("detectCp", () => {
  const above: NodePosition = {
    nodeId: "a", x: 5, y: 1, w: 2, h: 0.7,
    layer: 0, order: 0, scale: 1,
  };
  const below: NodePosition = {
    nodeId: "b", x: 5, y: 3, w: 2, h: 0.7,
    layer: 1, order: 0, scale: 1,
  };

  it("returns bottom→top for TB inter-layer (target below)", () => {
    const [src, tgt] = detectCp(above, below, "TB");
    expect(src).toBe(2); // bottom
    expect(tgt).toBe(0); // top
  });

  it("returns top→bottom for TB inter-layer (target above)", () => {
    const [src, tgt] = detectCp(below, above, "TB");
    expect(src).toBe(0); // top
    expect(tgt).toBe(2); // bottom
  });

  it("returns right→left for LR inter-layer", () => {
    const left: NodePosition = { ...above, x: 1 };
    const right: NodePosition = { ...below, x: 5, layer: 1 };
    const [src, tgt] = detectCp(left, right, "LR");
    expect(src).toBe(1); // right
    expect(tgt).toBe(3); // left
  });
});

describe("planEdgeRoute", () => {
  const from: NodePosition = {
    nodeId: "a", x: 5, y: 1, w: 2, h: 0.7,
    layer: 0, order: 0, scale: 1,
  };
  const to: NodePosition = {
    nodeId: "b", x: 5, y: 3, w: 2, h: 0.7,
    layer: 1, order: 0, scale: 1,
  };

  it("returns 2 points for direct route", () => {
    const points = planEdgeRoute(from, to, "rect", "rect", "TB", "direct");
    expect(points).toHaveLength(2);
  });

  it("L-route bends at the midpoint so the arrow enters the node perpendicular", () => {
    const offset: NodePosition = { ...to, x: 8 };
    const points = planEdgeRoute(from, offset, "rect", "rect", "TB", "l_route");
    expect(points).toHaveLength(4); // Manhattan: src → midbend → midbend → tgt
    const midY = (points[0].y + points[3].y) / 2;
    expect(points[1].y).toBeCloseTo(midY);
    expect(points[2].y).toBeCloseTo(midY);
    // final segment is straight into the target (same x) — arrowhead not crushed at the edge
    expect(points[2].x).toBeCloseTo(points[3].x);
  });

  it("returns 4 points for back-edge route", () => {
    const points = planEdgeRoute(to, from, "rect", "rect", "TB", "back_edge");
    expect(points).toHaveLength(4);
  });

  it("returns 4 points for cross-group route", () => {
    const points = planEdgeRoute(from, to, "rect", "rect", "TB", "cross_group");
    expect(points).toHaveLength(4);
  });
});

describe("computePortOffsets", () => {
  it("assigns zero offset for single edge", () => {
    const layers = assignLayers(SIMPLE_FLOW);
    const positions = computeLayout(SIMPLE_FLOW);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const offsets = computePortOffsets(SIMPLE_FLOW, posMap, layers, new Set());
    // Single outgoing edge from a → center offset
    const abOff = offsets.get("a->b");
    expect(abOff).toBeDefined();
    expect(abOff![0]).toBe(0); // src offset
  });

  it("spreads offsets for fan-out", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "a", to: "d" },
      ],
    });
    const positions = computeLayout(spec);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const layers = assignLayers(spec);
    const offsets = computePortOffsets(spec, posMap, layers, new Set());
    // Three outgoing edges from a → should have spread offsets
    const abOff = offsets.get("a->b");
    const acOff = offsets.get("a->c");
    const adOff = offsets.get("a->d");
    expect(abOff).toBeDefined();
    expect(acOff).toBeDefined();
    expect(adOff).toBeDefined();
    // Source offsets should be different
    const srcOffsets = [abOff![0], acOff![0], adOff![0]];
    const unique = new Set(srcOffsets);
    expect(unique.size).toBe(3);
  });
});

describe("computeGroupBboxes", () => {
  it("computes bounding boxes for groups", () => {
    const positions = computeLayout(GROUPED_FLOW);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const bboxes = computeGroupBboxes(GROUPED_FLOW, posMap);

    expect(bboxes.has("g1")).toBe(true);
    expect(bboxes.has("g2")).toBe(true);

    const g1 = bboxes.get("g1")!;
    // [minX, minY, maxX, maxY] — should contain its nodes
    const n1 = posMap.get("n1")!;
    const n2 = posMap.get("n2")!;
    expect(g1[0]).toBeLessThanOrEqual(Math.min(n1.x, n2.x));
    expect(g1[2]).toBeGreaterThanOrEqual(Math.max(n1.x + n1.w, n2.x + n2.w));
  });
});

describe("BT/RL directions", () => {
  it("BT reverses vertical order", () => {
    const spec = makeSpec({
      type: "flowchart",
      direction: "BT",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const positions = computeLayout(spec);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    // In BT, root (a) should be below child (b)
    expect(posMap.get("a")!.y).toBeGreaterThan(posMap.get("b")!.y);
  });

  it("RL reverses horizontal order", () => {
    const spec = makeSpec({
      type: "flowchart",
      direction: "RL",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const positions = computeLayout(spec);
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    // In RL, root (a) should be to the right of child (b)
    expect(posMap.get("a")!.x).toBeGreaterThan(posMap.get("b")!.x);
  });
});
