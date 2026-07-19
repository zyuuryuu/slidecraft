/**
 * gantt-diagram.test.ts — Native gantt charts (Mermaid gantt → DiagramSpec →
 * editable PPTX shapes). The parser resolves dates / `Nd` durations / `after`
 * deps into day offsets; rendered as a date axis + section bands + task bars.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import * as yaml from "js-yaml";

const MMD = `gantt
  title 開発計画
  dateFormat YYYY-MM-DD
  section 設計
    要件定義 :a1, 2024-01-01, 10d
    基本設計 :after a1, 14d
  section 開発
    実装 :crit, 2024-01-25, 20d
    マイルストーン :milestone, 2024-02-14, 0d`;

describe("Mermaid gantt parser", () => {
  it("resolves dates / durations / after-deps into day offsets", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.type).toBe("gantt");
    expect(spec.title).toBe("開発計画");
    expect(spec.gantt?.startDate).toBe("2024-01-01");
    const tasks = spec.gantt!.tasks;
    expect(tasks[0]).toMatchObject({ name: "要件定義", section: "設計", start: 0, end: 10 });
    expect(tasks[1]).toMatchObject({ name: "基本設計", start: 10, end: 24 }); // after a1 (day 10) + 14d
    expect(tasks[2].start).toBe(24); // 2024-01-25 = +24 days
    expect(tasks[2].status).toContain("crit");
    expect(tasks[3].status).toContain("milestone");
  });

  it("graduates to .diagram and preserves the gantt through serialization", () => {
    const s = parseMd("# 計画\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.gantt?.tasks[0]).toMatchObject({ name: "要件定義", start: 0, end: 10 });
    expect(spec.gantt?.tasks[2].status).toContain("crit");
  });
});

describe("gantt rendering", () => {
  it("renders task names, section bands, bars and the date axis (native shapes)", () => {
    const svg = renderDiagramToSvg(mermaidToDiagramSpec(MMD)!, {});
    expect(svg).toContain("要件定義");
    expect(svg).toContain("設計"); // section header
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3); // bars + section bands
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(1); // axis gridlines
  });
});

describe("gantt round-trips through Mermaid", () => {
  it("spec → Mermaid → spec preserves tasks (offsets), sections, status, title", () => {
    const spec1 = mermaidToDiagramSpec(MMD)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.title).toBe(spec1.title);
    expect(spec2.gantt).toEqual(spec1.gantt);
  });
});
