/**
 * diagram-golden.ts — Capture a hash of each diagram's slide1.xml so a renderer
 * refactor can be proven to leave the PPTX drawing byte-identical.
 *
 * Run before and after a change:  npx tsx scripts/diagram-golden.ts
 */
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { renderToBuffer } from "../src/engine/pptx-writer";
import type { DiagramSpec } from "../src/engine/schema";

export const SPECS: Record<string, DiagramSpec> = {
  simple: {
    type: "flowchart", direction: "TB", title: "Simple", classDefs: {},
    nodes: [
      { id: "a", label: "Start", shape: "rounded_rect" },
      { id: "b", label: "Step", shape: "rect" },
      { id: "c", label: "End", shape: "rounded_rect" },
    ],
    edges: [
      { from: "a", to: "b", label: "go" },
      { from: "b", to: "c" },
    ],
    groups: [], lanes: [],
    layout: { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
  } as unknown as DiagramSpec,
  shapes: {
    type: "flowchart", direction: "LR", title: "Shapes", classDefs: {},
    nodes: [
      { id: "r", label: "rect", shape: "rect" },
      { id: "d", label: "diamond", shape: "diamond" },
      { id: "c", label: "circle", shape: "circle" },
      { id: "o", label: "oval", shape: "oval" },
      { id: "h", label: "hexagon", shape: "hexagon" },
      // #269 — new Mermaid flowchart shapes
      { id: "st", label: "stadium", shape: "stadium" },
      { id: "sr", label: "subroutine", shape: "subroutine" },
      { id: "pg", label: "parallelogram", shape: "parallelogram" },
      { id: "cy", label: "cylinder", shape: "cylinder" },
    ],
    edges: [
      { from: "r", to: "d" }, { from: "d", to: "c" },
      { from: "c", to: "o" }, { from: "o", to: "h" },
      { from: "h", to: "st" }, { from: "st", to: "sr" },
      { from: "sr", to: "pg" }, { from: "pg", to: "cy" },
    ],
    groups: [], lanes: [],
    layout: { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
  } as unknown as DiagramSpec,
  groups: {
    type: "network", direction: "TB", title: "Net",
    classDefs: { srv: { fill: "#1E40AF", font_color: "#FFFFFF" } as never },
    nodes: [
      { id: "lb", label: "LB", shape: "rect", group: "g1" },
      { id: "s1", label: "S1", shape: "rect", group: "g1", class: "srv" },
      { id: "s2", label: "S2", shape: "rect", group: "g1", class: "srv" },
      { id: "db", label: "DB", shape: "rect" },
    ],
    edges: [
      { from: "lb", to: "s1" }, { from: "lb", to: "s2" },
      { from: "s1", to: "db" }, { from: "s2", to: "db" },
    ],
    groups: [{ id: "g1", label: "Web Tier" }], lanes: [],
    layout: { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
  } as unknown as DiagramSpec,
  swimlane: {
    type: "flowchart", direction: "LR", title: "Lanes", classDefs: {},
    nodes: [
      { id: "a", label: "A", shape: "rect", lane: "l1" },
      { id: "b", label: "B", shape: "rect", lane: "l2" },
      { id: "c", label: "C", shape: "rect", lane: "l1" },
    ],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    groups: [],
    lanes: [{ id: "l1", label: "Lane 1" }, { id: "l2", label: "Lane 2" }],
    layout: { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
  } as unknown as DiagramSpec,
};

export async function slideXmlHashes(): Promise<string[]> {
  const out: string[] = [];
  for (const [name, spec] of Object.entries(SPECS)) {
    const buf = await renderToBuffer(spec);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const hash = createHash("sha256").update(xml).digest("hex").slice(0, 16);
    out.push(`${name}\t${hash}\t${xml.length}`);
  }
  return out;
}
