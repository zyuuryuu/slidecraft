/**
 * template-loader.ts — Load a PPTX template and extract layout registry.
 *
 * Reads a template PPTX (with no slides, only slideLayouts + slideMaster)
 * via JSZip and builds a LayoutInfo[] registry for use by the placeholder filler.
 */

import JSZip from "jszip";
import type { SlideIR } from "./slide-schema";
import { LAYOUT_NAMES } from "./slide-schema";

// ── Types ──

export interface PlaceholderStyle {
  x: number; // inches
  y: number;
  w: number;
  h: number;
  fontSize: number; // points
  fontColor: string; // hex without #
  fontName: string;
  bold: boolean;
  align: string; // "l", "ctr", "r"
}

export interface PlaceholderInfo {
  idx: string;
  type: string; // "body", "ctrTitle", "subTitle", "sldNum", etc.
  name: string; // shape name from cNvPr
  shapeXml: string; // full normalized shape XML for cloning into slides
  style: PlaceholderStyle; // extracted position + style for preview
}

export interface DecoRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // hex without #
}

export interface LayoutInfo {
  index: number; // 1-based (slideLayout1.xml)
  name: string; // layout name from cSld
  placeholders: PlaceholderInfo[];
  decorations: DecoRect[]; // decorative shapes (backgrounds, bars, panels)
}

export interface TemplateData {
  layouts: LayoutInfo[];
  zip: JSZip; // retained for PPTX assembly
  presentationXml: string;
  presentationRels: string;
  contentTypes: string;
}

// ── Namespace normalization ──

function normalizeNs(xml: string): string {
  let r = xml;
  // Map all ns0-ns9 prefixes. Detect which maps to which namespace.
  // Common: ns0 = presentationml (p:), ns1/ns2/ns3/ns4 = drawingml (a:)
  // We normalize everything to p: and a:
  for (let i = 0; i <= 9; i++) {
    const prefix = `ns${i}`;
    // Check if this prefix is used for presentationml
    if (r.includes(`xmlns:${prefix}="http://schemas.openxmlformats.org/presentationml`)) {
      r = r.split(`<${prefix}:`).join("<p:");
      r = r.split(`</${prefix}:`).join("</p:");
      r = r.replace(
        new RegExp(`xmlns:${prefix}="[^"]*"`, "g"),
        "",
      );
    }
    // Check if this prefix is used for drawingml
    if (r.includes(`xmlns:${prefix}="http://schemas.openxmlformats.org/drawingml`)) {
      r = r.split(`<${prefix}:`).join("<a:");
      r = r.split(`</${prefix}:`).join("</a:");
      r = r.replace(
        new RegExp(`xmlns:${prefix}="[^"]*"`, "g"),
        "",
      );
    }
  }
  // Fallback: if still has ns0-ns4, apply common mapping
  r = r.replace(/<ns0:/g, "<p:").replace(/<\/ns0:/g, "</p:");
  r = r.replace(/<ns1:/g, "<a:").replace(/<\/ns1:/g, "</a:");
  r = r.replace(/<ns2:/g, "<a:").replace(/<\/ns2:/g, "</a:");
  r = r.replace(/<ns3:/g, "<a:").replace(/<\/ns3:/g, "</a:");
  r = r.replace(/<ns4:/g, "<a:").replace(/<\/ns4:/g, "</a:");
  return r;
}

// ── EMU to inches ──

const EMU_PER_INCH = 914400;
function emuToInch(emu: string | undefined): number {
  return emu ? parseInt(emu) / EMU_PER_INCH : 0;
}

// ── Extract style from shape XML ──

function extractStyle(sp: string): PlaceholderStyle {
  // Position and size from xfrm
  const offMatch = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
  const extMatch = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);

  // Font info from lstStyle defRPr or rPr
  const szMatch = sp.match(/defRPr[^>]*sz="(\d+)"/) || sp.match(/<a:rPr[^>]*sz="(\d+)"/);
  const boldMatch = sp.match(/defRPr[^>]*b="1"/) || sp.match(/<a:rPr[^>]*b="1"/);
  const colorMatch = sp.match(/srgbClr val="([A-Fa-f0-9]{6})"/);
  const fontMatch = sp.match(/<a:latin typeface="([^"]+)"/);
  const alignMatch = sp.match(/<a:(?:def)?PPr[^>]*algn="(\w+)"/);

  return {
    x: emuToInch(offMatch?.[1]),
    y: emuToInch(offMatch?.[2]),
    w: emuToInch(extMatch?.[1]),
    h: emuToInch(extMatch?.[2]),
    fontSize: szMatch ? parseInt(szMatch[1]) / 100 : 14,
    fontColor: colorMatch ? colorMatch[1] : "1E293B",
    fontName: fontMatch ? fontMatch[1] : "Calibri",
    bold: !!boldMatch,
    align: alignMatch ? alignMatch[1] : "l",
  };
}

// ── Extract decorative rects from layout XML ──

