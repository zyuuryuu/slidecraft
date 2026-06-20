/**
 * diagram-sequence.ts — Sequence-diagram layout + painter (a SECOND diagram engine).
 *
 * Unlike the node-edge/layered engine, a sequence diagram is temporal: participants
 * are vertical lifelines across the top, and messages are horizontal arrows ordered
 * top→bottom (by edge order). Rendered via the shared DrawTarget → native PPTX shapes
 * + preview SVG (WYSIWYG), NOT a Mermaid image. Milestone 1: participants, lifelines,
 * sync/return messages (+ self-message loop). Activations/fragments come later.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DiagramSpec } from "./schema";
import type { ThemeConfig } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

export interface SeqLayout {
  parts: { id: string; label: string; cx: number; boxX: number; boxW: number }[];
  boxY: number;
  boxH: number;
  lifelineBottom: number;
  msgs: { fromX: number; toX: number; y: number; label?: string; dash: boolean; self: boolean }[];
  frags: { x: number; y: number; w: number; h: number; kind: string; label: string }[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computeSequenceLayout(spec: DiagramSpec, contentTop: number): SeqLayout {
  const parts = spec.nodes;
  const n = Math.max(parts.length, 1);
  const margin = 0.6;
  const colW = (SLIDE_W - 2 * margin) / n;
  const boxW = Math.min(colW * 0.78, 2.2);
  const boxH = 0.5;
  const gap = 0.5;
  // Centre the block vertically in the available space so it clears the slide's
  // title/subtitle (top-aligning at contentTop overlapped them).
  const naturalH = boxH + 0.45 + spec.edges.length * gap + 0.3;
  const avail = SLIDE_H - contentTop - 0.4;
  const boxY = naturalH < avail ? contentTop + (avail - naturalH) / 2 : contentTop;
  const cx = (i: number) => margin + colW * i + colW / 2;

  const partLayout = parts.map((p, i) => ({ id: p.id, label: p.label, cx: cx(i), boxX: cx(i) - boxW / 2, boxW }));
  const idx = new Map(parts.map((p, i) => [p.id, i]));

  const firstMsgY = boxY + boxH + 0.45;
  const msgs = spec.edges.map((e, k) => {
    const fi = idx.get(e.from) ?? 0;
    const ti = idx.get(e.to) ?? 0;
    return {
      fromX: cx(fi),
      toX: cx(ti),
      y: firstMsgY + k * gap,
      label: e.label,
      dash: e.style?.dash ?? false,
      self: e.from === e.to,
    };
  });
  const lifelineBottom = firstMsgY + spec.edges.length * gap + 0.3;

  // combined-fragment boxes (alt/loop/opt/par) over their message range
  const leftX = partLayout.length ? partLayout[0].cx : margin;
  const rightX = partLayout.length ? partLayout[partLayout.length - 1].cx : SLIDE_W - margin;
  const padX = 0.35;
  const frags = spec.fragments.map((f) => {
    const top = (msgs[f.from]?.y ?? firstMsgY) - 0.3;
    const bot = (msgs[f.to]?.y ?? firstMsgY) + 0.22;
    return { x: leftX - padX, y: top, w: rightX - leftX + 2 * padX, h: bot - top, kind: f.kind, label: f.label };
  });

  let minX = margin - 0.1;
  let maxX = SLIDE_W - margin + 0.1;
  for (const f of frags) { minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x + f.w); }
  return {
    parts: partLayout,
    boxY,
    boxH,
    lifelineBottom,
    msgs,
    frags,
    bbox: { minX, minY: boxY - 0.1, maxX, maxY: lifelineBottom + 0.1 },
  };
}

export function paintSequence(dt: DrawTarget, lay: SeqLayout, theme: ThemeConfig): void {
  const ds = theme.diagram_style;
  const fonts = theme.fonts;
  const lineColor = ds.edge_color;
  const fill = theme.palette.navy;
  const border = theme.palette.accent;
  const textColor = "#FFFFFF";
  const w = ds.edge_width;

  // dashed lifelines under each participant
  for (const p of lay.parts) {
    dt.line({ x: p.cx, y: lay.boxY + lay.boxH }, { x: p.cx, y: lay.lifelineBottom }, { color: lineColor, width: 1, dash: true, arrow: false });
  }
  // participant header boxes
  for (const p of lay.parts) {
    dt.shape("rect", { x: p.boxX, y: lay.boxY, w: p.boxW, h: lay.boxH }, { fill, line: { color: border, width: 1.25 } });
    dt.text(
      [{ text: p.label, fontSize: 11, fontFace: fonts.heading, color: textColor, bold: true }],
      { x: p.boxX, y: lay.boxY, w: p.boxW, h: lay.boxH },
      { align: "center", valign: "middle", shrink: true },
    );
  }
  // combined fragments (alt/loop/opt/par): an outline box with a labelled corner tab
  for (const fr of lay.frags) {
    dt.shape("rect", { x: fr.x, y: fr.y, w: fr.w, h: fr.h }, { fill: null, line: { color: border, width: 1 } });
    const tabW = 0.9;
    const tabH = 0.26;
    dt.shape("rect", { x: fr.x, y: fr.y, w: tabW, h: tabH }, { fill, line: { color: border, width: 1 } });
    dt.text([{ text: fr.kind, fontSize: 9, fontFace: fonts.heading, color: textColor, bold: true }],
      { x: fr.x + 0.05, y: fr.y, w: tabW - 0.1, h: tabH }, { align: "left", valign: "middle", shrink: true });
    if (fr.label) {
      dt.text([{ text: fr.label, fontSize: 9, fontFace: fonts.body, color: lineColor, bold: false }],
        { x: fr.x + tabW + 0.1, y: fr.y, w: fr.w - tabW - 0.2, h: tabH }, { align: "left", valign: "middle", shrink: true });
    }
  }

  // messages (ordered top→bottom)
  for (const m of lay.msgs) {
    if (m.self) {
      const lw = 0.45;
      const lh = 0.28;
      dt.line({ x: m.fromX, y: m.y }, { x: m.fromX + lw, y: m.y }, { color: lineColor, width: w, dash: m.dash, arrow: false });
      dt.line({ x: m.fromX + lw, y: m.y }, { x: m.fromX + lw, y: m.y + lh }, { color: lineColor, width: w, dash: m.dash, arrow: false });
      dt.line({ x: m.fromX + lw, y: m.y + lh }, { x: m.fromX, y: m.y + lh }, { color: lineColor, width: w, dash: m.dash, arrow: true });
      if (m.label) {
        dt.text([{ text: m.label, fontSize: ds.edge_label_font_size, fontFace: fonts.body, color: lineColor, bold: false }],
          { x: m.fromX + lw + 0.08, y: m.y, w: 1.8, h: 0.3 }, { align: "left", valign: "middle", shrink: true });
      }
    } else {
      dt.line({ x: m.fromX, y: m.y }, { x: m.toX, y: m.y }, { color: lineColor, width: w, dash: m.dash, arrow: true });
      if (m.label) {
        const x1 = Math.min(m.fromX, m.toX);
        dt.text([{ text: m.label, fontSize: ds.edge_label_font_size, fontFace: fonts.body, color: lineColor, bold: false }],
          { x: x1, y: m.y - 0.28, w: Math.abs(m.toX - m.fromX), h: 0.25 }, { align: "center", valign: "middle", shrink: true });
      }
    }
  }
}
