import { describe, it, expect } from "vitest";
import { renderDiagram, renderToBuffer, renderToBase64 } from "../src/engine/pptx-writer";
import { parseDiagramJson } from "../src/engine/schema";
import { midnightExecutive } from "../src/engine/theme";

function makeSpec(json: Record<string, unknown>) {
  return parseDiagramJson(JSON.stringify(json));
}

const SIMPLE_FLOWCHART = makeSpec({
  type: "flowchart",
  direction: "TB",
  title: "認証フロー",
  classDefs: {
    process: { fill: "#1E2761", border: "#3B82F6", font_color: "#FFFFFF" },
    decision: { fill: "#F59E0B", font_color: "#1E293B", font_size: 10 },
    terminal: { fill: "#3B82F6" },
  },
  nodes: [
    { id: "start", label: "開始", shape: "rounded_rect", class: "terminal" },
    { id: "proc1", label: "リクエスト受付", class: "process" },
    { id: "auth", label: "認証OK？", shape: "diamond", class: "decision" },
    { id: "ok", label: "データ処理", class: "process" },
    { id: "ng", label: "エラー返却", class: "process" },
    { id: "end", label: "終了", shape: "rounded_rect", class: "terminal" },
  ],
  edges: [
    { from: "start", to: "proc1" },
    { from: "proc1", to: "auth" },
    { from: "auth", to: "ok", label: "Yes" },
    { from: "auth", to: "ng", label: "No" },
    { from: "ok", to: "end" },
    { from: "ng", to: "end" },
  ],
});

const NETWORK_DIAGRAM = makeSpec({
  type: "network",
  direction: "TB",
  title: "ネットワーク構成",
  classDefs: {
    core: { fill: "#1E2761", border: "#3B82F6" },
    server: { fill: "#3B82F6", font_size: 9 },
  },
  nodes: [
    { id: "router", label: "Router", shape: "rounded_rect", class: "core" },
    { id: "sw1", label: "Switch-A", class: "core", group: "access" },
    { id: "sw2", label: "Switch-B", class: "core", group: "access" },
    { id: "web1", label: "Web-01", class: "server", group: "servers" },
    { id: "web2", label: "Web-02", class: "server", group: "servers" },
  ],
  edges: [
    { from: "router", to: "sw1" },
    { from: "router", to: "sw2" },
    { from: "sw1", to: "web1" },
    { from: "sw2", to: "web2" },
  ],
  groups: [
    { id: "access", label: "Access Layer" },
    { id: "servers", label: "Server Farm" },
  ],
});

const ORGCHART = makeSpec({
  type: "orgchart",
  direction: "TB",
  title: "組織図",
  classDefs: {
    ceo: { fill: "#141B41", border: "#3B82F6", font_size: 12 },
    team: { fill: "#2D3A6E", border: "#3B82F6", font_size: 10 },
  },
  nodes: [
    { id: "ceo", label: "田中 太郎", sublabel: "CEO", shape: "rounded_rect", class: "ceo" },
    { id: "t1", label: "鈴木 花子", sublabel: "Engineering", shape: "rounded_rect", class: "team" },
    { id: "t2", label: "佐藤 次郎", sublabel: "Sales", shape: "rounded_rect", class: "team" },
  ],
  edges: [
    { from: "ceo", to: "t1" },
    { from: "ceo", to: "t2" },
  ],
});

const SWIMLANE_FLOW = makeSpec({
  type: "flowchart",
  direction: "TB",
  title: "スイムレーンフロー",
  nodes: [
    { id: "a", label: "Request", lane: "l1" },
    { id: "b", label: "Process", lane: "l2" },
    { id: "c", label: "Response", lane: "l1" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
  lanes: [
    { id: "l1", label: "Client" },
    { id: "l2", label: "Server" },
  ],
});

describe("renderDiagram", () => {
  it("creates a PptxGenJS instance for simple flowchart", () => {
    const pptx = renderDiagram(SIMPLE_FLOWCHART);
    expect(pptx).toBeDefined();
    // PptxGenJS object should have slides
    expect(typeof pptx.write).toBe("function");
  });

  it("creates a PptxGenJS instance for network diagram with groups", () => {
    const pptx = renderDiagram(NETWORK_DIAGRAM);
    expect(pptx).toBeDefined();
  });

  it("creates a PptxGenJS instance for orgchart with sublabels", () => {
    const pptx = renderDiagram(ORGCHART);
    expect(pptx).toBeDefined();
  });

  it("creates a PptxGenJS instance for swimlane flow", () => {
    const pptx = renderDiagram(SWIMLANE_FLOW);
    expect(pptx).toBeDefined();
  });

  it("works with custom theme", () => {
    const theme = midnightExecutive();
    theme.name = "Custom";
    theme.palette.navy = "FF0000";
    const pptx = renderDiagram(SIMPLE_FLOWCHART, { theme });
    expect(pptx).toBeDefined();
  });

  it("works without header bar", () => {
    const pptx = renderDiagram(SIMPLE_FLOWCHART, { useHeaderBar: false });
    expect(pptx).toBeDefined();
  });

  it("works with untitled diagram", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const pptx = renderDiagram(spec);
    expect(pptx).toBeDefined();
  });

  it("handles LR direction", () => {
    const spec = makeSpec({
      type: "flowchart",
      direction: "LR",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    const pptx = renderDiagram(spec);
    expect(pptx).toBeDefined();
  });

  it("handles all shape types", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "Rect", shape: "rect" },
        { id: "b", label: "Rounded", shape: "rounded_rect" },
        { id: "c", label: "Diamond", shape: "diamond" },
        { id: "d", label: "Circle", shape: "circle" },
        { id: "e", label: "Oval", shape: "oval" },
        { id: "f", label: "Hexagon", shape: "hexagon" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "d", to: "e" },
        { from: "e", to: "f" },
      ],
    });
    const pptx = renderDiagram(spec);
    expect(pptx).toBeDefined();
  });

  it("handles edge styles (dash, color)", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b", style: { color: "#FF0000", dash: true, width: 3 } },
      ],
    });
    const pptx = renderDiagram(spec);
    expect(pptx).toBeDefined();
  });

  it("handles cyclic graph (back-edges)", () => {
    const spec = makeSpec({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    const pptx = renderDiagram(spec);
    expect(pptx).toBeDefined();
  });
});

describe("renderToBuffer", () => {
  it("produces a Uint8Array", async () => {
    const buffer = await renderToBuffer(SIMPLE_FLOWCHART);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
    // PPTX files start with ZIP magic bytes PK
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });
});

describe("renderToBase64", () => {
  it("produces a non-empty base64 string", async () => {
    const b64 = await renderToBase64(SIMPLE_FLOWCHART);
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
  });
});
