/**
 * Layout Engine — Computes node positions for diagram rendering.
 *
 * Pure coordinate calculations with no rendering dependencies.
 * Ported from Python diagram_renderer.py layout algorithms.
 *
 * Three layout modes:
 *   - v1: Simple layer-centering (no groups, no lanes)
 *   - v2: Group-aware with column packing
 *   - v3: Swimlane-aware layout
 */

import type { DiagramSpec, Direction, LaneStyle } from "./schema";

// ── Constants ──

export const SLIDE_W = 13.333; // inches (widescreen 16:9)
export const SLIDE_H = 7.5;

// ── Types ──

export interface NodePosition {
  nodeId: string;
  x: number;      // left (inches)
  y: number;      // top (inches)
  w: number;      // width (inches)
  h: number;      // height (inches)
  layer: number;   // assigned layer (0 = root)
  order: number;   // order within layer
  scale: number;   // layout scale factor (1.0 = no shrink)
}

export interface LaneInfo {
  laneId: string;
  label: string;
  crossOrigin: number;  // start position on cross-axis (inches)
  crossSize: number;    // size on cross-axis (inches)
  style: LaneStyle;
}

export interface ConnectionPoint {
  x: number;  // inches
  y: number;  // inches
}

/** cp indices: 0=top, 1=right, 2=bottom, 3=left */
export type CpIndex = 0 | 1 | 2 | 3;

export interface EdgeRoute {
  fromId: string;
  toId: string;
  points: ConnectionPoint[];  // waypoints in inches
  routeType: "direct" | "l_route" | "back_edge" | "cross_group";
}

// ── Graph Analysis ──

export function buildAdjacency(spec: DiagramSpec): {
  fwd: Map<string, string[]>;
  rev: Map<string, string[]>;
} {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const e of spec.edges) {
    if (!fwd.has(e.from)) fwd.set(e.from, []);
    fwd.get(e.from)!.push(e.to);
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to)!.push(e.from);
  }
  return { fwd, rev };
}

export function findBackEdges(
  fwd: Map<string, string[]>,
  nodeIds: string[],
): Set<string> {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const nid of nodeIds) color.set(nid, WHITE);
  const backEdges = new Set<string>();

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const v of fwd.get(u) ?? []) {
      if (!color.has(v)) continue;
      if (color.get(v) === GRAY) {
        backEdges.add(`${u}->${v}`);
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const nid of nodeIds) {
    if (color.get(nid) === WHITE) dfs(nid);
  }
  return backEdges;
}

export function isBackEdge(backEdges: Set<string>, from: string, to: string): boolean {
  return backEdges.has(`${from}->${to}`);
}

// ── Layer Assignment ──

export function assignLayers(spec: DiagramSpec): Map<string, number> {
  const { fwd } = buildAdjacency(spec);
  const nodeIds = spec.nodes.map((n) => n.id);

  // Detect back-edges and build DAG
  const backEdges = findBackEdges(fwd, nodeIds);
  const dagFwd = new Map<string, string[]>();
  const dagRev = new Map<string, string[]>();

  for (const [u, children] of fwd) {
    for (const v of children) {
      if (!isBackEdge(backEdges, u, v)) {
        if (!dagFwd.has(u)) dagFwd.set(u, []);
        dagFwd.get(u)!.push(v);
        if (!dagRev.has(v)) dagRev.set(v, []);
        dagRev.get(v)!.push(u);
      }
    }
  }

  // Find roots (no incoming edges in DAG)
  let roots = nodeIds.filter(
    (nid) => !dagRev.has(nid) || dagRev.get(nid)!.length === 0,
  );
  if (roots.length === 0 && nodeIds.length > 0) {
    roots = [nodeIds[0]];
  }

  // BFS longest path
  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    layers.set(r, 0);
    queue.push(r);
  }

  while (queue.length > 0) {
    const nid = queue.shift()!;
    const curLayer = layers.get(nid)!;
    for (const child of dagFwd.get(nid) ?? []) {
      const newLayer = curLayer + 1;
      if (!layers.has(child) || layers.get(child)! < newLayer) {
        layers.set(child, newLayer);
        queue.push(child);
      }
    }
  }

  // Assign disconnected nodes to layer 0
  for (const nid of nodeIds) {
    if (!layers.has(nid)) layers.set(nid, 0);
  }

  return layers;
}

// ── Node Ordering (Barycenter) ──

