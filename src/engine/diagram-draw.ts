/**
 * diagram-draw.ts — Node, edge-path, header and label drawing primitives.
 *
 * Pure helpers shared by the diagram painter; they issue DrawTarget commands
 * (see draw-target.ts). Container/bus drawing lives in diagram-zones.ts.
 */

import type { Node } from "./schema";
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

export function paintShape(
  t: DrawTarget,
  node: Node,
  pos: NodePosition,
  style: ResolvedStyle,
  theme: ThemeConfig,
  layoutScale: number,
): void {
  if (node.shape === "class") {
    paintClassNode(t, node, pos, style, theme, layoutScale);
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
