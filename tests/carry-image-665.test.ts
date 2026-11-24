/**
 * carry-image-665.test.ts — #665: a text-only edit (MCP set_slide_markdown ⇄ GUI reconcileSlideEdit) of a
 * slide with an image used to drop the image silently. 統括裁定: an image joins the #220 B3 "omitted =
 * carried" kinds (diagram / Mermaid / table / code); an image the edit carries wins; a behind image
 * follows the same rule. Both doors share apply-slide-edit.carryOmittedBlocks, so they must agree (R8).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import { reconcileSlideEdit } from "../src/engine/ai-apply";
import { carryOmittedBlocks } from "../src/engine/apply-slide-edit";
import { carryFigures, CARRIED_KINDS } from "../src/engine/slide-figure-edit";
import { slideFigures } from "../src/engine/slide-figures";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR, FigureKind } from "../src/engine/slide-schema";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DIAG = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id.toUpperCase() + "\n```";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

/** Apply `edit` to slide 1 of `content` through both doors; returns the old slide and each door's result. */
async function bothDoors(content: string, edit: string): Promise<{ old: SlideIR; mcp: SlideIR; gui: SlideIR }> {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n" + content);
  const old = s.deck!.slides[1];
  const gui = reconcileSlideEdit(old, edit, { catalog: s.catalog!, layouts: s.template!.layouts })!;
  expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
  return { old, mcp: s.deck!.slides[1], gui: gui.slide };
}

describe("#665: a text-only edit keeps the slide's image on both doors", () => {
  it("a single body image is carried (MCP ≡ GUI)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n- a\n\n![写真](${PNG})`, "# 中身\n\n- b");
    expect(old.image?.src).toBe(PNG);
    expect(mcp.image).toEqual(old.image);
    expect(mcp).toEqual(gui);
  });
  it("a behind image is carried (MCP ≡ GUI)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n- a\n\n![bg](${PNG}){behind=1}`, "# 中身\n\n- b");
    expect(old.image?.behind).toBe(true);
    expect(mcp.image).toEqual(old.image);
    expect(mcp).toEqual(gui);
  });
  it("an image the edit carries wins over the old one (carry is only for omission)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n- a\n\n![写真](${PNG})`, `# 中身\n\n- b\n\n![別](${PNG2})`);
    expect(old.image?.src).toBe(PNG);
    expect(mcp.image?.src).toBe(PNG2);
    expect(mcp).toEqual(gui);
  });
  it("≥2 visuals (diagram + image): a text-only edit keeps both in place (MCP ≡ GUI)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n${DIAG("a")}\n\n![写真](${PNG})`, "# 中身\n\n- b");
    expect(slideFigures(old).map((f) => f.kind)).toEqual(["diagram", "image"]);
    expect(slideFigures(mcp)).toEqual(slideFigures(old));
    expect(mcp.figures).toEqual(old.figures);
    expect(mcp).toEqual(gui);
  });
  it("≥2 visuals + a behind image: a text-only edit keeps the behind image too (MCP ≡ GUI)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n![bg](${PNG}){behind=1}\n\n${DIAG("a")}\n\n${DIAG("b")}`, "# 中身\n\n- b");
    expect(old.image?.behind).toBe(true);
    expect(slideFigures(old)).toHaveLength(2);
    expect(mcp.image).toEqual(old.image);
    expect(slideFigures(mcp)).toEqual(slideFigures(old));
    expect(mcp).toEqual(gui);
  });
  it("≥2 visuals (diagram + body image), the edit brings a behind image: no throw, behind image + old diagram (MCP ≡ GUI)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n${DIAG("a")}\n\n![写真](${PNG})`, `# 中身\n\n- b\n\n![bg](${PNG2}){behind=1}`);
    expect(slideFigures(old).map((f) => f.kind)).toEqual(["diagram", "image"]);
    expect(mcp.image).toMatchObject({ src: PNG2, behind: true });
    expect(slideFigures(mcp)).toEqual(slideFigures(old).filter((f) => f.kind === "diagram"));
    expect(mcp.figures).toBeUndefined();
    expect(mcp).toEqual(gui);
  });
  it("two body images, the edit brings one body image: it replaces the 1st and the 2nd stays (MCP ≡ GUI)", async () => {
    const { old, mcp, gui } = await bothDoors(`# 中身\n\n![一](${PNG})\n\n![二](${PNG})`, `# 中身\n\n- b\n\n![別](${PNG2})`);
    expect(slideFigures(old).map((f) => f.kind)).toEqual(["image", "image"]);
    expect(slideFigures(mcp).map((f) => (f.kind === "image" ? f.src : f.kind))).toEqual([PNG2, PNG]);
    expect(mcp).toEqual(gui);
  });
});

describe("#665 / R8: the carried kinds are decided in ONE place (CARRIED_KINDS) and both carry paths follow it", () => {
  const BLOCK: Record<FigureKind, string> = {
    diagram: DIAG("a"),
    mermaid: "```mermaid\nflowchart TD\n  A-->B\n```",
    table: "| a | b |\n|---|---|\n| 1 | 2 |",
    code: "```ts\nconst a = 1;\n```",
    image: `![写真](${PNG})`,
  };
  const one = (md: string) => parseMd(md).slides[0];
  it("every figure kind is carried (image included, #665)", () => {
    expect([...CARRIED_KINDS].sort()).toEqual(["code", "diagram", "image", "mermaid", "table"]);
  });
  for (const kind of Object.keys(BLOCK) as FigureKind[]) {
    it(`single-visual path (carryOmittedBlocks) and per-visual path (carryFigures) both carry an omitted ${kind}`, () => {
      const old = one(`# T\n\n${BLOCK[kind]}`);
      const edited = one("# T\n\n- b");
      expect(slideFigures(old).map((f) => f.kind)).toEqual([kind]);
      expect(slideFigures(carryOmittedBlocks(old, edited))).toEqual(slideFigures(old));
      expect(slideFigures(carryFigures(old, edited))).toEqual(slideFigures(old));
    });
  }
});
