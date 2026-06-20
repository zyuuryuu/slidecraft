/**
 * diagram-sequence.ts — Sequence-diagram layout + painter (a SECOND diagram engine).
 *
 * Unlike the node-edge/layered engine, a sequence diagram is temporal: participants
 * are vertical lifelines across the top, and messages are horizontal arrows ordered
 * top→bottom (by edge order). Rendered via the shared DrawTarget → native PPTX shapes
 * + preview SVG (WYSIWYG), NOT a Mermaid image. M1: participants, lifelines, sync/
 * return messages (+ self-loop). M2: alt/loop/opt/par fragments. M3: alt `else`
 * branch dividers, activation bars, async (open) arrowheads.
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
  msgs: { fromX: number; toX: number; y: number; label?: string; dash: boolean; self: boolean; async: boolean }[];
  frags: { x: number; y: number; w: number; h: number; kind: string; label: string; dividers: { y: number; label: string }[] }[];
  acts: { id: string; x: number; y: number; w: number; h: number }[];
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
  const cxById = new Map(partLayout.map((p) => [p.id, p.cx]));

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
      async: e.style?.async ?? false,
    };
  });
  const lifelineBottom = firstMsgY + spec.edges.length * gap + 0.3;

  // combined-fragment boxes (alt/loop/opt/par) over their message range, plus
  // `else`/`and` branch divider lines at their message positions.
  const leftX = partLayout.length ? partLayout[0].cx : margin;
  const rightX = partLayout.length ? partLayout[partLayout.length - 1].cx : SLIDE_W - margin;
  const padX = 0.35;
  const frags = spec.fragments.map((f) => {
    const top = (msgs[f.from]?.y ?? firstMsgY) - 0.3;
    const bot = (msgs[f.to]?.y ?? firstMsgY) + 0.22;
    const dividers = (f.dividers ?? []).map((d) => ({
      y: (msgs[d.at]?.y ?? firstMsgY) - gap / 2,
      label: d.label,
    }));
    return { x: leftX - padX, y: top, w: rightX - leftX + 2 * padX, h: bot - top, kind: f.kind, label: f.label, dividers };
  });

  // activation bars: a thin rect on the participant's lifeline over its msg span.
  const actW = 0.16;
  const acts = spec.activations.map((a) => {
    const cv = cxById.get(a.participant) ?? margin;
    const top = msgs[a.from]?.y ?? firstMsgY;
    const bot = msgs[a.to]?.y ?? top;
    return { id: a.participant, x: cv - actW / 2, y: top, w: actW, h: Math.max(bot - top, 0.18) };
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
    acts,
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

  // Each participant = its dashed lifeline + header box + label, as ONE sub-group
  // (so dragging a participant in PowerPoint moves the lifeline with it).
  for (const p of lay.parts) {
    dt.beginGroup();
    dt.line({ x: p.cx, y: lay.boxY + lay.boxH }, { x: p.cx, y: lay.lifelineBottom }, { color: lineColor, width: 1, dash: true, arrow: false });
    dt.shape("rect", { x: p.boxX, y: lay.boxY, w: p.boxW, h: lay.boxH }, { fill, line: { color: border, width: 1.25 } });
    dt.text(
      [{ text: p.label, fontSize: 11, fontFace: fonts.heading, color: textColor, bold: true }],
      { x: p.boxX, y: lay.boxY, w: p.boxW, h: lay.boxH },
      { align: "center", valign: "middle", shrink: true },
    );
    // activation bars on this participant's lifeline (move with the participant)
    for (const a of lay.acts) {
      if (a.id !== p.id) continue;
      dt.shape("rect", { x: a.x, y: a.y, w: a.w, h: a.h }, { fill, line: { color: border, width: 0.75 } });
    }
    dt.endGroup();
  }
  // Each combined fragment (alt/loop/opt/par) = outline box + labelled corner tab,
  // grouped together.
  for (const fr of lay.frags) {
    dt.beginGroup();
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
    // alt `else` / par `and` branch dividers: a dashed line across + branch label
    for (const d of fr.dividers) {
      dt.line({ x: fr.x, y: d.y }, { x: fr.x + fr.w, y: d.y }, { color: border, width: 0.75, dash: true, arrow: false });
      if (d.label) {
        dt.text([{ text: d.label, fontSize: 9, fontFace: fonts.body, color: lineColor, bold: false }],
          { x: fr.x + 0.12, y: d.y, w: fr.w - 0.24, h: 0.22 }, { align: "left", valign: "middle", shrink: true });
      }
    }
    dt.endGroup();
  }

  // Each message (ordered top→bottom) = its arrow line(s) + label, as ONE sub-group.
  for (const m of lay.msgs) {
    dt.beginGroup();
    if (m.self) {
      const lw = 0.45;
      const lh = 0.28;
      dt.line({ x: m.fromX, y: m.y }, { x: m.fromX + lw, y: m.y }, { color: lineColor, width: w, dash: m.dash, arrow: false });
      dt.line({ x: m.fromX + lw, y: m.y }, { x: m.fromX + lw, y: m.y + lh }, { color: lineColor, width: w, dash: m.dash, arrow: false });
      dt.line({ x: m.fromX + lw, y: m.y + lh }, { x: m.fromX, y: m.y + lh }, { color: lineColor, width: w, dash: m.dash, arrow: true, openArrow: m.async });
      if (m.label) {
        dt.text([{ text: m.label, fontSize: ds.edge_label_font_size, fontFace: fonts.body, color: lineColor, bold: false }],
          { x: m.fromX + lw + 0.08, y: m.y, w: 1.8, h: 0.3 }, { align: "left", valign: "middle", shrink: true });
      }
    } else {
      dt.line({ x: m.fromX, y: m.y }, { x: m.toX, y: m.y }, { color: lineColor, width: w, dash: m.dash, arrow: true, openArrow: m.async });
      if (m.label) {
        const x1 = Math.min(m.fromX, m.toX);
        dt.text([{ text: m.label, fontSize: ds.edge_label_font_size, fontFace: fonts.body, color: lineColor, bold: false }],
          { x: x1, y: m.y - 0.28, w: Math.abs(m.toX - m.fromX), h: 0.25 }, { align: "center", valign: "middle", shrink: true });
      }
    }
    dt.endGroup();
  }
}
