/**
 * placeholder-filler.ts — Generate PPTX from DeckIR + template.
 *
 * Takes a parsed DeckIR and a loaded TemplateData, produces a PPTX buffer.
 * Core approach: for each slide, copy placeholder shapes from the layout XML,
 * replace text content while preserving lstStyle/spPr from the layout.
 */

import JSZip from "jszip";
import type { DeckIR, SlideIR, PlaceholderContent } from "./slide-schema";
import type { TemplateData, LayoutInfo } from "./template-loader";
import { autoSelectLayout, findLayout } from "./template-loader";
import { layoutIndex } from "./slide-schema";
import { paragraphsToOoxml } from "./md-to-ooxml";

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

// ── Build slide XML from layout placeholders + content ──

function buildSlideXml(
  layout: LayoutInfo,
  slide: SlideIR,
): string {
  const contentMap = new Map(
    slide.placeholders.map((p) => [p.idx, p]),
  );

  let shapes = "";
  let id = 2;

  for (const ph of layout.placeholders) {
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

  return (
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
    `</p:sld>`
  );
}

function buildSlideRels(layoutIndex: number): string {
  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1"` +
    ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"` +
    ` Target="../slideLayouts/slideLayout${layoutIndex}.xml"/>` +
    `</Relationships>`
  );
}

// ── Main: generate PPTX buffer from DeckIR + template ──

export async function generatePptx(
  deck: DeckIR,
  template: TemplateData,
): Promise<Uint8Array> {
  const zip = template.zip.clone();

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
    const slideXml = buildSlideXml(layout, slide);
    const slideRels = buildSlideRels(layout.index);

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
