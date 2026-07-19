/**
 * font-subsetter.ts — runtime CJK font subsetting via WASM harfbuzz (hb-subset)
 * (#193 / #115-b / #194). Orchestrator layer (async/WASM allowed, R2 keeps this out of src/engine/).
 *
 * Given a full source font (Noto Sans/Serif JP Regular/Bold — bundled as app assets, #193 asset
 * half) and the deck's actually-used text, returns a raw sfnt (TTF/OpenType) buffer containing ONLY
 * the glyphs the deck needs (typically tens of KB instead of the multi-MB source). harfbuzz drops
 * codepoints that aren't in the source font rather than failing, so unknown characters (emoji, rare
 * glyphs) simply aren't in the subset — the caller's CSS font-family fallback chain (font-stack.ts /
 * #192) takes over for those runs. This function only rejects for a genuinely unusable input
 * (e.g. a corrupt font buffer); callers should treat any rejection as "skip embedding, keep
 * relying on the fallback stack" (do-no-harm — embedding is additive, never load-bearing).
 *
 * No WOFF2 compression step: an earlier version piped the subset through `wawoff2`, but that
 * package's legacy Emscripten glue hangs forever (never resolves, never rejects) when it's actually
 * loaded through Vite's browser dep-optimizer — confirmed in a real Chromium session and in CI's e2e
 * job (#194 was the first caller to ever exercise this path outside vitest/Node, where the same glue
 * happens to init synchronously enough to dodge the race). The package is unmaintained since 2022
 * with no fix available. Embedding the raw subsetted sfnt directly via `format("truetype")` sidesteps
 * the broken dependency entirely — every browser has supported raw TTF `@font-face` embedding since
 * long before WOFF2 existed, and since subsetting already strips the font down to only the deck's
 * used glyphs, the size difference vs. WOFF2 compression is modest (tens of KB either way).
 */

// hb-subset.wasm ships as a plain binary in the harfbuzzjs package (no JS wrapper needed for
// subsetting — only the raw C-ABI exports below). Vite's built-in `?init` wasm handling resolves
// this correctly under the dev server, the production build, AND vitest's Vite-powered SSR
// transform (which reads the file straight off disk instead of fetching a URL) — so the SAME
// import works in tests, dev, and the packaged app without an environment branch here.
import initHbSubsetWasm from "harfbuzzjs/hb-subset.wasm?init";

// HB_MEMORY_MODE_WRITABLE (harfbuzz's hb-blob.h) — the wasm heap copy we hand to hb_blob_create
// may be mutated/freed by harfbuzz itself.
const HB_MEMORY_MODE_WRITABLE = 2;
// HB_SUBSET_SETS_LAYOUT_FEATURE_TAG (harfbuzz's hb-subset.h) — used to keep all OpenType layout
// features (equivalent to hb-subset CLI's `--font-features=*`).
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

/** 4-byte OpenType tag → the uint32 harfbuzz's C API expects (e.g. hb_tag_t HB_TAG('w','g','h','t')). */
function hbTag(tag: string): number {
  return tag.split("").reduce((acc, ch) => (acc << 8) + ch.charCodeAt(0), 0);
}

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_set(input: number, setType: number): number;
  hb_subset_input_unicode_set(input: number): number;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_set_add(set: number, value: number): void;
  hb_subset_input_pin_axis_location(input: number, face: number, axisTag: number, value: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

export interface SubsetOptions {
  /** Pin a variable font's `wght` axis to this value (e.g. 400 for Regular, 700 for Bold) before
   *  subsetting, so the result is a static-weight font instead of inheriting whatever instance the
   *  source font defaults to. Ignored (harmless) if the source font isn't a variable font / has no
   *  `wght` axis. */
  wght?: number;
}

let hbPromise: Promise<HbExports> | null = null;

async function loadHarfbuzz(): Promise<HbExports> {
  if (!hbPromise) {
    hbPromise = initHbSubsetWasm({}).then(
      (instance) => instance.exports as unknown as HbExports,
      (err) => {
        hbPromise = null; // let a later call retry instead of caching a permanent failure
        throw err;
      },
    );
  }
  return hbPromise;
}

/** Subset `sourceFont` down to the glyphs required to render `text`, returned as raw sfnt (TTF)
 *  bytes — no WOFF2 compression (see file header for why). Rejects only on a structurally-invalid
 *  source font or WASM init failure — never on characters in `text` that the font doesn't contain
 *  (those are simply excluded from the result). */
export async function subsetFontToTtf(sourceFont: Uint8Array, text: string, opts: SubsetOptions = {}): Promise<Uint8Array> {
  const hb = await loadHarfbuzz();
  const heap = () => new Uint8Array(hb.memory.buffer);

  const fontPtr = hb.malloc(sourceFont.byteLength);
  heap().set(sourceFont, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, sourceFont.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) {
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
    throw new Error("hb_subset_input_create_or_fail returned 0 (harfbuzz init failure)");
  }

  if (opts.wght != null) {
    hb.hb_subset_input_pin_axis_location(input, face, hbTag("wght"), opts.wght);
  }

  // Keep every OpenType layout feature (ligatures, vertical forms, etc.) — equivalent to
  // hb-subset's `--font-features=*`.
  const layoutFeatures = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
  hb.hb_set_clear(layoutFeatures);
  hb.hb_set_invert(layoutFeatures);

  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const ch of text) hb.hb_set_add(unicodes, ch.codePointAt(0)!);

  let subsetFace = 0;
  let sfntBuffer: Uint8Array;
  try {
    subsetFace = hb.hb_subset_or_fail(face, input);
    if (subsetFace === 0) {
      throw new Error("hb_subset_or_fail returned 0 — source font may be corrupt or unsupported");
    }

    const resultBlob = hb.hb_face_reference_blob(subsetFace);
    try {
      const offset = hb.hb_blob_get_data(resultBlob, 0);
      const length = hb.hb_blob_get_length(resultBlob);
      if (length === 0) throw new Error("harfbuzz produced an empty subset blob");
      sfntBuffer = heap().slice(offset, offset + length);
    } finally {
      hb.hb_blob_destroy(resultBlob);
    }
  } finally {
    hb.hb_subset_input_destroy(input);
    if (subsetFace !== 0) hb.hb_face_destroy(subsetFace);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }

  return sfntBuffer;
}
