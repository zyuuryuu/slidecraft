/**
 * PPTX Writer — Generates PowerPoint slides from DiagramSpec + layout positions.
 *
 * Uses PptxGenJS to create editable PPTX files.
 * Consumes positions computed by layout-engine.ts.
 *
 * Ported from Python diagram_renderer.py drawing logic.
 */

import PptxGenJS from "pptxgenjs";
import type { DiagramSpec, Node, EdgeStyle, GroupStyle } from "./schema";
import type { ThemeConfig, DiagramStyle, FontConfig, Palette } from "./theme";
import { DEFAULT_THEME } from "./theme";
import {
  computeLayout,
  computeLayoutWithLanes,
  assignLayers,
  buildAdjacency,
  findBackEdges,
  isBackEdge,
  cpCoords,
  detectCp,
  classifyEdgeRoute,
  computePortOffsets,
  computeGroupBboxes,
  planEdgeRoute,
  SLIDE_W,
  SLIDE_H,
  type NodePosition,
  type LaneInfo,
  type ConnectionPoint,
  type CpIndex,
} from "./layout-engine";

// ── Constants ──

const PPTX_SHAPE_MAP: Record<string, string> = {
  rect: "rect",
  rounded_rect: "roundRect",
  diamond: "diamond",
  circle: "ellipse",
  oval: "ellipse",
  hexagon: "hexagon",
};

// ── Utility Functions ──

function hexToRgb(hex: string): string {
  // Return 6-char hex without #
  return hex.replace(/^#/, "");
}

function scaledFontSize(
  baseSize: number,
  scale: number,
  minSize: number = 5,
): number {
  if (scale >= 1.0) return baseSize;
  return Math.max(baseSize * scale, minSize);
}

function inchesToPoints(inches: number): number {
  return inches * 72;
}

// ── Shape Drawing ──

function drawShape(
  slide: PptxGenJS.Slide,
  node: Node,
  pos: NodePosition,
  style: {
    fill?: string;
    border?: string;
    border_width: number;
    border_dash: boolean;
    font_color: string;
    font_size: number;
    font_bold: boolean;
  },
  theme: ThemeConfig,
  layoutScale: number,
): void {
  const pptxShape = PPTX_SHAPE_MAP[node.shape] ?? "rect";
  const fillColor = style.fill
    ? hexToRgb(style.fill)
    : theme.palette.navy;
  const fonts = theme.fonts;

  const fontSize = scaledFontSize(style.font_size, layoutScale);
  const fontColor = hexToRgb(style.font_color);

  const shapeOpts: PptxGenJS.ShapeProps = {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    fill: { color: fillColor },
    line: style.border
      ? {
          color: hexToRgb(style.border),
          width: style.border_width,
          dashType: style.border_dash ? "dash" : "solid",
        }
      : { color: fillColor, width: 0 },
  };

  if (node.sublabel) {
    // Two-line text: sublabel (small) + label (main)
    const subFs = scaledFontSize(Math.max(style.font_size - 3, 7), layoutScale);
    slide.addShape(pptxShape as keyof typeof PptxGenJS.ShapeType, {
      ...shapeOpts,
      // @ts-expect-error PptxGenJS shape type
      shape: pptxShape,
    });
    slide.addText(
      [
        {
          text: node.sublabel,
          options: {
            fontSize: subFs,
            fontFace: fonts.body,
            color: fontColor,
            bold: false,
            align: "center",
            breakType: "break",
          },
        },
        {
          text: node.label,
          options: {
            fontSize,
            fontFace: fonts.heading,
            color: fontColor,
            bold: style.font_bold,
            align: "center",
          },
        },
      ],
      {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        valign: "middle",
        align: "center",
        fit: "shrink",
      },
    );
  } else {
    // Single line text
    const fontName =
      node.shape === "rounded_rect" || node.shape === "circle" || node.shape === "oval"
        ? style.font_bold
          ? fonts.heading
          : fonts.body
        : fonts.body;

    slide.addShape(pptxShape as keyof typeof PptxGenJS.ShapeType, {
      ...shapeOpts,
      // @ts-expect-error PptxGenJS shape type
      shape: pptxShape,
    });
    slide.addText(node.label, {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      fontSize,
      fontFace: fontName,
      color: fontColor,
      bold: style.font_bold,
      align: "center",
      valign: "middle",
      fit: "shrink",
    });
  }
}

// ── Line Drawing ──

function drawLine(
  slide: PptxGenJS.Slide,
  from: ConnectionPoint,
  to: ConnectionPoint,
  opts: {
    color: string;
    width: number;
    arrow?: boolean;
    dash?: boolean;
  },
): void {
  // PptxGenJS uses inches for shape positioning
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x) || 0.001; // avoid zero width
  const h = Math.abs(to.y - from.y) || 0.001;

  const lineOpts: PptxGenJS.ShapeProps = {
    x,
    y,
    w,
    h,
    line: {
      color: hexToRgb(opts.color),
      width: opts.width,
      dashType: opts.dash ? "dash" : "solid",
      endArrowType: opts.arrow ? "triangle" : "none",
    },
    // Flip if needed to get correct direction
    flipH: to.x < from.x,
    flipV: to.y < from.y,
  };

  slide.addShape("line", lineOpts);
}

