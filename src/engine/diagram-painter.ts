/**
 * diagram-painter.ts — Backend-agnostic diagram drawing orchestration.
 *
 * The SINGLE source of truth for how a DiagramSpec is drawn. It computes
 * geometry via layout-engine and issues abstract draw commands against a
 * DrawTarget (draw-target.ts). Two backends consume it:
 *   - PptxDrawTarget (pptx-writer.ts)  → editable PPTX shapes
 *   - SvgDrawTarget  (svg-writer.ts)   → SVG for the live preview
 * Because both go through paintDiagram(), the preview and the PPTX can never
 * structurally diverge (WYSIWYG by construction).
 *
 * Drawing primitives live in diagram-draw.ts (nodes/edges/labels) and
 * diagram-zones.ts (groups/lanes/buses). Coordinates are inches.
 */

import type { DiagramSpec, EdgeStyle } from "./schema";
import { DEFAULT_THEME } from "./theme";
import {
  computeLayout,
  computeLayoutWithLanes,
  assignLayers,
  buildAdjacency,
  findBackEdges,
  isBackEdge,
  classifyEdgeRoute,
  computePortOffsets,
  planEdgeRoute,
  type NodePosition,
  type LaneInfo,
} from "./layout-engine";
import { scaledFontSize, type DrawTarget, type PaintOptions, type ResolvedStyle } from "./draw-target";
import { paintShape, paintPath, paintHeaderBar, placeEdgeLabel } from "./diagram-draw";
import { paintGroupZones, paintSwimlanes, paintFanInBus, paintFanOutBus } from "./diagram-zones";

// Re-export the draw abstraction so backends import everything from one place.
export type {
  DrawTarget,
  Box,
  LineSpec,
  TextRun,
  TextOpts,
  EdgeLineOpts,
  PaintOptions,
} from "./draw-target";

