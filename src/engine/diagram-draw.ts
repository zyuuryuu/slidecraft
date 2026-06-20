/**
 * diagram-draw.ts — Node, edge-path, header and label drawing primitives.
 *
 * Pure helpers shared by the diagram painter; they issue DrawTarget commands
 * (see draw-target.ts). Container/bus drawing lives in diagram-zones.ts.
 */

import type { Node, RelationType } from "./schema";
import type { ThemeConfig } from "./theme";
import { SLIDE_W, type NodePosition, type ConnectionPoint } from "./layout-engine";
import {
  scaledFontSize,
  type DrawTarget,
  type Box,
  type LineSpec,
  type EdgeLineOpts,
  type ResolvedStyle,
} from "./draw-target";

/** A UML class node: a box split into name / attributes / methods compartments. */
function paintClassNode(
  t: DrawTarget,
  node: Node,
  pos: NodePosition,
  style: ResolvedStyle,
  theme: ThemeConfig,
  layoutScale: number,
): void {
  const fill = style.fill ?? theme.palette.navy;
  const lineColor = style.border ?? style.font_color;
  const fonts = theme.fonts;
  const fc = style.font_color;
  const nameFs = scaledFontSize(style.font_size, layoutScale);
  const memFs = scaledFontSize(Math.max(style.font_size - 2, 7), layoutScale);
  const attrs = node.attributes ?? [];
  const methods = node.methods ?? [];
  const total = attrs.length + methods.length;

  t.shape("rect", { x: pos.x, y: pos.y, w: pos.w, h: pos.h }, { fill, line: { color: lineColor, width: style.border_width || 1 } });

  const nameH = total > 0 ? Math.min(0.4, pos.h * 0.4) : pos.h;
  t.text(
    [{ text: node.label, fontSize: nameFs, fontFace: fonts.heading, color: fc, bold: true }],
    { x: pos.x, y: pos.y, w: pos.w, h: nameH },
    { align: "center", valign: "middle", shrink: true },
  );
  if (total === 0) return;

  const rest = pos.h - nameH;
  const attrH = rest * (attrs.length / total);
  const pad = 0.08;
  const div = (y: number) => t.line({ x: pos.x, y }, { x: pos.x + pos.w, y }, { color: lineColor, width: 0.75, arrow: false });
  const members = (items: string[], y: number, h: number) =>
    t.text(
      items.map((s) => ({ text: s, fontSize: memFs, fontFace: fonts.body, color: fc, bold: false })),
      { x: pos.x + pad, y: y + 0.04, w: pos.w - 2 * pad, h: h - 0.08 },
      { align: "left", valign: "top", shrink: true },
    );

  const y1 = pos.y + nameH;
  div(y1);
  if (attrs.length) members(attrs, y1, attrH);
  if (methods.length) {
    const y2 = y1 + (attrs.length ? attrH : 0);
    if (attrs.length) div(y2);
    members(methods, y2, pos.y + pos.h - y2);
  }
}

/** State-diagram pseudo-states: `start` = a solid dot, `end` = a ring with a
 *  filled centre. Centred in the (small) node box from the layout. */
function paintStateMarker(t: DrawTarget, node: Node, pos: NodePosition, theme: ThemeConfig): void {
  const dot = theme.palette.accent;
  const d = Math.min(pos.w, pos.h);
  const cx = pos.x + pos.w / 2;
  const cy = pos.y + pos.h / 2;
  const box = (dd: number) => ({ x: cx - dd / 2, y: cy - dd / 2, w: dd, h: dd });
  if (node.shape === "end") {
    t.shape("circle", box(d), { fill: null, line: { color: dot, width: 1.5 } });
    t.shape("circle", box(d * 0.5), { fill: dot, line: { color: dot, width: 0 } });
  } else {
    t.shape("circle", box(d), { fill: dot, line: { color: dot, width: 0 } });
  }
}

export function paintShape(
  t: DrawTarget,
  node: Node,
  pos: NodePosition,
  style: ResolvedStyle,
  theme: ThemeConfig,
  layoutScale: number,
): void {
  if (node.shape === "class" || node.shape === "entity") {
    paintClassNode(t, node, pos, style, theme, layoutScale);
    return;
  }
  if (node.shape === "start" || node.shape === "end") {
    paintStateMarker(t, node, pos, theme);
    return;
  }
  const fillColor = style.fill ?? theme.palette.navy;
  const fonts = theme.fonts;
  const fontSize = scaledFontSize(style.font_size, layoutScale);
  const fontColor = style.font_color;

  const line: LineSpec = style.border
    ? { color: style.border, width: style.border_width, dash: style.border_dash }
    : { color: fillColor, width: 0 };

  t.shape(node.shape, { x: pos.x, y: pos.y, w: pos.w, h: pos.h }, { fill: fillColor, line });

  if (node.sublabel) {
    const subFs = scaledFontSize(Math.max(style.font_size - 3, 7), layoutScale);
    t.text(
      [
        { text: node.sublabel, fontSize: subFs, fontFace: fonts.body, color: fontColor, bold: false },
        { text: node.label, fontSize, fontFace: fonts.heading, color: fontColor, bold: style.font_bold },
      ],
      { x: pos.x, y: pos.y, w: pos.w, h: pos.h },
      { align: "center", valign: "middle", shrink: true },
    );
  } else {
    const fontName =
      node.shape === "rounded_rect" || node.shape === "circle" || node.shape === "oval"
        ? style.font_bold
          ? fonts.heading
          : fonts.body
        : fonts.body;
    t.text(
      [{ text: node.label, fontSize, fontFace: fontName, color: fontColor, bold: style.font_bold }],
      { x: pos.x, y: pos.y, w: pos.w, h: pos.h },
      { align: "center", valign: "middle", shrink: true },
    );
  }
}