export function orderWithinLayers(
  spec: DiagramSpec,
  layers: Map<string, number>,
): Map<string, number> {
  const { fwd, rev } = buildAdjacency(spec);
  const nodeGroup = new Map<string, string | undefined>();
  for (const n of spec.nodes) nodeGroup.set(n.id, n.group);

  const groupOrder = new Map<string, number>();
  spec.groups.forEach((g, i) => groupOrder.set(g.id, i));

  function groupSortKey(nid: string): number[] {
    const gid = nodeGroup.get(nid);
    if (!gid) return [9999];
    const chain: number[] = [];
    let cur: string | undefined = gid;
    while (cur !== undefined) {
      chain.push(groupOrder.get(cur) ?? 9999);
      const grp = spec.groups.find((g) => g.id === cur);
      cur = grp?.parent;
    }
    chain.reverse();
    return chain;
  }

  // Group nodes by layer
  const layerNodes = new Map<number, string[]>();
  for (const n of spec.nodes) {
    const lyr = layers.get(n.id) ?? 0;
    if (!layerNodes.has(lyr)) layerNodes.set(lyr, []);
    layerNodes.get(lyr)!.push(n.id);
  }
  const numLayers = layerNodes.size > 0
    ? Math.max(...layerNodes.keys()) + 1
    : 0;

  const origIdx = new Map<string, number>();
  spec.nodes.forEach((n, i) => origIdx.set(n.id, i));

  // Step 1: Initial ordering (group-clustered, original order)
  const orders = new Map<string, number>();
  for (const layerIdx of [...layerNodes.keys()].sort((a, b) => a - b)) {
    const nids = layerNodes.get(layerIdx)!;
    const sorted = [...nids].sort((a, b) => {
      const ka = groupSortKey(a);
      const kb = groupSortKey(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const va = ka[i] ?? 9999;
        const vb = kb[i] ?? 9999;
        if (va !== vb) return va - vb;
      }
      return (origIdx.get(a) ?? 0) - (origIdx.get(b) ?? 0);
    });
    sorted.forEach((nid, i) => orders.set(nid, i));
  }

  // Helper: group-constrained reorder
  function groupConstrainedReorder(
    nids: string[],
    bary: Map<string, number>,
  ): string[] {
    // Partition into group clusters
    const clusters: Array<{ key: string; members: string[] }> = [];
    for (const nid of nids) {
      const gk = groupSortKey(nid).join(",");
      if (clusters.length > 0 && clusters[clusters.length - 1].key === gk) {
        clusters[clusters.length - 1].members.push(nid);
      } else {
        clusters.push({ key: gk, members: [nid] });
      }
    }

    // Sort within each cluster by barycenter
    for (const cl of clusters) {
      cl.members.sort(
        (a, b) =>
          (bary.get(a) ?? orders.get(a) ?? 0) -
          (bary.get(b) ?? orders.get(b) ?? 0),
      );
    }

    // Sort clusters by average barycenter
    clusters.sort((a, b) => {
      const avgA =
        a.members.reduce(
          (s, nid) => s + (bary.get(nid) ?? orders.get(nid) ?? 0),
          0,
        ) / a.members.length;
      const avgB =
        b.members.reduce(
          (s, nid) => s + (bary.get(nid) ?? orders.get(nid) ?? 0),
          0,
        ) / b.members.length;
      return avgA - avgB;
    });

    return clusters.flatMap((c) => c.members);
  }

  // Iterative barycenter sweeps
  const NUM_ITERATIONS = 4;
  for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
    // Forward sweep: layer 0 → N-1
    for (let layerIdx = 1; layerIdx < numLayers; layerIdx++) {
      const nids = layerNodes.get(layerIdx);
      if (!nids || nids.length === 0) continue;

      const bary = new Map<string, number>();
      for (const nid of nids) {
        const parents = rev.get(nid) ?? [];
        const parentOrders = parents
          .filter((p) => orders.has(p))
          .map((p) => orders.get(p)!);
        if (parentOrders.length > 0) {
          bary.set(
            nid,
            parentOrders.reduce((a, b) => a + b, 0) / parentOrders.length,
          );
        }
      }

      const reordered = groupConstrainedReorder(nids, bary);
      reordered.forEach((nid, i) => orders.set(nid, i));
    }

    // Backward sweep: layer N-1 → 0
    for (let layerIdx = numLayers - 2; layerIdx >= 0; layerIdx--) {
      const nids = layerNodes.get(layerIdx);
      if (!nids || nids.length === 0) continue;

      const bary = new Map<string, number>();
      for (const nid of nids) {
        const children = fwd.get(nid) ?? [];
        const childOrders = children
          .filter((c) => orders.has(c))
          .map((c) => orders.get(c)!);
        if (childOrders.length > 0) {
          bary.set(
            nid,
            childOrders.reduce((a, b) => a + b, 0) / childOrders.length,
          );
        }
      }

      const reordered = groupConstrainedReorder(nids, bary);
      reordered.forEach((nid, i) => orders.set(nid, i));
    }
  }

  // Convert to integer orders
  const finalOrders = new Map<string, number>();
  for (const layerIdx of [...layerNodes.keys()].sort((a, b) => a - b)) {
    const nids = layerNodes.get(layerIdx)!;
    const sorted = [...nids].sort(
      (a, b) => (orders.get(a) ?? 0) - (orders.get(b) ?? 0),
    );
    sorted.forEach((nid, i) => finalOrders.set(nid, i));
  }

  return finalOrders;
}

// ── Group Helpers ──

function groupChildren(spec: DiagramSpec, groupId: string): string[] {
  return spec.groups.filter((g) => g.parent === groupId).map((g) => g.id);
}

function groupDepth(spec: DiagramSpec, groupId: string): number {
  const groupMap = new Map(spec.groups.map((g) => [g.id, g]));
  let depth = 0;
  let cur = groupMap.get(groupId);
  while (cur?.parent) {
    depth++;
    cur = groupMap.get(cur.parent);
  }
  return depth;
}

function groupAllNodeIds(
  spec: DiagramSpec,
  groupId: string,
  directNodes: Map<string, string[]>,
): string[] {
  const result = [...(directNodes.get(groupId) ?? [])];
  for (const childId of groupChildren(spec, groupId)) {
    result.push(...groupAllNodeIds(spec, childId, directNodes));
  }
  return result;
}

// ── Layout v1: Simple Layer-Centering ──

