/**
 * diagram-journey.ts — User-journey parser + layout + painter (a "second engine").
 *
 * A journey is a horizontal sequence of STEPS, each with a satisfaction SCORE
 * (1–5) and ACTORS, grouped into SECTIONS. Steps reuse node fields: label=step
 * name, value=score, group=section, attributes=actors. Rendered as a satisfaction
 * curve (points + connecting line, coloured by score) with section bands and
 * step/actor labels — native shapes, not a Mermaid image.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import { type ThemeConfig, bareTextColor } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

// ── parser ──
/** Parse a Mermaid `journey` into a DiagramSpec (type "journey"): `title`,
 *  `section`, and `<step>: <score>: <actor, actor>` lines. */
export function parseMermaidJourney(lines: string[]): DiagramSpec | null {
  let title: string | undefined;
  let section = "";
  const nodes: Array<{ id: string; label: string; value: number; group?: string; attributes: string[] }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;
    const t = line.match(/^title\s+(.+)$/i);
    if (t) { title = t[1].trim(); continue; }
    const sec = line.match(/^section\s+(.+)$/i);
    if (sec) { section = sec[1].trim(); continue; }
    const m = line.match(/^(.+?)\s*:\s*(\d+)\s*:\s*(.*)$/);
    if (m) {
      nodes.push({
        id: `j${nodes.length}`, label: m[1].trim(), value: parseInt(m[2], 10),
        ...(section ? { group: section } : {}),
        attributes: m[3].split(",").map((s) => s.trim()).filter(Boolean),
      });
    }
  }
  if (nodes.length === 0) return null;
  const sections = [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))];
  const r = DiagramSpecSchema.safeParse({
    type: "journey", direction: "LR", title, nodes,
    groups: sections.map((g) => ({ id: g, label: g })), edges: [],
  });
  return r.success ? r.data : null;
}

/** DiagramSpec(journey) → Mermaid `journey` text. */
export function journeySpecToMermaid(spec: DiagramSpec): string {
  let s = "journey\n";
  if (spec.title) s += `  title ${spec.title}\n`;
  let section: string | undefined;
  for (const n of spec.nodes) {
    if (n.group !== section) { section = n.group; if (section) s += `  section ${section}\n`; }
    s += `  ${n.label}: ${n.value ?? 0}: ${(n.attributes ?? []).join(", ")}\n`;
  }
  return s;
}

// ── layout + paint ──
function scoreColor(s: number): string {
  if (s >= 4) return "#10B981"; // happy → green
  if (s === 3) return "#F59E0B"; // neutral → amber
  return "#EF4444"; // unhappy → red
}

type Box = { x: number; y: number; w: number; h: number };
export interface JourneyLayout {
  steps: { cx: number; py: number; color: string; nameBox: Box; actorBox: Box; name: string; actors: string }[];
  sections: { x: number; w: number; y: number; h: number; label: string }[];
  gridYs: number[]; // y for score lines 1..5 (faint)
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computeJourneyLayout(spec: DiagramSpec, contentTop: number): JourneyLayout {
  const steps = spec.nodes;
  const n = Math.max(steps.length, 1);
  const margin = 0.7;
  const colW = (SLIDE_W - 2 * margin) / n;
  const cx = (i: number) => margin + colW * i + colW / 2;

  const hasSections = steps.some((p) => p.group);
  const sectionBandH = hasSections ? 0.4 : 0;
  const chartH = 1.8;
  const labelH = 0.3;
  const actorH = 0.26;
  const blockH = sectionBandH + 0.1 + chartH + 0.15 + labelH + actorH;
  const avail = SLIDE_H - contentTop - 0.4;
  const top = blockH < avail ? contentTop + (avail - blockH) / 2 : contentTop;

  const chartTop = top + sectionBandH + 0.1;
  const chartBottom = chartTop + chartH;
  const scoreY = (s: number) => chartBottom - ((Math.max(1, Math.min(5, s)) - 1) / 4) * chartH;
  const labelY = chartBottom + 0.15;
  const actorY = labelY + labelH;

  const stepsL = steps.map((p, i) => {
    const c = cx(i);
    const score = p.value ?? 3;
    return {
      cx: c, py: scoreY(score), color: scoreColor(score),
      name: p.label, actors: (p.attributes ?? []).join(", "),
      nameBox: { x: c - colW / 2 + 0.05, y: labelY, w: colW - 0.1, h: labelH },
      actorBox: { x: c - colW / 2 + 0.05, y: actorY, w: colW - 0.1, h: actorH },
    };
  });

  const sections: JourneyLayout["sections"] = [];
  if (hasSections) {
    let i = 0;
    while (i < steps.length) {
      const g = steps[i].group;
      let j = i;
      while (j < steps.length && steps[j].group === g) j++;
      if (g) {
        const x1 = cx(i) - colW / 2 + 0.05;
        const x2 = cx(j - 1) + colW / 2 - 0.05;
        sections.push({ x: x1, w: x2 - x1, y: top, h: sectionBandH - 0.06, label: g });
      }
      i = j;
    }
  }

  return {
    steps: stepsL, sections,
    gridYs: [1, 2, 3, 4, 5].map(scoreY),
    bbox: { minX: margin - 0.1, minY: top - 0.05, maxX: SLIDE_W - margin + 0.1, maxY: actorY + actorH + 0.05 },
  };
}

export function paintJourney(dt: DrawTarget, lay: JourneyLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const accent = theme.palette.accent;
  const navy = theme.palette.navy;
  const grid = theme.diagram_style.edge_color;
  const ink = bareTextColor(theme);

  // section bands
  for (const s of lay.sections) {
    dt.beginGroup();
    dt.shape("rounded_rect", { x: s.x, y: s.y, w: s.w, h: s.h }, { fill: navy, line: { color: accent, width: 1 } });
    dt.text([{ text: s.label, fontSize: 11, fontFace: fonts.heading, color: accent, bold: true }],
      { x: s.x + 0.1, y: s.y, w: s.w - 0.2, h: s.h }, { align: "center", valign: "middle", shrink: true });
    dt.endGroup();
  }

  // faint score gridlines (1..5)
  for (const gy of lay.gridYs) {
    dt.line({ x: lay.bbox.minX + 0.1, y: gy }, { x: lay.bbox.maxX - 0.1, y: gy }, { color: grid, width: 0.4, dash: true, arrow: false });
  }

  // satisfaction curve: connect consecutive step points
  for (let i = 0; i < lay.steps.length - 1; i++) {
    dt.line({ x: lay.steps[i].cx, y: lay.steps[i].py }, { x: lay.steps[i + 1].cx, y: lay.steps[i + 1].py }, { color: accent, width: 2, arrow: false });
  }

  // each step = its point + name + actors (one sub-group)
  for (const st of lay.steps) {
    dt.beginGroup();
    const r = 0.1;
    dt.shape("circle", { x: st.cx - r, y: st.py - r, w: 2 * r, h: 2 * r }, { fill: st.color, line: { color: "#FFFFFF", width: 1 } });
    dt.text([{ text: st.name, fontSize: 9, fontFace: fonts.heading, color: ink, bold: true }],
      st.nameBox, { align: "center", valign: "middle", shrink: true, wrap: true });
    if (st.actors) {
      dt.text([{ text: st.actors, fontSize: 8, fontFace: fonts.body, color: ink, bold: false }],
        st.actorBox, { align: "center", valign: "middle", shrink: true });
    }
    dt.endGroup();
  }
}
