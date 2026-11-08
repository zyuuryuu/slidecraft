/**
 * slide-figure-ooxml.ts — the VISUALS of one exported slide (#392 段 2): which figure is drawn where, as
 * what, with which media relationship. Split out of placeholder-filler.buildSlideXml (R1), which now asks
 * this module for the figure plan and its XML pieces while keeping the slide's paint ORDER.
 *
 * Every placement comes from figureRegions (figure-placement + visual-placement, R8) — the same resolution
 * the preview, the editor overlay and deck-diagnostics read — so a figure lands in the same box everywhere
 * and is drawn iff it is not reported unbound.
 *
 * Relationship ids: the FIRST mermaid PNG / image keep the historical rId2 / rId3 (a single-visual slide is
 * byte-identical); each further one gets a name-spaced id (rIdMermaid2, rIdImage2 …), the same convention as
 * the native chart's rIdChart — never colliding with notes (rId4) or hyperlinks (rId5…).
 *
 * Pure logic (R2): no DOM / Tauri.
 */
import { loadYaml } from "./yaml-io";
import type { SlideIR, ImageBlock, ImageRect, TableBlock } from "./slide-schema";
import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import type { PlaceholderInfo } from "./template-loader";
import { figureRegions, figureAt, imagePlaceholder, imageRect, drawnImage, type FigureRegion } from "./visual-placement";
import { imageCaption, imageCaptionShapeXml, imageDescrAttr } from "./image-caption";
import { paintToShapeXml } from "./pptx-writer";
import { paintDiagram } from "./diagram-painter";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./mermaid-to-diagram";
import { midnightExecutive } from "./theme";

type Box = { x: number; y: number; w: number; h: number };
const EMU = (inches: number) => Math.round(inches * 914400);

/** One embedded media part of the slide: what to write, and the rel id the slide XML references. */
export interface SlideMedia {
  rId: string;
  /** File-name suffix after the slide number: "" for the first of its kind, "_2", "_3" … after. */
  suffix: string;
  source: { kind: "mermaid"; svg: string } | { kind: "image"; src: string };
}

/** A diagram to paint as shapes / a native chart: a ```diagram, or a ```mermaid whose type has a native
 *  DiagramSpec form (exported as editable shapes, matching the preview). `region` undefined = solo. */
export interface DiagramDraw { yaml: string; region?: Box }

export interface SlideFigurePlan {
  /** placeholder idx → the visual drawn there (the placeholder shape is skipped, or filled for code). */
  occupied: Map<string, FigureRegion>;
  behind?: { image: ImageBlock; box: ImageRect; rId: string };
  mermaidPics: { box: Box; rId: string }[];
  images: { image: ImageBlock; box: ImageRect; captionColor?: string; rId: string }[];
  diagrams: DiagramDraw[];
  tables: { table: TableBlock; box: PlaceholderInfo["style"] }[];
  media: SlideMedia[];
}

/** Parse a base64 image data URI → bytes + ext + mime for OOXML media embedding. Returns null for a
 *  non-base64 data URI or a path src (those aren't embedded — no <p:pic> is emitted for them). */
export function dataUriToImage(src: string): { bytes: Uint8Array; ext: string; mime: string } | null {
  const m = src.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const sub = mime.slice("image/".length);
  const ext = sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub; // png/gif/webp/bmp pass through
  try {
    const bin = atob(m[2].replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext, mime };
  } catch {
    return null;
  }
}