function computeLayoutV1(
  spec: DiagramSpec,
  contentTop: number = 0.8,
): NodePosition[] {
  const layout = spec.layout;
  const layers = assignLayers(spec);
  const orders = orderWithinLayers(spec, layers);

  const layerNodes = new Map<number, string[]>();
  for (const n of spec.nodes) {
    const lyr = layers.get(n.id) ?? 0;
    if (!layerNodes.has(lyr)) layerNodes.set(lyr, []);
    layerNodes.get(lyr)!.push(n.id);
  }

  for (const [, nids] of layerNodes) {
    nids.sort((a, b) => (orders.get(a) ?? 0) - (orders.get(b) ?? 0));
  }

  const isHorizontal = spec.direction === "LR" || spec.direction === "RL";
  const isReversed = spec.direction === "BT" || spec.direction === "RL";

  const nw = layout.node_width;
  const nh = layout.node_height;
  const hg = layout.h_gap;
  const vg = layout.v_gap;

  const diamondIds = new Set(
    spec.nodes.filter((n) => n.shape === "diamond").map((n) => n.id),
  );
  // state-diagram pseudo-states (start/end) render as a small dot, not a full cell.
  const MARKER_SIZE = 0.34;
  const markerIds = new Set(
    spec.nodes.filter((n) => n.shape === "start" || n.shape === "end").map((n) => n.id),
  );
  const nodeHMap = new Map<string, number>();
  for (const n of spec.nodes) {
    let h = nh;
    if (markerIds.has(n.id)) h = MARKER_SIZE;
    else if (diamondIds.has(n.id)) h = nh * 1.6;
    else if (n.shape === "class" || n.shape === "entity") {
      // name compartment + one row per attribute/method (so the box fits its members)
      const members = (n.attributes?.length ?? 0) + (n.methods?.length ?? 0);
      h = 0.4 + Math.max(members, 1) * 0.26 + 0.1;
    }
    nodeHMap.set(n.id, h);
  }

  const marginX = 0.8;
  const marginYTop = contentTop;
  const marginYBot = 0.3;

  const positions: NodePosition[] = [];

  for (const layerIdx of [...layerNodes.keys()].sort((a, b) => a - b)) {
    const nids = layerNodes.get(layerIdx)!;
    const nInLayer = nids.length;

    for (let i = 0; i < nids.length; i++) {
      const nid = nids[i];
      const thisH = nodeHMap.get(nid) ?? nh;
      let x: number, y: number;

      if (isHorizontal) {
        x = marginX + layerIdx * (nw + vg);
        // #229: stack the in-layer cells by each node's REAL height (floored at nh) — the old fixed
        // nh step made taller nodes (class/entity sized by member count, diamond at 1.6×nh) overlap
        // their in-layer neighbours. Uniform-height layers degenerate to the old nh step exactly
        // (coordinates byte-identical), and a marker's short dot keeps its nh-tall cell (the
        // centering below is unchanged).
        const cellH = (id: string) => Math.max(nodeHMap.get(id) ?? nh, nh);
        const totalH = nids.reduce((a, id) => a + cellH(id), 0) + (nInLayer - 1) * hg;
        const yStart = (SLIDE_H - totalH) / 2;
        y = yStart;
        for (let k = 0; k < i; k++) y += cellH(nids[k]) + hg;
        if (isReversed) {
          x = SLIDE_W - marginX - nw - layerIdx * (nw + vg);
        }
      } else {
        const totalW = nInLayer * nw + (nInLayer - 1) * hg;
        const xStart = (SLIDE_W - totalW) / 2;
        x = xStart + i * (nw + hg);

        y = marginYTop;
        for (let l = 0; l < layerIdx; l++) {
          const lyrNids = layerNodes.get(l) ?? [nid];
          const maxH = Math.max(
            ...lyrNids.map((n) => nodeHMap.get(n) ?? nh),
          );
          y += maxH + vg;
        }

        if (isReversed) {
          y = SLIDE_H - marginYBot - thisH;
          for (let l = 0; l < layerIdx; l++) {
            const lyrNids = layerNodes.get(l) ?? [nid];
            const maxH = Math.max(
              ...lyrNids.map((n) => nodeHMap.get(n) ?? nh),
            );
            y -= maxH + vg;
          }
        }
      }

      // A pseudo-state is a small dot: shrink its box and centre it in the cell so
      // edges connect to the dot, not to an invisible full-width node.
      const isMarker = markerIds.has(nid);
      const thisW = isMarker ? MARKER_SIZE : nw;
      const nodeX = isMarker ? x + (nw - thisW) / 2 : x;
      const nodeY = isMarker && isHorizontal ? y + (nh - thisH) / 2 : y;

      positions.push({
        nodeId: nid,
        x: nodeX, y: nodeY,
        w: thisW, h: thisH,
        layer: layerIdx,
        order: i,
        scale: 1.0,
      });
    }
  }

  // Auto-scale to fit slide
  if (positions.length > 0) {
    const allX = positions.map((p) => p.x);
    const allY = positions.map((p) => p.y);
    const allR = positions.map((p) => p.x + p.w);
    const allB = positions.map((p) => p.y + p.h);

    const effW = Math.max(...allR) - Math.min(...allX);
    const effH = Math.max(...allB) - Math.min(...allY);
    const effLeft = Math.min(...allX);
    const effTop = Math.min(...allY);

    const availW = SLIDE_W - 2 * marginX;
    const availH = SLIDE_H - marginYTop - marginYBot;

    const scaleX = effW > 0 ? availW / effW : 1.0;
    const scaleY = effH > 0 ? availH / effH : 1.0;
    const scale = Math.min(scaleX, scaleY, 1.0);

    for (const p of positions) {
      p.x = (p.x - effLeft) * scale;
      p.y = (p.y - effTop) * scale;
      p.w *= scale;
      p.h *= scale;
      p.scale = scale;
    }

    const scaledW = effW * scale;
    const scaledH = effH * scale;
    const offsetX = marginX + (availW - scaledW) / 2;
    const offsetY = marginYTop + (availH - scaledH) / 2;

    for (const p of positions) {
      p.x += offsetX;
      p.y += offsetY;
    }
  }

  return positions;
}

// ── Layout v2: Group-Aware ──

