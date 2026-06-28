/**
 * zip-safe.ts — hardened zip reads for UNTRUSTED input (.slidecraft, .pptx templates).
 *
 * The real zip-bomb defense is here: `readCappedBytes` STREAM-decompresses one entry and
 * aborts the instant the OUTPUT exceeds the cap — so a small-in/huge-out bomb is caught
 * with memory bounded to the cap, even if the entry's declared size lies. (Checking size
 * AFTER `.async()` is too late: JSZip has already inflated the whole thing into memory.)
 * `loadZipSafe` guards the input byte size + entry count up front (header parse is cheap).
 *
 * Pure logic (R2): no DOM / Tauri. JSZip only.
 */

import JSZip from "jszip";

const MB = 1024 * 1024;

/** Tunable guards. Decompressed caps are the real defense; the input cap is a coarse
 *  outer guard. Bump these when in-slide image embedding lands (decks grow then). */
export const ZIP_LIMITS = {
  inputBytes: 100 * MB, // coarse: don't even load an absurd file
  entries: 5000, // total entries in a bundle / pptx
  deckJson: 32 * MB, // decompressed deck.json (text → small)
  templatePptx: 128 * MB, // decompressed template.pptx (images)
  xmlEntry: 32 * MB, // a single XML part inside a pptx
  maxSlides: 2000, // a sane upper bound on a deck
};

/** JSZip's `internalStream` is a real runtime API but missing from @types/jszip — a
 *  precise local interface (no `any`) lets us use it type-safely. */
interface ZipStream {
  on(event: "data", cb: (chunk: Uint8Array) => void): ZipStream;
  on(event: "error", cb: (e: Error) => void): ZipStream;
  on(event: "end", cb: () => void): ZipStream;
  resume(): ZipStream;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Stream-decompress one entry, rejecting the moment the output exceeds maxBytes. */
export function readCappedBytes(file: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const stream = (file as unknown as { internalStream(type: "uint8array"): ZipStream }).internalStream("uint8array");
    stream
      .on("data", (chunk: Uint8Array) => {
        total += chunk.length;
        if (total > maxBytes) {
          reject(new Error(`展開サイズが上限(${maxBytes} bytes)を超過しました — zip bomb の可能性`));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (e: Error) => reject(e))
      .on("end", () => resolve(concat(chunks, total)))
      .resume();
  });
}

export async function readCappedString(file: JSZip.JSZipObject, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readCappedBytes(file, maxBytes));
}

/** Read a named entry as a capped string ("" if the entry is absent). */
export async function readEntryString(zip: JSZip, path: string, maxBytes: number): Promise<string> {
  const file = zip.file(path);
  return file ? readCappedString(file, maxBytes) : "";
}

/** Parse a zip's structure (cheap header parse, NO decompression) with an input-size +
 *  entry-count guard. Use the returned JSZip only via the capped readers above. */
export async function loadZipSafe(
  bytes: ArrayBuffer | Uint8Array,
  opts?: { maxInputBytes?: number; maxEntries?: number },
): Promise<JSZip> {
  const len = bytes.byteLength;
  const maxInput = opts?.maxInputBytes ?? ZIP_LIMITS.inputBytes;
  if (len > maxInput) throw new Error(`ファイルが大きすぎます（${len} > ${maxInput} bytes）`);
  const zip = await JSZip.loadAsync(bytes);
  const maxEntries = opts?.maxEntries ?? ZIP_LIMITS.entries;
  const count = Object.keys(zip.files).length;
  if (count > maxEntries) throw new Error(`zip エントリが多すぎます（${count} > ${maxEntries}）`);
  return zip;
}
