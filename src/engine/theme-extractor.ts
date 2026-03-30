/**
 * Theme Extractor — Extracts theme/color information from a PPTX template.
 *
 * PPTX files are ZIP archives containing XML. The theme is stored in
 * `ppt/theme/theme1.xml` with OOXML color scheme definitions.
 *
 * This module uses JSZip to open the PPTX and parse the theme XML
 * to extract the color palette, which can then be used to create
 * a ThemeConfig for rendering.
 */

import JSZip from "jszip";
import type { ThemeConfig } from "./theme";
import { midnightExecutive } from "./theme";

// ── OOXML Constants ──

const THEME_PATH = "ppt/theme/theme1.xml";

// OOXML theme color scheme element names → semantic roles
const OOXML_COLOR_ROLES = [
  "dk1",    // Dark 1 (typically black/dark)
  "lt1",    // Light 1 (typically white)
  "dk2",    // Dark 2 (dark accent)
  "lt2",    // Light 2 (light accent)
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",  // Hyperlink
  "folHlink", // Followed hyperlink
] as const;

// ── Types ──

export interface ExtractedTheme {
  name: string;
  colors: Map<string, string>; // role → hex color (6 chars, no #)
  fontHeading?: string;
  fontBody?: string;
}

// ── XML Parsing Helpers ──

function extractTagContent(xml: string, tagSuffix: string): string[] {
  // Simple regex-based extraction for OOXML
  // Matches tags like <a:dk1>, <a:accent1>, etc.
  const results: string[] = [];
  // Match tag with namespace prefix, e.g. <a:dk1> ... </a:dk1>
  const regex = new RegExp(
    `<[^:>]+:${tagSuffix}[^>]*>([\\s\\S]*?)<\\/[^:>]+:${tagSuffix}>`,
    "g",
  );
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function extractSrgbColor(xmlFragment: string): string | undefined {
  // Look for srgbClr val="RRGGBB"
  const srgbMatch = xmlFragment.match(/srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (srgbMatch) return srgbMatch[1].toUpperCase();

  // Look for sysClr lastClr="RRGGBB"
  const sysMatch = xmlFragment.match(/sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/);
  if (sysMatch) return sysMatch[1].toUpperCase();

  return undefined;
}

function extractFontName(xml: string, tagSuffix: string): string | undefined {
  // Matches <a:latin typeface="FontName" />
  const regex = new RegExp(
    `<[^:>]+:${tagSuffix}[^>]*>[\\s\\S]*?<[^:>]+:latin[^>]*typeface="([^"]+)"`,
  );
  const match = xml.match(regex);
  return match?.[1];
}

function extractThemeName(xml: string): string {
  // <a:theme name="ThemeName">
  const match = xml.match(/theme[^>]*\sname="([^"]+)"/);
  return match?.[1] ?? "Unknown";
}

// ── Main Extraction ──

export async function extractThemeFromPptx(
  pptxData: ArrayBuffer | Uint8Array,
): Promise<ExtractedTheme> {
  const zip = await JSZip.loadAsync(pptxData);

  const themeFile = zip.file(THEME_PATH);
  if (!themeFile) {
    throw new Error(`Theme file not found in PPTX: ${THEME_PATH}`);
  }

  const xml = await themeFile.async("text");
  return extractThemeFromXml(xml);
}

export function extractThemeFromXml(xml: string): ExtractedTheme {
  const colors = new Map<string, string>();

  // Extract color scheme colors
  for (const role of OOXML_COLOR_ROLES) {
    const fragments = extractTagContent(xml, role);
    for (const fragment of fragments) {
      const color = extractSrgbColor(fragment);
      if (color) {
        colors.set(role, color);
        break; // take first occurrence
      }
    }
  }

  // Extract fonts
  const fontHeading = extractFontName(xml, "majorFont");
  const fontBody = extractFontName(xml, "minorFont");

  // Theme name
  const name = extractThemeName(xml);

  return { name, colors, fontHeading, fontBody };
}

// ── Convert to ThemeConfig ──

export function extractedToThemeConfig(extracted: ExtractedTheme): ThemeConfig {
  const theme = midnightExecutive();
  theme.name = extracted.name;

  // Map OOXML color roles to our palette
  const c = extracted.colors;

  if (c.has("dk2")) theme.palette.navy = c.get("dk2")!;
  if (c.has("dk1")) theme.palette.dark_navy = c.get("dk1")!;
  if (c.has("lt2")) theme.palette.ice_blue = c.get("lt2")!;
  if (c.has("lt1")) theme.palette.white = c.get("lt1")!;
  if (c.has("accent1")) theme.palette.accent = c.get("accent1")!;
  if (c.has("accent2")) theme.palette.teal = c.get("accent2")!;
  if (c.has("accent3")) theme.palette.amber = c.get("accent3")!;
  if (c.has("accent4")) theme.palette.soft_navy = c.get("accent4")!;

  // Update diagram style colors based on extracted palette
  if (c.has("dk2")) {
    theme.diagram_style.title_font_color = `#${c.get("dk2")!}`;
    theme.diagram_style.header_bar_color = `#${c.get("dk2")!}`;
  }
  if (c.has("lt1")) {
    theme.diagram_style.header_font_color = `#${c.get("lt1")!}`;
  }
  if (c.has("lt2")) {
    theme.diagram_style.header_subtitle_color = `#${c.get("lt2")!}`;
  }

  // Fonts
  if (extracted.fontHeading) theme.fonts.heading = extracted.fontHeading;
  if (extracted.fontBody) theme.fonts.body = extracted.fontBody;

  return theme;
}

export async function themeFromPptx(
  pptxData: ArrayBuffer | Uint8Array,
): Promise<ThemeConfig> {
  const extracted = await extractThemeFromPptx(pptxData);
  return extractedToThemeConfig(extracted);
}
