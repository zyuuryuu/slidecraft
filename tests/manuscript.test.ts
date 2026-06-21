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

  it("VISUALIZE: key-value bullets → native table; non-pair bullets stay bullets", () => {
    const ms = `# 製品X

## 仕様
- 速度: 0.8秒
- 対応: モバイル完全対応
- 料金: ¥1,200/月

## 比較
- 現行は遅い
- 新は速い`;
    const deck = parseMd(structureManuscript(ms));
    const spec = deck.slides.find((s) => s.table);
    expect(spec?.table?.rows).toEqual([
      ["項目", "内容"], ["速度", "0.8秒"], ["対応", "モバイル完全対応"], ["料金", "¥1,200/月"],
    ]);
    const cmp = deck.slides.find((s) => titleOf(s) === "比較");
    expect(cmp?.table).toBeUndefined(); // not key-value → kept as bullets
    expect(cmp?.placeholders.find((p) => p.idx === "1")?.paragraphs.length).toBe(2);
  });

  it("a heading with no body becomes a section divider (autoSelect)", async () => {
    const { autoSelectLayout } = await import("../src/engine/template-loader");
    const deck = parseMd(structureManuscript("# T\n\n## 第1部\n\n## 内容\n- a"));
    const divider = deck.slides.find((s) => titleOf(s) === "第1部");
    // title-only content slide → autoSelect resolves to a Section layout
    expect(autoSelectLayout(divider!, 1, deck.slides.length)).toMatch(/Section/i);
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
