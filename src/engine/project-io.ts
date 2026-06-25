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
import { DeckIRSchema, type DeckIR } from "./slide-schema";
import { loadTemplate, type TemplateData } from "./template-loader";

const PROJECT_VERSION = 1;

export interface ProjectMeta {
  version: number;
  templateName: string;
  savedAt: string; // ISO timestamp
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
  const zip = await JSZip.loadAsync(bytes);
  const deckFile = zip.file("deck.json");
  const tplFile = zip.file("template.pptx");
  if (!deckFile || !tplFile) {
    throw new Error("不正な .slidecraft ファイルです（deck.json / template.pptx が見つかりません）");
  }
  const deck = DeckIRSchema.parse(JSON.parse(await deckFile.async("string")));
  const template = await loadTemplate(await tplFile.async("arraybuffer"));
  const metaFile = zip.file("meta.json");
  const meta: ProjectMeta = metaFile
    ? (JSON.parse(await metaFile.async("string")) as ProjectMeta)
    : { version: 0, templateName: "", savedAt: "" };
  return { deck, template, meta };
}
