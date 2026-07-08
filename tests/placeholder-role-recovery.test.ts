/**
 * ADR-0025: gated title recovery. When a layout has NO title-role placeholder, a promotable
 * (body/other) box whose name says "title" AND is at idx 0 or has title geometry is promoted to
 * "title" — so a body-typed / mis-authored title placeholder still receives the deck title.
 * The gate (no title present) guarantees healthy templates are byte-identical.
 */
import { describe, it, expect } from "vitest";
import { placeholderRole, recoverLayoutTitle } from "../src/engine/template-catalog";
import { bindContentByRole } from "../src/engine/placeholder-binding";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

const st = (o: Partial<{ x: number; y: number; w: number; h: number }> = {}) =>
  ({ x: 0, y: 0, w: 0, h: 0, fontSize: 18, color: "000000", align: "l", fontFace: "", bulletChar: "", ...o }) as never;
const ph = (o: Partial<PlaceholderInfo>): PlaceholderInfo => ({
  idx: "1", type: "", name: "", shapeXml: "", style: st(), metaIdxConvention: true, ...o,
});
// A title-shaped box: top band, wide, short (matches geometryRole's "title").
const titleGeo = st({ x: 0.5, y: 0.3, w: 12, h: 1.0 });
const bigGeo = st({ x: 0.5, y: 1.8, w: 12, h: 5 });

/** Run the load-time pass, then read the resolved role. */
const roleAfterRecovery = (layout: PlaceholderInfo[], target: PlaceholderInfo) => {
  recoverLayoutTitle(layout);
  return placeholderRole(target);
};

describe("ADR-0025 gated title recovery", () => {
  it("promotes a body-typed idx=0 box named Title (the reported case)", () => {
    const title = ph({ name: "Title", type: "body", idx: "0", style: titleGeo });
    const body = ph({ name: "Content Placeholder", type: "body", idx: "1", style: bigGeo });
    expect(roleAfterRecovery([title, body], title)).toBe("title");
    expect(placeholderRole(body)).toBe("body"); // the real body is untouched
  });

  it("promotes a Japanese タイトル box at idx 0 (type body)", () => {
    const title = ph({ name: "タイトル 1", type: "body", idx: "0", style: titleGeo });
    expect(roleAfterRecovery([title, ph({ type: "body", idx: "1", style: bigGeo })], title)).toBe("title");
  });

  it("promotes a Title-named body box by title GEOMETRY even at a non-0 idx", () => {
    const title = ph({ name: "Title", type: "body", idx: "3", style: titleGeo });
    expect(roleAfterRecovery([title, ph({ type: "body", idx: "1", style: bigGeo })], title)).toBe("title");
  });

  it("GATE: never steals a real title — a layout WITH a title type is left untouched", () => {
    const realTitle = ph({ name: "Title 1", type: "title", idx: "0", style: titleGeo });
    const nameyBody = ph({ name: "Title Text", type: "body", idx: "1", style: bigGeo });
    recoverLayoutTitle([realTitle, nameyBody]);
    expect(placeholderRole(realTitle)).toBe("title");
    expect(placeholderRole(nameyBody)).toBe("body"); // NOT promoted (a title already exists)
    expect(nameyBody.resolvedRole).toBeUndefined();
  });

  it("consensus: name alone is NOT enough — needs idx0 OR title geometry", () => {
    const namedOnly = ph({ name: "Title", type: "body", idx: "5", style: bigGeo }); // no idx0, big geo
    recoverLayoutTitle([namedOnly, ph({ type: "body", idx: "1", style: bigGeo })]);
    expect(placeholderRole(namedOnly)).toBe("body");
  });

  it("consensus: geometry/idx0 alone is NOT enough — needs a title-ish name", () => {
    const geoOnly = ph({ name: "Content", type: "body", idx: "0", style: titleGeo }); // idx0+geo but wrong name
    recoverLayoutTitle([geoOnly, ph({ type: "body", idx: "1", style: bigGeo })]);
    expect(placeholderRole(geoOnly)).toBe("body");
  });

  it("never promotes a subtitle-named box to title", () => {
    const sub = ph({ name: "Subtitle 2", type: "body", idx: "0", style: titleGeo });
    recoverLayoutTitle([sub, ph({ type: "body", idx: "1", style: bigGeo })]);
    expect(placeholderRole(sub)).not.toBe("title");
  });

  it("never promotes a meta-role box (e.g. a footer typed ftr) even if named Title", () => {
    const footer = ph({ name: "Title", type: "ftr", idx: "12", style: titleGeo });
    recoverLayoutTitle([footer, ph({ type: "body", idx: "1", style: bigGeo })]);
    expect(placeholderRole(footer)).toBe("footer");
  });

  it("integration: the deck title binds INTO the promoted placeholder", () => {
    const title = ph({ name: "Title", type: "body", idx: "0", style: titleGeo });
    const body = ph({ name: "Body", type: "body", idx: "1", style: bigGeo });
    const layout = [title, body];
    recoverLayoutTitle(layout);
    const slide: SlideIR = {
      layout: "X",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "My Title" }] }] as never }, // canonical title idx
        { idx: "1", paragraphs: [{ segments: [{ text: "some body" }] }] as never },
      ],
    } as never;
    const bound = bindContentByRole(slide, layout);
    // title content (canonical idx 15 → role title) lands in the promoted box (layout idx "0")
    expect(bound.get("0")?.paragraphs[0].segments[0].text).toBe("My Title");
    expect(bound.get("1")?.paragraphs[0].segments[0].text).toBe("some body");
  });

  it("idempotent: running recovery twice does not double-promote or change the winner", () => {
    const title = ph({ name: "Title", type: "body", idx: "0", style: titleGeo });
    const layout = [title, ph({ type: "body", idx: "1", style: bigGeo })];
    recoverLayoutTitle(layout);
    recoverLayoutTitle(layout);
    expect(placeholderRole(title)).toBe("title");
  });
});