function drawPath(
  slide: PptxGenJS.Slide,
  points: ConnectionPoint[],
  opts: {
    color: string;
    width: number;
    arrow?: boolean;
    dash?: boolean;
  },
): void {
  if (points.length < 2) return;

  // Draw all segments except the last without arrows
  for (let i = 0; i < points.length - 2; i++) {
    drawLine(slide, points[i], points[i + 1], {
      ...opts,
      arrow: false,
    });
  }

  // Last segment gets the arrow
  drawLine(slide, points[points.length - 2], points[points.length - 1], opts);
}

// ── Header Bar ──

function drawHeaderBar(
  slide: PptxGenJS.Slide,
  title: string,
  theme: ThemeConfig,
): void {
  const ds = theme.diagram_style;
  const fonts = theme.fonts;

  // Navy background bar
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 1.15,
    fill: { color: hexToRgb(ds.header_bar_color) },
    line: { width: 0 },
  });

  // Left accent bar
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.08,
    h: 1.15,
    fill: { color: theme.palette.accent },
    line: { width: 0 },
  });

  // Title text
  slide.addText(title, {
    x: 0.5,
    y: 0.18,
    w: 10,
    h: 0.55,
    fontSize: 28,
    fontFace: fonts.heading,
    color: hexToRgb(ds.header_font_color),
    bold: true,
  });
}

// ── Group Zone Drawing ──

