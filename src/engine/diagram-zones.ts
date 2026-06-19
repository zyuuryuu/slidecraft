/**
 * diagram-zones.ts — Group zones, swimlanes, and fan-in/out bus drawing.
 *
 * The "container" half of the diagram painter; issues DrawTarget commands.
 * Node/edge/label drawing lives in diagram-draw.ts.
 */

import type { DiagramSpec, GroupStyle, EdgeStyle } from "./schema";
import type { ThemeConfig } from "./theme";
import {
  cpCoords,
  SLIDE_W,
  SLIDE_H,
  type NodePosition,
  type LaneInfo,
} from "./layout-engine";
import { scaledFontSize, type DrawTarget } from "./draw-target";

export function paintGroupZones(
  t: DrawTarget,
  spec: DiagramSpec,
  posMap: Map<string, NodePosition>,
  theme: ThemeConfig,
  layoutScale: number,
): Map<string, [number, number, number, number]> {
  const ds = theme.diagram_style;
  const fonts = theme.fonts;

  const BASE_DEPTH_PAD: Record<number, number> = { 0: 0.25, 1: 0.18, 2: 0.12 };
  const BASE_LABEL_H = 0.25;
  const padScale = Math.max(layoutScale, 0.4);
  const DEPTH_PAD: Record<number, number> = {};
  for (const [k, v] of Object.entries(BASE_DEPTH_PAD)) {
    DEPTH_PAD[Number(k)] = Math.max(0.06, v * padScale);
  }
  const LABEL_HEIGHT = Math.max(0.1, BASE_LABEL_H * padScale);

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

  const sortedGroups = [...spec.groups].sort(
    (a, b) => getGroupDepth(b.id) - getGroupDepth(a.id),
  );

  const groupBboxes = new Map<string, [number, number, number, number]>();

  for (const grp of sortedGroups) {
    const depth = getGroupDepth(grp.id);
    const pad = DEPTH_PAD[depth] ?? 0.1;

    const ptsX: number[] = [];
    const ptsY: number[] = [];
    const ptsXE: number[] = [];
    const ptsYE: number[] = [];

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

    t.shape(
      "rounded_rect",
      { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      {
        fill: gs.fill ?? null,
        line: { color: gs.border, width: ds.group_border_width, dash: gs.border_dash },
        rectRadius: 0.1,
      },
    );

    const labelFs = scaledFontSize(
      Math.max(ds.group_label_font_size - depth, 7),
      layoutScale,
      5.0,
    );
    const labelW = Math.min(maxX - minX - 0.1, 3.0);

    t.text(
      [{ text: grp.label, fontSize: labelFs, fontFace: fonts.body, color: gs.border, bold: true }],
      { x: minX + 0.08, y: minY + 0.04, w: Math.max(labelW, 0.3), h: LABEL_HEIGHT },
      { shrink: true },
    );
  }

  return groupBboxes;
}

export function paintSwimlanes(
  t: DrawTarget,
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
    const bandFill = ls.band_fill ?? bandColors[i % 2];

    if (isHorizontal) {
      t.shape("rect", { x: 0, y: li.crossOrigin, w: SLIDE_W, h: li.crossSize }, { fill: bandFill, line: { width: 0 } });
      t.shape("rect", { x: 0, y: li.crossOrigin, w: laneHeaderSize, h: li.crossSize }, { fill: ls.header_fill, line: { width: 0 } });
      t.text(
        [{ text: li.label, fontSize: 11, fontFace: fonts.heading, color: ls.header_font_color, bold: true }],
        { x: 0.05, y: li.crossOrigin, w: laneHeaderSize - 0.1, h: li.crossSize },
        { align: "center", valign: "middle", wrap: true },
      );
      if (i < laneInfos.length - 1) {
        const sepY = li.crossOrigin + li.crossSize;
        t.line({ x: 0, y: sepY }, { x: SLIDE_W, y: sepY }, { color: ls.border, width: ls.border_width });
      }
    } else {
      const bandTop = contentTop;
      const bandHeight = SLIDE_H - bandTop;
      t.shape("rect", { x: li.crossOrigin, y: bandTop, w: li.crossSize, h: bandHeight }, { fill: bandFill, line: { width: 0 } });
      t.shape("rect", { x: li.crossOrigin, y: contentTop, w: li.crossSize, h: laneHeaderSize }, { fill: ls.header_fill, line: { width: 0 } });
      t.text(
        [{ text: li.label, fontSize: 11, fontFace: fonts.heading, color: ls.header_font_color, bold: true }],
        { x: li.crossOrigin, y: contentTop + 0.1, w: li.crossSize, h: laneHeaderSize - 0.2 },
        { align: "center" },
      );
      if (i < laneInfos.length - 1) {
        const sepX = li.crossOrigin + li.crossSize;
        t.line({ x: sepX, y: bandTop }, { x: sepX, y: SLIDE_H }, { color: ls.border, width: ls.border_width });
      }
    }
  }
}

