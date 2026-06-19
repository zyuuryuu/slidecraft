/**
 * json-salvage.test.ts — Tolerant parsing of imperfect small-model JSON.
 * Centers on the reported bug: Japanese \uXXXX escapes with one malformed escape.
 */
import { describe, it, expect } from "vitest";
import {
  tolerantJsonParse,
  parseJsonLoose,
  repairEscapes,
  removeTrailingCommas,
  escapeControlChars,
  normalizeWhitespace,
} from "../src/engine/json-salvage";
import { extractSlidePlan, extractDeckPlan } from "../src/engine/deck-plan";

describe("tolerantJsonParse", () => {
  it("leaves valid JSON untouched (incl. valid \\uXXXX and raw UTF-8)", () => {
    expect(tolerantJsonParse('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    // valid \u escapes decode correctly
    expect(tolerantJsonParse(String.raw`{"t":"データ"}`)).toEqual({ ok: true, value: { t: "データ" } });
    // raw UTF-8 Japanese (the hardened-prompt happy path)
    expect(tolerantJsonParse('{"t":"データ処理"}')).toEqual({ ok: true, value: { t: "データ処理" } });
  });

  it("repairs the reported bug: a MALFORMED \\u escape no longer crashes", () => {
    // valid escapes + one truncated "\u30c" (3 hex) — strict JSON.parse throws "Bad Unicode escape"
    const raw = String.raw`{"t":"デ","bad":"\u30c"}`;
    expect(() => JSON.parse(raw)).toThrow(); // strict fails
    const r = tolerantJsonParse(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.value as Record<string, string>).t).toBe("デ"); // valid one still decodes
      expect((r.value as Record<string, string>).bad).toContain("u30c"); // bad one kept as literal, not lost
    }
  });

  it("repairs a non-hex \\u, a stray backslash, trailing commas, and raw newlines", () => {
    expect(tolerantJsonParse(String.raw`{"t":"\u30cg"}`).ok).toBe(true);
    expect(tolerantJsonParse(String.raw`{"t":"a\zb"}`).ok).toBe(true);
    expect(tolerantJsonParse('{"a":1,}').ok).toBe(true);
    expect(tolerantJsonParse('{"list":[1,2,],}').ok).toBe(true);
    expect(tolerantJsonParse('{"t":"line1\nline2"}').ok).toBe(true); // raw control char inside string
  });

  it("returns a clear error when truly unrecoverable", () => {
    const r = tolerantJsonParse("not json at all <<<");
    expect(r.ok).toBe(false);
  });
});

describe("repair helpers", () => {
  it("repairEscapes preserves valid escapes, doubles bad ones", () => {
    expect(repairEscapes(String.raw`デ`)).toBe(String.raw`デ`); // valid kept
    expect(repairEscapes(String.raw`\n\t\\`)).toBe(String.raw`\n\t\\`); // valid kept
    expect(repairEscapes(String.raw`\u30c`)).toBe(String.raw`\\u30c`); // truncated → literal
    expect(repairEscapes(String.raw`\z`)).toBe(String.raw`\\z`); // stray → literal
  });
  it("removeTrailingCommas", () => {
    expect(removeTrailingCommas('[1,2,]')).toBe('[1,2]');
    expect(removeTrailingCommas('{"a":1, }')).toBe('{"a":1 }');
  });
  it("escapeControlChars escapes only inside strings", () => {
    expect(escapeControlChars('{\n"a":"x\ny"}')).toBe('{\n"a":"x\\ny"}'); // structural \n kept, in-string \n escaped
  });
});

describe("red-team gaps — Unicode whitespace between tokens (Japanese IME)", () => {
  const NBSP = "\u00A0";
  const IDEO = "\u3000"; // full-width space — the most likely fault for a Japanese model
  const ZWSP = "\u200B";

  it("recovers full-width / non-breaking / zero-width space between tokens", () => {
    expect(tolerantJsonParse(`{${IDEO}"a":1}`).ok).toBe(true);
    expect(tolerantJsonParse(`{"a":1,${IDEO}"b":2}`).ok).toBe(true);
    expect(tolerantJsonParse(`{${NBSP}"a":1}`).ok).toBe(true);
    expect(tolerantJsonParse(`{"a":1,${ZWSP}"b":2}`).ok).toBe(true);
  });

  it("PRESERVES Unicode whitespace INSIDE string values (legit content)", () => {
    const r = tolerantJsonParse(`{"t":"全角${IDEO}空白"}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, string>).t).toBe(`全角${IDEO}空白`); // not normalized
  });

  it("normalizeWhitespace only touches outside-string whitespace", () => {
    expect(normalizeWhitespace(`{${IDEO}"k":"a${IDEO}b"}`)).toBe(`{ "k":"a${IDEO}b"}`);
  });
});

describe("red-team gaps — structural faults", () => {
  it("single-quoted strings and keys", () => {
    expect(tolerantJsonParse(`{'kind':'content','title':'A'}`).ok).toBe(true);
    expect(tolerantJsonParse(`{'kind':"content",'title':"A"}`).ok).toBe(true);
  });
  it("unquoted identifier keys", () => {
    const r = tolerantJsonParse(`{kind:"content",title:"A",bullets:["x"]}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, unknown>).kind).toBe("content");
  });
  it("Python literals and comments", () => {
    expect(tolerantJsonParse(`{"a":True,"b":False,"c":None}`)).toEqual({
      ok: true,
      value: { a: true, b: false, c: null },
    });
    expect(tolerantJsonParse(`{"a":1 // note\n,"b":2}`).ok).toBe(true);
    expect(tolerantJsonParse(`{"a":1 /* x */,"b":2}`).ok).toBe(true);
  });
});