function drawGroupZones(
  slide: PptxGenJS.Slide,
  spec: DiagramSpec,
  posMap: Map<string, NodePosition>,
  theme: ThemeConfig,
  layoutScale: number,
): Map<string, [number, number, number, number]> {
  const ds = theme.diagram_style;
  const fonts = theme.fonts;

  // Padding per depth — scales with layout
  const BASE_DEPTH_PAD: Record<number, number> = { 0: 0.25, 1: 0.18, 2: 0.12 };
  const BASE_LABEL_H = 0.25;
  const padScale = Math.max(layoutScale, 0.4);
  const DEPTH_PAD: Record<number, number> = {};
  for (const [k, v] of Object.entries(BASE_DEPTH_PAD)) {
    DEPTH_PAD[Number(k)] = Math.max(0.06, v * padScale);
  }
  const LABEL_HEIGHT = Math.max(0.10, BASE_LABEL_H * padScale);

  // Build group depth map
  const groupMap = new Map(spec.groups.map((g) => [g.id, g]));

  function getGroupDepth(gid: string): number {
    let depth = 0;
    let cur = groupMap.get(gid);
    while (cur?.parent) {
      depth++;
      cur = groupMap.get(cur.parent);
    }
    return depth;
  }

  function getGroupChildren(gid: string): string[] {
    return spec.groups.filter((g) => g.parent === gid).map((g) => g.id);
  }

  // Sort groups deepest-first for bottom-up bbox calculation
  const sortedGroups = [...spec.groups].sort(
    (a, b) => getGroupDepth(b.id) - getGroupDepth(a.id),
  );

  const groupBboxes = new Map<string, [number, number, number, number]>();

  for (const grp of sortedGroups) {
    const depth = getGroupDepth(grp.id);
    const pad = DEPTH_PAD[depth] ?? 0.10;

    const ptsX: number[] = [];
    const ptsY: number[] = [];
    const ptsXE: number[] = [];
    const ptsYE: number[] = [];

    // Direct member nodes
    for (const n of spec.nodes) {
      if (n.group === grp.id) {
        const p = posMap.get(n.id);
        if (p) {
          ptsX.push(p.x);
          ptsY.push(p.y);
          ptsXE.push(p.x + p.w);
          ptsYE.push(p.y + p.h);
        }
      }
    }

    // Child group bboxes
    for (const childId of getGroupChildren(grp.id)) {
      const cb = groupBboxes.get(childId);
      if (cb) {
        ptsX.push(cb[0]);
        ptsY.push(cb[1]);
        ptsXE.push(cb[2]);
        ptsYE.push(cb[3]);
      }
    }

    if (ptsX.length === 0) continue;

    const minX = Math.min(...ptsX) - pad;
    const minY = Math.min(...ptsY) - pad - LABEL_HEIGHT;
    const maxX = Math.max(...ptsXE) + pad;
    const maxY = Math.max(...ptsYE) + pad;

    groupBboxes.set(grp.id, [minX, minY, maxX, maxY]);
  }

  // Draw groups from outermost to innermost
  const drawOrder = [...spec.groups].sort(
    (a, b) => getGroupDepth(a.id) - getGroupDepth(b.id),
  );

  for (const grp of drawOrder) {
    const bbox = groupBboxes.get(grp.id);
    if (!bbox) continue;

    const [minX, minY, maxX, maxY] = bbox;
    const depth = getGroupDepth(grp.id);
    const gs: GroupStyle = grp.style ?? {
      border: "#94A3B8",
      border_dash: true,
    };

    // Zone rectangle
    slide.addShape("roundRect", {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      fill: gs.fill ? { color: hexToRgb(gs.fill) } : { type: "none" },
      line: {
        color: hexToRgb(gs.border),
        width: ds.group_border_width,
        dashType: gs.border_dash ? "dash" : "solid",
      },
      rectRadius: 0.1,
    });

    // Group label
    const labelFs = scaledFontSize(
      Math.max(ds.group_label_font_size - depth, 7),
      layoutScale,
      5.0,
    );
    const labelW = Math.min(maxX - minX - 0.1, 3.0);

    slide.addText(grp.label, {
      x: minX + 0.08,
      y: minY + 0.04,
      w: Math.max(labelW, 0.3),
      h: LABEL_HEIGHT,
      fontSize: labelFs,
      fontFace: fonts.body,
      color: hexToRgb(gs.border),
      bold: true,
      fit: "shrink",
    });
  }

  return groupBboxes;
}

// ── Swimlane Drawing ──

function drawSwimlanes(
  slide: PptxGenJS.Slide,
  laneInfos: LaneInfo[],
  direction: string,
  contentTop: number,
  theme: ThemeConfig,
): void {
  const isHorizontal = direction === "LR" || direction === "RL";
  const fonts = theme.fonts;
  const laneHeaderSize = 0.6;

  const bandColors = ["F8FAFC", "EFF3F8"];

  for (let i = 0; i < laneInfos.length; i++) {
    const li = laneInfos[i];
    if (li.laneId === "__default__") continue;

    const ls = li.style;
    const bandFill = ls.band_fill
      ? hexToRgb(ls.band_fill)
      : bandColors[i % 2];

    if (isHorizontal) {
      // Horizontal lane: full width row
      slide.addShape("rect", {
        x: 0,
        y: li.crossOrigin,
        w: SLIDE_W,
        h: li.crossSize,
        fill: { color: bandFill },
        line: { width: 0 },
      });

      // Header strip at left
      slide.addShape("rect", {
        x: 0,
        y: li.crossOrigin,
        w: laneHeaderSize,
        h: li.crossSize,
        fill: { color: hexToRgb(ls.header_fill) },
        line: { width: 0 },
      });

      // Header label
      slide.addText(li.label, {
        x: 0.05,
        y: li.crossOrigin,
        w: laneHeaderSize - 0.1,
        h: li.crossSize,
        fontSize: 11,
        fontFace: fonts.heading,
        color: hexToRgb(ls.header_font_color),
        bold: true,
        align: "center",
        valign: "middle",
        wrap: true,
      });

      // Separator line
      if (i < laneInfos.length - 1) {
        const sepY = li.crossOrigin + li.crossSize;
        drawLine(
          slide,
          { x: 0, y: sepY },
          { x: SLIDE_W, y: sepY },
          {
            color: ls.border,
            width: ls.border_width,
          },
        );
      }
    } else {
      // Vertical lane: column
      const bandTop = contentTop;
      const bandHeight = SLIDE_H - bandTop;

      slide.addShape("rect", {
        x: li.crossOrigin,
        y: bandTop,
        w: li.crossSize,
        h: bandHeight,
        fill: { color: bandFill },
        line: { width: 0 },
      });

      // Header at top
      slide.addShape("rect", {
        x: li.crossOrigin,
        y: contentTop,
        w: li.crossSize,
        h: laneHeaderSize,
        fill: { color: hexToRgb(ls.header_fill) },
        line: { width: 0 },
      });

      slide.addText(li.label, {
        x: li.crossOrigin,
        y: contentTop + 0.1,
        w: li.crossSize,
        h: laneHeaderSize - 0.2,
        fontSize: 11,
        fontFace: fonts.heading,
        color: hexToRgb(ls.header_font_color),
        bold: true,
        align: "center",
      });

      // Separator line
      if (i < laneInfos.length - 1) {
        const sepX = li.crossOrigin + li.crossSize;
        drawLine(
          slide,
          { x: sepX, y: bandTop },
          { x: sepX, y: SLIDE_H },
          {
            color: ls.border,
            width: ls.border_width,
          },
        );
      }
    }
  }
}

