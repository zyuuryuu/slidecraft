import { describe, it, expect } from "vitest";
import { validateCondense } from "../src/engine/ai-validate";
import type { FitBox } from "../src/engine/distill";

const BIG: FitBox = { charsPerLine: 59, maxLines: 22 };
const TINY: FitBox = { charsPerLine: 20, maxLines: 3 };

describe("validateCondense — the small-model guardrail", () => {
  it("clean JA condense: facts kept, within budget, language preserved → ok", () => {
    const before = "# 2026年Q1業績\n\n- 売上高は前年同期比23%増の14億2000万円となり過去最高を更新した";
    const after = "# 2026年Q1業績\n\n- 売上高: 23%増、14億2000万円（過去最高）";
    const v = validateCondense(before, after, BIG);
    expect(v.ok).toBe(true);
    expect(v.hasHard).toBe(false);
    expect(v.violations).toHaveLength(0);
  });

  it("dropped number → HARD fact violation", () => {
    const before = "# 顧客\n\n- 新規顧客は340社から520社へ増加した";
    const after = "# 顧客\n\n- 新規顧客: 520社へ増加"; // 340 dropped
    const v = validateCondense(before, after, BIG);
    expect(v.hasHard).toBe(true);
    expect(v.violations.some((x) => x.kind === "fact")).toBe(true);
  });

  it("JA → Chinese drift (kana lost) → HARD language violation", () => {
    const before = "# 概要\n\n- 速度は毎秒0.8メートルで安定している";
    const after = "# 概要\n\n- 速度每秒0.8米，稳定运行"; // Han only, no kana
    const v = validateCondense(before, after, BIG);
    expect(v.hasHard).toBe(true);
    expect(v.violations.some((x) => x.kind === "language")).toBe(true);
  });

  it("EN → JA translation → HARD language violation", () => {
    const before = "# Summary\n\n- Revenue grew 23% year-over-year to $14.2M this quarter";
    const after = "# 概要\n\n- 収益が23%増、$14.2M"; // translated to JA
    const v = validateCondense(before, after, BIG);
    expect(v.hasHard).toBe(true);
    expect(v.violations.some((x) => x.kind === "language")).toBe(true);
  });

  it("JSON ops instead of Markdown → HARD parse violation", () => {
    const before = "# 概要\n\n- 速度: 0.8秒";
    const after = '[{"op":"regionSplit","arrangement":"text-left"}]';
    const v = validateCondense(before, after, BIG);
    expect(v.hasHard).toBe(true);
    expect(v.violations.some((x) => x.kind === "parse")).toBe(true);
  });

  it("over-length bullet → SOFT budget violation (not hard)", () => {
    const before = "# x\n\n- " + "あ".repeat(40);
    const after = "# x\n\n- " + "い".repeat(30); // 30 > TINY.charsPerLine 20
    const v = validateCondense(before, after, TINY);
    expect(v.violations.some((x) => x.kind === "budget")).toBe(true);
    expect(v.hasHard).toBe(false); // budget is soft — still an improvement
    expect(v.ok).toBe(false);
  });

  it("too many bullets → SOFT budget violation", () => {
    const before = "# x\n\n- a\n- b\n- c\n- d\n- e";
    const after = "# x\n\n- a\n- b\n- c\n- d\n- e"; // 5 > TINY.maxLines 3
    const v = validateCondense(before, after, TINY);
    expect(v.violations.some((x) => x.kind === "budget")).toBe(true);
    expect(v.hasHard).toBe(false);
  });

  it("all-kanji JA (no kana) gets no false language flag", () => {
    const before = "# 概要\n\n- 売上高増加、利益率改善";
    const after = "# 概要\n\n- 売上増加、利益改善";
    const v = validateCondense(before, after, BIG);
    expect(v.violations.some((x) => x.kind === "language")).toBe(false);
  });

  it("no budget box → skips budget checks but still guards fact/language/parse", () => {
    const before = "# x\n\n- 340社から520社へ";
    const after = "# x\n\n- 520社へ"; // dropped 340
    const v = validateCondense(before, after);
    expect(v.violations.some((x) => x.kind === "budget")).toBe(false);
    expect(v.violations.some((x) => x.kind === "fact")).toBe(true);
  });
});
