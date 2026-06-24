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

  it("H1 preamble → title-less lead slide, NOT the cover subtitle (no data loss)", () => {
    // The old behavior put the 1st preamble line on the cover as ## subtitle and DROPPED
    // the rest (e.g. an attendees line). It must keep every line on its own lead slide.
    const md = "# キックオフ議事録\n\n2026-06-23 会議室B\n出席：田中、佐藤、鈴木\n\n## 議題\n\n- A\n- B";
    const structured = structureManuscript(md);
    expect(structured.split("---")[0]).not.toMatch(/\n##\s/); // cover: title only, no subtitle

    const deck = parseMd(structured);
    const cover = deck.slides[0];
    expect(titleOf(cover)).toBe("キックオフ議事録");
    expect(cover.placeholders.find((p) => p.idx === "1")).toBeUndefined(); // no subtitle on cover
    // every preamble line survives somewhere in the deck (incl. the attendees line)
    const json = JSON.stringify(deck);
    for (const name of ["出席", "田中", "佐藤", "鈴木"]) expect(json).toContain(name);
  });

  it("a SHORT clean H1 preamble (single line, no 句読点) becomes the cover subtitle", () => {
    const md = "# 2026年度 営業戦略\n\n営業本部 山田太郎\n\n## 概況\n\n- A";
    const cover = parseMd(structureManuscript(md)).slides[0];
    expect(titleOf(cover)).toBe("2026年度 営業戦略");
    const sub = cover.placeholders.find((p) => p.idx === "1");
    expect(sub?.paragraphs.map((x) => x.segments.map((g) => g.text).join("")).join("")).toBe("営業本部 山田太郎");
  });

  it("a subtitle + short metadata (affiliation / name) all sit on the cover", () => {
    const md = "# 新規事業提案\n\nAI を活用した新サービス構想\n営業本部 山田太郎\n\n## 背景\n\n- A";
    const cover = parseMd(structureManuscript(md)).slides[0];
    expect(titleOf(cover)).toBe("新規事業提案");
    const subText = cover.placeholders.find((p) => p.idx === "1")?.paragraphs.map((x) => x.segments.map((g) => g.text).join("")).join(" ") ?? "";
    expect(subText).toContain("AI を活用した新サービス構想"); // subtitle
    expect(subText).toContain("営業本部 山田太郎"); // metadata also on the cover
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

  it("keeps consecutive 'ラベル: 値' spec lines as separate bullets → native table (not a run-on)", () => {
    // Raw manuscript spec lines on their own lines, no blank between, no 。 — must NOT
    // merge into one bullet (which would defeat the visualize→table lever).
    const ms = `# レポート\n\n## 指標\n想定ピーク: 8000 RPS\n仮想ユーザ数: 12000\n試験時間: 25分`;
    const deck = parseMd(structureManuscript(ms));
    const spec = deck.slides.find((s) => s.table);
    expect(spec?.table?.rows).toEqual([
      ["項目", "内容"], ["想定ピーク", "8000 RPS"], ["仮想ユーザ数", "12000"], ["試験時間", "25分"],
    ]);
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
