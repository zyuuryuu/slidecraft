/**
 * placeholder-filler.ts — Generate PPTX from DeckIR + template.
 *
 * Takes a parsed DeckIR and a loaded TemplateData, produces a PPTX buffer.
 * Core approach: for each slide, copy placeholder shapes from the layout XML,
 * replace text content while preserving lstStyle/spPr from the layout.
 */

import JSZip from "jszip";
import yaml from "js-yaml";
import type { DeckIR, SlideIR, PlaceholderContent } from "./slide-schema";
import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import type { TemplateData, LayoutInfo } from "./template-loader";
import { autoSelectLayout, findLayout } from "./template-loader";
import { paragraphsToOoxml } from "./md-to-ooxml";
import { renderToBuffer } from "./pptx-writer";
import { midnightExecutive } from "./theme";

/**
 * Rasterizes an SVG string to PNG bytes. Injected by the caller (the UI layer)
 * so this engine module stays free of DOM/Node rendering dependencies — the
 * browser/WebView provides a canvas-based implementation that matches the preview.
 */
export type SvgRasterizer = (svg: string) => Promise<Uint8Array>;

// ── Replace text in a placeholder shape XML ──

function replaceTextInShape(
  shapeXml: string,
  content: PlaceholderContent,
): string {
  const newParagraphs = paragraphsToOoxml(content.paragraphs);

  const txStart = shapeXml.indexOf("<p:txBody>");
  const txEnd = shapeXml.indexOf("</p:txBody>");
  if (txStart === -1 || txEnd === -1) return shapeXml;

  const inner = shapeXml.substring(
    txStart + "<p:txBody>".length,
    txEnd,
  );

  // Find where lstStyle ends to preserve bodyPr + lstStyle
  let cut: number;
  const lstEnd = inner.lastIndexOf("</a:lstStyle>");
  if (lstEnd !== -1) {
    cut = lstEnd + "</a:lstStyle>".length;
  } else {
    const lstSelf = inner.indexOf("<a:lstStyle/>");
    if (lstSelf !== -1) {
      cut = lstSelf + "<a:lstStyle/>".length;
    } else {
      // Fallback: put paragraphs right after bodyPr
      const bodyPrEnd = inner.indexOf("/>");
      cut = bodyPrEnd !== -1 ? bodyPrEnd + 2 : 0;
    }
  }

  const preserved = inner.substring(0, cut);
  return (
    shapeXml.substring(0, txStart) +
    "<p:txBody>" +
    preserved +
    newParagraphs +
    "</p:txBody>" +
    shapeXml.substring(txEnd + "</p:txBody>".length)
  );
}

// ── Extract diagram shapes from PptxGenJS output ──

async function extractDiagramShapes(diagramYaml: string): Promise<string> {
  const data = yaml.load(diagramYaml);
  const result = DiagramSpecSchema.safeParse(data);
  if (!result.success) {
    throw new Error("Invalid diagram YAML: " + result.error.issues[0]?.message);
  }
  const spec: DiagramSpec = result.data;
  const theme = midnightExecutive();
  const pptxBuf = await renderToBuffer(spec, { theme });

  // Open the PptxGenJS-generated PPTX and extract shapes from slide1
  const diagZip = await JSZip.loadAsync(pptxBuf);
  const slideXml = await diagZip.file("ppt/slides/slide1.xml")?.async("string");
  if (!slideXml) return "";

  // Extract all shapes except the group wrapper
  const shapesMatch = slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  const cxnMatches = slideXml.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g) || [];
  return [...shapesMatch, ...cxnMatches].join("");
}

// ── Build slide XML from layout placeholders + content ──