function computeLayoutV2(
  spec: DiagramSpec,
  contentTop: number = 0.8,
): NodePosition[] {
  const layout = spec.layout;
  const layers = assignLayers(spec);
  const orders = orderWithinLayers(spec, layers);

  const nw = layout.node_width;
  const nh = layout.node_height;
  const hg = layout.h_gap;
  const vg = layout.v_gap;

  const isHorizontal = spec.direction === "LR" || spec.direction === "RL";
  const isReversed = spec.direction === "BT" || spec.direction === "RL";

  const diamondIds = new Set(
    spec.nodes.filter((n) => n.shape === "diamond").map((n) => n.id),
  );
  // state-diagram pseudo-states (start/end) render as a small dot, not a full cell.
  const MARKER_SIZE = 0.34;
  const markerIds = new Set(
    spec.nodes.filter((n) => n.shape === "start" || n.shape === "end").map((n) => n.id),
  );
  const nodeHMap = new Map<string, number>();
  for (const n of spec.nodes) {
    let h = nh;
    if (markerIds.has(n.id)) h = MARKER_SIZE;
    else if (diamondIds.has(n.id)) h = nh * 1.6;
    else if (n.shape === "class" || n.shape === "entity") {
      // name compartment + one row per attribute/method (so the box fits its members)
      const members = (n.attributes?.length ?? 0) + (n.methods?.length ?? 0);
      h = 0.4 + Math.max(members, 1) * 0.26 + 0.1;
    }
    nodeHMap.set(n.id, h);
  }

  const numLayers = Math.max(0, ...layers.values()) + 1;

  const marginX = 0.8;
  const marginYTop = contentTop;
  const marginYBot = 0.3;

  // Axis abstraction
  const mainNode = isHorizontal ? nw : nh;
  const crossNode = isHorizontal ? nh : nw;
  const mainGap = vg;
  const crossGap = hg;

  // Group membership
  const groupDirectNodes = new Map<string, string[]>();
  const ungroupedNodes: string[] = [];
  for (const n of spec.nodes) {
    if (n.group) {
      if (!groupDirectNodes.has(n.group)) groupDirectNodes.set(n.group, []);
      groupDirectNodes.get(n.group)!.push(n.id);
    } else {
      ungroupedNodes.push(n.id);
    }
  }

  const DEPTH_PAD: Record<number, number> = { 0: 0.25, 1: 0.18, 2: 0.12 };
  const LABEL_H = 0.25;

  function maxCrossSlots(nids: string[]): number {
    if (nids.length === 0) return 0;
    const layerCounts = new Map<number, number>();
    for (const nid of nids) {
      const lyr = layers.get(nid) ?? 0;
      layerCounts.set(lyr, (layerCounts.get(lyr) ?? 0) + 1);
    }
    return Math.max(...layerCounts.values());
  }

  function groupCrossSize(gid: string): number {
    const depth = groupDepth(spec, gid);
    const pad = DEPTH_PAD[depth] ?? 0.10;
    const children = groupChildren(spec, gid);

    let total: number;
    if (children.length > 0) {
      total = 0;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) total += crossGap * 0.5;
        total += groupCrossSize(children[i]);
      }
      const directNids = groupDirectNodes.get(gid) ?? [];
      if (directNids.length > 0) {
        const ms = maxCrossSlots(directNids);
        if (total > 0) total += crossGap * 0.5;
        total += ms * crossNode + (ms - 1) * crossGap;
      }
    } else {
      const allNids = groupAllNodeIds(spec, gid, groupDirectNodes);
      const ms = maxCrossSlots(allNids);
      total = ms * crossNode + Math.max(0, ms - 1) * crossGap;
    }

    return total + 2 * pad + LABEL_H;
  }

  // Per-layer gap computation (Algorithm A)
  const COMPACT_GAP_RATIO = 0.25;
  const MIN_GROUP_VISUAL_GAP = 0.10;

  const nodeGroupMap = new Map<string, string | undefined>();
  for (const n of spec.nodes) nodeGroupMap.set(n.id, n.group);

  const layerToNodes = new Map<number, string[]>();
  for (const [nid, lyr] of layers) {
    if (!layerToNodes.has(lyr)) layerToNodes.set(lyr, []);
    layerToNodes.get(lyr)!.push(nid);
  }

  // Group layer ranges
  const groupLayerRanges = new Map<string, [number, number]>();
  for (const g of spec.groups) {
    const gNids = spec.nodes
      .filter((n) => n.group === g.id)
      .map((n) => n.id);
    if (gNids.length > 0) {
      const gLyrs = gNids
        .filter((nid) => layers.has(nid))
        .map((nid) => layers.get(nid)!);
      if (gLyrs.length > 0) {
        groupLayerRanges.set(g.id, [Math.min(...gLyrs), Math.max(...gLyrs)]);
      }
    }
  }

  const layerGaps = new Map<number, number>();
  for (let lyr = 0; lyr < numLayers - 1; lyr++) {
    const groupsThis = new Set<string>();
    const groupsNext = new Set<string>();
    for (const nid of layerToNodes.get(lyr) ?? []) {
      const g = nodeGroupMap.get(nid);
      if (g) groupsThis.add(g);
    }
    for (const nid of layerToNodes.get(lyr + 1) ?? []) {
      const g = nodeGroupMap.get(nid);
      if (g) groupsNext.add(g);
    }

    if (
      groupsThis.size > 0 &&
      groupsNext.size > 0 &&
      setsEqual(groupsThis, groupsNext)
    ) {
      layerGaps.set(lyr, mainGap * COMPACT_GAP_RATIO);
    } else {
      const ending = new Set(
        [...groupLayerRanges.entries()]
          .filter(([, [, mx]]) => mx === lyr)
          .map(([gid]) => gid),
      );
      const starting = new Set(
        [...groupLayerRanges.entries()]
          .filter(([, [mn]]) => mn === lyr + 1)
          .map(([gid]) => gid),
      );

      if (ending.size > 0 && starting.size > 0) {
        const maxEndDepth = Math.max(
          ...[...ending].map((gid) => groupDepth(spec, gid)),
        );
        const maxStartDepth = Math.max(
          ...[...starting].map((gid) => groupDepth(spec, gid)),
        );
        const endPad = DEPTH_PAD[maxEndDepth] ?? 0.10;
        const startPad = DEPTH_PAD[maxStartDepth] ?? 0.10;
        const boundaryGap = endPad + MIN_GROUP_VISUAL_GAP + startPad + LABEL_H;
        layerGaps.set(
          lyr,
          Math.max(boundaryGap, mainGap * COMPACT_GAP_RATIO),
        );
      } else if (intersects(groupsThis, groupsNext)) {
        layerGaps.set(lyr, mainGap * 0.5);
      } else {
        layerGaps.set(lyr, mainGap * 0.5);
      }
    }
  }

  // Cumulative main-axis positions
  const layerMainPos = new Map<number, number>();
  layerMainPos.set(0, 0);
  for (let lyr = 1; lyr < numLayers; lyr++) {
    const gap = layerGaps.get(lyr - 1) ?? mainGap * 0.5;
    layerMainPos.set(lyr, layerMainPos.get(lyr - 1)! + mainNode + gap);
  }

  const totalMainVar = (layerMainPos.get(numLayers - 1) ?? 0) + mainNode;

  // Node position storage
  const nodePositions = new Map<
    string,
    { x: number; y: number; w: number; h: number; layer: number; order: number }
  >();

  function placeNodesInBand(nids: string[], crossOrigin: number): void {
    const layerGroupsLocal = new Map<number, string[]>();
    for (const nid of nids) {
      const lyr = layers.get(nid) ?? 0;
      if (!layerGroupsLocal.has(lyr)) layerGroupsLocal.set(lyr, []);
      layerGroupsLocal.get(lyr)!.push(nid);
    }

    for (const [lyr, lyrNids] of layerGroupsLocal) {
      lyrNids.sort((a, b) => (orders.get(a) ?? 0) - (orders.get(b) ?? 0));
      for (let i = 0; i < lyrNids.length; i++) {
        const nid = lyrNids[i];
        const mPos = layerMainPos.get(lyr) ?? 0;
        const cPos = crossOrigin + i * (crossNode + crossGap);
        const thisH = nodeHMap.get(nid) ?? nh;

        if (isHorizontal) {
          nodePositions.set(nid, {
            x: mPos, y: cPos, w: nw, h: thisH,
            layer: lyr, order: orders.get(nid) ?? 0,
          });
        } else {
          nodePositions.set(nid, {
            x: cPos, y: mPos, w: nw, h: thisH,
            layer: lyr, order: orders.get(nid) ?? 0,
          });
        }
      }
    }
  }

  function allocateGroup(gid: string, crossOrigin: number): void {
    const depth = groupDepth(spec, gid);
    const pad = DEPTH_PAD[depth] ?? 0.10;
    const innerCross = crossOrigin + pad + LABEL_H;

    const children = groupChildren(spec, gid);
    let currentCross = innerCross;

    if (children.length > 0) {
      for (let i = 0; i < children.length; i++) {
        if (i > 0) currentCross += crossGap * 0.5;
        allocateGroup(children[i], currentCross);
        currentCross += groupCrossSize(children[i]);
      }
      const directNids = groupDirectNodes.get(gid) ?? [];
      if (directNids.length > 0) {
        if (currentCross > innerCross) currentCross += crossGap * 0.5;
        placeNodesInBand(directNids, currentCross);
      }
    } else {
      const allNids = groupAllNodeIds(spec, gid, groupDirectNodes);
      placeNodesInBand(allNids, innerCross);
    }
  }

  // Column packing via interval coloring
  const topGroups = spec.groups.filter((g) => g.parent === undefined);

  const topGroupRanges = new Map<string, [number, number]>();
  for (const g of topGroups) {
    const allNids = groupAllNodeIds(spec, g.id, groupDirectNodes);
    if (allNids.length > 0) {
      const gLyrs = allNids
        .filter((nid) => layers.has(nid))
        .map((nid) => layers.get(nid)!);
      if (gLyrs.length > 0) {
        topGroupRanges.set(g.id, [Math.min(...gLyrs), Math.max(...gLyrs)]);
      }
    }
  }

  const sortedTl = topGroups
    .filter((g) => topGroupRanges.has(g.id))
    .sort((a, b) => {
      const [aMin, aMax] = topGroupRanges.get(a.id)!;
      const [bMin, bMax] = topGroupRanges.get(b.id)!;
      if (aMin !== bMin) return aMin - bMin;
      return (aMax - aMin) - (bMax - bMin);
    });

  const columns: Array<typeof topGroups> = [];
  const columnIntervals: Array<Array<[number, number]>> = [];
  const groupColumn = new Map<string, number>();

  for (const g of sortedTl) {
    const [gMin, gMax] = topGroupRanges.get(g.id)!;
    let assigned = false;
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      let fits = true;
      for (const [eMin, eMax] of columnIntervals[colIdx]) {
        if (gMin <= eMax && gMax >= eMin) {
          fits = false;
          break;
        }
      }
      if (fits) {
        columns[colIdx].push(g);
        columnIntervals[colIdx].push([gMin, gMax]);
        groupColumn.set(g.id, colIdx);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      columns.push([g]);
      columnIntervals.push([[gMin, gMax]]);
      groupColumn.set(g.id, columns.length - 1);
    }
  }

  // Empty groups go to column 0
  for (const g of topGroups) {
    if (!groupColumn.has(g.id)) {
      if (columns.length > 0) {
        columns[0].push(g);
        groupColumn.set(g.id, 0);
      } else {
        columns.push([g]);
        groupColumn.set(g.id, 0);
        columnIntervals.push([]);
      }
    }
  }

  // Compute column cross-axis sizes
  const columnCrossSizes = columns.map((colGroups) =>
    Math.max(...colGroups.map((g) => groupCrossSize(g.id)), 0),
  );

  let totalCross =
    columnCrossSizes.reduce((a, b) => a + b, 0) +
    Math.max(0, columns.length - 1) * crossGap;

  if (ungroupedNodes.length > 0) {
    const maxUgSlots = maxCrossSlots(ungroupedNodes);
    const ugSize =
      maxUgSlots * crossNode + Math.max(0, maxUgSlots - 1) * crossGap;
    totalCross += crossGap + ugSize;
  }

  let totalMain = totalMainVar;
  if (totalMain <= 0) totalMain = mainNode;

  // Scale to fit
  const availMain = isHorizontal
    ? SLIDE_W - 2 * marginX
    : SLIDE_H - marginYTop - marginYBot;
  const availCross = isHorizontal
    ? SLIDE_H - marginYTop - marginYBot
    : SLIDE_W - 2 * marginX;

  const scaleMain = totalMain > 0 ? availMain / totalMain : 1.0;
  const scaleCross = totalCross > 0 ? availCross / totalCross : 1.0;
  const scale = Math.min(scaleMain, scaleCross, 1.0);

  // Allocate groups with connectivity-based offset
  const columnCrossOrigins: number[] = [];
  let curPos = 0;
  for (let i = 0; i < columns.length; i++) {
    columnCrossOrigins.push(curPos);
    curPos += columnCrossSizes[i] + crossGap;
  }

  // Build group-to-group edge weights
  const ntg = new Map<string, string>();
  for (const n of spec.nodes) {
    if (n.group) ntg.set(n.id, n.group);
  }

  const g2gWeights = new Map<string, Map<string, number>>();
  for (const e of spec.edges) {
    const fg = ntg.get(e.from);
    const tg = ntg.get(e.to);
    if (fg && tg && fg !== tg) {
      if (!g2gWeights.has(fg)) g2gWeights.set(fg, new Map());
      if (!g2gWeights.has(tg)) g2gWeights.set(tg, new Map());
      g2gWeights.get(fg)!.set(tg, (g2gWeights.get(fg)!.get(tg) ?? 0) + 1);
      g2gWeights.get(tg)!.set(fg, (g2gWeights.get(tg)!.get(fg) ?? 0) + 1);
    }
  }

  const columnCenters = columnCrossOrigins.map(
    (o, i) => o + columnCrossSizes[i] / 2,
  );

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const colOrigin = columnCrossOrigins[colIdx];
    const colSize = columnCrossSizes[colIdx];

    for (const g of columns[colIdx]) {
      const gSize = groupCrossSize(g.id);
      const maxOffset = colSize - gSize;

      if (maxOffset <= 0.01) {
        allocateGroup(g.id, colOrigin);
        continue;
      }

      let weightedSum = 0;
      let totalWeight = 0;
      const neighbors = g2gWeights.get(g.id);
      if (neighbors) {
        for (const [neighborGid, weight] of neighbors) {
          const nCol = groupColumn.get(neighborGid);
          if (nCol !== undefined && nCol !== colIdx) {
            weightedSum += columnCenters[nCol] * weight;
            totalWeight += weight;
          }
        }
      }

      let gOffset: number;
      if (totalWeight > 0) {
        const targetCenter = weightedSum / totalWeight;
        const myCenterIfCentered = colOrigin + colSize / 2;
        const shiftDirection = targetCenter - myCenterIfCentered;
        const shiftRatio = Math.min(
          Math.abs(shiftDirection) / (colSize + crossGap + 1e-6),
          1.0,
        );
        gOffset =
          shiftDirection > 0
            ? maxOffset * shiftRatio
            : maxOffset * (1.0 - shiftRatio);
      } else {
        gOffset = maxOffset / 2;
      }

      allocateGroup(g.id, colOrigin + gOffset);
    }
  }

  if (ungroupedNodes.length > 0) {
    placeNodesInBand(ungroupedNodes, curPos);
  }

  // Cross-axis stretch
  const MAX_CROSS_STRETCH = 2.5;
  const crossStretch =
    scaleMain < scaleCross && totalCross > 0
      ? Math.min(availCross / (totalCross * scale), MAX_CROSS_STRETCH)
      : 1.0;

  // Transform: scale + cross-stretch + center + margin
  const positions: NodePosition[] = [];

  const allRawCross: number[] = [];
  for (const [, raw] of nodePositions) {
    allRawCross.push(
      isHorizontal ? raw.y + raw.h / 2 : raw.x + raw.w / 2,
    );
  }
  const rawCrossCenter =
    allRawCross.length > 0
      ? (Math.min(...allRawCross) + Math.max(...allRawCross)) / 2
      : 0;

  for (const [nid, raw] of nodePositions) {
    let sx: number, sy: number;
    if (isHorizontal) {
      sx = raw.x * scale;
      const yCenter = raw.y + raw.h / 2;
      sy =
        ((yCenter - rawCrossCenter) * crossStretch + rawCrossCenter) * scale -
        (raw.h * scale) / 2;
    } else {
      sy = raw.y * scale;
      const xCenter = raw.x + raw.w / 2;
      sx =
        ((xCenter - rawCrossCenter) * crossStretch + rawCrossCenter) * scale -
        (raw.w * scale) / 2;
    }
    positions.push({
      nodeId: nid,
      x: sx, y: sy,
      w: raw.w * scale, h: raw.h * scale,
      layer: raw.layer, order: raw.order,
      scale,
    });
  }

  // Center in available space
  if (positions.length > 0) {
    let offsetX: number, offsetY: number;
    if (isHorizontal) {
      const scaledMain = totalMain * scale;
      const scaledCross = totalCross * scale * crossStretch;
      offsetX = marginX + (availMain - scaledMain) / 2;
      offsetY = marginYTop + (availCross - scaledCross) / 2;
    } else {
      const scaledMain = totalMain * scale;
      const scaledCross = totalCross * scale * crossStretch;
      offsetX = marginX + (availCross - scaledCross) / 2;
      offsetY = marginYTop + (availMain - scaledMain) / 2;
    }

    for (const p of positions) {
      p.x += offsetX;
      p.y += offsetY;
    }
  }

  // Handle reversed directions
  if (isReversed && positions.length > 0) {
    for (const p of positions) {
      if (isHorizontal) {
        p.x = SLIDE_W - p.x - p.w;
      } else {
        p.y = SLIDE_H - p.y - p.h;
      }
    }
  }

  return positions;
}

