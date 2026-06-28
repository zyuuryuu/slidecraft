/**
 * zip-safe.test.ts — the zip-bomb / oversize defenses for untrusted zip input.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readCappedBytes, loadZipSafe } from "../src/engine/zip-safe";

async function zipWith(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

describe("zip-safe (zip-bomb / oversize defense)", () => {
  it("readCappedBytes aborts when DECOMPRESSED output exceeds the cap (small-in/large-out)", async () => {
    // 200KB of one repeated char → compresses to a few bytes = a mini bomb.
    const loaded = await JSZip.loadAsync(await zipWith({ big: "A".repeat(200 * 1024) }));
    const file = loaded.file("big")!;
    await expect(readCappedBytes(file, 1024)).rejects.toThrow(/zip bomb|超過/);
    const ok = await readCappedBytes(file, 1024 * 1024); // generous cap → succeeds
    expect(ok.length).toBe(200 * 1024);
  });

  it("loadZipSafe rejects an oversized input file", async () => {
    await expect(loadZipSafe(await zipWith({ a: "x" }), { maxInputBytes: 10 })).rejects.toThrow(/大きすぎ/);
  });

  it("loadZipSafe rejects a zip with too many entries", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[`f${i}`] = "x";
    await expect(loadZipSafe(await zipWith(files), { maxEntries: 10 })).rejects.toThrow(/多すぎ/);
  });
});
