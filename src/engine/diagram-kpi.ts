/**
 * diagram-kpi.ts — KPI "big number" cards layout + painter (a "second engine").
 *
 * A row/grid of stat tiles, each a filled panel with a large value, a caption and
 * an optional delta (tinted by trend up/down). Common in report/dashboard slides.
 * Native shapes (rounded rects + text), not an image. Authored as a DiagramSpec
 * (type "kpi"); no Mermaid equivalent.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DiagramSpec } from "./schema";
import type { ThemeConfig } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

export interface KpiCardBox {
  x: number; y: number; w: number; h: number;
  value: string; label: string; delta: string; deltaColor: string;
}
export interface KpiLayout {
  cards: KpiCardBox[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function deltaColor(trend: string, theme: ThemeConfig): string {
  const t = trend.toLowerCase();
  if (t === "up" || t === "+" || t === "good") return "#10B981";
  if (t === "down" || t === "-" || t === "bad") return "#EF4444";
  return theme.palette.accent;
}

export function computeKpiLayout(spec: DiagramSpec, contentTop: number, theme: ThemeConfig): KpiLayout {
  const cards = spec.kpi?.cards ?? [];
  const n = Math.max(1, cards.length);
  const margin = 0.5;
  const gap = 0.3;
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  const totalW = SLIDE_W - 2 * margin;
  const cardW = (totalW - gap * (cols - 1)) / cols;
  const avail = SLIDE_H - contentTop - 0.4;
  const cardH = Math.max(1.1, Math.min(2.0, (avail - gap * (rows - 1)) / rows));
  const gridH = rows * cardH + (rows - 1) * gap;
  const top = contentTop + Math.max(0, (avail - gridH) / 2);

  const boxes: KpiCardBox[] = cards.map((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: margin + col * (cardW + gap),
      y: top + row * (cardH + gap),
      w: cardW, h: cardH,
      value: c.value, label: c.label, delta: c.delta, deltaColor: deltaColor(c.trend, theme),
    };
  });

  return {
    cards: boxes,
    bbox: { minX: margin - 0.05, minY: top - 0.05, maxX: SLIDE_W - margin + 0.05, maxY: top + gridH + 0.05 },
  };
}

export function paintKpi(dt: DrawTarget, lay: KpiLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const navy = theme.palette.navy;
  const accent = theme.palette.accent;

  for (const c of lay.cards) {
    dt.beginGroup();
    // panel + a thin accent bar along the top edge
    dt.shape("rounded_rect", { x: c.x, y: c.y, w: c.w, h: c.h }, { fill: navy, line: { color: navy, width: 0 }, rectRadius: 0.1 });
    dt.shape("rect", { x: c.x, y: c.y, w: c.w, h: 0.08 }, { fill: accent, line: { color: accent, width: 0 } });

    // big value
    dt.text([{ text: c.value, fontSize: 30, fontFace: fonts.heading, color: "#FFFFFF", bold: true }],
      { x: c.x + 0.1, y: c.y + c.h * 0.14, w: c.w - 0.2, h: c.h * 0.42 }, { align: "center", valign: "middle", shrink: true });
    // delta (trend-tinted)
    if (c.delta) {
      dt.text([{ text: c.delta, fontSize: 13, fontFace: fonts.body, color: c.deltaColor, bold: true }],
        { x: c.x + 0.1, y: c.y + c.h * 0.55, w: c.w - 0.2, h: c.h * 0.2 }, { align: "center", valign: "middle", shrink: true });
    }
    // caption
    dt.text([{ text: c.label, fontSize: 11, fontFace: fonts.body, color: "#CBD5E1", bold: false }],
      { x: c.x + 0.1, y: c.y + c.h * (c.delta ? 0.74 : 0.6), w: c.w - 0.2, h: c.h * 0.22 }, { align: "center", valign: "middle", shrink: true });
    dt.endGroup();
  }
}
