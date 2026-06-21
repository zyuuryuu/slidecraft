/**
 * manuscript.test.ts — Raw manuscript (prose + headings, no slide structure) →
 * deterministic slide-structured Markdown: heading→slide, prose→bullets, table kept.
 */
import { describe, it, expect } from "vitest";
import { structureManuscript, isSlideStructured } from "../src/engine/manuscript";
import { parseMd } from "../src/engine/md-parser";

const MANUSCRIPT = `# 新CRM導入提案

## 背景
現行CRMはレスポンスが遅く、モバイル非対応。情報共有の遅れが遅延の主因。

## 目的
新システムを導入し、リアルタイム共有を実現する。データを安全に移行する。

## 比較
| 項目 | 現行 | 新 |
| --- | --- | --- |
| 速度 | 3.2s | 0.8s |`;

const titleOf = (s: ReturnType<typeof parseMd>["slides"][number]) =>
  s.placeholders.find((p) => p.idx === "15" || p.idx === "0")?.paragraphs.map((x) => x.segments.map((g) => g.text).join("")).join("") ?? "";

describe("structureManuscript", () => {
  it("splits a manuscript into per-heading slides (prose→bullets, table kept native)", () => {
    const deck = parseMd(structureManuscript(MANUSCRIPT));
    expect(deck.slides.length).toBe(4); // title + 背景 + 目的 + 比較

    const titles = deck.slides.map(titleOf);
    expect(titles).toEqual(expect.arrayContaining(["新CRM導入提案", "背景", "目的", "比較"]));

    const bg = deck.slides.find((s) => titleOf(s) === "背景");
    const bgBody = bg?.placeholders.find((p) => p.idx === "1");
    expect(bgBody?.paragraphs.length).toBe(2); // 2 sentences → 2 bullets
    expect(bgBody?.paragraphs.every((p) => p.bullet)).toBe(true);

    const cmp = deck.slides.find((s) => s.table);
    expect(cmp?.table?.rows[0]).toEqual(["項目", "現行", "新"]); // GFM table preserved → native table
  });

  it("leaves already slide-structured Markdown unchanged", () => {
    const slideMd = "<!-- slide: Title.1Title.Single -->\n# T\n\n---\n\n# A\n\n- x";
    expect(isSlideStructured(slideMd)).toBe(true);
    expect(structureManuscript(slideMd)).toBe(slideMd);
  });

  it("leaves heading-less prose alone (nothing to split on)", () => {
    const prose = "ただの段落です。改行もある。";
    expect(structureManuscript(prose)).toBe(prose);
  });
});
