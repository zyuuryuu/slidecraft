/**
 * project-io.ts — save / open a SlideCraft PROJECT (the editable source of truth).
 *
 * A `.slidecraft` file is a self-contained zip:
 *   deck.json      — the DeckIR (lossless; the canonical serialization, NOT Markdown)
 *   template.pptx  — the template bytes (re-emitted from the retained TemplateData.zip)
 *   meta.json      — { version, templateName, savedAt }
 * Opening rebuilds the full editing state (deck + template) → no lossy round-trip
 * through Markdown/PPTX. The same deck.json is the unit a future Integration/MCP layer
 * passes in/out ([[primary-surface-deck]], ROADMAP "次の2課題").
 */

import JSZip from "jszip";
import { z } from "zod";
import { DeckIRSchema, type DeckIR } from "./slide-schema";
import { loadTemplate, type TemplateData } from "./template-loader";
import { loadZipSafe, readCappedString, readCappedBytes, readEntryString, ZIP_LIMITS } from "./zip-safe";

const PROJECT_VERSION = 1;

const ProjectMetaSchema = z.object({
  version: z.number(),
  templateName: z.string().max(200),
  savedAt: z.string().max(40),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

/** Bound the untrusted deck beyond zod's TYPE check (the deck.json byte cap already
 *  bounds total size; this rejects an absurd slide count cheaply). */
function assertDeckBounds(deck: DeckIR): void {
  if (deck.slides.length > ZIP_LIMITS.maxSlides) {
    throw new Error(`スライド数が多すぎます（${deck.slides.length} > ${ZIP_LIMITS.maxSlides}）`);
  }
}

/** Drop the render-only `svgCache` from every mermaidBlock of an UNTRUSTED deck.
 *  svgCache is a recomputable render cache (UI/export re-render it from `.mermaid`
 *  via mermaid's securityLevel:"strict"). A value PERSISTED in a hand-crafted
 *  deck.json is an XSS carrier: it reaches MermaidDirect's dangerouslySetInnerHTML
 *  (and the CSP-less HTML export) WITHOUT that sanitizing render. Stripping it on
 *  open forces a fresh, safe re-render. See ADR-0016 F2. */
function stripSvgCache(deck: DeckIR): DeckIR {
  return {
    ...deck,
    slides: deck.slides.map((s) =>
      s.mermaidBlock?.svgCache
        ? { ...s, mermaidBlock: { ...s.mermaidBlock, svgCache: undefined } }
        : s,
    ),
  };
}

/** Bundle the deck + its template into a `.slidecraft` zip (Uint8Array). */
export async function bundleProject(
  deck: DeckIR,
  template: TemplateData,
  opts: { templateName: string; savedAt: string },
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("deck.json", JSON.stringify(deck, null, 2));
  zip.file("template.pptx", await template.zip.generateAsync({ type: "uint8array" }));
  const meta: ProjectMeta = { version: PROJECT_VERSION, templateName: opts.templateName, savedAt: opts.savedAt };
  zip.file("meta.json", JSON.stringify(meta, null, 2));
  return zip.generateAsync({ type: "uint8array" });
}

/** Open a `.slidecraft` zip → the full editing state. Throws on a malformed bundle or a
 *  deck.json that doesn't match the current schema. */
export async function openProject(bytes: ArrayBuffer | Uint8Array): Promise<{ deck: DeckIR; template: TemplateData; meta: ProjectMeta }> {
  const zip = await loadZipSafe(bytes); // input-size + entry-count guard (cheap header parse)
  const deckFile = zip.file("deck.json");
  const tplFile = zip.file("template.pptx");
  if (!deckFile || !tplFile) {
    throw new Error("不正な .slidecraft ファイルです（deck.json / template.pptx が見つかりません）");
  }
  // Stream-capped decompression (zip-bomb safe) → schema validation → bounds.
  const parsed = DeckIRSchema.parse(JSON.parse(await readCappedString(deckFile, ZIP_LIMITS.deckJson)));
  assertDeckBounds(parsed);
  const deck = stripSvgCache(parsed); // untrusted svgCache is an XSS carrier — force fresh re-render (ADR-0016 F2)
  const template = await loadTemplate(await readCappedBytes(tplFile, ZIP_LIMITS.templatePptx));
  // meta is non-critical — validate, but fall back to defaults rather than reject the file.
  let meta: ProjectMeta = { version: 0, templateName: "", savedAt: "" };
  try {
    const parsed = ProjectMetaSchema.safeParse(JSON.parse((await readEntryString(zip, "meta.json", 64 * 1024)) || "{}"));
    if (parsed.success) meta = parsed.data;
  } catch { /* malformed meta.json → keep defaults, still open the deck */ }
  return { deck, template, meta };
}
