/**
 * diagram-icons.ts — Built-in node icons drawn as NATIVE shapes.
 *
 * Each icon is composed from DrawTarget primitives (rect / rounded_rect / circle
 * / line), so it renders identically in the preview SVG and the PPTX export
 * (WYSIWYG) and stays editable — no raster images, no filesystem. Icons are simple
 * monochrome line glyphs sized into a square box, matching BUILTIN_ICONS.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DrawTarget } from "./draw-target";

/** Draw a built-in icon glyph (by name) into the square box (x,y,s) in `color`. */
export function paintIcon(dt: DrawTarget, name: string, x: number, y: number, s: number, color: string): void {
  const w = Math.max(1, s * 1.6); // stroke width (pt) scaled to icon size
  const X = (f: number) => x + f * s;
  const Y = (f: number) => y + f * s;
  const ln = (x1: number, y1: number, x2: number, y2: number) =>
    dt.line({ x: X(x1), y: Y(y1) }, { x: X(x2), y: Y(y2) }, { color, width: w, arrow: false });
  const arr = (x1: number, y1: number, x2: number, y2: number) =>
    dt.line({ x: X(x1), y: Y(y1) }, { x: X(x2), y: Y(y2) }, { color, width: w, arrow: true });
  const rect = (a: number, b: number, c: number, d: number, fill = false) =>
    dt.shape("rect", { x: X(a), y: Y(b), w: c * s, h: d * s }, { fill: fill ? color : null, line: { color, width: w } });
  const rr = (a: number, b: number, c: number, d: number) =>
    dt.shape("rounded_rect", { x: X(a), y: Y(b), w: c * s, h: d * s }, { fill: null, line: { color, width: w }, rectRadius: 0.06 * s });
  const circ = (a: number, b: number, c: number, d: number, fill = false) =>
    dt.shape("circle", { x: X(a), y: Y(b), w: c * s, h: d * s }, { fill: fill ? color : null, line: { color, width: w } });

  switch (name) {
    case "server":
      rr(0.22, 0.05, 0.56, 0.9); ln(0.3, 0.3, 0.7, 0.3); ln(0.3, 0.5, 0.7, 0.5); ln(0.3, 0.7, 0.7, 0.7);
      circ(0.6, 0.78, 0.08, 0.08, true); break;
    case "database":
      circ(0.2, 0.05, 0.6, 0.2); ln(0.2, 0.15, 0.2, 0.82); ln(0.8, 0.15, 0.8, 0.82); circ(0.2, 0.72, 0.6, 0.2); break;
    case "storage":
      circ(0.2, 0.06, 0.6, 0.16); circ(0.2, 0.4, 0.6, 0.16); circ(0.2, 0.74, 0.6, 0.16);
      ln(0.2, 0.14, 0.2, 0.82); ln(0.8, 0.14, 0.8, 0.82); break;
    case "cloud":
      circ(0.06, 0.42, 0.34, 0.4); circ(0.3, 0.22, 0.44, 0.48); circ(0.56, 0.42, 0.36, 0.4); ln(0.2, 0.8, 0.82, 0.8); break;
    case "internet":
      circ(0.1, 0.1, 0.8, 0.8); circ(0.32, 0.1, 0.36, 0.8); ln(0.1, 0.5, 0.9, 0.5); break;
    case "router":
      rr(0.3, 0.42, 0.4, 0.16);
      arr(0.5, 0.42, 0.5, 0.14); arr(0.5, 0.58, 0.5, 0.86); arr(0.42, 0.5, 0.14, 0.5); arr(0.58, 0.5, 0.86, 0.5); break;
    case "switch":
      rr(0.1, 0.4, 0.8, 0.34); rect(0.2, 0.62, 0.1, 0.08); rect(0.36, 0.62, 0.1, 0.08); rect(0.52, 0.62, 0.1, 0.08); rect(0.68, 0.62, 0.1, 0.08);
      arr(0.3, 0.4, 0.7, 0.18); arr(0.7, 0.4, 0.3, 0.18); break;
    case "firewall":
      rect(0.12, 0.12, 0.76, 0.76); ln(0.12, 0.37, 0.88, 0.37); ln(0.12, 0.62, 0.88, 0.62);
      ln(0.5, 0.12, 0.5, 0.37); ln(0.31, 0.37, 0.31, 0.62); ln(0.69, 0.37, 0.69, 0.62); ln(0.5, 0.62, 0.5, 0.88); break;
    case "client":
    case "monitor":
      rect(0.12, 0.14, 0.76, 0.54); ln(0.5, 0.68, 0.5, 0.82); ln(0.3, 0.86, 0.7, 0.86); break;
    case "load_balancer":
      circ(0.4, 0.06, 0.2, 0.2); ln(0.5, 0.26, 0.2, 0.78); ln(0.5, 0.26, 0.5, 0.78); ln(0.5, 0.26, 0.8, 0.78);
      circ(0.13, 0.74, 0.14, 0.14, true); circ(0.43, 0.74, 0.14, 0.14, true); circ(0.73, 0.74, 0.14, 0.14, true); break;
    case "wireless_ap":
      circ(0.42, 0.66, 0.16, 0.16, true);
      ln(0.26, 0.5, 0.5, 0.32); ln(0.5, 0.32, 0.74, 0.5); ln(0.16, 0.62, 0.5, 0.36); ln(0.5, 0.36, 0.84, 0.62); break;
    case "printer":
      rect(0.16, 0.4, 0.68, 0.34); rect(0.3, 0.14, 0.4, 0.26); ln(0.3, 0.55, 0.7, 0.55); rect(0.32, 0.62, 0.36, 0.24); break;
    case "phone":
      rr(0.3, 0.05, 0.4, 0.9); ln(0.42, 0.16, 0.58, 0.16); circ(0.46, 0.82, 0.08, 0.08); break;
    case "vpn":
      rr(0.26, 0.46, 0.48, 0.44); circ(0.32, 0.2, 0.36, 0.42); circ(0.46, 0.62, 0.08, 0.08, true); break;
    default:
      rr(0.18, 0.18, 0.64, 0.64); break; // generic node glyph
  }
}