async function buildSlideXml(
  layout: LayoutInfo,
  slide: SlideIR,
): Promise<{ xml: string; mermaidImageRId: string | undefined }> {
  const contentMap = new Map(
    slide.placeholders.map((p) => [p.idx, p]),
  );

  let shapes = "";
  let id = 2;

  for (const ph of layout.placeholders) {
    // Skip placeholders replaced by diagram or mermaid
    if (slide.diagram && ph.idx === slide.diagram.placeholderIdx) continue;
    if (slide.mermaidBlock && ph.idx === slide.mermaidBlock.placeholderIdx) continue;

    const content = contentMap.get(ph.idx);
    if (!content) continue;

    let shapeXml = replaceTextInShape(ph.shapeXml, content);
    // Update shape ID to be unique within the slide
    shapeXml = shapeXml.replace(
      /(<p:cNvPr[^>]*id=")\d+"/,
      `$1${id}"`,
    );
    shapes += shapeXml;
    id++;
  }

  // Add mermaid image placeholder if present
  // The actual image is added to the ZIP separately; here we add a <p:pic> reference
  let mermaidImageRId: string | undefined;
  if (slide.mermaidBlock?.svgCache) {
    const phInfo = layout.placeholders.find(p => p.idx === slide.mermaidBlock!.placeholderIdx);
    if (phInfo) {
      const s = phInfo.style;
      const EMU = (inches: number) => Math.round(inches * 914400);
      mermaidImageRId = "rId2"; // rId1 is slideLayout
      shapes += `<p:pic>`
        + `<p:nvPicPr><p:cNvPr id="${id}" name="MermaidImage"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
        + `<p:blipFill><a:blip r:embed="${mermaidImageRId}"/>`
        + `<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
        + `<p:spPr><a:xfrm>`
        + `<a:off x="${EMU(s.x)}" y="${EMU(s.y)}"/>`
        + `<a:ext cx="${EMU(s.w)}" cy="${EMU(s.h)}"/>`
        + `</a:xfrm><a:prstGeom prst="rect"/></p:spPr>`
        + `</p:pic>`;
      id++;
    }
  }

  // Add diagram shapes if present
  if (slide.diagram) {
    const diagramShapes = await extractDiagramShapes(slide.diagram.yaml);
    // Re-number shape IDs to avoid conflicts
    let reNumbered = diagramShapes;
    const idMatches = [...reNumbered.matchAll(/<p:cNvPr[^>]*id="(\d+)"/g)];
    const usedIds = new Set(idMatches.map(m => m[1]));
    for (const oldId of usedIds) {
      reNumbered = reNumbered.replace(
        new RegExp(`id="${oldId}"`, "g"),
        `id="${id}"`,
      );
      id++;
    }
    shapes += reNumbered;
  }

  const xml =
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    shapes +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sld>`;

  return { xml, mermaidImageRId };
}

function buildSlideRels(layoutIndex: number, imageRId?: string, imageTarget?: string): string {
  let rels =
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1"` +
    ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"` +
    ` Target="../slideLayouts/slideLayout${layoutIndex}.xml"/>`;

  if (imageRId && imageTarget) {
    rels += `<Relationship Id="${imageRId}"` +
      ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"` +
      ` Target="${imageTarget}"/>`;
  }

  rels += `</Relationships>`;
  return rels;
}

// ── Main: generate PPTX buffer from DeckIR + template ──

export async function generatePptx(
  deck: DeckIR,
  template: TemplateData,
  rasterizeSvg?: SvgRasterizer,
): Promise<Uint8Array> {
  // Clone by re-serializing + re-loading (JSZip has no clone method)
  const tplBuf = await template.zip.generateAsync({ type: "uint8array" });
  const zip = await JSZip.loadAsync(tplBuf);

  // Find max rId in presentation.xml.rels
  const existingRIds = [
    ...template.presentationRels.matchAll(/Id="rId(\d+)"/g),
  ].map((m) => parseInt(m[1]));
  let nextRId = Math.max(...existingRIds, 0) + 1;

  const sldIdEntries: string[] = [];
  const relEntries: string[] = [];
  const ctEntries: string[] = [];
  const slideIdBase = 256;

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const slideNum = i + 1;
    const rId = `rId${nextRId++}`;

    // Resolve layout
    const layoutName = autoSelectLayout(
      slide,
      i,
      deck.slides.length,
    );
    const layout = findLayout(template, layoutName);
    if (!layout) {
      throw new Error(
        `Layout not found: "${layoutName}". Available: ${template.layouts.map((l) => l.name).join(", ")}`,
      );
    }

    // Build slide XML
    const { xml: slideXml, mermaidImageRId } = await buildSlideXml(layout, slide);

    // Handle mermaid SVG → PNG image embedding (rasterized by the injected
    // UI-layer canvas rasterizer so the image matches the WYSIWYG preview).
    let imageTarget: string | undefined;
    if (mermaidImageRId && slide.mermaidBlock?.svgCache && rasterizeSvg) {
      const pngData = await rasterizeSvg(slide.mermaidBlock.svgCache);
      const imagePath = `ppt/media/mermaid${slideNum}.png`;
      zip.file(imagePath, pngData);
      imageTarget = `../media/mermaid${slideNum}.png`;

      // Add content type for PNG if not already present
      let ct = await zip.file("[Content_Types].xml")!.async("string");
      if (!ct.includes('Extension="png"')) {
        ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
        zip.file("[Content_Types].xml", ct);
      }
    }

    const slideRels = buildSlideRels(layout.index, mermaidImageRId, imageTarget);

    zip.file(`ppt/slides/slide${slideNum}.xml`, slideXml);
    zip.file(
      `ppt/slides/_rels/slide${slideNum}.xml.rels`,
      slideRels,
    );

    sldIdEntries.push(
      `<p:sldId id="${slideIdBase + i}" r:id="${rId}"/>`,
    );
    relEntries.push(
      `<Relationship Id="${rId}"` +
        ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"` +
        ` Target="slides/slide${slideNum}.xml"/>`,
    );
    ctEntries.push(
      `<Override PartName="/ppt/slides/slide${slideNum}.xml"` +
        ` ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
  }

  // Update presentation.xml
  let presXml = template.presentationXml;
  presXml = presXml.replace(
    "<p:sldIdLst/>",
    `<p:sldIdLst>${sldIdEntries.join("")}</p:sldIdLst>`,
  );
  // Also handle non-empty sldIdLst (if template had slides)
  presXml = presXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${sldIdEntries.join("")}</p:sldIdLst>`,
  );
  zip.file("ppt/presentation.xml", presXml);

  // Update presentation.xml.rels
  let presRels = template.presentationRels;
  presRels = presRels.replace(
    "</Relationships>",
    `${relEntries.join("")}</Relationships>`,
  );
  zip.file("ppt/_rels/presentation.xml.rels", presRels);

  // Update [Content_Types].xml
  let ct = template.contentTypes;
  ct = ct.replace(
    "</Types>",
    `${ctEntries.join("")}</Types>`,
  );
  zip.file("[Content_Types].xml", ct);

  const buf = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  return buf;
}
