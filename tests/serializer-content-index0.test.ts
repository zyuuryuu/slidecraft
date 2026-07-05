/**
 * serializer-content-index0.test.ts
 *
 * Regression: a lone CONTENT slide at index 0 must not be forced to the Title role.
 *
 * slideRoleRegions (template-loader) defaults an index-0 slide to a Title slide. When such a slide
 * actually carries the content-title namespace (idx 15/16 + body idx 1) — a deck authored with no
 * separate cover — serializeMd would read title/subtitle through the EMPTY title namespace (idx 0/1),
 * emitting the body as `## …` and dropping the real title. The fix gates the index-0 default on
 * `!hasTitle` (idx 15 absent). See template-loader.ts slideRoleRegions.
 */
import { describe, it, expect } from "vitest";
import { serializeMd } from "../src/engine/md-serializer";

describe("serializer: a content slide at index 0 keeps its content namespace", () => {
  it("serializes idx 15/16/1 (content title/subtitle/body) instead of the empty title namespace", () => {
    const md = serializeMd({
      slides: [
        {
          layout: "auto", // resolved by autoSelectLayout at index 0
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Content Title" }] }] },
            { idx: "16", paragraphs: [{ segments: [{ text: "Content Subtitle" }] }] },
            { idx: "1", paragraphs: [{ segments: [{ text: "Body content" }] }] },
          ],
        },
      ],
    });

    expect(md).toContain("# Content Title");
    expect(md).toContain("> Content Subtitle");
    expect(md).toContain("Body content");
    // The old bug read the body through the title namespace → `## Body content`.
    expect(md).not.toContain("## Body content");
  });

  it("still treats an empty index-0 slide as a title slide (no crash, backward compat)", () => {
    const md = serializeMd({ slides: [{ layout: "auto", placeholders: [] }] });
    expect(md).toBeDefined();
  });

  it("still treats an index-0 slide with the title namespace (idx 0/1) as a title slide", () => {
    const md = serializeMd({
      slides: [
        {
          layout: "auto",
          placeholders: [
            { idx: "0", paragraphs: [{ segments: [{ text: "True Title" }] }] },
            { idx: "1", paragraphs: [{ segments: [{ text: "Sub" }] }] },
          ],
        },
      ],
    });
    expect(md).toContain("# True Title");
    expect(md).toContain("## Sub");
  });
});