describe("red-team gaps — lone surrogates (would break PPTX XML)", () => {
  it("replaces a lone surrogate with U+FFFD", () => {
    const r = tolerantJsonParse(String.raw`{"t":"\uD83D"}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, string>).t).toBe("�");
  });
  it("KEEPS a valid emoji surrogate pair intact", () => {
    const r = tolerantJsonParse(String.raw`{"t":"😀"}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, string>).t).toBe("😀");
  });
});

describe("red-team gaps — extraction (parseJsonLoose)", () => {
  it("returns the FIRST of two JSON blocks", () => {
    const r = parseJsonLoose(`{"kind":"title","title":"T"}\n{"kind":"content","title":"C","bullets":["A"]}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, string>).kind).toBe("title");
  });
  it("skips a prose {placeholder} and finds the real JSON", () => {
    const r = parseJsonLoose(`Use {placeholder} like:\n{"kind":"content","title":"概要","bullets":["A"]}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, string>).title).toBe("概要");
  });
  it("completes truncated output (missing closer / cut mid-string)", () => {
    expect(parseJsonLoose(`{"kind":"content","title":"概要","bullets":["A"`).ok).toBe(true);
    const r = parseJsonLoose(`{"kind":"content","title":"概要`);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, string>).title).toBe("概要");
  });
  it("a truncated per-slide edit still yields a usable slide", () => {
    const r = extractSlidePlan(`{"kind":"content","title":"システム構成","bullets":["入力","検証"`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slide.title).toBe("システム構成");
  });
});

describe("verify-v2 gaps — truncation prefers the OUTER object, key surrogates", () => {
  it("a truncated deck recovers the WHOLE deck, not just an inner array", () => {
    const r = extractDeckPlan(`{"slides":[{"kind":"content","title":"概要","bullets":["A","B"]`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.slides).toHaveLength(1);
      expect(r.plan.slides[0].kind).toBe("content");
    }
  });
  it("a multi-slide truncated deck recovers the complete slides", () => {
    const r = extractDeckPlan(`{"slides":[{"kind":"title","title":"T"},{"kind":"content","title":"C","bullets":["x","y"]`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.slides.length).toBeGreaterThanOrEqual(2);
  });
  it("a cut-mid-key truncation drops the dangling key and keeps the rest", () => {
    const r = parseJsonLoose(`{"a":1,"titl`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });
  it("sanitizes a lone surrogate in an object KEY (would break XML)", () => {
    const r = tolerantJsonParse(String.raw`{"k\uD83D":"v"}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const key = Object.keys(r.value as object)[0];
      expect(/[\uD800-\uDFFF]/.test(key)).toBe(false);
    }
  });
});

describe("valid JSON is never altered by the repair pipeline", () => {
  it.each([
    '{"a":1,"b":[1,2,3],"c":"テスト"}',
    '{"kind":"content","title":"提案","bullets":["A","B"]}',
    '{"t":"quote: \\"hi\\" and slash /"}',
    '{"t":"line\\nbreak\\ttab"}',
  ])("passes %s through unchanged", (s) => {
    expect(tolerantJsonParse(s)).toEqual({ ok: true, value: JSON.parse(s) });
  });
});

describe("extractSlidePlan / extractDeckPlan survive small-model faults", () => {
  it("a per-slide edit with \\u-escaped Japanese + one bad escape still parses (the reported case)", () => {
    // Mimics Granite-via-Ollama: kind=content, Japanese unicode-escaped, one malformed escape.
    const modelOutput = String.raw`{"kind":"content","title":"データフロー","bullets":["ユーザー入力","バリデーション","処理データトップス処理で表示します。"]}`;
    const r = extractSlidePlan(modelOutput);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.slide.kind).toBe("content");
      expect(r.slide.title).toBe("データフロー");
    }
  });

  it("a per-slide edit that ACTUALLY contains a malformed escape recovers", () => {
    const modelOutput = String.raw`{"kind":"content","title":"テスト","bullets":["項目A","壊れた\u30cエスケープ"]}`;
    expect(() => JSON.parse(modelOutput)).toThrow();
    const r = extractSlidePlan(modelOutput);
    expect(r.ok).toBe(true);
  });

  it("a deck plan with a trailing comma + raw Japanese parses", () => {
    const modelOutput = '{"slides":[{"kind":"title","title":"提案"},{"kind":"closing","title":"ご清聴ありがとうございました",}]}';
    const r = extractDeckPlan(modelOutput);
    expect(r.ok).toBe(true);
  });
});
