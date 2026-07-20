/**
 * diagram-sequence.ts — Sequence-diagram layout + painter (a SECOND diagram engine).
 *
 * Unlike the node-edge/layered engine, a sequence diagram is temporal: participants
 * are vertical lifelines across the top, and messages are horizontal arrows ordered
 * top→bottom (by edge order). Rendered via the shared DrawTarget → native PPTX shapes
 * + preview SVG (WYSIWYG), NOT a Mermaid image. M1: participants, lifelines, sync/
 * return messages (+ self-loop). M2: alt/loop/opt/par fragments. M3: alt `else`
 * branch dividers, activation bars, async (open) arrowheads. M4 (#270): notes
 * (Note over/left of/right of) — also carries sequenceSpecToMermaid (the reverse
 * DiagramSpec→Mermaid direction), matching the parse+serialize+layout+paint grouping
 * used by the other diagram-<type>.ts modules (gantt/journey/xychart).
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
  notes: { x: number; y: number; w: number; h: number; text: string }[];
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
  const noteH = 0.4;
  const noteStack = 0.12; // gap between stacked notes (or a note and whatever follows in the same slot)
  // A message's label is drawn 0.28in ABOVE its line (see the msgs loop below) — a
  // note ending right where that message starts would collide with the label, so a
  // note→message transition needs extra headroom a note→note one doesn't.
  const noteToMsgClearance = 0.3;
  const noteW = 1.8;
  const notePad = 0.15;
  // Centre the block vertically in the available space so it clears the slide's
  // title/subtitle (top-aligning at contentTop overlapped them). Conservatively
  // assumes every note precedes a message (worst case) — at most under-centres.
  const naturalH =
    boxH + 0.45 + spec.edges.length * gap + spec.notes.length * (noteH + noteStack + noteToMsgClearance) + 0.3;
  const avail = SLIDE_H - contentTop - 0.4;
  const boxY = naturalH < avail ? contentTop + (avail - naturalH) / 2 : contentTop;
  const cx = (i: number) => margin + colW * i + colW / 2;

  const partLayout = parts.map((p, i) => ({ id: p.id, label: p.label, cx: cx(i), boxX: cx(i) - boxW / 2, boxW }));
  const idx = new Map(parts.map((p, i) => [p.id, i]));
  const cxById = new Map(partLayout.map((p) => [p.id, p.cx]));
  const leftmostCx = partLayout.length ? partLayout[0].cx : margin;

  // Walk message slots 0..edges.length; any note pinned "at" a slot claims its own
  // row just before that slot's message (or, for `at === edges.length`, after the
  // last message), so notes never collide with message arrows/labels.
  const firstMsgY = boxY + boxH + 0.45;
  const msgs: SeqLayout["msgs"] = [];
  const notes: SeqLayout["notes"] = [];
  let cursorY = firstMsgY;
  for (let k = 0; k <= spec.edges.length; k++) {
    const notesHere = spec.notes.filter((x) => x.at === k);
    for (const nt of notesHere) {
      const cxs = nt.participants.map((pid) => cxById.get(pid)).filter((v): v is number => v !== undefined);
      const spanLo = cxs.length ? Math.min(...cxs) : leftmostCx;
      const spanHi = cxs.length ? Math.max(...cxs) : leftmostCx;
      let x: number, w: number;
      if (nt.placement === "over") {
        w = Math.max(spanHi - spanLo + noteW * 0.6, noteW * 0.7);
        x = (spanLo + spanHi) / 2 - w / 2;
      } else {
        w = noteW;
        x = nt.placement === "left_of" ? spanLo - w - notePad : spanHi + notePad;
      }
      notes.push({ x, y: cursorY, w, h: noteH, text: nt.text });
      cursorY += noteH + noteStack;
    }
    if (k < spec.edges.length) {
      if (notesHere.length) cursorY += noteToMsgClearance;
      const e = spec.edges[k];
      const fi = idx.get(e.from) ?? 0;
      const ti = idx.get(e.to) ?? 0;
      msgs.push({
        fromX: cx(fi),
        toX: cx(ti),
        y: cursorY,
        label: e.label,
        dash: e.style?.dash ?? false,
        self: e.from === e.to,
        async: e.style?.async ?? false,
      });
      cursorY += gap;
    }
  }
  const lifelineBottom = cursorY + 0.3;

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
  for (const nt of notes) { minX = Math.min(minX, nt.x); maxX = Math.max(maxX, nt.x + nt.w); }
  return {
    parts: partLayout,
    boxY,
    boxH,
    lifelineBottom,
    msgs,
    frags,
    acts,
    notes,
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

  // Each note (Note over/left of/right of) = a filled box + centred text, its own group.
  const noteFill = theme.palette.amber;
  const noteBorder = theme.palette.accent_dark;
  const noteTextColor = theme.palette.dark_text;
  for (const nt of lay.notes) {
    dt.beginGroup();
    dt.shape("rect", { x: nt.x, y: nt.y, w: nt.w, h: nt.h }, { fill: noteFill, line: { color: noteBorder, width: 1 } });
    dt.text([{ text: nt.text, fontSize: 9, fontFace: fonts.body, color: noteTextColor, bold: false }],
      { x: nt.x + 0.08, y: nt.y, w: nt.w - 0.16, h: nt.h }, { align: "center", valign: "middle", shrink: true });
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

// ── DiagramSpec (sequence) → Mermaid (reverse direction; R8 agreement with the
// parser in mermaid-uml-parser.ts's parseMermaidSequence) ──

/** Mermaid message operator for a message's dash (return) + async flags. */
function seqArrow(dash: boolean | undefined, async: boolean | undefined): string {
  if (async) return dash ? "--)" : "-)";
  return dash ? "-->>" : "->>";
}

