/**
 * group-roundtrip.test.ts — Wave 2 of the adversarial-hunt fixes: group/figure slides must survive
 * serialize↔parse regardless of the RESOLVED layout.
 *  #2 an auto-layout card/step/kpi slide serialized (autoSelect resolves it to a Title layout) lost its
 *     title, all-but-one column, and groupKind because the title-namespace branch swallowed it.
 *  #4 a single-body table/code slide that resolves to a separator (Column/KPI/Process) layout serialized
 *     the figure INSIDE the separator branch, which the parser then re-absorbed into the last column.
 */
import { describe, it, expect } from "vitest";
import { serializeMd } from "../src/engine/md-serializer";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";

const rt = (s: SlideIR) => parseMd(serializeMd({ slides: [s] })).slides[0];

describe("#2 auto-layout grouped slide survives round-trip", () => {
  it("card slide (layout auto + groupKind) keeps title + all columns + groupKind", () => {
    const src = parseMd("# Our Options\n\n<!-- card -->\n### Plan A\n- fast\n\n<!-- card -->\n### Plan B\n- slow").slides[0];
    expect(src.groupKind).toBe("card");
    expect(src.layout).toBe("auto");
    const back = rt(src);
    expect(back.groupKind).toBe("card");
    // title preserved (content-namespace idx15), not swallowed by the title branch
    expect(JSON.stringify(back)).toContain("Our Options");
    expect(JSON.stringify(back)).toContain("Plan A");
    expect(JSON.stringify(back)).toContain("Plan B"); // second column survives
  });

  it("the serialized markdown is not the broken '## ### ...' shape", () => {
    const src = parseMd("# T\n\n<!-- card -->\n### A\n- x\n\n<!-- card -->\n### B\n- y").slides[0];
    const md = serializeMd({ slides: [src] });
    expect(md).not.toContain("## ###");
    expect(md).toContain("<!-- card -->");
  });
});

describe("#4 single-body figure on a separator-resolved layout round-trips", () => {
  it("table pinned to a KPI layout survives (not absorbed into a column)", () => {
    const src: SlideIR = {
      layout: "KPI.3Value.Equal",
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "Q3" }] }] }],
      table: { rows: [["Metric", "Value"], ["Latency", "12ms"]], header: true, placeholderIdx: "1" },
    };
    const back = rt(src);
    expect(back.table?.rows).toEqual([["Metric", "Value"], ["Latency", "12ms"]]);
  });

  it("code pinned to a Process layout survives with indentation intact", () => {
    const src: SlideIR = {
      layout: "Process.3Step.Sequential",
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "Impl" }] }] }],
      code: { content: "def f():\n    return 1", lang: "python", placeholderIdx: "1" },
    };
    const back = rt(src);
    expect(back.code?.content).toContain("    return 1"); // indentation preserved
  });

  it("a real grouped kpi slide (columns, no table) still round-trips its columns", () => {
    const src = parseMd("<!-- slide: KPI.2Value.Equal -->\n# Q3\n\n<!-- kpi -->\n- 90%\n\n<!-- kpi -->\n- 80%").slides[0];
    const back = rt(src);
    expect(back.groupKind).toBe("kpi");
    expect(JSON.stringify(back)).toContain("90%");
    expect(JSON.stringify(back)).toContain("80%");
    expect(back.table).toBeUndefined();
  });
});
