/**
 * project-io.ts — save / open a SlideCraft PROJECT (the editable source of truth).
 *
 * A `.scft` file is a self-contained zip:
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

/** The `.scft` format version this build writes and reads natively (meta.json.version).
 *  Bump it ONLY together with a `PROJECT_MIGRATIONS[old]` step so older files stay openable. */
export const PROJECT_VERSION = 1;

/** Why a `.scft` was refused on its meta.json.version (#121). `code` is stable for callers/tests;
 *  `message` is the user-facing text shown by the existing never-silent open-error path. */
export type ProjectVersionErrorCode = "PROJECT_VERSION_TOO_NEW" | "PROJECT_VERSION_UNSUPPORTED";

export class ProjectVersionError extends Error {
  readonly code: ProjectVersionErrorCode;
  readonly fileVersion: number;
  readonly supportedVersion: number;
  constructor(code: ProjectVersionErrorCode, fileVersion: number, supportedVersion: number) {
    super(
      code === "PROJECT_VERSION_TOO_NEW"
        ? `このファイルは新しいバージョンの SlideCraft で作成されています（ファイル形式 v${fileVersion} ＞ 対応 v${supportedVersion}）。アプリを更新してから開いてください`
        : `このファイルの形式（v${fileVersion}）はこのバージョンの SlideCraft では開けません（対応 v${supportedVersion}・移行手段がありません）`,
    );
    this.name = "ProjectVersionError";
    this.code = code;
    this.fileVersion = fileVersion;
    this.supportedVersion = supportedVersion;
  }
}

/** One step per OLD version: `PROJECT_MIGRATIONS[v]` converts a raw (pre-zod) deck.json of
 *  version v into version v+1. Empty today — v1 is the first format; add a step when bumping. */
export type ProjectMigrations = Readonly<Record<number, (rawDeck: unknown) => unknown>>;
export const PROJECT_MIGRATIONS: ProjectMigrations = {};

/** Bring a raw deck.json of `fileVersion` up to `current` (pure; #121). Same version → the input
 *  itself. Newer than `current`, or any missing step in the chain → ProjectVersionError (never a
 *  silent fallback, never a partial migration). Non-integer versions never count as current. */
export function migrateProjectDeck(
  rawDeck: unknown,
  fileVersion: number,
  current: number = PROJECT_VERSION,
  migrations: ProjectMigrations = PROJECT_MIGRATIONS,
): unknown {
  if (fileVersion === current) return rawDeck;
  if (fileVersion > current) throw new ProjectVersionError("PROJECT_VERSION_TOO_NEW", fileVersion, current);
  if (!Number.isInteger(fileVersion)) throw new ProjectVersionError("PROJECT_VERSION_UNSUPPORTED", fileVersion, current);
  const steps: Array<(d: unknown) => unknown> = [];
  for (let v = fileVersion; v < current; v++) {
    const step = Object.prototype.hasOwnProperty.call(migrations, v) ? migrations[v] : undefined;
    if (!step) throw new ProjectVersionError("PROJECT_VERSION_UNSUPPORTED", fileVersion, current);
    steps.push(step);
  }
  return steps.reduce((d, step) => step(d), rawDeck);
}

/** The project file extension (no dot). One constant so the picker, save name, and
 *  the OS file-association / launch-open path can never drift apart. */
export const PROJECT_EXT = "scft";

/** Derive a document title from a project file's name/path by stripping the `.scft`
 *  extension (case-insensitive). Shared by the "open" dialog and the launch-open
 *  (double-click a .scft) path so both name the tab identically. Accepts a full path
 *  or a bare name; returns the last path segment sans extension. */
export function projectTitleFromFileName(nameOrPath: string): string {
  const base = nameOrPath.split(/[\\/]/).pop() ?? nameOrPath;
  return base.replace(new RegExp(`\\.${PROJECT_EXT}$`, "i"), "");
}

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

/** Bundle the deck + its template into a `.scft` zip (Uint8Array). */
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

/** Open a `.scft` zip → the full editing state. Throws on a malformed bundle, on a meta.json
 *  version this build can't open (ProjectVersionError, #121), or on a deck.json that doesn't match
 *  the current schema (after migration). */
export async function openProject(bytes: ArrayBuffer | Uint8Array): Promise<{ deck: DeckIR; template: TemplateData; meta: ProjectMeta }> {
  const zip = await loadZipSafe(bytes); // input-size + entry-count guard (cheap header parse)
  const deckFile = zip.file("deck.json");
  const tplFile = zip.file("template.pptx");
  if (!deckFile || !tplFile) {
    throw new Error("不正な .scft ファイルです（deck.json / template.pptx が見つかりません）");
  }
  // meta is read FIRST so the version gate (migrateProjectDeck) runs before deck.json schema validation (a newer app's
  // deck shape must surface as "update the app", not a cryptic zod error).
  // A corrupt / missing meta.json is non-critical — keep defaults and open as the current format
  // (pre-#121 behaviour); only a VALID meta's version is gated.
  let meta: ProjectMeta = { version: 0, templateName: "", savedAt: "" };
  let fileVersion = PROJECT_VERSION;
  try {
    const parsedMeta = ProjectMetaSchema.safeParse(JSON.parse((await readEntryString(zip, "meta.json", 64 * 1024)) || "{}"));
    if (parsedMeta.success) { meta = parsedMeta.data; fileVersion = meta.version; }
  } catch { /* malformed meta.json → keep defaults, still open the deck */ }
  // Stream-capped decompression (zip-bomb safe) → version gate/migration → schema validation → bounds.
  const rawDeck = JSON.parse(await readCappedString(deckFile, ZIP_LIMITS.deckJson));
  const parsed = DeckIRSchema.parse(migrateProjectDeck(rawDeck, fileVersion));
  assertDeckBounds(parsed);
  const deck = stripSvgCache(parsed); // untrusted svgCache is an XSS carrier — force fresh re-render (ADR-0016 F2)
  const template = await loadTemplate(await readCappedBytes(tplFile, ZIP_LIMITS.templatePptx));
  return { deck, template, meta };
}