/** The slide's figure plan on `layout` (see module doc). */
export function planSlideFigures(slide: SlideIR, layoutPhs: readonly PlaceholderInfo[]): SlideFigurePlan {
  const regions = figureRegions(slide, layoutPhs);
  const plan: SlideFigurePlan = { occupied: figureAt(slide, layoutPhs), mermaidPics: [], images: [], diagrams: [], tables: [], media: [] };
  // Media rel ids, numbered per kind in draw order (the 1st mermaid PNG = rId2, then the 1st image).
  const mermaidRId = (k: number) => (k === 0 ? "rId2" : `rIdMermaid${k + 1}`);
  const suffix = (k: number) => (k === 0 ? "" : `_${k + 1}`);

  for (const r of regions) {
    const f = r.figure;
    const region = r.solo ? undefined : r.ph?.style;
    const drawn = r.solo || !!r.ph; // a region-bound visual without a region is not drawn (unboundVisuals)
    if (f.kind === "diagram") {
      if (drawn) plan.diagrams.push({ yaml: f.yaml, region });
    } else if (f.kind === "mermaid") {
      const native = mermaidToDiagramSpec(f.mermaid);
      if (native) {
        if (drawn) plan.diagrams.push({ yaml: diagramSpecToYaml(native), region });
      } else if (f.svgCache && r.ph) {
        const k = plan.mermaidPics.length;
        plan.mermaidPics.push({ box: r.ph.style, rId: mermaidRId(k) });
        plan.media.push({ rId: mermaidRId(k), suffix: suffix(k), source: { kind: "mermaid", svg: f.svgCache } });
      }
    } else if (f.kind === "table") {
      if (r.ph) plan.tables.push({ table: f, box: r.ph.style });
    }
  }

  // Images: rId2 after no mermaid PNG, else rId3 (the historical pair); further images name-spaced.
  const imageRId = (k: number) => (k > 0 ? `rIdImage${k + 1}` : plan.mermaidPics.length ? "rId3" : "rId2");
  const pushImage = (image: ImageBlock, ph: PlaceholderInfo | undefined, behind: boolean) => {
    const box = imageRect(image, ph);
    if (!box || !dataUriToImage(image.src)) return;
    const k = plan.images.length + (plan.behind ? 1 : 0);
    if (behind) plan.behind = { image, box, rId: imageRId(k) };
    else plan.images.push({ image, box, captionColor: ph?.style.fontColor, rId: imageRId(k) });
    plan.media.push({ rId: imageRId(k), suffix: suffix(k), source: { kind: "image", src: image.src } });
  };
  // A BEHIND image is a backmost layer bound to no placeholder; it rides its placeholder's box.
  if (slide.image?.behind) pushImage(slide.image, imagePlaceholder(layoutPhs, slide.image.placeholderIdx), true);
  for (const r of regions) if (r.figure.kind === "image" && r.ph) pushImage(r.figure, r.ph, false);
  return plan;
}

/** An embedded image <p:pic>, fitted into its box the same way the browser preview does (contain /
 *  cover) so preview and export agree — the manual rect / placeholder box, then the aspect math. */
export function imagePicXml(shapeId: number, image: ImageBlock, box: ImageRect, rId: string): string {
  const { rect: r, srcRect: cr } = drawnImage(image, box);
  const srcRectXml = cr
    ? `<a:srcRect${cr.l ? ` l="${cr.l}"` : ""}${cr.t ? ` t="${cr.t}"` : ""}${cr.r ? ` r="${cr.r}"` : ""}${cr.b ? ` b="${cr.b}"` : ""}/>`
    : "";
  return `<p:pic>`
    + `<p:nvPicPr><p:cNvPr id="${shapeId}" name="Image"${imageDescrAttr(image.alt)}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rId}"/>${srcRectXml}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${EMU(r.x)}" y="${EMU(r.y)}"/><a:ext cx="${EMU(r.w)}" cy="${EMU(r.h)}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>`
    + `</p:pic>`;
}

/** A rasterized Mermaid PNG <p:pic> stretched over its body region. */
export function mermaidPicXml(shapeId: number, s: Box, rId: string): string {
  return `<p:pic>`
    + `<p:nvPicPr><p:cNvPr id="${shapeId}" name="MermaidImage"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rId}"/>`
    + `<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm>`
    + `<a:off x="${EMU(s.x)}" y="${EMU(s.y)}"/>`
    + `<a:ext cx="${EMU(s.w)}" cy="${EMU(s.h)}"/>`
    + `</a:xfrm><a:prstGeom prst="rect"/></p:spPr>`
    + `</p:pic>`;
}

/** An image <p:pic> plus its alt caption (#399) directly under the drawn image — the preview's geometry. */
export function imageWithCaptionXml(shapeId: number, img: SlideFigurePlan["images"][number]): { xml: string; next: number } {
  let xml = imagePicXml(shapeId, img.image, img.box, img.rId);
  let id = shapeId + 1;
  const caption = imageCaption(img.image, img.box, img.captionColor);
  if (caption) { xml += imageCaptionShapeXml(id, caption); id++; }
  return { xml, next: id };
}

/** A diagram's PptxGenJS shapes as slide XML. Embedded in a titled slide → the diagram omits its own title
 *  bar so it doesn't duplicate / overlap the slide's title placeholder. When `region` is given (a diagram
 *  beside body text or another figure), the shapes are confined to that placeholder box. The shapes are
 *  nested into PowerPoint sub-groups (figure = one object; node/edge = grabbable parts). */
export async function extractDiagramShapes(diagramYaml: string, region?: Box): Promise<string> {
  const data = loadYaml(diagramYaml);
  const result = DiagramSpecSchema.safeParse(data);
  if (!result.success) {
    throw new Error("Invalid diagram YAML: " + result.error.issues[0]?.message);
  }
  const spec: DiagramSpec = result.data;
  const theme = midnightExecutive();
  return paintToShapeXml((t) => paintDiagram(t, spec, { theme, omitTitle: true, region }));
}
