/**
 * placeholder-filler.ts — Generate PPTX from DeckIR + template.
 *
 * Takes a parsed DeckIR and a loaded TemplateData, produces a PPTX buffer.
 * Core approach: for each slide, copy placeholder shapes from the layout XML,
 * replace text content while preserving lstStyle/spPr from the layout.
 */

import JSZip from "jszip";
import * as yaml from "js-yaml";
import type { DeckIR, SlideIR, PlaceholderContent } from "./slide-schema";
import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import type { TemplateData, LayoutInfo } from "./template-loader";
import { autoSelectLayout, findLayout } from "./template-loader";
import { buildCatalog } from "./template-catalog";
import { bindContentByRole, bodyPlaceholders, nthBody } from "./placeholder-binding";
import { isGroupedLayout, expandGroups } from "./group-binding";
import { paragraphsToOoxml } from "./md-to-ooxml";
import { renderToBufferWithGroups, nestShapeXml } from "./pptx-writer";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./mermaid-to-diagram";
import { tableGraphicFrameXml } from "./table-ooxml";
import { midnightExecutive } from "./theme";

/**
 * Rasterizes an SVG string to PNG bytes. Injected by the caller (the UI layer)
 * so this engine module stays free of DOM/Node rendering dependencies — the
 * browser/WebView provides a canvas-based implementation that matches the preview.
 */
export type SvgRasterizer = (svg: string) => Promise<Uint8Array>;

/** Code/log text → paragraphs (one per source line, no bullets) so the body renders line-by-line. */
function codeToParagraphs(content: string): PlaceholderContent["paragraphs"] {
  return content.split("\n").map((line) => ({ segments: [{ text: line }] }));
}

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

  // Preserve the bodyPr (anchor / autofit) but DROP the layout's lstStyle: a slide placeholder must NOT
  // carry its own lstStyle. It inherits font / size / color from the LAYOUT placeholder (which inherits
  // from the MASTER) by matching type+idx. Copying the layout's lstStyle into the slide PINS the
  // formatting at the slide level, so editing the master/layout font no longer propagates to generated
  // slides ("スライドマスターでフォントサイズを変えても効かない"). An empty <a:lstStyle/> restores
  // normal inheritance while looking identical, since the layout supplies exactly the same lstStyle.
  // bodyPr is a required first child of txBody — keep the layout's (anchor/autofit) or a minimal one.
  const bodyPr = inner.match(/<a:bodyPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/)?.[0] ?? "<a:bodyPr/>";
  const preserved = bodyPr + "<a:lstStyle/>";
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

async function extractDiagramShapes(
  diagramYaml: string,
  region?: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const data = yaml.load(diagramYaml);
  const result = DiagramSpecSchema.safeParse(data);
  if (!result.success) {
    throw new Error("Invalid diagram YAML: " + result.error.issues[0]?.message);
  }
  const spec: DiagramSpec = result.data;
  const theme = midnightExecutive();
  // Embedded in a titled slide → the diagram omits its own title bar so it
  // doesn't duplicate / overlap the slide's title placeholder. When `region` is
  // given (diagram beside body text), confine the shapes to that placeholder box.
  const { buffer, groups } = await renderToBufferWithGroups(spec, {
    theme,
    omitTitle: true,
    region,
  });

  // Open the PptxGenJS-generated PPTX and pull slide1's shapes, then nest them
  // into PowerPoint sub-groups (figure = one object; node/edge = grabbable parts)
  // per the painter's group tree.
  const diagZip = await JSZip.loadAsync(buffer);
  const slideXml = await diagZip.file("ppt/slides/slide1.xml")?.async("string");
  if (!slideXml) return "";
  return nestShapeXml(slideXml, groups);
}

// ── Build slide XML from layout placeholders + content ──

