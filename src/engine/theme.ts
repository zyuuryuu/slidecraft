/**
 * DiagramTheme — Centralized theme configuration for diagram rendering.
 *
 * Defines palette, fonts, and default styles so that rendered diagrams
 * visually match the target PPTX template.
 *
 * Default: Midnight Executive theme.
 */

import * as yaml from "js-yaml";
import { loadYaml } from "./yaml-io";

// ── Types ──

export interface FontConfig {
  heading: string;
  body: string;
  mono: string;
}

export interface Palette {
  navy: string;
  dark_navy: string;
  ice_blue: string;
  white: string;
  light_gray: string;
  panel_gray: string;
  mid_gray: string;
  dark_text: string;
  accent: string;
  accent_dark: string;
  teal: string;
  amber: string;
  soft_navy: string;
  card_bg: string;
}

export interface NodeDefaults {
  flowchart: Record<string, Record<string, unknown>>;
  network: Record<string, Record<string, unknown>>;
  orgchart: Record<string, Record<string, unknown>>;
}

export interface DiagramStyle {
  title_font_size: number;
  title_font_bold: boolean;
  title_font_color: string;
  edge_color: string;
  edge_width: number;
  edge_label_font_size: number;
  group_label_font_size: number;
  group_border_width: number;
  slide_bg: string | null;
  header_bar_color: string;
  header_font_color: string;
  header_subtitle_color: string;
}

export interface ThemeConfig {
  name: string;
  palette: Palette;
  fonts: FontConfig;
  node_defaults: NodeDefaults;
  diagram_style: DiagramStyle;
}

// ── Defaults ──

function defaultPalette(): Palette {
  return {
    navy: "1E2761",
    dark_navy: "141B41",
    ice_blue: "CADCFC",
    white: "FFFFFF",
    light_gray: "F5F7FA",
    panel_gray: "EDF0F7",
    mid_gray: "94A3B8",
    dark_text: "1E293B",
    accent: "3B82F6",
    accent_dark: "2563EB",
    teal: "06B6D4",
    amber: "F59E0B",
    soft_navy: "2D3A6E",
    card_bg: "F0F4FF",
  };
}

function defaultFonts(): FontConfig {
  return {
    heading: "Georgia",
    body: "Calibri",
    mono: "Consolas",
  };
}

function defaultNodeDefaults(): NodeDefaults {
  return {
    flowchart: {
      terminal: { fill: "#3B82F6", font_color: "#FFFFFF", font_bold: true, font_size: 11 },
      process: { fill: "#1E2761", border: "#3B82F6", font_color: "#FFFFFF", font_size: 11 },
      decision: { fill: "#F59E0B", font_color: "#1E293B", font_size: 10 },
      error: { fill: "#2D3A6E", font_color: "#FFFFFF", font_size: 11 },
      io: { fill: "#06B6D4", font_color: "#FFFFFF", font_size: 11 },
    },
    network: {
      external: { fill: "#94A3B8", border: "#1E293B", font_color: "#FFFFFF" },
      firewall: { fill: "#F59E0B", font_color: "#1E293B", font_size: 9 },
      core: { fill: "#1E2761", border: "#3B82F6", font_color: "#FFFFFF" },
      switch: { fill: "#2D3A6E", border: "#3B82F6", font_color: "#FFFFFF", font_size: 10 },
      server: { fill: "#3B82F6", font_color: "#FFFFFF", font_size: 9 },
      database: { fill: "#1E2761", font_color: "#FFFFFF", font_size: 9 },
      app: { fill: "#06B6D4", font_color: "#FFFFFF", font_size: 9 },
    },
    orgchart: {
      ceo: { fill: "#141B41", border: "#3B82F6", font_color: "#FFFFFF", font_size: 12 },
      vp: { fill: "#1E2761", border: "#3B82F6", font_color: "#FFFFFF", font_size: 11 },
      team: { fill: "#2D3A6E", border: "#3B82F6", font_color: "#FFFFFF", font_size: 10 },
    },
  };
}

function defaultDiagramStyle(): DiagramStyle {
  return {
    title_font_size: 20,
    title_font_bold: true,
    title_font_color: "#1E2761",
    edge_color: "#94A3B8",
    edge_width: 2.0,
    edge_label_font_size: 9,
    group_label_font_size: 8,
    group_border_width: 1.5,
    slide_bg: "#F5F7FA",
    header_bar_color: "#1E2761",
    header_font_color: "#FFFFFF",
    header_subtitle_color: "#CADCFC",
  };
}

// ── Factory ──

export function midnightExecutive(): ThemeConfig {
  return {
    name: "Midnight Executive",
    palette: defaultPalette(),
    fonts: defaultFonts(),
    node_defaults: defaultNodeDefaults(),
    diagram_style: defaultDiagramStyle(),
  };
}

export const DEFAULT_THEME: ThemeConfig = midnightExecutive();