/** A note's placement + participants → Mermaid `Note <kw> <ids>: text`. */
function noteToMermaid(nt: DiagramSpec["notes"][number]): string {
  const kw = nt.placement === "over" ? "over" : nt.placement === "left_of" ? "left of" : "right of";
  return `Note ${kw} ${nt.participants.join(",")}: ${nt.text}`;
}

export function sequenceSpecToMermaid(spec: DiagramSpec): string {
  let s = "sequenceDiagram\n";
  for (const n of spec.nodes) {
    s += n.label && n.label !== n.id ? `  participant ${n.id} as ${n.label}\n` : `  participant ${n.id}\n`;
  }
  // Walk messages in order, interleaving fragment open/divider/close and
  // activate/deactivate so the parser reconstructs the same indices.
  let depth = 1;
  const pad = () => "  ".repeat(depth);
  for (let i = 0; i < spec.edges.length; i++) {
    // opens at i (outermost = widest span first)
    for (const f of spec.fragments.filter((f) => f.from === i).sort((a, b) => (b.to - b.from) - (a.to - a.from))) {
      s += `${pad()}${f.kind}${f.label ? " " + f.label : ""}\n`;
      depth++;
    }
    // branch dividers at i (`else` for alt/opt/loop, `and` for par)
    for (const f of spec.fragments) {
      for (const d of f.dividers ?? []) {
        if (d.at === i) {
          const kw = f.kind === "par" ? "and" : "else";
          s += `${"  ".repeat(Math.max(1, depth - 1))}${kw}${d.label ? " " + d.label : ""}\n`;
        }
      }
    }
    for (const a of spec.activations) if (a.from === i) s += `${pad()}activate ${a.participant}\n`;
    for (const nt of spec.notes ?? []) if (nt.at === i) s += `${pad()}${noteToMermaid(nt)}\n`;
    const e = spec.edges[i];
    s += `${pad()}${e.from}${seqArrow(e.style?.dash, e.style?.async)}${e.to}: ${e.label ?? ""}\n`;
    for (const a of spec.activations) if (a.to === i) s += `${pad()}deactivate ${a.participant}\n`;
    // closes at i — every fragment ending here emits an `end` (all identical, so
    // only the count matters); each one closes a nesting level.
    const closes = spec.fragments.filter((f) => f.to === i).length;
    for (let c = 0; c < closes; c++) {
      depth = Math.max(1, depth - 1);
      s += `${pad()}end\n`;
    }
  }
  // notes pinned after the last message (or, with zero messages, at position 0)
  for (const nt of spec.notes ?? []) if (nt.at >= spec.edges.length) s += `${pad()}${noteToMermaid(nt)}\n`;
  return s;
}
