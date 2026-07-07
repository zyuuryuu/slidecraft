/**
 * image-src-security.test.ts — M6 (ADR-0016 addendum): embedded-image src must be a self-contained
 * data:image URI within a size cap. Before this, ImageBlockSchema.src was z.string(), so a Markdown
 * import or an MCP text mutation could persist `javascript:` / remote / `file:` into a rendered
 * <img src> and the exported HTML (stored XSS) or a giant data-URI (DoS). Two layers: the parser DROPS
 * an unsafe src (graceful — the line becomes text), and the schema REJECTS it (never-silent backstop).
 */
import { describe, it, expect } from "vitest";
import { isSafeImageSrc, ImageBlockSchema, MAX_IMAGE_DATA_URI } from "../src/engine/slide-schema";
import { parseMd } from "../src/engine/md-parser";

const DATA = "data:image/png;base64,AAAA";

describe("isSafeImageSrc (M6 XSS / DoS)", () => {
  it("accepts a data:image URI within the size cap (any image subtype)", () => {
    expect(isSafeImageSrc(DATA)).toBe(true);
    expect(isSafeImageSrc("data:image/jpeg;base64,/9j/AA")).toBe(true);
    expect(isSafeImageSrc("data:image/svg+xml;utf8,<svg/>")).toBe(true); // safe in <img> context (no script exec)
  });

  it("rejects javascript:/remote/file:/text-html/relative and oversize", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "http://evil.example/x.png",
      "https://evil.example/x.png",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "data:application/octet-stream;base64,AAAA",
      "assets/x.png",
      "vbscript:msgbox(1)",
      "",
    ]) {
      expect(isSafeImageSrc(bad), bad).toBe(false);
    }
    expect(isSafeImageSrc("data:image/png;base64," + "A".repeat(MAX_IMAGE_DATA_URI))).toBe(false);
  });
});

describe("ImageBlockSchema.src backstop (never-silent on a tampered deck)", () => {
  it("rejects an unsafe src and accepts a data:image src", () => {
    expect(ImageBlockSchema.safeParse({ src: "javascript:alert(1)" }).success).toBe(false);
    expect(ImageBlockSchema.safeParse({ src: "http://evil/x.png" }).success).toBe(false);
    expect(ImageBlockSchema.safeParse({ src: DATA }).success).toBe(true);
  });
});

describe("Markdown image ingestion (M6)", () => {
  it("embeds a data:image URI as an image", () => {
    expect(parseMd(`# T\n\n![a](${DATA})`).slides[0].image?.src).toBe(DATA);
  });

  it("does NOT embed a non-data:image src — the line degrades to text, never an <img>", () => {
    expect(parseMd("# T\n\n![x](javascript:alert(1))").slides[0].image).toBeUndefined();
    expect(parseMd("# T\n\n![x](https://evil.example/x.png)").slides[0].image).toBeUndefined();
    expect(parseMd("# T\n\n![x](assets/x.png)").slides[0].image).toBeUndefined();
  });
});