export function paintPath(
  t: DrawTarget,
  points: ConnectionPoint[],
  opts: EdgeLineOpts,
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length - 2; i++) {
    t.line(points[i], points[i + 1], { ...opts, arrow: false });
  }
  t.line(points[points.length - 2], points[points.length - 1], opts);
}

// ── UML class-diagram relationship rendering ──

export interface UmlEdgeStyle {
  marker: "triangle" | "diamond" | null; // end decoration (else a plain arrow)
  end: "from" | "to"; // which end the marker / arrow sits on
  filled: boolean; // filled (composition) vs hollow
  dash: boolean; // realization / dependency are dashed
  endArrow: boolean; // association / dependency keep an open arrow at `to`
}

/** How a UML relation draws: hollow triangle = inheritance/realization (dashed),
 *  filled/hollow diamond = composition/aggregation, open arrow = dependency/association. */
export function umlEdgeStyle(relation: RelationType): UmlEdgeStyle {
  switch (relation) {
    case "inheritance": return { marker: "triangle", end: "from", filled: false, dash: false, endArrow: false };
    case "realization": return { marker: "triangle", end: "from", filled: false, dash: true, endArrow: false };
    case "composition": return { marker: "diamond", end: "from", filled: true, dash: false, endArrow: false };
    case "aggregation": return { marker: "diamond", end: "from", filled: false, dash: false, endArrow: false };
    case "dependency": return { marker: null, end: "to", filled: false, dash: true, endArrow: true };
    default: return { marker: null, end: "to", filled: false, dash: false, endArrow: true }; // association
  }
}

/** Draw the UML end-marker (triangle/diamond) at the chosen end of the routed path. */
export function paintUmlMarker(
  t: DrawTarget,
  points: ConnectionPoint[],
  end: "from" | "to",
  kind: "triangle" | "diamond",
  filled: boolean,
  color: string,
  width: number,
): void {
  if (points.length < 2) return;
  const P = end === "to" ? points[points.length - 1] : points[0];
  const prev = end === "to" ? points[points.length - 2] : points[1];
  const len = Math.hypot(P.x - prev.x, P.y - prev.y) || 1;
  const ux = (P.x - prev.x) / len; // unit vector pointing INTO the node at P
  const uy = (P.y - prev.y) / len;
  const size = 0.16;
  const half = 0.1;
  const px = -uy; // perpendicular
  const py = ux;
  const bx = P.x - ux * size; // base centre (one marker back from P)
  const by = P.y - uy * size;
  const a = { x: bx + px * half, y: by + py * half };
  const b = { x: bx - px * half, y: by - py * half };
  const ln = (p1: ConnectionPoint, p2: ConnectionPoint) => t.line(p1, p2, { color, width, arrow: false });

  if (kind === "triangle") {
    ln(P, a); ln(a, b); ln(b, P); // hollow triangle, apex at the node
  } else if (filled) {
    // a small filled diamond (composition) centred just outside the node edge
    t.shape("diamond", { x: bx - half, y: by - half, w: half * 2, h: half * 2 }, { fill: color, line: { color, width } });
  } else {
    const back = { x: P.x - ux * size * 2, y: P.y - uy * size * 2 };
    ln(P, a); ln(a, back); ln(back, b); ln(b, P); // hollow diamond (aggregation)
  }
}

export function paintHeaderBar(t: DrawTarget, title: string, theme: ThemeConfig): void {
  const ds = theme.diagram_style;
  const fonts = theme.fonts;

  t.shape("rect", { x: 0, y: 0, w: SLIDE_W, h: 1.15 }, { fill: ds.header_bar_color, line: { width: 0 } });
  t.shape("rect", { x: 0, y: 0, w: 0.08, h: 1.15 }, { fill: theme.palette.accent, line: { width: 0 } });
  t.text(
    [{ text: title, fontSize: 28, fontFace: fonts.heading, color: ds.header_font_color, bold: true }],
    { x: 0.5, y: 0.18, w: 10, h: 0.55 },
    {},
  );
}

export function placeEdgeLabel(points: ConnectionPoint[], labelText: string): Box {
  const charCount = labelText.length;
  const lblW = Math.max(0.4, Math.min(charCount * 0.08, 1.4));
  const lblH = 0.22;

  if (points.length < 2) {
    return { x: 0.1, y: 0.1, w: lblW, h: lblH };
  }

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

  return {
    x: bestMidX - lblW / 2 + 0.08,
    y: bestMidY - lblH / 2 - 0.15,
    w: lblW,
    h: lblH,
  };
}