export function paintFanInBus(
  t: DrawTarget,
  targetId: string,
  sourceEdges: DiagramSpec["edges"],
  posMap: Map<string, NodePosition>,
  nodeShapeMap: Map<string, string>,
  direction: string,
  isFlowchart: boolean,
  theme: ThemeConfig,
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

    const stubXs: number[] = [];
    for (const { edge, pos: fp } of sources) {
      const srcCp = cpCoords(fp, 2, nodeShapeMap.get(edge.from) ?? "rect");
      const es: Partial<EdgeStyle> = edge.style ?? {};
      t.line(srcCp, { x: srcCp.x, y: busY }, {
        color: es.color ?? edgeColor,
        width: es.width ?? edgeWidth,
        dash: es.dash ?? false,
      });
      stubXs.push(srcCp.x);
      handled.add(`${edge.from}->${edge.to}`);
    }

    const allXs = [...stubXs, tgtCp.x];
    t.line({ x: Math.min(...allXs), y: busY }, { x: Math.max(...allXs), y: busY }, { color: edgeColor, width: edgeWidth });
    t.line({ x: tgtCp.x, y: busY }, tgtCp, { color: edgeColor, width: edgeWidth, arrow: isFlowchart });
  }

  return handled;
}

export function paintFanOutBus(
  t: DrawTarget,
  sourceId: string,
  targetEdges: DiagramSpec["edges"],
  posMap: Map<string, NodePosition>,
  nodeShapeMap: Map<string, string>,
  direction: string,
  isFlowchart: boolean,
  theme: ThemeConfig,
): Set<string> {
  const fp = posMap.get(sourceId);
  if (!fp || targetEdges.length < 3) return new Set();

  const handled = new Set<string>();

  if (direction === "TB") {
    const targets = targetEdges
      .map((e) => ({ edge: e, pos: posMap.get(e.to)! }))
      .filter((tg) => tg.pos)
      .sort((a, b) => a.pos.x - b.pos.x);

    const busY = (fp.y + fp.h + Math.min(...targets.map((tg) => tg.pos.y))) / 2;
    const srcCp = cpCoords(fp, 2, nodeShapeMap.get(sourceId) ?? "rect");

    const ds = theme.diagram_style;
    const edgeColor = ds.edge_color;
    const edgeWidth = ds.edge_width;

    const stubXs: number[] = [];
    for (const { edge, pos: tp } of targets) {
      const tgtCp = cpCoords(tp, 0, nodeShapeMap.get(edge.to) ?? "rect");
      const es: Partial<EdgeStyle> = edge.style ?? {};
      t.line({ x: tgtCp.x, y: busY }, tgtCp, {
        color: es.color ?? edgeColor,
        width: es.width ?? edgeWidth,
        arrow: isFlowchart,
        dash: es.dash ?? false,
      });
      stubXs.push(tgtCp.x);
      handled.add(`${edge.from}->${edge.to}`);
    }

    const allXs = [...stubXs, srcCp.x];
    t.line({ x: Math.min(...allXs), y: busY }, { x: Math.max(...allXs), y: busY }, { color: edgeColor, width: edgeWidth });
    t.line(srcCp, { x: srcCp.x, y: busY }, { color: edgeColor, width: edgeWidth });
  }

  return handled;
}
