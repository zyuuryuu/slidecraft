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
import { buildCatalog, isSectionFooterTarget } from "./template-catalog";
import { bindContentByRole } from "./placeholder-binding";
import { planSlideFigures, dataUriToImage, imagePicXml, mermaidPicXml, imageWithCaptionXml, extractDiagramShapes, type SlideMedia } from "./slide-figure-ooxml";
import { planFieldRescue, applyFieldRescue, fieldNoteShapeXml } from "./field-rescue";
import { isGroupedLayout, expandGroups, groupCellOverlay } from "./group-binding";
import { isGroupedSlide } from "./slide-markers";
import { isEmptyOverlay, paintGroupOverlay, withLeftInset } from "./group-overlay";
import { beforeAfterOverlay, beforeAfterShapesXml } from "./before-after";
import { paragraphsToOoxml, type LinkResolver } from "./md-to-ooxml";
import { createLinkRegistry } from "./hyperlink-rels";
import { titleFontPt } from "./title-fit";
import { paintToShapeXml, renumberShapeIds } from "./pptx-writer";
import type { ChartsMode } from "./pptx-native-chart";
import { nativeChartPartsForYaml, writeNativeChart, maxChartNumber, XLSX_CT, CHART_REL_ID, type NativeChartParts } from "./pptx-native-chart-parts";
import { tableGraphicFrameXml } from "./table-ooxml";
import { notesSlideXml, notesSlideRels, notesMasterXml, notesMasterRels, NOTES_SLIDE_CT, NOTES_MASTER_CT, NOTES_FIRST_LINK_RID } from "./notes-ooxml";
import { materializeDerivedSlides, sectionFooterFor } from "./deck-sections";
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
  link?: LinkResolver,
  szPt?: number, // #437: pre-computed title size (title-fit) baked into the runs; absent → inherit
): string {
  const newParagraphs = paragraphsToOoxml(content.paragraphs, link, szPt);

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

// ── Build slide XML from layout placeholders + content ──

async function buildSlideXml(
  layout: LayoutInfo,
  slide: SlideIR,
  // 所属章名（#168・案A）。null＝章扉より前 or section 無しデッキ＝注入なし。chrome 経路（sldNum と
  // 同じ「テンプレに枠が無ければテンプレの意思」扱い）— 明示 Footer: が束縛済みの ftr 枠には触れない。
  sectionFooterText: string | null = null,
  charts: ChartsMode = "shapes", // #554: "native" → pie/xychart/radar as a native chart (else shapes)
): Promise<{ xml: string; media: SlideMedia[]; linkRels: string; charts: { parts: NativeChartParts; relId: string }[]; figures: ("native" | "shapes")[] }> {
  // Bind content to placeholders BY ROLE (not idx) via the SHARED binding — the SAME function the
  // live preview uses, so export and preview can't diverge (WYSIWYG), and any template's idx
  // convention binds correctly (an alien master's title/body idxs match through their role).
  // A grouped slide (card/step/kpi) fills the layout's per-group heading/body slots via the SEPARATE
  // group path; everything else uses the canonical binder. Same Map shape → the loop below is unchanged.
  const bound = isGroupedSlide(slide) && isGroupedLayout(layout)
    ? expandGroups(slide, layout)
    : bindContentByRole(slide, layout.placeholders);
  // #597: slot-less Category/Takeaway rows merged as text, a slot-less Source drawn as a note (field-rescue).
  const rescue = planFieldRescue(slide, layout, bound);
  const contentFor = applyFieldRescue(bound, rescue);
  // Group-cell decorations (#400 heading icons / #401 current-step frame) from the same pass.
  const overlay = isGroupedSlide(slide) && isGroupedLayout(layout) ? groupCellOverlay(slide, layout) : undefined;

  // Every visual's region, media rel and draw form (#392 段 2: all of them, not just the first of each
  // kind) — the SAME placement the preview and deck-diagnostics read (figureRegions, R8). A Mermaid block
  // of a NATIVE diagram type is drawn as native, editable shapes (matching the preview); `occupied` is the
  // placeholders a visual replaces (skipped below) or a code block fills (#390).
  const fig = planSlideFigures(slide, layout.placeholders);

  // Hyperlinks (#393) in body text / table cells → External rels after the fixed ones (see buildSlideRels).
  const links = createLinkRegistry(FIRST_LINK_RID);

  let shapes = "";
  let id = 2;
  // Backmost: the behind backdrop paints FIRST — before the placeholder shapes — never as <p:bg>.
  if (fig.behind) { shapes += imagePicXml(id, fig.behind.image, fig.behind.box, fig.behind.rId); id++; }

  for (const ph of layout.placeholders) {
    const occ = fig.occupied.get(ph.idx)?.figure;
    if (occ && occ.kind !== "code") continue; // replaced by the visual
    // A code/log block FILLS its body placeholder with monospace text (the placeholder's own
    // lstStyle supplies the monospace font / code-box styling — we only swap the text).
    if (occ?.kind === "code") {
      let shapeXml = replaceTextInShape(ph.shapeXml, { idx: ph.idx, paragraphs: codeToParagraphs(occ.content) });
      shapeXml = shapeXml.replace(/(<p:cNvPr[^>]*id=")\d+"/, `$1${id}"`);
      shapes += shapeXml;
      id++;
      continue;
    }
    let content = contentFor.get(ph.idx);
    // 章名フッタの自動注入（#168）: ftr 枠が未束縛（明示 Footer: 無し）のときだけ、所属章名を書く。
    if (!content && sectionFooterText != null && isSectionFooterTarget(ph, layout.name)) {
      content = { idx: ph.idx, paragraphs: [{ segments: [{ text: sectionFooterText }] }] };
    }
    if (!content) continue;

    // #437 (R7): an over-long title is shrunk to its box here — the SAME fitTitle preview and review read.
    let shapeXml = replaceTextInShape(ph.shapeXml, content, links.rIdFor, titleFontPt(slide, content, ph.style));
    const inset = overlay?.insets.get(ph.idx);
    if (inset !== undefined) shapeXml = withLeftInset(shapeXml, inset); // room for the #400 icon
    // Update shape ID to be unique within the slide
    shapeXml = shapeXml.replace(/(<p:cNvPr[^>]*id=")\d+"/, `$1${id}"`);
    shapes += shapeXml;
    id++;
  }

  // Mermaid SVG → PNG <p:pic> in its body region (a front figure; the bytes are written to the ZIP in
  // the export loop), then each NON-behind image LAST (in front) in its picture/body frame with its alt
  // as a caption line directly under it (#399 — same geometry as the preview).
  for (const m of fig.mermaidPics) { shapes += mermaidPicXml(id, m.box, m.rId); id++; }
  for (const img of fig.images) {
    const r = imageWithCaptionXml(id, img);
    shapes += r.xml;
    id = r.next;
  }
  if (rescue.note) { shapes += fieldNoteShapeXml(id, rescue.note); id++; }

  if (overlay && !isEmptyOverlay(overlay)) {
    const r = renumberShapeIds(await paintToShapeXml((t) => paintGroupOverlay(t, overlay)), id);
    shapes += r.xml;
    id = r.next;
  }

  // Diagram shapes: a solo diagram (a lone one at ordinal 1) fills the slide; any other is confined to its
  // placeholder region so it doesn't cover the bullets or the other figures. A region-bound figure whose
  // region does NOT resolve is not in the plan (DROPPED and reported by unboundVisuals / figure-dropped)
  // rather than falling through to the solo/full-slide path: silently re-homing it would paint the figure
  // OVER the very content it was meant to sit beside (#124). Native charts: the 1st keeps rIdChart.
  const chartParts: { parts: NativeChartParts; relId: string }[] = [];
  const figures: ("native" | "shapes")[] = [];
  for (const d of fig.diagrams) {
    const chart = charts === "native" ? await nativeChartPartsForYaml(d.yaml, midnightExecutive(), d.region) : null;
    const relId = chartParts.length === 0 ? CHART_REL_ID : `${CHART_REL_ID}${chartParts.length + 1}`;
    const diagramShapes = chart ? chart.frameXml.replace(`r:id="${CHART_REL_ID}"`, `r:id="${relId}"`) : await extractDiagramShapes(d.yaml, d.region);
    if (chart) chartParts.push({ parts: chart, relId });
    figures.push(chart ? "native" : "shapes");
    // Re-number shape IDs (incl. nestShapeXml's <p:grpSp> 7000-range ids) in ONE document-order pass.
    // The old per-id global replace re-rewrote ids whose NEW value collided with a later oldId (#441).
    const r = renumberShapeIds(diagramShapes, id);
    shapes += r.xml;
    id = r.next;
  }

  // Native tables (each fills its body region; editable in PowerPoint).
  for (const t of fig.tables) {
    shapes += tableGraphicFrameXml(t.table.rows, t.table.header, t.box, id, links.rIdFor);
    id++;
  }

  // #402: a Before/After pair's direction arrow + role labels, frontmost — the SAME geometry the preview
  // draws (before-after.ts). Undefined for every other slide → nothing added.
  const ba = beforeAfterOverlay(slide, layout);
  if (ba) shapes += beforeAfterShapesXml(id, ba).xml;

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

  return { xml, media: fig.media, linkRels: links.relsXml(), charts: chartParts, figures };
}

/** Fixed slide rels: rId1 layout, rId2/rId3 images, rId4 notesSlide — hyperlinks (#393) start after. */
const FIRST_LINK_RID = 5;

function buildSlideRels(layoutIndex: number, imageRels: { rId: string; target: string }[] = [], notesSlideNum?: number, linkRels = ""): string {
  let rels =
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1"` +
    ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"` +
    ` Target="../slideLayouts/slideLayout${layoutIndex}.xml"/>`;

  for (const { rId, target } of imageRels) {
    rels += `<Relationship Id="${rId}"` +
      ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"` +
      ` Target="${target}"/>`;
  }

  // Speaker notes (#150): image rels occupy at most rId2/rId3, so rId4 is always free.
  if (notesSlideNum !== undefined) {
    rels += `<Relationship Id="rId4"` +
      ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"` +
      ` Target="../notesSlides/notesSlide${notesSlideNum}.xml"/>`;
  }

  rels += `${linkRels}</Relationships>`;
  return rels;
}

// ── Main: generate PPTX buffer from DeckIR + template ──

export async function generatePptx(
  deck: DeckIR,
  template: TemplateData,
  rasterizeSvg?: SvgRasterizer,
  // #554: charts "native" exports pie/xychart/radar as native charts; onFigure reports each DiagramSpec figure's
  // outcome (never-silent). Omitted / "shapes" = the pre-#554 output byte for byte.
  opts: { charts?: ChartsMode; onFigure?: (figure: "native" | "shapes") => void } = {},
): Promise<Uint8Array> {
  // Catalog → layout selection adapts to THIS template (canonical = unchanged).
  const catalog = buildCatalog(template);
  // 派生スライド（<!-- toc -->）の内容を消費点で導出（#151）。宣言なしデッキは同一参照が返る。
  deck = materializeDerivedSlides(deck, catalog); // catalog: 章扉の章一覧はこのテンプレが受けられる時だけ（#637）
  // Clone by re-serializing + re-loading (JSZip has no clone method)
  const tplBuf = await template.zip.generateAsync({ type: "uint8array" });
  const zip = await JSZip.loadAsync(tplBuf);

  // PURGE any slides baked into the template. A picked master may be a FULL deck (e.g. an
  // "all-layouts sample" .pptx with 13 slides), not a slide-free TemplateOnly file. Our assembly
  // writes the deck's slides as slide1.xml, slide2.xml… — which would collide with the template's
  // existing slide parts and, worse, duplicate their [Content_Types] Overrides + presentation rels
  // (invalid OOXML → PowerPoint shows 0 slides). Removing the template's slides makes the deck's
  // slides the ONLY slides, so ANY .pptx works as a master. (Layouts/master/theme are untouched.)
  // notesSlides も同時にパージ（#150）: テンプレのスライドを消す以上、そのスライド由来の
  // notesSlide を残すと孤児パート＋宙吊り rels になる。デッキ側の notesSlide は後段で書く。
  for (const path of Object.keys(zip.files)) {
    if (/^ppt\/(?:slides\/(?:_rels\/)?slide|notesSlides\/(?:_rels\/)?notesSlide)\d+\.xml(?:\.rels)?$/.test(path)) zip.remove(path);
  }

  // Find max rId in presentation.xml.rels
  const existingRIds = [
    ...template.presentationRels.matchAll(/Id="rId(\d+)"/g),
  ].map((m) => parseInt(m[1]));
  let nextRId = Math.max(...existingRIds, 0) + 1;

  const sldIdEntries: string[] = [];
  const relEntries: string[] = [];
  const ctEntries: string[] = [];
  const mediaDefaults = new Map<string, string>(); // ext → ContentType, added in the FINAL CT rebuild (an
  // inline [Content_Types].xml write here would be clobbered by that rebuild, which reads the pristine CT).
  const slideIdBase = 256;
  let chartNum = maxChartNumber(zip); // native charts are numbered above any the template already has

  // ── Speaker notes (#150 / ADR-0032): notes を持つスライドが 1 枚でもあるときだけ notesMaster を
  // 用意する。ノート無しデッキはこのブロック丸ごと素通り＝出力不変を構造的に担保。
  const hasNotes = deck.slides.some((s) => s.notes?.length);
  let notesMasterNum = 0;
  if (hasNotes) {
    const existingNm = Object.keys(zip.files)
      .map((p) => p.match(/^ppt\/notesMasters\/notesMaster(\d+)\.xml$/))
      .find(Boolean);
    if (existingNm) {
      notesMasterNum = parseInt(existingNm[1]);
    } else {
      // notesMaster はテーマ参照が必須。既存テーマを複製して専用テーマ番号を与える
      // （slideMaster とのテーマ共有は厳格バリデータで弾かれ得るため）。
      const themeNums = Object.keys(zip.files)
        .map((p) => p.match(/^ppt\/theme\/theme(\d+)\.xml$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => parseInt(m[1]));
      let themeTarget = "../theme/theme1.xml";
      if (themeNums.length > 0) {
        const srcTheme = await zip.file(`ppt/theme/theme${Math.min(...themeNums)}.xml`)!.async("string");
        const newThemeNum = Math.max(...themeNums) + 1;
        zip.file(`ppt/theme/theme${newThemeNum}.xml`, srcTheme);
        ctEntries.push(
          `<Override PartName="/ppt/theme/theme${newThemeNum}.xml"` +
            ` ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
        );
        themeTarget = `../theme/theme${newThemeNum}.xml`;
      }
      notesMasterNum = 1;
      zip.file("ppt/notesMasters/notesMaster1.xml", notesMasterXml());
      zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", notesMasterRels(themeTarget));
      ctEntries.push(
        `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${NOTES_MASTER_CT}"/>`,
      );
    }
  }

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
    const built = await buildSlideXml(layout, slide, sectionFooterFor(deck, i), opts.charts);
    const slideXml = built.xml;
    for (const f of built.figures) opts.onFigure?.(f);
    let linkRels = built.linkRels;
    for (const c of built.charts) {
      const w = writeNativeChart(zip, c.parts, ++chartNum, c.relId);
      linkRels += w.slideRel;
      ctEntries.push(w.ctOverride);
      mediaDefaults.set("xlsx", XLSX_CT);
    }

    // Embed each referenced image with its OWN rId (a behind backdrop can coexist with a mermaid PNG,
    // so they no longer share one slot). Mermaid SVG→PNG is rasterized by the injected UI-layer canvas.
    const imageRels: { rId: string; target: string }[] = [];
    for (const m of built.media) {
      if (m.source.kind === "mermaid") {
        if (!rasterizeSvg) continue;
        zip.file(`ppt/media/mermaid${slideNum}${m.suffix}.png`, await rasterizeSvg(m.source.svg));
        mediaDefaults.set("png", "image/png");
        imageRels.push({ rId: m.rId, target: `../media/mermaid${slideNum}${m.suffix}.png` });
      } else {
        const img = dataUriToImage(m.source.src)!; // planSlideFigures only plans decodable images
        zip.file(`ppt/media/image${slideNum}${m.suffix}.${img.ext}`, img.bytes);
        mediaDefaults.set(img.ext, img.mime);
        imageRels.push({ rId: m.rId, target: `../media/image${slideNum}${m.suffix}.${img.ext}` });
      }
    }

    // notes 付きスライドだけ notesSlide パートを生成（番号はスライド番号に一致させる）。
    const notesSlideNum = slide.notes?.length ? slideNum : undefined;
    if (notesSlideNum !== undefined) {
      const noteLinks = createLinkRegistry(NOTES_FIRST_LINK_RID);
      zip.file(`ppt/notesSlides/notesSlide${notesSlideNum}.xml`, notesSlideXml(slide.notes!, noteLinks.rIdFor));
      zip.file(
        `ppt/notesSlides/_rels/notesSlide${notesSlideNum}.xml.rels`,
        notesSlideRels(slideNum, notesMasterNum, noteLinks.relsXml()),
      );
      ctEntries.push(
        `<Override PartName="/ppt/notesSlides/notesSlide${notesSlideNum}.xml" ContentType="${NOTES_SLIDE_CT}"/>`,
      );
    }

    const slideRels = buildSlideRels(layout.index, imageRels, notesSlideNum, linkRels);

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

  // Speaker notes (#150): notesMaster への参照（IdLst＋rel）を保証する。既にテンプレが持つなら
  // 触らない。無ければ rel を新規採番して sldMasterIdLst の直後（スキーマ順）へ挿入する。
  if (hasNotes && !/<p:notesMasterIdLst[\s>]/.test(presXml)) {
    const existingNmRel = template.presentationRels.match(
      /<Relationship Id="(rId\d+)"[^>]*Type="[^"]*\/relationships\/notesMaster"[^>]*\/>/,
    );
    // nextRId here is already past every slide rel; no later allocation follows, so no increment.
    const nmRId = existingNmRel ? existingNmRel[1] : `rId${nextRId}`;
    if (!existingNmRel) {
      relEntries.push(
        `<Relationship Id="${nmRId}"` +
          ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster"` +
          ` Target="notesMasters/notesMaster${notesMasterNum}.xml"/>`,
      );
    }
    const nmIdLst = `<p:notesMasterIdLst><p:notesMasterId r:id="${nmRId}"/></p:notesMasterIdLst>`;
    presXml = /<\/p:sldMasterIdLst>/.test(presXml)
      ? presXml.replace("</p:sldMasterIdLst>", `</p:sldMasterIdLst>${nmIdLst}`)
      : presXml.replace(sldIdLstXml, `${nmIdLst}${sldIdLstXml}`);
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
  // テンプレ由来 notesSlide の Override も除去（パート本体は冒頭でパージ済み — #150）。
  ct = ct.replace(
    /<Override\b[^>]*PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g,
    "",
  );
  // Default Content-Types for any embedded media (mermaid PNG / pasted images) not already declared —
  // else PowerPoint rejects the image parts. Added HERE (not inline) so this rebuild can't clobber them.
  const mediaDefaultXml = [...mediaDefaults]
    .filter(([ext]) => !ct.includes(`Extension="${ext}"`))
    .map(([ext, mime]) => `<Default Extension="${ext}" ContentType="${mime}"/>`)
    .join("");
  ct = ct.replace(
    "</Types>",
    `${mediaDefaultXml}${ctEntries.join("")}</Types>`,
  );
  zip.file("[Content_Types].xml", ct);

  const buf = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  return buf;
}
