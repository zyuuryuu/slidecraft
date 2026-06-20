/**
 * diagram-grouping.test.ts — Diagrams export as NESTED groups, not loose shapes.
 *
 * In PowerPoint a diagram should be ONE object (top-level group) whose logical
 * units are sub-groups: a node = box+label, an edge = line+arrow+label, and for
 * sequence diagrams a participant = box+lifeline, a message = line+label, a
 * fragment = box+tab+label. So you can grab the whole diagram, or a meaningful
 * part, instead of dozens of disconnected shapes.
 *
 * The flat standalone render (renderToBuffer, used by goldens) is unchanged; only
 * the EMBEDDED deck path nests groups.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { renderToBufferWithGroups, nestShapeXml } from "../src/engine/pptx-writer";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { DiagramSpecSchema } from "../src/engine/schema";
import { midnightExecutive } from "../src/engine/theme";

const FLOW = DiagramSpecSchema.parse({
  type: "flowchart",
  direction: "TB",
  nodes: [
    { id: "A", label: "Start" },
    { id: "B", label: "End" },
  ],
  edges: [{ from: "A", to: "B", label: "go" }],
});

async function nested(spec: unknown, opts: Record<string, unknown> = {}) {
  const parsed = DiagramSpecSchema.parse(spec);
  const { buffer, groups } = await renderToBufferWithGroups(parsed, {
    theme: midnightExecutive(),
    omitTitle: true,
    ...opts,
  });
  const zip = await JSZip.loadAsync(buffer);
  const flat = (await zip.file("ppt/slides/slide1.xml")!.async("string")) ?? "";
  return { flat, grouped: nestShapeXml(flat, groups) };
}

const leaves = (s: string) => (s.match(/<p:sp>|<p:cxnSp>/g) ?? []).length;

describe("diagram grouping → nested PPTX groups", () => {
  it("the flat render has no groups; the nested render wraps shapes in groups", async () => {
    const { flat, grouped } = await nested(FLOW);
    expect(flat).not.toContain("<p:grpSp>");
    expect(grouped).toContain("<p:grpSp>");
  });

  it("groups nest (a top-level group containing per-unit sub-groups)", async () => {
    const { grouped } = await nested(FLOW);
    expect(grouped).toMatch(/<p:grpSp>[\s\S]*<p:grpSp>/);
    // balanced open/close
    expect((grouped.match(/<p:grpSp>/g) ?? []).length).toBe(
      (grouped.match(/<\/p:grpSp>/g) ?? []).length,
    );
  });

  it("no shapes are lost or duplicated by grouping", async () => {
    const { flat, grouped } = await nested(FLOW);
    expect(leaves(grouped)).toBe(leaves(flat));
    expect(leaves(grouped)).toBeGreaterThan(0);
  });

  it("a lone node's box + label end up in one sub-group", async () => {
    const { grouped } = await nested({
      type: "flowchart",
      direction: "TB",
      nodes: [{ id: "A", label: "Solo" }],
      edges: [],
    });
    // top-level group wraps a sub-group that holds the 2 leaf shapes (box + label)
    expect(grouped).toMatch(/<p:grpSp>[\s\S]*<p:grpSp>[\s\S]*<p:sp>[\s\S]*<p:sp>/);
    expect(leaves(grouped)).toBe(2);
  });

  it("sequence diagrams nest groups too (participants/messages)", async () => {
    const { grouped } = await nested({
      type: "sequence",
      direction: "TB",
      nodes: [
        { id: "A", label: "U" },
        { id: "B", label: "S" },
      ],
      edges: [{ from: "A", to: "B", label: "req" }],
    });
    expect(grouped).toMatch(/<p:grpSp>[\s\S]*<p:grpSp>/);
    expect(leaves(grouped)).toBeGreaterThan(0);
  });

  it("the SVG preview nests shapes in <g> for structure parity", () => {
    expect(renderDiagramToSvg(FLOW, { transparent: true })).toContain("<g>");
  });
});