// ── Layout v3: Swimlane-Aware ──

function computeLayoutSwimlane(
  spec: DiagramSpec,
  contentTop: number = 0.8,
): { positions: NodePosition[]; laneInfos: LaneInfo[] } {
  const layout = spec.layout;
  const layers = assignLayers(spec);
  const orders = orderWithinLayers(spec, layers);

  const isHorizontal = spec.direction === "LR" || spec.direction === "RL";
  const isReversed = spec.direction === "BT" || spec.direction === "RL";

  const nw = layout.node_width;
  const nh = layout.node_height;
  const hg = layout.h_gap;
  const vg = layout.v_gap;

  const diamondIds = new Set(
    spec.nodes.filter((n) => n.shape === "diamond").map((n) => n.id),
  );
  // state-diagram pseudo-states (start/end) render as a small dot, not a full cell.
  const MARKER_SIZE = 0.34;
  const markerIds = new Set(
    spec.nodes.filter((n) => n.shape === "start" || n.shape === "end").map((n) => n.id),
  );
  const nodeHMap = new Map<string, number>();
  for (const n of spec.nodes) {
    let h = nh;
    if (markerIds.has(n.id)) h = MARKER_SIZE;
    else if (diamondIds.has(n.id)) h = nh * 1.6;
    else if (n.shape === "class" || n.shape === "entity") {
      // name compartment + one row per attribute/method (so the box fits its members)
      const members = (n.attributes?.length ?? 0) + (n.methods?.length ?? 0);
      h = 0.4 + Math.max(members, 1) * 0.26 + 0.1;
    }
    nodeHMap.set(n.id, h);
  }

  const numLayers = Math.max(0, ...layers.values()) + 1;
  const margin = 0.3;
  const laneHeaderSize = 0.6;

  let mainStart: number, mainAvail: number;
  let crossStart: number, crossAvail: number;

  if (isHorizontal) {
    mainStart = margin + laneHeaderSize + 0.1;
    mainAvail = SLIDE_W - mainStart - margin;
    crossStart = contentTop + 0.1;
    crossAvail = SLIDE_H - crossStart - margin;
  } else {
    mainStart = contentTop + laneHeaderSize + 0.1;
    mainAvail = SLIDE_H - mainStart - margin;
    crossStart = margin;
    crossAvail = SLIDE_W - 2 * margin;
  }

  // Assign nodes to lanes
  const laneMap = new Map(spec.lanes.map((ln) => [ln.id, ln]));
  const laneOrder = spec.lanes.map((ln) => ln.id);
  const laneNodes = new Map<string, string[]>();
  for (const lid of laneOrder) laneNodes.set(lid, []);
  const unassigned: string[] = [];

  for (const n of spec.nodes) {
    if (n.lane && laneNodes.has(n.lane)) {
      laneNodes.get(n.lane)!.push(n.id);
    } else {
      unassigned.push(n.id);
    }
  }

  if (unassigned.length > 0) {
    laneOrder.push("__default__");
    laneNodes.set("__default__", unassigned);
  }

  // Compute lane sizes
  const laneMaxPerLayer = new Map<string, number>();
  for (const lid of laneOrder) {
    const nids = laneNodes.get(lid) ?? [];
    if (nids.length === 0) {
      laneMaxPerLayer.set(lid, 1);
      continue;
    }
    const layerCounts = new Map<number, number>();
    for (const nid of nids) {
      const lyr = layers.get(nid) ?? 0;
      layerCounts.set(lyr, (layerCounts.get(lyr) ?? 0) + 1);
    }
    laneMaxPerLayer.set(lid, Math.max(...layerCounts.values(), 1));
  }

  const crossNodeSize = isHorizontal ? nh : nw;
  const crossGapSize = hg;
  const minBand = crossNodeSize + crossGapSize * 2;
  const totalWeight = laneOrder.reduce(
    (s, lid) => s + Math.max(1, laneMaxPerLayer.get(lid) ?? 1),
    0,
  );
  const laneGap = 0.05;
  const usableCross = crossAvail - laneGap * (laneOrder.length - 1);

  const laneInfos: LaneInfo[] = [];
  let curCross = crossStart;

  for (const lid of laneOrder) {
    const weight = Math.max(1, laneMaxPerLayer.get(lid) ?? 1);
    const bandSize = Math.max(minBand, (usableCross * weight) / totalWeight);
    const lane = laneMap.get(lid);
    const style: LaneStyle = lane?.style ?? {
      header_fill: "#1E2761",
      header_font_color: "#FFFFFF",
      border: "#CBD5E1",
      border_width: 1.0,
    };
    laneInfos.push({
      laneId: lid,
      label: lane?.label ?? "",
      crossOrigin: curCross,
      crossSize: bandSize,
      style,
    });
    curCross += bandSize + laneGap;
  }

  const laneInfoMap = new Map(laneInfos.map((li) => [li.laneId, li]));

  // Main-axis positions
  const mainNodeSize = isHorizontal ? nw : nh;
  const rawMainTotal =
    numLayers * mainNodeSize + (numLayers - 1) * vg;
  const mainScale =
    rawMainTotal > 0 ? Math.min(mainAvail / rawMainTotal, 1.0) : 1.0;

  function layerMainPos(layerIdx: number): number {
    let pos = mainStart + layerIdx * (mainNodeSize + vg) * mainScale;
    if (isReversed) {
      pos =
        mainStart + mainAvail - (pos - mainStart) - mainNodeSize * mainScale;
    }
    return pos;
  }

  // Place nodes
  const positions: NodePosition[] = [];

  for (const lid of laneOrder) {
    const li = laneInfoMap.get(lid)!;
    const nids = laneNodes.get(lid) ?? [];
    if (nids.length === 0) continue;

    const laneLyrNodes = new Map<number, string[]>();
    for (const nid of nids) {
      const lyr = layers.get(nid) ?? 0;
      if (!laneLyrNodes.has(lyr)) laneLyrNodes.set(lyr, []);
      laneLyrNodes.get(lyr)!.push(nid);
    }

    for (const [lyr, lyrNids] of laneLyrNodes) {
      lyrNids.sort((a, b) => (orders.get(a) ?? 0) - (orders.get(b) ?? 0));
      const nIn = lyrNids.length;

      for (let i = 0; i < lyrNids.length; i++) {
        const nid = lyrNids[i];
        const thisH = nodeHMap.get(nid) ?? nh;
        const mainPos = layerMainPos(lyr);

        let x: number, y: number, w: number, h: number;

        if (isHorizontal) {
          const nodeCross = thisH;
          const totalCrossSize = nIn * nodeCross + (nIn - 1) * crossGapSize;
          const crossOffset = (li.crossSize - totalCrossSize) / 2;
          x = mainPos;
          y = li.crossOrigin + crossOffset + i * (nodeCross + crossGapSize);
          w = nw * mainScale;
          h = thisH;
        } else {
          const nodeCross = nw;
          const totalCrossSize = nIn * nodeCross + (nIn - 1) * crossGapSize;
          const crossOffset = (li.crossSize - totalCrossSize) / 2;
          x = li.crossOrigin + crossOffset + i * (nodeCross + crossGapSize);
          y = mainPos;
          w = nw;
          h = thisH * mainScale;
        }

        positions.push({
          nodeId: nid, x, y, w, h,
          layer: lyr, order: i,
          scale: mainScale,
        });
      }
    }
  }

  return { positions, laneInfos };
}