// ── Bus Line Drawing ──

function drawFanInBus(
  slide: PptxGenJS.Slide,
  targetId: string,
  sourceEdges: DiagramSpec["edges"],
  posMap: Map<string, NodePosition>,
  nodeShapeMap: Map<string, string>,
  direction: string,
  isFlowchart: boolean,
  theme: ThemeConfig,
  layoutScale: number,
): Set<string> {
  const tp = posMap.get(targetId);
  if (!tp || sourceEdges.length < 3) return new Set();

  const handled = new Set<string>();

  if (direction === "TB") {
    const sources = sourceEdges
      .map((e) => ({ edge: e, pos: posMap.get(e.from)! }))
      .filter((s) => s.pos)
      .sort((a, b) => a.pos.x - b.pos.x);

    const busY = (Math.max(...sources.map((s) => s.pos.y + s.pos.h)) + tp.y) / 2;
    const tgtCp = cpCoords(tp, 0, nodeShapeMap.get(targetId) ?? "rect");

    const ds = theme.diagram_style;
    const edgeColor = ds.edge_color;
    const edgeWidth = ds.edge_width;

    // Individual stubs from each source to bus
    const stubXs: number[] = [];
    for (const { edge, pos: fp } of sources) {
      const srcCp = cpCoords(fp, 2, nodeShapeMap.get(edge.from) ?? "rect");
      const es = edge.style ?? {};
      drawLine(slide, srcCp, { x: srcCp.x, y: busY }, {
        color: (es as any).color ?? edgeColor,
        width: (es as any).width ?? edgeWidth,
        dash: (es as any).dash ?? false,
      });
      stubXs.push(srcCp.x);
      handled.add(`${edge.from}->${edge.to}`);
    }

    // Horizontal bus
    const allXs = [...stubXs, tgtCp.x];
    drawLine(
      slide,
      { x: Math.min(...allXs), y: busY },
      { x: Math.max(...allXs), y: busY },
      { color: edgeColor, width: edgeWidth },
    );

    // Vertical drop to target
    drawLine(slide, { x: tgtCp.x, y: busY }, tgtCp, {
      color: edgeColor,
      width: edgeWidth,
      arrow: isFlowchart,
    });
  }

  return handled;
}

