/**
 * json-missing-comma.test.ts — Repair MISSING commas in weak-model JSON.
 * Reproduces the real qwen2.5:7b fault: a closing slide with no comma between
 * "title" and "subtitle" made the WHOLE deck JSON unparseable.
 */
import { describe, it, expect } from "vitest";
import { parseJsonLoose, insertMissingCommas } from "../src/engine/json-salvage";
import { extractDeckPlan } from "../src/engine/deck-plan";

describe("insertMissingCommas", () => {
  it("inserts commas between adjacent values (object props, array items, objects)", () => {
    expect(JSON.parse(insertMissingCommas('{"a":1 "b":2}'))).toEqual({ a: 1, b: 2 });
    expect(JSON.parse(insertMissingCommas('["a" "b"]'))).toEqual(["a", "b"]);
    expect(JSON.parse(insertMissingCommas('[{"a":1} {"b":2}]'))).toEqual([{ a: 1 }, { b: 2 }]);
    expect(JSON.parse(insertMissingCommas('{"t":"x"\n  "s":"y"}'))).toEqual({ t: "x", s: "y" });
  });
  it("leaves valid JSON byte-for-byte unchanged (no spurious commas)", () => {
    for (const valid of ['{"a":1,"b":[1,2,3],"c":{"d":"e"},"f":true,"g":null}', '{"k": "v"}', '[]', '{}', '"plain"']) {
      expect(insertMissingCommas(valid)).toBe(valid);
    }
  });
  it("does not corrupt commas/colons inside string values", () => {
    expect(JSON.parse(insertMissingCommas('{"m":"a, b: c \\"d\\""}'))).toEqual({ m: 'a, b: c "d"' });
  });
});

describe("parseJsonLoose + DeckPlan with a missing comma", () => {
  it("parses the real closing-slide fault (title then subtitle, no comma)", () => {
    const bad = `{ "kind": "closing", "title": "CRM移行計画の影響"\n  "subtitle": "高速な進行" }`;
    const r = parseJsonLoose(bad);
    expect(r.ok).toBe(true);
  });
  it("recovers the whole deck despite a missing comma in one slide", () => {
    const json = `{ "slides": [
      {"kind":"title","title":"CRM移行計画"},
      {"kind":"table","title":"比較","headers":["機能","現状"],"rows":[["共有","遅れ"]]},
      {"kind":"diagram","title":"フロー","mermaid":"flowchart LR\\n  A --> B"},
      {"kind":"closing","title":"影響"  "subtitle":"効率向上"}
    ]}`;
    const r = extractDeckPlan(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.slides).toHaveLength(4);
  });
});