// ── Connection Point Calculation ──

export function cpCoords(
  pos: NodePosition,
  cpIdx: CpIndex,
  shape: string = "rect",
  portOffset: number = 0.0,
): ConnectionPoint {
  const cx = pos.x + pos.w / 2;
  const cy = pos.y + pos.h / 2;

  if (shape === "diamond") {
    // Diamond vertices
    switch (cpIdx) {
      case 0: return { x: cx, y: pos.y };
      case 1: return { x: pos.x + pos.w, y: cy };
      case 2: return { x: cx, y: pos.y + pos.h };
      case 3: return { x: pos.x, y: cy };
    }
  }

  // Rectangle: offset along the edge
  const offPx = portOffset * pos.w;
  const offPy = portOffset * pos.h;

  switch (cpIdx) {
    case 0: return { x: cx + offPx, y: pos.y };           // top
    case 1: return { x: pos.x + pos.w, y: cy + offPy };   // right
    case 2: return { x: cx + offPx, y: pos.y + pos.h };   // bottom
    case 3: return { x: pos.x, y: cy + offPy };           // left
  }
}

export function detectCp(
  fromPos: NodePosition,
  toPos: NodePosition,
  direction: Direction = "TB",
): [CpIndex, CpIndex] {
  const ax = fromPos.x + fromPos.w / 2;
  const ay = fromPos.y + fromPos.h / 2;
  const bx = toPos.x + toPos.w / 2;
  const by = toPos.y + toPos.h / 2;
  const dx = bx - ax;
  const dy = by - ay;

  const isInterLayer = fromPos.layer !== toPos.layer;

  if (isInterLayer) {
    if (direction === "TB" || direction === "BT") {
      return dy > 0 ? [2, 0] : [0, 2];
    } else {
      return dx > 0 ? [1, 3] : [3, 1];
    }
  } else {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? [1, 3] : [3, 1];
    }
    return dy > 0 ? [2, 0] : [0, 2];
  }
}