function drawFanOutBus(
  slide: PptxGenJS.Slide,
  sourceId: string,
  targetEdges: DiagramSpec["edges"],
  posMap: Map<string, NodePosition>,
  nodeShapeMap: Map<string, string>,
  direction: string,
  isFlowchart: boolean,
  theme: ThemeConfig,
  layoutScale: number,
): Set<string> {
  const fp = posMap.get(sourceId);
  if (!fp || targetEdges.length < 3) return new Set();

  const handled = new Set<string>();

  if (direction === "TB") {
    const targets = targetEdges
      .map((e) => ({ edge: e, pos: posMap.get(e.to)! }))
      .filter((t) => t.pos)
      .sort((a, b) => a.pos.x - b.pos.x);

    const busY = (fp.y + fp.h + Math.min(...targets.map((t) => t.pos.y))) / 2;
    const srcCp = cpCoords(fp, 2, nodeShapeMap.get(sourceId) ?? "rect");

    const ds = theme.diagram_style;
    const edgeColor = ds.edge_color;
    const edgeWidth = ds.edge_width;

    // Stubs from bus to each target
    const stubXs: number[] = [];
    for (const { edge, pos: tp } of targets) {
      const tgtCp = cpCoords(tp, 0, nodeShapeMap.get(edge.to) ?? "rect");
      const es = edge.style ?? {};
      drawLine(slide, { x: tgtCp.x, y: busY }, tgtCp, {
        color: (es as any).color ?? edgeColor,
        width: (es as any).width ?? edgeWidth,
        arrow: isFlowchart,
        dash: (es as any).dash ?? false,
      });
      stubXs.push(tgtCp.x);
      handled.add(`${edge.from}->${edge.to}`);
    }

    // Horizontal bus
    const allXs = [...stubXs, srcCp.x];
    drawLine(
      slide,
      { x: Math.min(...allXs), y: busY },
      { x: Math.max(...allXs), y: busY },
      { color: edgeColor, width: edgeWidth },
    );

    // Source to bus
    drawLine(slide, srcCp, { x: srcCp.x, y: busY }, {
      color: edgeColor,
      width: edgeWidth,
    });
  }

  return handled;
}

// ── Edge Label Placement ──

function placeEdgeLabel(
  points: ConnectionPoint[],
  labelText: string,
): { x: number; y: number; w: number; h: number } {
  const charCount = labelText.length;
  const lblW = Math.max(0.4, Math.min(charCount * 0.08, 1.4));
  const lblH = 0.22;

  if (points.length < 2) {
    return { x: 0.1, y: 0.1, w: lblW, h: lblH };
  }

  // Find the longest segment midpoint
  let bestMidX = 0;
  let bestMidY = 0;
  let bestLen = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > bestLen) {
      bestLen = len;
      bestMidX = (points[i].x + points[i + 1].x) / 2;
      bestMidY = (points[i].y + points[i + 1].y) / 2;
    }
  }

  // Offset perpendicular to the segment
  return {
    x: bestMidX - lblW / 2 + 0.08,
    y: bestMidY - lblH / 2 - 0.15,
    w: lblW,
    h: lblH,
  };
}

// ── Main Render Function ──

export interface RenderOptions {
  theme?: ThemeConfig;
  useHeaderBar?: boolean;
  templatePath?: string;
}

