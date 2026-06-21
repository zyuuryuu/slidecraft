/**
 * diagram-timeline.ts — Timeline layout + painter (a temporal "second engine",
 * like diagram-sequence). A `timeline` is a horizontal axis of PERIODS, each with
 * a marker dot, a period label, and a stack of event cards; consecutive periods
 * can be grouped into labelled SECTIONS. Rendered via the shared DrawTarget →
 * native PPTX shapes + preview SVG (WYSIWYG), not a Mermaid image.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DiagramSpec } from "./schema";
import type { ThemeConfig } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

type Box = { x: number; y: number; w: number; h: number };

export interface TimelineLayout {
  axisY: number;
  axisX1: number;
  axisX2: number;
  periods: { cx: number; label: string; labelBox: Box; events: { box: Box; text: string }[] }[];
  sections: { x: number; w: number; y: number; h: number; label: string }[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computeTimelineLayout(spec: DiagramSpec, contentTop: number): TimelineLayout {
  const periods = spec.nodes;
  const n = Math.max(periods.length, 1);
  const margin = 0.7;
  const colW = (SLIDE_W - 2 * margin) / n;
  const cx = (i: number) => margin + colW * i + colW / 2;

  const hasSections = periods.some((p) => p.group);
  const sectionBandH = hasSections ? 0.42 : 0;
  const labelH = 0.36;
  const headH = sectionBandH + 0.45 + 0.14 + labelH + 0.12; // band + axis gap + period-label band
  const maxEvents = Math.max(1, ...periods.map((p) => p.attributes?.length ?? 0));
  const cardGap = 0.1;
  const cardH = Math.max(0.3, Math.min(0.6, (SLIDE_H - contentTop - headH - 0.4 - (maxEvents - 1) * cardGap) / maxEvents));
  const cardW = Math.min(colW * 0.86, 2.4);

  // Centre the whole block vertically in the available space so it clears the
  // slide's title/subtitle (top-aligning at contentTop overlapped them).
  const naturalH = headH + maxEvents * (cardH + cardGap);
  const avail = SLIDE_H - contentTop - 0.4;
  const top = naturalH < avail ? contentTop + (avail - naturalH) / 2 : contentTop;
  const axisY = top + sectionBandH + 0.45;
  const labelY = axisY + 0.14;
  const eventsTop = labelY + labelH + 0.12;

  const periodsL = periods.map((p, i) => {
    const c = cx(i);
    const events = (p.attributes ?? []).map((text, k) => ({
      box: { x: c - cardW / 2, y: eventsTop + k * (cardH + cardGap), w: cardW, h: cardH },
      text,
    }));
    return {
      cx: c,
      label: p.label,
      labelBox: { x: c - colW / 2 + 0.05, y: labelY, w: colW - 0.1, h: labelH },
      events,
    };
  });

  // sections = consecutive runs of periods sharing the same group
  const sections: TimelineLayout["sections"] = [];
  if (hasSections) {
    let i = 0;
    while (i < periods.length) {
      const g = periods[i].group;
      let j = i;
      while (j < periods.length && periods[j].group === g) j++;
      if (g) {
        const x1 = cx(i) - colW / 2 + 0.05;
        const x2 = cx(j - 1) + colW / 2 - 0.05;
        sections.push({ x: x1, w: x2 - x1, y: top, h: sectionBandH - 0.08, label: g });
      }
      i = j;
    }
  }

  const lastY = eventsTop + maxEvents * (cardH + cardGap);
  return {
    axisY,
    axisX1: cx(0),
    axisX2: cx(n - 1),
    periods: periodsL,
    sections,
    bbox: { minX: margin - 0.1, minY: top - 0.1, maxX: SLIDE_W - margin + 0.1, maxY: lastY + 0.1 },
  };
}

export function paintTimeline(dt: DrawTarget, lay: TimelineLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const accent = theme.palette.accent;
  const navy = theme.palette.navy;
  const textColor = "#FFFFFF"; // text ON the navy event cards / section bands
  const ink = theme.palette.dark_text; // bare period labels on the (light) slide bg

  // section bands (drawn first, behind the axis)
  for (const s of lay.sections) {
    dt.beginGroup();
    dt.shape("rounded_rect", { x: s.x, y: s.y, w: s.w, h: s.h }, { fill: navy, line: { color: accent, width: 1 } });
    dt.text(
      [{ text: s.label, fontSize: 11, fontFace: fonts.heading, color: accent, bold: true }],
      { x: s.x + 0.1, y: s.y, w: s.w - 0.2, h: s.h },
      { align: "center", valign: "middle", shrink: true },
    );
    dt.endGroup();
  }

  // the horizontal time axis
  dt.line({ x: lay.axisX1 - 0.2, y: lay.axisY }, { x: lay.axisX2 + 0.2, y: lay.axisY }, { color: accent, width: 2, arrow: false });

  // each period = its marker dot + period label + event cards (one sub-group)
  for (const p of lay.periods) {
    dt.beginGroup();
    const r = 0.08;
    dt.shape("circle", { x: p.cx - r, y: lay.axisY - r, w: 2 * r, h: 2 * r }, { fill: accent, line: { color: accent, width: 0 } });
    dt.text(
      [{ text: p.label, fontSize: 12, fontFace: fonts.heading, color: ink, bold: true }],
      p.labelBox,
      { align: "center", valign: "middle", shrink: true },
    );
    for (const e of p.events) {
      dt.shape("rounded_rect", e.box, { fill: navy, line: { color: accent, width: 1 } });
      dt.text(
        [{ text: e.text, fontSize: 10, fontFace: fonts.body, color: textColor, bold: false }],
        { x: e.box.x + 0.08, y: e.box.y, w: e.box.w - 0.16, h: e.box.h },
        { align: "center", valign: "middle", shrink: true, wrap: true },
      );
    }
    dt.endGroup();
  }
}