// ── Edge Route Planning ──

export function classifyEdgeRoute(
  fromId: string,
  toId: string,
  posMap: Map<string, NodePosition>,
  layerMap: Map<string, number>,
  nodeToGroup: Map<string, string | undefined>,
  groupBboxes: Map<string, [number, number, number, number]>,
  direction: Direction,
  backEdges: Set<string>,
): string {
  if (isBackEdge(backEdges, fromId, toId)) return "back_edge";

  const fp = posMap.get(fromId);
  const tp = posMap.get(toId);
  if (!fp || !tp) return "direct";

  const fg = nodeToGroup.get(fromId);
  const tg = nodeToGroup.get(toId);
  const fromLayer = layerMap.get(fromId) ?? 0;
  const toLayer = layerMap.get(toId) ?? 0;
  const isInterLayer = fromLayer !== toLayer;
  const isVertical = direction === "TB" || direction === "BT";
  const layerDist = Math.abs(fromLayer - toLayer);

  // Cross-group detection
  if (fg && tg && fg !== tg && groupBboxes.has(fg) && groupBboxes.has(tg) && layerDist > 3) {
    const fb = groupBboxes.get(fg)!;
    const tb = groupBboxes.get(tg)!;
    if (isVertical) {
      const hOverlap = Math.min(fb[2], tb[2]) - Math.max(fb[0], tb[0]);
      const minW = Math.min(fb[2] - fb[0], tb[2] - tb[0]);
      if (minW > 0 && hOverlap < minW * 0.3) return "cross_group";
    } else {
      const vOverlap = Math.min(fb[3], tb[3]) - Math.max(fb[1], tb[1]);
      const minH = Math.min(fb[3] - fb[1], tb[3] - tb[1]);
      if (minH > 0 && vOverlap < minH * 0.3) return "cross_group";
    }
  }

  // L-route detection
  if (isInterLayer) {
    if (isVertical) {
      const hOffset = Math.abs(fp.x + fp.w / 2 - (tp.x + tp.w / 2));
      if (hOffset > fp.w * 0.3) return "l_route";
    } else {
      const vOffset = Math.abs(fp.y + fp.h / 2 - (tp.y + tp.h / 2));
      if (vOffset > fp.h * 0.3) return "l_route";
    }
  }

  return "direct";
}