export function renderDiagram(
  spec: DiagramSpec,
  options: RenderOptions = {},
): PptxGenJS {
  const theme = options.theme ?? DEFAULT_THEME;
  const useHeaderBar = options.useHeaderBar ?? true;
  const ds = theme.diagram_style;
  const fonts = theme.fonts;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";

  const slide = pptx.addSlide();

  // Background
  if (ds.slide_bg) {
    slide.background = { color: hexToRgb(ds.slide_bg) };
  }

  // Header bar
  let contentTop = 0.8;
  if (useHeaderBar && spec.title) {
    drawHeaderBar(slide, spec.title, theme);
    contentTop = 1.35;
  } else if (spec.title) {
    slide.addText(spec.title, {
      x: 0.5,
      y: 0.15,
      w: 10,
      h: 0.45,
      fontSize: ds.title_font_size,
      fontFace: fonts.heading,
      color: hexToRgb(ds.title_font_color),
      bold: ds.title_font_bold,
    });
  }

  // Compute layout
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

  // Build node shape map for connection point calculation
  const nodeShapeMap = new Map<string, string>();
  for (const n of spec.nodes) nodeShapeMap.set(n.id, n.shape);

  // Draw swimlane bands (behind shapes)
  if (laneInfos.length > 0) {
    drawSwimlanes(slide, laneInfos, spec.direction, contentTop, theme);
  }

  // Draw group zones (behind shapes)
  let groupBboxes = new Map<string, [number, number, number, number]>();
  if (spec.groups.length > 0) {
    groupBboxes = drawGroupZones(slide, spec, posMap, theme, layoutScale);
  }

  // Draw shapes
  const nodeMap = new Map(spec.nodes.map((n) => [n.id, n]));

  for (const pos of positions) {
    const node = nodeMap.get(pos.nodeId);
    if (!node) continue;

    // Resolve style
    const baseStyle = {
      fill: undefined as string | undefined,
      border: undefined as string | undefined,
      border_width: 1.5,
      border_dash: false,
      font_color: "#FFFFFF",
      font_size: 11,
      font_bold: true,
    };

    if (node.class && spec.classDefs[node.class]) {
      const cd = spec.classDefs[node.class];
      Object.assign(baseStyle, cd);
    }
    if (node.style) {
      Object.assign(baseStyle, node.style);
    }

    drawShape(slide, node, pos, baseStyle, theme, layoutScale);
  }

  // Draw connectors
  const isFlowchart = spec.type === "flowchart";
  const direction = spec.direction;
  const layers = assignLayers(spec);
  const { fwd } = buildAdjacency(spec);
  const backEdges = findBackEdges(fwd, spec.nodes.map((n) => n.id));

  const nodeToGroup = new Map<string, string | undefined>();
  for (const n of spec.nodes) nodeToGroup.set(n.id, n.group);

  // Bus line handling
  const busHandled = new Set<string>();

  // Auto-detect fan-in/fan-out bus patterns
  const fanoutCandidates = new Map<string, typeof spec.edges>();
  const faninCandidates = new Map<string, typeof spec.edges>();

  for (const edge of spec.edges) {
    const key = `${edge.from}->${edge.to}`;
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

  // Fan-out buses
  for (const [srcId, edges] of fanoutCandidates) {
    if (!isAutoMergeable(edges)) continue;
    if (edges.some((e) => busHandled.has(`${e.from}->${e.to}`))) continue;
    const h = drawFanOutBus(
      slide, srcId, edges, posMap, nodeShapeMap,
      direction, isFlowchart, theme, layoutScale,
    );
    for (const k of h) busHandled.add(k);
  }

  // Fan-in buses
  for (const [tgtId, edges] of faninCandidates) {
    const remaining = edges.filter(
      (e) => !busHandled.has(`${e.from}->${e.to}`),
    );
    if (!isAutoMergeable(remaining)) continue;
    const h = drawFanInBus(
      slide, tgtId, remaining, posMap, nodeShapeMap,
      direction, isFlowchart, theme, layoutScale,
    );
    for (const k of h) busHandled.add(k);
  }

  // Compute port offsets
  const portOffsets = computePortOffsets(spec, posMap, layers, backEdges);

  // Draw individual edges
  for (const edge of spec.edges) {
    const edgeKey = `${edge.from}->${edge.to}`;
    if (busHandled.has(edgeKey)) continue;

    const fromPos = posMap.get(edge.from);
    const toPos = posMap.get(edge.to);
    if (!fromPos || !toPos) continue;

    const es = edge.style ?? {};
    const color = (es as any).color ?? ds.edge_color;
    const width = (es as any).width ?? ds.edge_width;
    const arrow = isFlowchart ? ((es as any).arrow ?? true) : false;
    const dash = (es as any).dash ?? false;

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

    drawPath(slide, points, {
      color,
      width,
      arrow,
      dash: routeType === "back_edge" ? true : dash,
    });

    // Edge label
    if (edge.label) {
      const labelPos = placeEdgeLabel(points, edge.label);
      const edgeFs = scaledFontSize(ds.edge_label_font_size, layoutScale);
      slide.addText(edge.label, {
        x: labelPos.x,
        y: labelPos.y,
        w: labelPos.w,
        h: labelPos.h,
        fontSize: edgeFs,
        fontFace: fonts.body,
        color: hexToRgb(color),
        bold: true,
      });
    }
  }

  return pptx;
}

// ── Convenience Functions ──

export async function renderToBuffer(
  spec: DiagramSpec,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const pptx = renderDiagram(spec, options);
  const data = await pptx.write({ outputType: "uint8array" });
  return data as Uint8Array;
}

export async function renderToBase64(
  spec: DiagramSpec,
  options: RenderOptions = {},
): Promise<string> {
  const pptx = renderDiagram(spec, options);
  const data = await pptx.write({ outputType: "base64" });
  return data as string;
}
