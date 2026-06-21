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
import {
  scaledFontSize,
  TransformedTarget,
  fitTransform,
  type DrawTarget,
  type PaintOptions,
  type ResolvedStyle,
} from "./draw-target";
import { paintShape, paintPath, paintHeaderBar, placeEdgeLabel, umlEdgeStyle, paintUmlMarker, paintCrowFoot } from "./diagram-draw";
import { computeSequenceLayout, paintSequence } from "./diagram-sequence";
import { computeTimelineLayout, paintTimeline } from "./diagram-timeline";
import { computeQuadrantLayout, paintQuadrant } from "./diagram-quadrant";
import { computePieLayout, paintPie } from "./diagram-pie";
import { computeGanttLayout, paintGantt } from "./diagram-gantt";
import { computeJourneyLayout, paintJourney } from "./diagram-journey";
import { computeXychartLayout, paintXychart } from "./diagram-xychart";
import { computeRadarLayout, paintRadar } from "./diagram-radar";
import { computeKpiLayout, paintKpi } from "./diagram-kpi";
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

/** Wrap a "second engine" paint in the region/transform fit + one top-level group
 *  (so it exports as a single PPTX object). Shared by all non-node-edge engines. */
function paintFitted(
  t: DrawTarget,
  options: PaintOptions,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  paint: (dt: DrawTarget) => void,
): void {
  let dt: DrawTarget = t;
  if (options.transform) {
    const { scale, offsetX, offsetY } = options.transform;
    dt = new TransformedTarget(t, scale, offsetX, offsetY);
  } else if (options.region) {
    const { scale, offsetX, offsetY } = fitTransform(bbox, options.region);
    dt = new TransformedTarget(t, scale, offsetX, offsetY);
  }
  dt.beginGroup();
  paint(dt);
  dt.endGroup();
}

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

  // When embedded in a titled slide, the diagram draws no title of its own.
  const title = options.omitTitle ? undefined : spec.title;

  let contentTop = 0.8;
  if (useHeaderBar && title) {
    paintHeaderBar(t, title, theme);
    contentTop = 1.35;
  } else if (title) {
    t.text(
      [{ text: title, fontSize: ds.title_font_size, fontFace: fonts.heading, color: ds.title_font_color, bold: ds.title_font_bold }],
      { x: 0.5, y: 0.15, w: 10, h: 0.45 },
      {},
    );
  }

  // "Second engines": non node-edge layouts (temporal / chart / matrix). Each
  // computes its own layout + bbox, then paints inside a single fitted group.
  if (spec.type === "sequence") {
    const seq = computeSequenceLayout(spec, contentTop);
    paintFitted(t, options, seq.bbox, (dt) => paintSequence(dt, seq, theme));
    return;
  }
  if (spec.type === "timeline") {
    const tl = computeTimelineLayout(spec, contentTop);
    paintFitted(t, options, tl.bbox, (dt) => paintTimeline(dt, tl, theme));
    return;
  }
  if (spec.type === "quadrant") {
    const ql = computeQuadrantLayout(spec, contentTop);
    paintFitted(t, options, ql.bbox, (dt) => paintQuadrant(dt, ql, theme, spec.quadrant));
    return;
  }
  if (spec.type === "pie") {
    const pl = computePieLayout(spec, contentTop);
    paintFitted(t, options, pl.bbox, (dt) => paintPie(dt, pl, theme));
    return;
  }
  if (spec.type === "gantt") {
    const gl = computeGanttLayout(spec, contentTop);
    paintFitted(t, options, gl.bbox, (dt) => paintGantt(dt, gl, theme));
    return;
  }
  if (spec.type === "journey") {
    const jl = computeJourneyLayout(spec, contentTop);
    paintFitted(t, options, jl.bbox, (dt) => paintJourney(dt, jl, theme));
    return;
  }
  if (spec.type === "xychart") {
    const xl = computeXychartLayout(spec, contentTop);
    paintFitted(t, options, xl.bbox, (dt) => paintXychart(dt, xl, theme));
    return;
  }
  if (spec.type === "radar") {
    const rl = computeRadarLayout(spec, contentTop);
    paintFitted(t, options, rl.bbox, (dt) => paintRadar(dt, rl, theme));
    return;
  }
  if (spec.type === "kpi") {
    const kl = computeKpiLayout(spec, contentTop, theme);
    paintFitted(t, options, kl.bbox, (dt) => paintKpi(dt, kl, theme));
    return;
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

  // Confine to a region (diagram-beside-text): scale+translate every draw call.
  // Title/background were already drawn (or omitted) on the untransformed target.
  // An explicit `transform` wins over `region` (fixed transform while dragging).
  let dt: DrawTarget = t;
  if (options.transform) {
    const { scale, offsetX, offsetY } = options.transform;
    dt = new TransformedTarget(t, scale, offsetX, offsetY);
  } else if (options.region && positions.length > 0) {
    const bbox = {
      minX: Math.min(...positions.map((p) => p.x)),
      minY: Math.min(...positions.map((p) => p.y)),
      maxX: Math.max(...positions.map((p) => p.x + p.w)),
      maxY: Math.max(...positions.map((p) => p.y + p.h)),
    };
    const { scale, offsetX, offsetY } = fitTransform(bbox, options.region);
    dt = new TransformedTarget(t, scale, offsetX, offsetY);
  }

  const nodeShapeMap = new Map<string, string>();
  for (const n of spec.nodes) nodeShapeMap.set(n.id, n.shape);

  // Wrap the whole node-edge diagram in ONE top-level group so it exports as a
  // single PowerPoint object; each node/edge/bus below is a grabbable sub-group.
  dt.beginGroup();

  if (laneInfos.length > 0) {
    paintSwimlanes(dt, laneInfos, spec.direction, contentTop, theme);
  }

  let groupBboxes = new Map<string, [number, number, number, number]>();
  if (spec.groups.length > 0) {
    groupBboxes = paintGroupZones(dt, spec, posMap, theme, layoutScale);
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

    // A node = its box + label (+ class compartments) as one sub-group.
    dt.beginGroup();
    paintShape(dt, node, pos, baseStyle, theme, layoutScale);
    dt.endGroup();
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
    dt.beginGroup();
    const h = paintFanOutBus(dt, srcId, edges, posMap, nodeShapeMap, direction, isFlowchart, theme);
    dt.endGroup();
    for (const k of h) busHandled.add(k);
  }

  for (const [tgtId, edges] of faninCandidates) {
    const remaining = edges.filter((e) => !busHandled.has(`${e.from}->${e.to}`));
    if (!isAutoMergeable(remaining)) continue;
    dt.beginGroup();
    const h = paintFanInBus(dt, tgtId, remaining, posMap, nodeShapeMap, direction, isFlowchart, theme);
    dt.endGroup();
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

    const [autoSrc, autoTgt] = portOffsets.get(edgeKey) ?? [0, 0];
    // A manual srcPort/tgtPort overrides the auto port spread (move the start/end).
    const srcPortOff = es.srcPort ?? autoSrc;
    const tgtPortOff = es.tgtPort ?? autoTgt;

    const points = planEdgeRoute(
      fromPos, toPos,
      nodeShapeMap.get(edge.from) ?? "rect",
      nodeShapeMap.get(edge.to) ?? "rect",
      direction, routeType, srcPortOff, tgtPortOff,
    );

    // A UML relation (class diagrams) swaps the plain arrow for a triangle/diamond
    // end-marker; an ER relation (srcCard/tgtCard) draws crow's-foot ends and no
    // arrow; otherwise a normal flowchart arrow.
    const er = edge.srcCard !== undefined || edge.tgtCard !== undefined;
    const uml = edge.relation ? umlEdgeStyle(edge.relation) : null;
    const edgeArrow = er ? false : uml ? uml.endArrow : arrow;
    const edgeDash = (uml?.dash ?? false) || dash;
    // An edge = its line + end markers + label as one sub-group.
    dt.beginGroup();
    paintPath(dt, points, {
      color,
      width,
      arrow: routeType === "back_edge" ? true : edgeArrow,
      dash: routeType === "back_edge" ? true : edgeDash,
    });
    if (er) {
      if (edge.srcCard) paintCrowFoot(dt, points, false, edge.srcCard, color, width);
      if (edge.tgtCard) paintCrowFoot(dt, points, true, edge.tgtCard, color, width);
    } else if (uml?.marker) {
      paintUmlMarker(dt, points, uml.end, uml.marker, uml.filled, color, width);
    }

    if (edge.label) {
      const labelPos = placeEdgeLabel(points, edge.label);
      // ER labels sit BESIDE the relationship line (not on top of it) for clarity.
      if (er && points.length >= 2) {
        const mi = Math.max(1, Math.floor(points.length / 2));
        const seg = { dx: points[mi].x - points[mi - 1].x, dy: points[mi].y - points[mi - 1].y };
        if (Math.abs(seg.dy) >= Math.abs(seg.dx)) labelPos.x += labelPos.w / 2 + 0.14; // vertical line → shift right
        else labelPos.y -= labelPos.h + 0.05; // horizontal line → shift above
      }
      const edgeFs = scaledFontSize(ds.edge_label_font_size, layoutScale);
      dt.text(
        [{ text: edge.label, fontSize: edgeFs, fontFace: fonts.body, color, bold: true }],
        labelPos,
        {},
      );
    }
    dt.endGroup();
  }

  dt.endGroup(); // close the top-level diagram group
}
