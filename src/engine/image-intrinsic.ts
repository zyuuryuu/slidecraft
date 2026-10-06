/**
 * image-intrinsic.ts — an embedded image's natural pixel size, read from the first bytes of its
 * base64 data URI (#417).
 *
 * An image written without `{ar=…}` (hand-written / AI / MCP markdown) has no measured aspect. The
 * browser preview still knows its real size (`object-fit` letterboxes it), but the PPTX export did
 * not — `<a:stretch>` filled the box and distorted it. This gives the export (and every other
 * consumer, via visual-placement's resolvedImageAspect) the same natural size the browser uses.
 *
 * The format is identified by its magic bytes, not the declared MIME: PNG (IHDR), JPEG (SOFn frame
 * header), GIF (logical screen), WebP (VP8X / VP8L / VP8) and BMP. Anything else — SVG, a truncated
 * or corrupt header, a path src — is undefined, and the caller keeps its stretch behavior.
 *
 * Only the bytes needed are decoded (a 3-byte group per 4 base64 chars, so any prefix decodes on its
 * own) — the header of a multi-MB photo, not the photo. Not considered: JPEG EXIF orientation (the raw
 * frame size is returned).
 *
 * Pure logic (R2).
 */

export interface PixelSize {
  w: number;
  h: number;
}

/** A JPEG may carry large APPn (EXIF/ICC) segments before its frame header — read at most this far. */
const JPEG_SCAN_LIMIT = 1 << 20;

/** The decodable prefix of a base64 payload: `bytes(n)` returns (at least) its first n bytes, or fewer
 *  when the payload is shorter / undecodable. */
function base64Prefix(payload: string): (n: number) => Uint8Array {
  let cache = new Uint8Array(0);
  return (n: number) => {
    if (cache.length >= n) return cache;
    const chars = Math.ceil(n / 3) * 4;
    // Strip whitespace (wrapped base64) from a growing PREFIX only — never copy the whole payload.
    let take = chars;
    let s = payload.slice(0, take).replace(/\s/g, "");
    while (s.length < chars && take < payload.length) {
      take = Math.min(payload.length, take * 2);
      s = payload.slice(0, take).replace(/\s/g, "");
    }
    try {
      const bin = atob(s.slice(0, chars));
      cache = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) cache[i] = bin.charCodeAt(i);
    } catch {
      cache = new Uint8Array(0);
    }
    return cache;
  };
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const tag = (b: Uint8Array, o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));

function png(b: Uint8Array): PixelSize | undefined {
  if (b.length < 24 || !tag(b, 12, "IHDR")) return undefined;
  return { w: u32be(b, 16), h: u32be(b, 20) };
}

/** Walk the marker segments to the first SOFn frame header (FFC0–FFCF minus DHT C4 / JPG C8 / DAC CC). */
function jpeg(bytes: (n: number) => Uint8Array): PixelSize | undefined {
  let b = bytes(4096);
  let o = 2;
  for (;;) {
    if (o + 9 > b.length) {
      if (o + 9 > JPEG_SCAN_LIMIT) return undefined;
      const more = bytes(Math.min(JPEG_SCAN_LIMIT, Math.max(o + 9, b.length * 2)));
      if (more.length <= b.length) return undefined; // payload exhausted
      b = more;
      continue;
    }
    if (b[o] !== 0xff) return undefined;
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; } // fill byte
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(b, o + 7), h: u16be(b, o + 5) };
    if (m === 0xd9 || m === 0xda) return undefined; // EOI / start of scan — no frame header before it
    o += 2 + u16be(b, o + 2);
  }
}

function webp(b: Uint8Array): PixelSize | undefined {
  if (b.length < 25 || !tag(b, 8, "WEBP")) return undefined;
  if (tag(b, 12, "VP8X") && b.length >= 30) return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  if (tag(b, 12, "VP8L") && b[20] === 0x2f) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (tag(b, 12, "VP8 ") && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  return undefined;
}

/** The natural pixel size of a base64 data-URI image, or undefined when it can't be read. */
export function intrinsicImageSize(src: string): PixelSize | undefined {
  const head = src.slice(0, 128).match(/^data:image\/[a-z0-9.+-]+;base64,/i);
  if (!head) return undefined;
  const bytes = base64Prefix(src.slice(head[0].length));
  const b = bytes(32);
  let size: PixelSize | undefined;
  if (b[0] === 0x89 && tag(b, 1, "PNG")) size = png(b);
  else if (b[0] === 0xff && b[1] === 0xd8) size = jpeg(bytes);
  else if (tag(b, 0, "GIF8") && b.length >= 10) size = { w: u16le(b, 6), h: u16le(b, 8) };
  else if (tag(b, 0, "RIFF")) size = webp(b);
  else if (tag(b, 0, "BM") && b.length >= 26) size = { w: i32le(b, 18), h: Math.abs(i32le(b, 22)) };
  return size && size.w > 0 && size.h > 0 ? size : undefined;
}
