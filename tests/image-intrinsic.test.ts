/**
 * image-intrinsic.test.ts — Issue #417: an embedded image's natural pixel size read from the data URI
 * header (pure, R2). It is what an image with no `{ar=…}` uses for its aspect, so the PPTX export
 * letterboxes it exactly like the browser preview's `object-fit: contain` (which knows the real size).
 * Unknown / unreadable formats (SVG, truncated bytes, a path src) → undefined (the caller stretches).
 */
import { describe, it, expect } from "vitest";
import { intrinsicImageSize } from "../src/engine/image-intrinsic";

const uri = (mime: string, bytes: number[] | Uint8Array) =>
  `data:${mime};base64,${Buffer.from(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)).toString("base64")}`;
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function png(w: number, h: number): number[] {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0];
}
/** SOI, APP0 (JFIF), an optional big APP1 (EXIF-like padding), a DHT (FFC4 — NOT a frame header), then
 *  the SOFn frame header carrying height/width. */
function jpeg(w: number, h: number, sof = 0xc0, app1Pad = 0): number[] {
  const seg = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
  return [
    0xff, 0xd8,
    ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(app1Pad ? seg(0xe1, new Array(app1Pad).fill(0)) : []),
    ...seg(0xc4, [0, ...new Array(16).fill(0)]),
    ...seg(sof, [8, ...be16(h), ...be16(w), 1, 1, 0x11, 0]),
    0xff, 0xd9,
  ];
}

describe("intrinsicImageSize", () => {
  it("PNG: IHDR width/height", () => {
    expect(intrinsicImageSize(uri("image/png", png(800, 500)))).toEqual({ w: 800, h: 500 });
  });

  it("JPEG: baseline (SOF0) and progressive (SOF2), skipping DHT (FFC4)", () => {
    expect(intrinsicImageSize(uri("image/jpeg", jpeg(640, 480)))).toEqual({ w: 640, h: 480 });
    expect(intrinsicImageSize(uri("image/jpeg", jpeg(300, 900, 0xc2)))).toEqual({ w: 300, h: 900 });
  });

  it("JPEG: a frame header behind a large EXIF/APP1 segment is still found", () => {
    expect(intrinsicImageSize(uri("image/jpeg", jpeg(1920, 1080, 0xc0, 60000)))).toEqual({ w: 1920, h: 1080 });
  });

  it("GIF: logical screen size (little-endian)", () => {
    expect(intrinsicImageSize(uri("image/gif", [...ascii("GIF89a"), ...le16(320), ...le16(200), 0, 0, 0]))).toEqual({ w: 320, h: 200 });
  });

  it("WebP: VP8X / VP8L / VP8 (lossy)", () => {
    const riff = (chunk: number[]) => [...ascii("RIFF"), ...le32(chunk.length + 4), ...ascii("WEBP"), ...chunk];
    const vp8x = riff([...ascii("VP8X"), ...le32(10), 0, 0, 0, 0, ...le24(1000 - 1), ...le24(250 - 1)]);
    expect(intrinsicImageSize(uri("image/webp", vp8x))).toEqual({ w: 1000, h: 250 });
    // VP8L: signature 0x2f then 14-bit (w-1) and 14-bit (h-1), little-endian bit order.
    const bits = (400 - 1) | ((300 - 1) << 14);
    const vp8l = riff([...ascii("VP8L"), ...le32(5), 0x2f, ...le32(bits)]);
    expect(intrinsicImageSize(uri("image/webp", vp8l))).toEqual({ w: 400, h: 300 });
    const vp8 = riff([...ascii("VP8 "), ...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(512), ...le16(256)]);
    expect(intrinsicImageSize(uri("image/webp", vp8))).toEqual({ w: 512, h: 256 });
  });

  it("BMP: width / |height| (a top-down BMP stores a negative height)", () => {
    const bmp = (h: number) => [...ascii("BM"), ...new Array(16).fill(0), ...le32(120), ...le32(h >>> 0), 0, 0];
    expect(intrinsicImageSize(uri("image/bmp", bmp(90)))).toEqual({ w: 120, h: 90 });
    expect(intrinsicImageSize(uri("image/bmp", bmp(-90)))).toEqual({ w: 120, h: 90 });
  });

  it("format is identified by the bytes, not the declared MIME", () => {
    expect(intrinsicImageSize(uri("image/jpeg", png(16, 9)))).toEqual({ w: 16, h: 9 });
  });

  it("whitespace inside the base64 payload is tolerated", () => {
    const u = uri("image/png", png(800, 500));
    const i = u.indexOf(",") + 1;
    expect(intrinsicImageSize(`${u.slice(0, i)}${u.slice(i).replace(/(.{8})/g, "$1\n")}`)).toEqual({ w: 800, h: 500 });
  });

  it("unreadable → undefined: SVG, truncated header, zero size, garbage, path src", () => {
    expect(intrinsicImageSize("data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"))).toBeUndefined();
    expect(intrinsicImageSize(uri("image/png", png(800, 500).slice(0, 20)))).toBeUndefined();
    expect(intrinsicImageSize(uri("image/jpeg", jpeg(640, 480).slice(0, 30)))).toBeUndefined();
    expect(intrinsicImageSize(uri("image/png", png(0, 500)))).toBeUndefined();
    expect(intrinsicImageSize("data:image/png;base64,!!!!")).toBeUndefined();
    expect(intrinsicImageSize("images/photo.png")).toBeUndefined();
    expect(intrinsicImageSize("data:image/png,rawnotbase64")).toBeUndefined();
  });
});