export function paintDiagram(
  t: DrawTarget,
  spec: DiagramSpec,
  options: PaintOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const useHeaderBar = options.useHeaderBar ?? true;
  const ds = theme.diagram_style;
  const fonts = theme.fonts;

  if (ds.slide_bg) {
    t.background(ds.slide_bg);
  }

  let contentTop = 0.8;
  if (useHeaderBar && spec.title) {
    paintHeaderBar(t, spec.title, theme);
    contentTop = 1.35;
  } else if (spec.title) {
    t.text(
      [{ text: spec.title, fontSize: ds.title_font_size, fontFace: fonts.heading, color: ds.title_font_color, bold: ds.title_font_bold }],
      { x: 0.5, y: 0.15, w: 10, h: 0.45 },
      {},
    );
  }

  let positions: NodePosition[];
  let laneInfos: LaneInfo[] = [];

  if (spec.lanes.length > 0) {
    const result = computeLayoutWithLanes(spec, contentTop);
    positions = result.positions;
    laneInfos = result.laneInfos;
  } else {
    positions = computeLayout(spec, contentTop);
  }

  const posMap = new Map(positions.map((p) => [p.nodeId, p]));
  const layoutScale = positions.length > 0 ? positions[0].scale : 1.0;

  const nodeShapeMap = new Map<string, string>();
  for (const n of spec.nodes) nodeShapeMap.set(n.id, n.shape);

  if (laneInfos.length > 0) {
    paintSwimlanes(t, laneInfos, spec.direction, contentTop, theme);
  }

  let groupBboxes = new Map<string, [number, number, number, number]>();
  if (spec.groups.length > 0) {
    groupBboxes = paintGroupZones(t, spec, posMap, theme, layoutScale);
  }

  const nodeMap = new Map(spec.nodes.map((n) => [n.id, n]));

  for (const pos of positions) {
    const node = nodeMap.get(pos.nodeId);
    if (!node) continue;

    const baseStyle: ResolvedStyle = {
      fill: undefined,
      border: undefined,
      border_width: 1.5,
      border_dash: false,
      font_color: "#FFFFFF",
      font_size: 11,
      font_bold: true,
    };

    if (node.class && spec.classDefs[node.class]) {
      Object.assign(baseStyle, spec.classDefs[node.class]);
    }
    if (node.style) {
      Object.assign(baseStyle, node.style);
    }

    paintShape(t, node, pos, baseStyle, theme, layoutScale);
  }

  // Connectors
  const isFlowchart = spec.type === "flowchart";
  const direction = spec.direction;
  const layers = assignLayers(spec);
  const { fwd } = buildAdjacency(spec);
  const backEdges = findBackEdges(fwd, spec.nodes.map((n) => n.id));

  const nodeToGroup = new Map<string, string | undefined>();
  for (const n of spec.nodes) nodeToGroup.set(n.id, n.group);

  const busHandled = new Set<string>();
  const fanoutCandidates = new Map<string, typeof spec.edges>();
  const faninCandidates = new Map<string, typeof spec.edges>();

  for (const edge of spec.edges) {
    if (isBackEdge(backEdges, edge.from, edge.to)) continue;
    if (!fanoutCandidates.has(edge.from)) fanoutCandidates.set(edge.from, []);
    fanoutCandidates.get(edge.from)!.push(edge);
    if (!faninCandidates.has(edge.to)) faninCandidates.set(edge.to, []);
    faninCandidates.get(edge.to)!.push(edge);
  }

  function isAutoMergeable(edges: typeof spec.edges): boolean {
    if (edges.length < 3) return false;
    if (edges.some((e) => e.label)) return false;
    return true;
  }

  for (const [srcId, edges] of fanoutCandidates) {
    if (!isAutoMergeable(edges)) continue;
    if (edges.some((e) => busHandled.has(`${e.from}->${e.to}`))) continue;
    const h = paintFanOutBus(t, srcId, edges, posMap, nodeShapeMap, direction, isFlowchart, theme);
    for (const k of h) busHandled.add(k);
  }

  for (const [tgtId, edges] of faninCandidates) {
    const remaining = edges.filter((e) => !busHandled.has(`${e.from}->${e.to}`));
    if (!isAutoMergeable(remaining)) continue;
    const h = paintFanInBus(t, tgtId, remaining, posMap, nodeShapeMap, direction, isFlowchart, theme);
    for (const k of h) busHandled.add(k);
  }

  const portOffsets = computePortOffsets(spec, posMap, layers, backEdges);

  for (const edge of spec.edges) {
    const edgeKey = `${edge.from}->${edge.to}`;
    if (busHandled.has(edgeKey)) continue;

    const fromPos = posMap.get(edge.from);
    const toPos = posMap.get(edge.to);
    if (!fromPos || !toPos) continue;

    const es: Partial<EdgeStyle> = edge.style ?? {};
    const color = es.color ?? ds.edge_color;
    const width = es.width ?? ds.edge_width;
    const arrow = isFlowchart ? (es.arrow ?? true) : false;
    const dash = es.dash ?? false;

    const routeType = classifyEdgeRoute(
      edge.from, edge.to, posMap, layers,
      nodeToGroup, groupBboxes, direction, backEdges,
    );

    const [srcPortOff, tgtPortOff] = portOffsets.get(edgeKey) ?? [0, 0];

    const points = planEdgeRoute(
      fromPos, toPos,
      nodeShapeMap.get(edge.from) ?? "rect",
      nodeShapeMap.get(edge.to) ?? "rect",
      direction, routeType, srcPortOff, tgtPortOff,
    );

    paintPath(t, points, { color, width, arrow, dash: routeType === "back_edge" ? true : dash });

    if (edge.label) {
      const labelPos = placeEdgeLabel(points, edge.label);
      const edgeFs = scaledFontSize(ds.edge_label_font_size, layoutScale);
      t.text(
        [{ text: edge.label, fontSize: edgeFs, fontFace: fonts.body, color, bold: true }],
        labelPos,
        {},
      );
    }
  }
}
