/**
 * group-overlay.ts — what a GROUP cell (card / step / kpi) draws BESIDE its placeholder text:
 *  - #400 a heading icon: `### :server: 可用性` → the built-in ICON_CATALOG glyph left of the heading,
 *    the heading text indented past it (the `:server:` token itself is not printed);
 *  - #401 a current-step frame: `<!-- step * -->` → a thin frame around that step's column.
 *
 * The icon token stays IN the heading text (IR unchanged → round-trip stable, the GUI group field keeps
 * it). splitHeadingIcon is the ONE recognizer: group-binding uses it both to strip the token from the
 * cell content and to place the icon, so the two cannot disagree (R8). Icons are drawn by the diagram
 * painter's paintIcon through the shared DrawTarget backends (SVG preview / PPTX export) — no second
 * icon renderer. Pure logic (R2).
 */
import type { DrawTarget, Box } from "./draw-target";
import type { Paragraph } from "./slide-schema";
import type { PlaceholderInfo } from "./template-loader";
import { normalizeIconName } from "./icon-catalog";
import { paintIcon } from "./diagram-icons";

export interface OverlayIcon { name: string; phIdx: string; x: number; y: number; s: number; color: string; }
export interface OverlayFrame extends Box { color: string; }
/** Decorations for one grouped slide. `insets` = placeholder idx → the new left text inset (inches)
 *  that makes room for that cell's icon. All empty ⇔ the slide has no icon token / current step. */
export interface GroupOverlay { icons: OverlayIcon[]; frames: OverlayFrame[]; insets: Map<string, number>; }

export function emptyOverlay(): GroupOverlay {
  return { icons: [], frames: [], insets: new Map() };
}

export function isEmptyOverlay(o: GroupOverlay): boolean {
  return o.icons.length === 0 && o.frames.length === 0 && o.insets.size === 0;
}

// `:name:` leading a heading. Its characters (letters/digits/_/-) never include a parseInline token
// start (` [ ~ *), and it is matched only inside a PLAIN first segment — so `**:server:**` etc. stay
// literal, and formatting after the token survives untouched.
const HEADING_ICON_RE = /^:([A-Za-z0-9_-]+):[ \t]*/;

/** The heading's built-in icon (canonical name, aliases/case resolved like diagram node icons) and the
 *  paragraph without the token — or null when the heading has no token or the name is unknown (the
 *  text then stays literal: a typo never makes content vanish). */
export function splitHeadingIcon(p: Paragraph): { icon: string; paragraph: Paragraph } | null {
  const [first, ...rest] = p.segments;
  if (!first || first.bold || first.italic || first.code || first.strike || first.href) return null;
  const m = HEADING_ICON_RE.exec(first.text);
  const icon = m ? normalizeIconName(m[1]) : undefined;
  if (!m || !icon) return null;
  const remain = first.text.slice(m[0].length);
  const segments = remain ? [{ ...first, text: remain }, ...rest] : rest;
  return { icon, paragraph: { ...p, segments: segments.length ? segments : [{ text: "" }] } };
}

// ── Geometry ──

const EMU_PER_IN = 914400;
// OOXML <a:bodyPr> defaults when the attribute is absent: lIns/rIns 0.1in, tIns/bIns 0.05in.
const DEFAULT_INS = { lIns: 91440, tIns: 45720, bIns: 45720 };

function bodyPrOf(shapeXml: string): { anchor: string; lIns: number; tIns: number; bIns: number } {
  const tag = shapeXml.match(/<a:bodyPr\b[^>]*>/)?.[0] ?? "";
  const attr = (k: string) => tag.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1];
  const ins = (k: keyof typeof DEFAULT_INS) => {
    const v = Number(attr(k));
    return (attr(k) !== undefined && Number.isFinite(v) ? v : DEFAULT_INS[k]) / EMU_PER_IN;
  };
  return { anchor: attr("anchor") ?? "t", lIns: ins("lIns"), tIns: ins("tIns"), bIns: ins("bIns") };
}

/** Where a heading icon sits in placeholder `ph`: a square of ~1.1em at the text's left inset, centred
 *  on the FIRST line (or the box centre for an anchor="ctr" box), plus the new left inset (inches) that
 *  moves the text past it. Shared by preview and export (one geometry). */
export function headingIconGeometry(ph: PlaceholderInfo): { box: { x: number; y: number; s: number }; lIns: number } {
  const st = ph.style;
  const fs = st.fontSize > 0 ? st.fontSize : 18;
  const { anchor, lIns, tIns, bIns } = bodyPrOf(ph.shapeXml);
  const s = Math.max(0.05, Math.min((fs * 1.1) / 72, st.h));
  const lineH = (fs * 1.2) / 72;
  let y: number;
  if (anchor === "ctr") y = st.y + (st.h - s) / 2;
  else if (anchor === "b") y = st.y + st.h - bIns - lineH + (lineH - s) / 2;
  else y = st.y + tIns + (lineH - s) / 2;
  y = Math.min(Math.max(y, st.y), st.y + st.h - s);
  return { box: { x: st.x + lIns, y, s }, lIns: lIns + s * 1.35 };
}

/** Set the text's left inset (inches) on a placeholder shape's <a:bodyPr> — the export side of an
 *  icon cell's `insets` entry (the preview pads its text box by the same amount). */
export function withLeftInset(shapeXml: string, inches: number): string {
  const emu = Math.round(inches * EMU_PER_IN);
  return shapeXml.replace(/<a:bodyPr\b([^>]*?)(\/?)>/, (_m, attrs: string, close: string) => {
    const next = /\slIns="[^"]*"/.test(attrs) ? attrs.replace(/\slIns="[^"]*"/, ` lIns="${emu}"`) : `${attrs} lIns="${emu}"`;
    return `<a:bodyPr${next}${close}>`;
  });
}

/** A frame around column `i` (its slots' union box), padded but kept clear of the other columns. */
export function frameAround(unions: Box[], i: number, color: string): OverlayFrame {
  const c = unions[i];
  const sep = (a: Box, b: Box) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  const minSep = Math.min(Infinity, ...unions.filter((_, j) => j !== i).map((o) => sep(c, o)));
  const pad = Math.max(0.02, Math.min(0.08, 0.4 * minSep));
  return { x: c.x - pad, y: c.y - pad, w: c.w + 2 * pad, h: c.h + 2 * pad, color };
}

/** The union box of placeholder styles. */
export function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── Painter (shared by the SVG preview and the PPTX export) ──

const FRAME_LINE_PT = 1.5;

export function paintGroupOverlay(dt: DrawTarget, o: GroupOverlay): void {
  for (const f of o.frames) {
    dt.shape("rect", { x: f.x, y: f.y, w: f.w, h: f.h }, { fill: null, line: { color: f.color, width: FRAME_LINE_PT } });
  }
  for (const ic of o.icons) {
    dt.beginGroup(); // one grabbable object per icon
    paintIcon(dt, ic.name, ic.x, ic.y, ic.s, ic.color);
    dt.endGroup();
  }
}