// ── Palette helper ──

export function paletteHex(palette: Palette, name: keyof Palette): string {
  return `#${palette[name]}`;
}

/** Perceived luminance (0=black … 255=white) of a hex colour. */
export function hexLuminance(hex: string): number {
  const h = hex.replace(/^#/, "");
  if (h.length < 6) return 255;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Colour for "bare" text drawn DIRECTLY on the slide background (chart legends,
 * axis labels, task names, …). Derived for contrast against the theme's slide
 * background — dark ink on a light slide, white on a dark slide — so it never
 * vanishes (white-on-white / dark-on-dark) when the theme/background changes.
 * Text drawn ON a coloured shape should instead contrast with THAT shape's fill.
 */
export function bareTextColor(theme: ThemeConfig): string {
  const bg = theme.diagram_style.slide_bg ?? "#FFFFFF";
  return hexLuminance(bg) > 140 ? theme.palette.dark_text : "#FFFFFF";
}

// ── Merge utilities ──

function mergeObject<T extends object>(base: T, overrides: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    if (key in base) {
      (result as Record<string, unknown>)[key] = (overrides as Record<string, unknown>)[key];
    }
  }
  return result;
}

function mergeNodeDefaults(base: NodeDefaults, overrides: Record<string, unknown>): NodeDefaults {
  const result = { ...base };
  for (const dtype of ["flowchart", "network", "orgchart"] as const) {
    if (dtype in overrides && typeof overrides[dtype] === "object" && overrides[dtype] !== null) {
      const baseRoles = { ...result[dtype] };
      const overrideRoles = overrides[dtype] as Record<string, unknown>;
      for (const [role, styleDict] of Object.entries(overrideRoles)) {
        if (typeof styleDict === "object" && styleDict !== null) {
          baseRoles[role] = styleDict as Record<string, unknown>;
        }
      }
      result[dtype] = baseRoles;
    }
  }
  return result;
}

// ── YAML I/O ──

export function themeFromYaml(yamlStr: string): ThemeConfig {
  const data = loadYaml(yamlStr);
  if (data === null || data === undefined) {
    return midnightExecutive();
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Theme YAML root must be a mapping, got ${typeof data}`);
  }

  const d = data as Record<string, unknown>;
  const base = midnightExecutive();

  if ("name" in d && typeof d.name === "string") {
    base.name = d.name;
  }
  if ("palette" in d && typeof d.palette === "object" && d.palette !== null) {
    base.palette = mergeObject(base.palette, d.palette as Partial<typeof base.palette>);
  }
  if ("fonts" in d && typeof d.fonts === "object" && d.fonts !== null) {
    base.fonts = mergeObject(base.fonts, d.fonts as Partial<typeof base.fonts>);
  }
  if ("diagram_style" in d && typeof d.diagram_style === "object" && d.diagram_style !== null) {
    base.diagram_style = mergeObject(base.diagram_style, d.diagram_style as Partial<typeof base.diagram_style>);
  }
  if ("node_defaults" in d && typeof d.node_defaults === "object" && d.node_defaults !== null) {
    base.node_defaults = mergeNodeDefaults(base.node_defaults, d.node_defaults as Record<string, unknown>);
  }

  return base;
}

export function themeToYaml(theme: ThemeConfig): string {
  const data = {
    name: theme.name,
    palette: { ...theme.palette },
    fonts: { ...theme.fonts },
    diagram_style: { ...theme.diagram_style },
    node_defaults: {
      flowchart: { ...theme.node_defaults.flowchart },
      network: { ...theme.node_defaults.network },
      orgchart: { ...theme.node_defaults.orgchart },
    },
  };
  return yaml.dump(data, { flowLevel: -1, sortKeys: false });
}

// ── Helpers ──

export function getClassdefsForType(theme: ThemeConfig, diagramType: string): Record<string, Record<string, unknown>> {
  const mapping: Record<string, Record<string, Record<string, unknown>>> = {
    flowchart: theme.node_defaults.flowchart,
    network: theme.node_defaults.network,
    orgchart: theme.node_defaults.orgchart,
  };
  return mapping[diagramType] ?? theme.node_defaults.flowchart;
}

export function paletteSummaryForPrompt(theme: ThemeConfig): string {
  const p = theme.palette;
  return `- navy: #${p.navy}（メイン背景）
- dark_navy: #${p.dark_navy}（最上位ノード）
- accent: #${p.accent}（青アクセント）
- teal: #${p.teal}（ティール）
- amber: #${p.amber}（判断/警告）
- soft_navy: #${p.soft_navy}（サブノード）
- mid_gray: #${p.mid_gray}（コネクタ/外部）
- white: #${p.white}（ダーク背景上の文字）
- dark_text: #${p.dark_text}（ライト背景上の文字）
- ice_blue: #${p.ice_blue}（サブテキスト）`;
}
