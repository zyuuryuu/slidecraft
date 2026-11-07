/**
 * field-edit-ops.test.ts — #106 P2 / ADR-0019: placeholder TEXT ops (`setField`).
 *
 * The model emits only the changed field(s) as `[{ "op": "setField", "idx": "<idx>", "text": "…" }]`;
 * the engine merges them through the SAME primitive the GUI field editor uses
 * (applyFieldEdit + textToParagraphs — SlideEditor.updatePlaceholder). Pinned here:
 *   - R8 agreement: setField ops ≡ applyFieldEdit called directly with the same edit
 *   - untouched placeholders stay byte-identical (same object, same serialization)
 *   - unknown idx → skipped + announced (never silent); an all-skip batch returns the slide unchanged
 *   - parse: whole-string bare array only (prose quoting an array is not hijacked), distinct from the
 *     figure / design ops vocabularies
 *   - a malformed setField array is detected so the caller can fall back to full text AND announce it
 */
import { describe, it, expect } from "vitest";
import type { SlideIR, Paragraph } from "../src/engine/slide-schema";
import { applyFieldEdit } from "../src/engine/placeholder-binding";
import { textToParagraphs } from "../src/engine/field-text";
import {
  parseFieldEditOps,
  applyFieldEditOps,
  malformedFieldOpsNotice,
  describeEditableFields,
  routeFieldEdit,
} from "../src/engine/field-edit-ops";
import { parseDiagramEditOps } from "../src/engine/diagram-edit-ops";
import { parseDesignIntent } from "../src/engine/design-intent";

const para = (text: string): Paragraph[] => [{ segments: [{ text }] }];
const SLIDE: SlideIR = {
  layout: "Content.1Body.Single",
  placeholders: [
    { idx: "15", paragraphs: para("売上の推移") },
    { idx: "1", paragraphs: [{ segments: [{ text: "前年比 120%" }], bullet: true }, { segments: [{ text: "新規顧客 35 社" }], bullet: true }] },
    { idx: "12", paragraphs: para("社外秘") },
  ],
  diagram: { yaml: "type: flowchart\nnodes:\n  - id: a\n    label: A", placeholderIdx: "2" },
};

describe("parseFieldEditOps", () => {
  it("accepts a whole-string bare setField array (optionally fenced)", () => {
    expect(parseFieldEditOps('[{"op":"setField","idx":"15","text":"売上の推移（2026）"}]')).toEqual([
      { op: "setField", idx: "15", text: "売上の推移（2026）" },
    ]);
    expect(parseFieldEditOps('```json\n[{"op":"setField","idx":"1","text":"- a"}]\n```')).toEqual([
      { op: "setField", idx: "1", text: "- a" },
    ]);
  });
  it("normalizes a numeric idx to its string form (models often drop the quotes)", () => {
    expect(parseFieldEditOps('[{"op":"setField","idx":15,"text":"t"}]')).toEqual([{ op: "setField", idx: "15", text: "t" }]);
  });
  it("rejects prose, Markdown, empty arrays, and the other ops vocabularies", () => {
    expect(parseFieldEditOps('例: [{"op":"setField","idx":"15","text":"x"}] のように')).toBeNull();
    expect(parseFieldEditOps("# タイトル\n- 箇条書き")).toBeNull();
    expect(parseFieldEditOps("[]")).toBeNull();
    expect(parseFieldEditOps('[{"op":"nodeUpdate","id":"a","label":"B"}]')).toBeNull();
    expect(parseFieldEditOps('[{"op":"regionSplit","arrangement":"text-left"}]')).toBeNull();
  });
  it("a setField array is not mistaken for figure or design ops (vocabularies stay disjoint)", () => {
    const raw = '[{"op":"setField","idx":"15","text":"x"}]';
    expect(parseDiagramEditOps(raw)).toBeNull();
    expect(parseDesignIntent(raw)).toBeNull();
  });
});

describe("applyFieldEditOps — R8 agreement with applyFieldEdit (the GUI field editor's primitive)", () => {
  const cases: Array<[string, string, string]> = [
    ["rewrite the title", "15", "売上の推移（2026年度）"],
    ["rewrite the bullets (list markers + nesting)", "1", "- 前年比 120%\n  - 内訳: 既存 80%\n- 新規顧客 35 社"],
    ["rewrite with a heading line + inline bold", "1", "### 要点\n**前年比 120%**"],
    ["clear a field (blank text drops the placeholder)", "12", ""],
  ];
  for (const [name, idx, text] of cases) {
    it(name, () => {
      const viaOps = applyFieldEditOps(SLIDE, [{ op: "setField", idx, text }]);
      expect(viaOps.skipped).toEqual([]);
      expect(viaOps.slide.placeholders).toEqual(applyFieldEdit(SLIDE.placeholders, idx, textToParagraphs(text)));
    });
  }
  it("several ops ≡ applyFieldEdit applied in the same order", () => {
    const ops = [
      { op: "setField" as const, idx: "15", text: "新タイトル" },
      { op: "setField" as const, idx: "1", text: "- 一\n- 二" },
    ];
    let direct = SLIDE.placeholders;
    for (const o of ops) direct = applyFieldEdit(direct, o.idx, textToParagraphs(o.text));
    expect(applyFieldEditOps(SLIDE, ops).slide.placeholders).toEqual(direct);
  });
});