export function planEdgeRoute(
  fromPos: NodePosition,
  toPos: NodePosition,
  fromShape: string,
  toShape: string,
  direction: Direction,
  routeType: string,
  srcPortOff: number = 0,
  tgtPortOff: number = 0,
): ConnectionPoint[] {
  const [srcCp, tgtCp] = detectCp(fromPos, toPos, direction);
  const src = cpCoords(fromPos, srcCp, fromShape, srcPortOff);
  const tgt = cpCoords(toPos, tgtCp, toShape, tgtPortOff);

  if (routeType === "direct") {
    return [src, tgt];
  }

  if (routeType === "l_route") {
    // Manhattan route with the bend at the MIDPOINT between the nodes, so the final
    // segment approaches the target PERPENDICULAR and straight (the arrowhead has
    // room). The old single elbow landed on the target's edge, so the last segment
    // ran ALONG that edge and crushed the arrowhead right at the node.
    const isVertical = direction === "TB" || direction === "BT";
    if (isVertical) {
      const midY = (src.y + tgt.y) / 2;
      return [src, { x: src.x, y: midY }, { x: tgt.x, y: midY }, tgt];
    } else {
      const midX = (src.x + tgt.x) / 2;
      return [src, { x: midX, y: src.y }, { x: midX, y: tgt.y }, tgt];
    }
  }

  if (routeType === "back_edge") {
    // U-shape: go out to the right margin, then back
    const isVertical = direction === "TB" || direction === "BT";
    const rightMargin = SLIDE_W - 0.3;
    if (isVertical) {
      const srcR = cpCoords(fromPos, 1, fromShape);
      const tgtR = cpCoords(toPos, 1, toShape);
      return [
        srcR,
        { x: rightMargin, y: srcR.y },
        { x: rightMargin, y: tgtR.y },
        tgtR,
      ];
    } else {
      const srcB = cpCoords(fromPos, 2, fromShape);
      const tgtB = cpCoords(toPos, 2, toShape);
      const bottomMargin = SLIDE_H - 0.3;
      return [
        srcB,
        { x: srcB.x, y: bottomMargin },
        { x: tgtB.x, y: bottomMargin },
        tgtB,
      ];
    }
  }

  if (routeType === "cross_group") {
    // Manhattan route between groups
    const isVertical = direction === "TB" || direction === "BT";
    if (isVertical) {
      const midY = (src.y + tgt.y) / 2;
      return [
        src,
        { x: src.x, y: midY },
        { x: tgt.x, y: midY },
        tgt,
      ];
    } else {
      const midX = (src.x + tgt.x) / 2;
      return [
        src,
        { x: midX, y: src.y },
        { x: midX, y: tgt.y },
        tgt,
      ];
    }
  }

  return [src, tgt];
}

// ── Port Offset Calculation ──

export function computePortOffsets(
  spec: DiagramSpec,
  posMap: Map<string, NodePosition>,
  _layerMap: Map<string, number>,
  backEdges: Set<string>,
): Map<string, [number, number]> {
  const isVertical = spec.direction === "TB" || spec.direction === "BT";
  const nodeOutEdges = new Map<string, typeof spec.edges>();
  const nodeInEdges = new Map<string, typeof spec.edges>();

  for (const edge of spec.edges) {
    if (isBackEdge(backEdges, edge.from, edge.to)) continue;
    if (!posMap.has(edge.from) || !posMap.has(edge.to)) continue;

    if (!nodeOutEdges.has(edge.from)) nodeOutEdges.set(edge.from, []);
    nodeOutEdges.get(edge.from)!.push(edge);
    if (!nodeInEdges.has(edge.to)) nodeInEdges.set(edge.to, []);
    nodeInEdges.get(edge.to)!.push(edge);
  }

  const portOffsets = new Map<string, [number, number]>();

  function assignPorts(
    _nodeId: string,
    edges: typeof spec.edges,
    isOutgoing: boolean,
  ): void {
    if (edges.length <= 1) {
      for (const e of edges) {
        const key = `${e.from}->${e.to}`;
        if (!portOffsets.has(key)) portOffsets.set(key, [0, 0]);
        const cur = portOffsets.get(key)!;
        if (isOutgoing) portOffsets.set(key, [0, cur[1]]);
        else portOffsets.set(key, [cur[0], 0]);
      }
      return;
    }

    // Sort by cross-axis position of the other endpoint
    const sorted = [...edges].sort((a, b) => {
      const othA = posMap.get(isOutgoing ? a.to : a.from);
      const othB = posMap.get(isOutgoing ? b.to : b.from);
      if (!othA || !othB) return 0;
      if (isVertical) {
        return (othA.x + othA.w / 2) - (othB.x + othB.w / 2);
      }
      return (othA.y + othA.h / 2) - (othB.y + othB.h / 2);
    });

    const maxSpread = 0.35;
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const e = sorted[i];
      const offset = n === 1 ? 0 : -maxSpread + (2 * maxSpread * i) / (n - 1);
      const key = `${e.from}->${e.to}`;
      if (!portOffsets.has(key)) portOffsets.set(key, [0, 0]);
      const cur = portOffsets.get(key)!;
      if (isOutgoing) portOffsets.set(key, [offset, cur[1]]);
      else portOffsets.set(key, [cur[0], offset]);
    }
  }

  for (const [nodeId, edges] of nodeOutEdges) {
    assignPorts(nodeId, edges, true);
  }
  for (const [nodeId, edges] of nodeInEdges) {
    assignPorts(nodeId, edges, false);
  }

  return portOffsets;
}

// ── Group Bounding Boxes ──

export function computeGroupBboxes(
  spec: DiagramSpec,
  posMap: Map<string, NodePosition>,
): Map<string, [number, number, number, number]> {
  const bboxes = new Map<string, [number, number, number, number]>();
  const padding = 0.15;

  for (const g of spec.groups) {
    const memberNodes = spec.nodes
      .filter((n) => n.group === g.id)
      .map((n) => posMap.get(n.id))
      .filter((p): p is NodePosition => p !== undefined);

    if (memberNodes.length === 0) continue;

    const minX = Math.min(...memberNodes.map((p) => p.x)) - padding;
    const minY = Math.min(...memberNodes.map((p) => p.y)) - padding - 0.25; // label space
    const maxX = Math.max(...memberNodes.map((p) => p.x + p.w)) + padding;
    const maxY = Math.max(...memberNodes.map((p) => p.y + p.h)) + padding;

    bboxes.set(g.id, [minX, minY, maxX, maxY]);
  }

  return bboxes;
}

// ── Main Entry Point ──

/**
 * Apply manual per-node position/size overrides (inches) onto the computed
 * layout. Nodes without an override are left exactly as auto-computed, so
 * Python coordinate parity (R5) and the golden output are unaffected.
 */
function applyNodeOverrides(
  positions: NodePosition[],
  spec: DiagramSpec,
): NodePosition[] {
  const overrides = new Map(
    spec.nodes.filter((n) => n.override).map((n) => [n.id, n.override!]),
  );
  if (overrides.size === 0) return positions;
  return positions.map((p) => {
    const o = overrides.get(p.nodeId);
    if (!o) return p;
    return {
      ...p,
      x: o.x ?? p.x,
      y: o.y ?? p.y,
      w: o.w ?? p.w,
      h: o.h ?? p.h,
    };
  });
}

export function computeLayout(
  spec: DiagramSpec,
  contentTop: number = 0.8,
): NodePosition[] {
  let positions: NodePosition[];
  if (spec.lanes.length > 0) {
    positions = computeLayoutSwimlane(spec, contentTop).positions;
  } else if (spec.groups.length > 0) {
    positions = computeLayoutV2(spec, contentTop);
  } else {
    positions = computeLayoutV1(spec, contentTop);
  }
  return applyNodeOverrides(positions, spec);
}

export function computeLayoutWithLanes(
  spec: DiagramSpec,
  contentTop: number = 0.8,
): { positions: NodePosition[]; laneInfos: LaneInfo[] } {
  const { positions, laneInfos } = computeLayoutSwimlane(spec, contentTop);
  return { positions: applyNodeOverrides(positions, spec), laneInfos };
}

// ── Utility Functions ──

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

function intersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}
