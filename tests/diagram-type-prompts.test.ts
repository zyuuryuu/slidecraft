/**
 * diagram-type-prompts.test.ts — two-stage diagram generation (#2 redesign).
 *
 * Instead of one monolithic prompt claiming 3 types (that omits the other 9 + their shapes), the
 * diagram type is decided FIRST (Stage 1: UI pick or an AI route call), then ONLY that type's shape
 * fragment is sent (Stage 2: base + registry[type]). Keeps each request small (speed) and makes adding
 * a type a one-entry change (extensibility). These gates lock: the registry covers every VALID_TYPE,
 * each type's prompt carries that type's real fields, and the router parse is robust.
 */
import { describe, it, expect } from "vitest";
import { VALID_TYPES, type DiagramType } from "../src/engine/schema-constants";
import {
  DIAGRAM_TYPES,
  diagramSystemPrompt,
  diagramRoutePrompt,
  parseDiagramType,
} from "../src/engine/diagram-type-prompts";

describe("diagram type registry", () => {
  it("covers EXACTLY the schema's VALID_TYPES (no drift)", () => {
    expect(Object.keys(DIAGRAM_TYPES).sort()).toEqual([...VALID_TYPES].sort());
  });

  it("every type has a label, a routing hint, and a shape fragment", () => {
    for (const t of VALID_TYPES) {
      const info = DIAGRAM_TYPES[t];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.hint.length).toBeGreaterThan(0);
      expect(info.shape.length).toBeGreaterThan(0);
    }
  });
});

describe("diagramSystemPrompt(type) — base + ONLY that type's fragment", () => {
  // The field keyword that MUST appear for each type (proves the right shape is taught).
  const TYPE_MARKERS: Record<DiagramType, string> = {
    flowchart: "edges",
    network: "icon",
    orgchart: "edges",
    sequence: "fragments",
    timeline: "section",
    quadrant: "quadrant",
    pie: "value",
    gantt: "tasks",
    journey: "score",
    xychart: "series",
    radar: "axes",
    kpi: "cards",
  };

  it("includes the base output contract for every type", () => {
    for (const t of VALID_TYPES) {
      const p = diagramSystemPrompt(t);
      expect(p).toContain("JSON");
      expect(p).toContain(t); // names the chosen type
    }
  });

  it("teaches each type's OWN field(s)", () => {
    for (const t of VALID_TYPES) {
      expect(diagramSystemPrompt(t).toLowerCase()).toContain(TYPE_MARKERS[t]);
    }
  });

  it("does NOT dump every other type's fields (small prompt = the whole point)", () => {
    // A pie prompt must not carry the gantt/xychart/radar/kpi field blocks.
    const pie = diagramSystemPrompt("pie");
    expect(pie).not.toContain('"gantt"');
    expect(pie).not.toContain('"xychart"');
    expect(pie).not.toContain('"radar"');
    expect(pie).not.toContain('"kpi"');
  });

  it("defaults to flowchart when no type is given (back-compat)", () => {
    expect(diagramSystemPrompt()).toContain("flowchart");
  });
});

describe("Stage 1 — route prompt + parse", () => {
  it("route prompt lists every type with its hint + the request", () => {
    const p = diagramRoutePrompt("プロジェクトのスケジュールを図にして");
    for (const t of VALID_TYPES) expect(p).toContain(t);
    expect(p).toContain("プロジェクトのスケジュールを図にして");
  });

  it("parseDiagramType accepts a valid type (tolerating whitespace / case / punctuation)", () => {
    expect(parseDiagramType("gantt")).toBe("gantt");
    expect(parseDiagramType("  Pie.  ")).toBe("pie");
    expect(parseDiagramType('"sequence"')).toBe("sequence");
  });

  it("parseDiagramType returns null for an unknown / junk answer", () => {
    expect(parseDiagramType("barchart")).toBeNull();
    expect(parseDiagramType("I think a flowchart")).toBeNull(); // not a bare type word
    expect(parseDiagramType("")).toBeNull();
  });
});