describe("applyFieldEditOps — untouched content stays byte-identical", () => {
  it("only the named placeholder changes; the others (and the figure) are the SAME objects", () => {
    const { slide } = applyFieldEditOps(SLIDE, [{ op: "setField", idx: "15", text: "新タイトル" }]);
    expect(slide.placeholders.find((p) => p.idx === "1")).toBe(SLIDE.placeholders[1]);
    expect(slide.placeholders.find((p) => p.idx === "12")).toBe(SLIDE.placeholders[2]);
    expect(JSON.stringify(slide.diagram)).toBe(JSON.stringify(SLIDE.diagram));
    expect(slide.layout).toBe(SLIDE.layout);
    expect(slide.placeholders.map((p) => p.idx)).toEqual(["15", "1", "12"]); // order kept
  });
  it("does not mutate the input slide", () => {
    const before = JSON.stringify(SLIDE);
    applyFieldEditOps(SLIDE, [{ op: "setField", idx: "1", text: "x" }, { op: "setField", idx: "12", text: "" }]);
    expect(JSON.stringify(SLIDE)).toBe(before);
  });
});

describe("applyFieldEditOps — unknown idx is skipped and announced (never silent)", () => {
  it("skips an idx the slide does not carry, lists the existing idxs, and still applies the rest", () => {
    const { slide, skipped } = applyFieldEditOps(SLIDE, [
      { op: "setField", idx: "9", text: "幻のフィールド" },
      { op: "setField", idx: "15", text: "新タイトル" },
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].idx).toBe("9");
    expect(skipped[0].reason).toBe("unknown-idx");
    expect(skipped[0].message).toContain('"9"');
    expect(skipped[0].message).toContain("15, 1, 12");
    expect(slide.placeholders.some((p) => p.idx === "9")).toBe(false); // not upserted
    expect(slide.placeholders.find((p) => p.idx === "15")?.paragraphs).toEqual(textToParagraphs("新タイトル"));
  });
  it("an all-skip batch returns the ORIGINAL slide object (no spurious diff)", () => {
    const out = applyFieldEditOps(SLIDE, [{ op: "setField", idx: "9", text: "x" }]);
    expect(out.slide).toBe(SLIDE);
    expect(out.skipped).toHaveLength(1);
  });
  it("an idx cleared by an earlier op in the same batch is unknown for a later op", () => {
    const { skipped } = applyFieldEditOps(SLIDE, [
      { op: "setField", idx: "12", text: "" },
      { op: "setField", idx: "12", text: "復活" },
    ]);
    expect(skipped.map((s) => s.idx)).toEqual(["12"]);
  });
});

describe("malformedFieldOpsNotice — invalid setField ops fall back to full text, announced", () => {
  it("flags a bare array that names setField but fails the schema", () => {
    expect(malformedFieldOpsNotice('[{"op":"setField","idx":"15"}]')).toMatch(/setField/);
    // mixing vocabularies in one reply is invalid too (one kind per reply)
    expect(malformedFieldOpsNotice('[{"op":"setField","idx":"15","text":"x"},{"op":"nodeUpdate","id":"a","label":"B"}]')).toMatch(/setField/);
  });
  it("is null for valid setField ops, Markdown, prose, and other ops vocabularies", () => {
    expect(malformedFieldOpsNotice('[{"op":"setField","idx":"15","text":"x"}]')).toBeNull();
    expect(malformedFieldOpsNotice("# タイトル\n- a")).toBeNull();
    expect(malformedFieldOpsNotice('例: [{"op":"setField"}] のように')).toBeNull();
    expect(malformedFieldOpsNotice('[{"op":"nodeUpdate","id":"a"}]')).toBeNull();
  });
});

describe("routeFieldEdit — the GUI's setField branch (handleApplySlide / previewSlideEdit)", () => {
  it("ops → merged slide + notices (the skipped messages)", () => {
    const r = routeFieldEdit(SLIDE, '[{"op":"setField","idx":"15","text":"新"},{"op":"setField","idx":"9","text":"x"}]');
    expect(r?.kind).toBe("ops");
    if (r?.kind !== "ops") return;
    expect(r.slide).toEqual(applyFieldEditOps(SLIDE, [{ op: "setField", idx: "15", text: "新" }]).slide);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toContain('"9"');
  });
  it("malformed setField → fallback with a notice (the caller continues down the full-text path)", () => {
    const r = routeFieldEdit(SLIDE, '[{"op":"setField","idx":"15"}]');
    expect(r?.kind).toBe("fallback");
    if (r?.kind !== "fallback") return;
    expect(r.notice).toMatch(/全文/);
  });
  it("anything else → null (figure ops / design ops / Markdown keep their existing routes)", () => {
    expect(routeFieldEdit(SLIDE, '[{"op":"nodeUpdate","id":"a","label":"B"}]')).toBeNull();
    expect(routeFieldEdit(SLIDE, '[{"op":"regionSplit","arrangement":"text-left"}]')).toBeNull();
    expect(routeFieldEdit(SLIDE, "# 売上\n- a")).toBeNull();
  });
});

describe("describeEditableFields — the idx list handed to the model", () => {
  it("lists every text placeholder's idx with its current text (as the field editor shows it)", () => {
    const d = describeEditableFields(SLIDE);
    expect(d).toContain('idx "15": "売上の推移"');
    expect(d).toContain('idx "1": "- 前年比 120%\\n- 新規顧客 35 社"');
    expect(d).toContain('idx "12": "社外秘"');
  });
  it("is empty for a slide without text placeholders", () => {
    expect(describeEditableFields({ layout: "x", placeholders: [] })).toBe("");
  });
});