function extractDecorations(layoutXml: string): DecoRect[] {
  const normalized = normalizeNs(layoutXml);
  const shapes = normalized.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  const decos: DecoRect[] = [];

  for (const sp of shapes) {
    // Skip placeholder shapes
    if (sp.includes("<p:ph")) continue;

    const offMatch = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
    const extMatch = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    const colorMatch = sp.match(/srgbClr val="([A-Fa-f0-9]{6})"/);

    if (offMatch && extMatch && colorMatch) {
      decos.push({
        x: emuToInch(offMatch[1]),
        y: emuToInch(offMatch[2]),
        w: emuToInch(extMatch[1]),
        h: emuToInch(extMatch[2]),
        color: colorMatch[1],
      });
    }
  }

  return decos;
}

// ── Extract placeholders from layout XML ──

function extractPlaceholders(layoutXml: string): PlaceholderInfo[] {
  const normalized = normalizeNs(layoutXml);
  const shapes = normalized.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  const placeholders: PlaceholderInfo[] = [];

  for (const sp of shapes) {
    const phTag = sp.match(/<p:ph([^/]*?)\/?>/)
    if (!phTag) continue; // decorative shape, skip

    const attrs = phTag[1];
    const idxMatch = attrs.match(/idx="(\d+)"/);
    const typeMatch = attrs.match(/type="(\w+)"/);
    const nameMatch = sp.match(/cNvPr[^>]*name="([^"]*)"/);

    const idx = idxMatch ? idxMatch[1] : "0";
    const type = typeMatch ? typeMatch[1] : "body";
    const name = nameMatch ? nameMatch[1] : "";
    const style = extractStyle(sp);

    placeholders.push({ idx, type, name, shapeXml: sp, style });
  }

  return placeholders;
}

// ── Load template ──

export async function loadTemplate(
  pptxBuffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<TemplateData> {
  const zip = await JSZip.loadAsync(pptxBuffer);

  const layouts: LayoutInfo[] = [];

  for (let i = 1; i <= 30; i++) {
    const path = `ppt/slideLayouts/slideLayout${i}.xml`;
    const file = zip.file(path);
    if (!file) break;

    const xml = await file.async("string");
    const nameMatch = xml.match(/name="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `Layout${i}`;
    const placeholders = extractPlaceholders(xml);
    const decorations = extractDecorations(xml);

    layouts.push({ index: i, name, placeholders, decorations });
  }

  const presentationXml = await zip
    .file("ppt/presentation.xml")!
    .async("string");
  const presentationRels = await zip
    .file("ppt/_rels/presentation.xml.rels")!
    .async("string");
  const contentTypes = await zip
    .file("[Content_Types].xml")!
    .async("string");

  return { layouts, zip, presentationXml, presentationRels, contentTypes };
}

// ── Auto layout selection ──

export function autoSelectLayout(
  slide: SlideIR,
  slideIndex: number,
  totalSlides: number,
): string {
  // If explicitly specified, use it
  if (slide.layout !== "auto") {
    return slide.layout;
  }

  const idxs = new Set(slide.placeholders.map((p) => p.idx));
  const hasTitle = idxs.has("15");
  const hasCtrTitle = idxs.has("0");
  const hasBody = idxs.has("1");
  const hasIdx2 = idxs.has("2");
  const hasIdx3 = idxs.has("3");

  // Check for closing keywords
  const allText = slide.placeholders
    .flatMap((p) => p.paragraphs.flatMap((pp) => pp.segments.map((s) => s.text)))
    .join(" ")
    .toLowerCase();
  const isClosing =
    allText.includes("thank") || allText.includes("感謝") || allText.includes("ありがとう");

  // First slide → Title
  if (slideIndex === 0) {
    return LAYOUT_NAMES[0]; // Title.1Title.Single
  }

  // Closing keywords on last slide
  if (isClosing && slideIndex === totalSlides - 1) {
    return LAYOUT_NAMES[28]; // Closing.1Message.Single
  }

  // 3 content sections → 3 column
  if (hasTitle && hasBody && hasIdx2 && hasIdx3) {
    return LAYOUT_NAMES[12]; // Column.3Body.Equal
  }

  // 2 content sections → 2 column
  if (hasTitle && hasBody && hasIdx2) {
    return LAYOUT_NAMES[10]; // Column.2Body.Equal
  }

  // Title + body → Content
  if ((hasTitle || hasCtrTitle) && hasBody) {
    return LAYOUT_NAMES[6]; // Content.1Body.Single
  }

  // Title only → Section
  if (hasTitle && !hasBody) {
    return LAYOUT_NAMES[3]; // Section.1Title.Single
  }

  // Fallback
  return LAYOUT_NAMES[6]; // Content.1Body.Single
}

// ── Find layout by name ──

export function findLayout(
  tpl: TemplateData,
  name: string,
): LayoutInfo | undefined {
  return tpl.layouts.find((l) => l.name === name);
}