async function buildSlideXml(
  layout: LayoutInfo,
  slide: SlideIR,
): Promise<{ xml: string; mermaidImageRId: string | undefined }> {
  // A Mermaid block whose content is a NATIVE diagram type exports as native,
  // editable shapes (not a rasterised mermaid.js image) — matching the preview.
  if (slide.mermaidBlock && !slide.diagram) {
    const nativeSpec = mermaidToDiagramSpec(slide.mermaidBlock.mermaid);
    if (nativeSpec) {
      slide = {
        ...slide,
        diagram: { yaml: diagramSpecToYaml(nativeSpec), placeholderIdx: slide.mermaidBlock.placeholderIdx },
        mermaidBlock: undefined,
      };
    }
  }
  // Bind content to placeholders BY ROLE (not idx) via the SHARED binding — the SAME function the
  // live preview uses, so export and preview can't diverge (WYSIWYG), and any template's idx
  // convention binds correctly (an alien master's title/body idxs match through their role).
  // A grouped slide (card/step/kpi) fills the layout's per-group heading/body slots via the SEPARATE
  // group path; everything else uses the canonical binder. Same Map shape → the loop below is unchanged.
  const contentFor = slide.groupKind && isGroupedLayout(layout)
    ? expandGroups(slide, layout)
    : bindContentByRole(slide, layout.placeholders);

  // Diagram/mermaid/table occupies the Nth BODY region (placeholderIdx "1"→1, "2"→2…).
  const bodyPhs = bodyPlaceholders(layout.placeholders);
  const visualBody = (pi?: string) => nthBody(bodyPhs, pi);
  const diagBodyIdx = slide.diagram ? visualBody(slide.diagram.placeholderIdx)?.idx : undefined;
  const mermBodyIdx = slide.mermaidBlock ? visualBody(slide.mermaidBlock.placeholderIdx)?.idx : undefined;
  const tableBodyIdx = slide.table ? visualBody(slide.table.placeholderIdx)?.idx : undefined;
  const codeBodyIdx = slide.code ? visualBody(slide.code.placeholderIdx)?.idx : undefined;

  let shapes = "";
  let id = 2;

  for (const ph of layout.placeholders) {
    if (ph.idx === diagBodyIdx || ph.idx === mermBodyIdx || ph.idx === tableBodyIdx) continue; // replaced by the visual
    // A code/log block FILLS its body placeholder with monospace text (the placeholder's own
    // lstStyle supplies the monospace font / code-box styling — we only swap the text).
    if (ph.idx === codeBodyIdx) {
      let shapeXml = replaceTextInShape(ph.shapeXml, { idx: ph.idx, paragraphs: codeToParagraphs(slide.code!.content) });
      shapeXml = shapeXml.replace(/(<p:cNvPr[^>]*id=")\d+"/, `$1${id}"`);
      shapes += shapeXml;
      id++;
      continue;
    }
    const content = contentFor.get(ph.idx);
    if (!content) continue;

    let shapeXml = replaceTextInShape(ph.shapeXml, content);
    // Update shape ID to be unique within the slide
    shapeXml = shapeXml.replace(/(<p:cNvPr[^>]*id=")\d+"/, `$1${id}"`);
    shapes += shapeXml;
    id++;
  }

  // Add mermaid image placeholder if present
  // The actual image is added to the ZIP separately; here we add a <p:pic> reference
  let mermaidImageRId: string | undefined;
  if (slide.mermaidBlock?.svgCache) {
    const phInfo = visualBody(slide.mermaidBlock.placeholderIdx);
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
    // Solo diagram (idx 1) fills the slide; beside-text diagram (idx 2+) is
    // confined to its placeholder region so it doesn't cover the bullets.
    const diagPh =
      (parseInt(slide.diagram.placeholderIdx) || 1) !== 1
        ? visualBody(slide.diagram.placeholderIdx)
        : undefined;
    const diagramShapes = await extractDiagramShapes(slide.diagram.yaml, diagPh?.style);
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

  // Add a native table if present (fills its body region; editable in PowerPoint).
  if (slide.table) {
    const tablePh = visualBody(slide.table.placeholderIdx);
    if (tablePh) {
      shapes += tableGraphicFrameXml(slide.table.rows, slide.table.header, tablePh.style, id);
    }
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

  // PURGE any slides baked into the template. A picked master may be a FULL deck (e.g. an
  // "all-layouts sample" .pptx with 13 slides), not a slide-free TemplateOnly file. Our assembly
  // writes the deck's slides as slide1.xml, slide2.xml… — which would collide with the template's
  // existing slide parts and, worse, duplicate their [Content_Types] Overrides + presentation rels
  // (invalid OOXML → PowerPoint shows 0 slides). Removing the template's slides makes the deck's
  // slides the ONLY slides, so ANY .pptx works as a master. (Layouts/master/theme are untouched.)
  for (const path of Object.keys(zip.files)) {
    if (/^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$/.test(path)) zip.remove(path);
  }

  // Find max rId in presentation.xml.rels
  const existingRIds = [
    ...template.presentationRels.matchAll(/Id="rId(\d+)"/g),
  ].map((m) => parseInt(m[1]));
  let nextRId = Math.max(...existingRIds, 0) + 1;

  const sldIdEntries: string[] = [];
  const relEntries: string[] = [];
  const ctEntries: string[] = [];
  const slideIdBase = 256;
  // Catalog → layout selection adapts to THIS template (canonical = unchanged).
  const catalog = buildCatalog(template);

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const slideNum = i + 1;
    const rId = `rId${nextRId++}`;

    // Resolve layout
    const layoutName = autoSelectLayout(
      slide,
      i,
      deck.slides.length,
      catalog,
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

  // Update presentation.xml — replace the sldIdLst if present, else INSERT one. Some hand/generated
  // templates OMIT <p:sldIdLst> entirely; without it the exported deck lists NO slides and PowerPoint/
  // LibreOffice show a single blank default slide even though every slide part exists.
  const sldIdLstXml = `<p:sldIdLst>${sldIdEntries.join("")}</p:sldIdLst>`;
  let presXml = template.presentationXml;
  const sldIdLstRe = /<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\s*\/>/;
  if (sldIdLstRe.test(presXml)) {
    presXml = presXml.replace(sldIdLstRe, sldIdLstXml);
  } else if (/<p:sldSz\b/.test(presXml)) {
    // Schema order is …sldMasterIdLst, sldIdLst, sldSz… — insert right before the (required) sldSz.
    presXml = presXml.replace(/<p:sldSz\b/, `${sldIdLstXml}<p:sldSz`);
  } else {
    presXml = presXml.replace("</p:presentation>", `${sldIdLstXml}</p:presentation>`);
  }
  zip.file("ppt/presentation.xml", presXml);

  // Update presentation.xml.rels — first drop the template's own slide rels (purged above), then
  // append the deck's, so no dangling/duplicate slide relationships remain.
  let presRels = template.presentationRels;
  presRels = presRels.replace(
    /<Relationship\b[^>]*Type="[^"]*\/relationships\/slide"[^>]*\/>/g,
    "",
  );
  presRels = presRels.replace(
    "</Relationships>",
    `${relEntries.join("")}</Relationships>`,
  );
  zip.file("ppt/_rels/presentation.xml.rels", presRels);

  // Update [Content_Types].xml — drop the template's own slide Overrides (purged above) first, so
  // the deck's slide Overrides aren't DUPLICATED (duplicate PartName = invalid OOXML → 0 slides).
  // Only /ppt/slides/slideN.xml is stripped; slideLayouts/slideMaster Overrides are left intact.
  let ct = template.contentTypes;
  ct = ct.replace(
    /<Override\b[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g,
    "",
  );
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
