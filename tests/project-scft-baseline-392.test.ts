/**
 * project-scft-baseline-392.test.ts — #392 段 0（既存動作の固定・テストのみ）: `.scft` 後方互換。
 *
 * #392 段 1 で SlideIR に `figures?: FigureBlock[]` が増える。その後も**今の形式で保存した `.scft` が同じ
 * DeckIR として開ける**ことを固定する（#121 の version gate → migrateProjectDeck → zod 検査の経路）。
 *
 * fixture `tests/fixtures/projects/visuals-v1.scft` は 2026-11-08 の main（PROJECT_VERSION = 1）で
 * `bundleProject(parseMd(tests/fixtures/slideir-baseline/visuals.md), 技術報告_スタンダード水色_TemplateOnly)` を
 * 保存したもの。**fixture は再生成しない**（古い形式の見本であることが目的。形式を変えたら新しい fixture を足す）。
 * スナップショットは使わない（期待値は fixture 自身の deck.json）。
 *
 * #392 段 1 以降で変わってよい点: なし。複数ビジュアルのスライド（表＋図・col 表｜図）も、保存済みファイル
 * としては今の単数フィールドのまま開けること（移行するなら migrate の段で、この期待値を満たしたうえで）。

 *
 * #392 段 1 の注記: .scft 側は何も変わらない（開いた DeckIR は保存時と一致）。変わったのは**同じ md の parse**で、
 * 「図が 2 つ」は旧 parser が後勝ち（2 つ目の図だけ）で保存していたのに対し、段 1 の parser は単数 diagram に
 * 1 つ目の図を入れ（裁定どおり）、2 つ目は figures に残す。よって「旧 .scft の書き出し == 今の md の書き出し」は
 * そのスライドだけ成り立たない（旧ファイルは旧挙動のまま描かれる＝後方互換は保たれている）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { openProject, bundleProject, PROJECT_VERSION } from "../src/engine/project-io";
import { loadTemplate } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";
import type { DeckIR } from "../src/engine/slide-schema";

const ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(ROOT, "tests/fixtures/projects/visuals-v1.scft");
const TEMPLATE = resolve(ROOT, "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let bytes: Buffer;
let rawDeck: DeckIR;
beforeAll(async () => {
  bytes = readFileSync(FIXTURE);
  rawDeck = JSON.parse(await (await JSZip.loadAsync(bytes)).file("deck.json")!.async("string")) as DeckIR;
});

async function slideHashes(deck: DeckIR, tplBytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(await generatePptx(deck, await loadTemplate(tplBytes)));
  const out: string[] = [];
  for (let n = 1; n <= deck.slides.length; n++) out.push(sha(await zip.file(`ppt/slides/slide${n}.xml`)!.async("string")));
  return out;
}

describe("#392 段 0: a v1 .scft saved today opens to the same DeckIR", () => {
  it("the fixture is a v1 file and this build still writes v1", async () => {
    expect(PROJECT_VERSION).toBe(1);
    const { meta } = await openProject(bytes);
    expect(meta).toEqual({ version: 1, templateName: "技術報告 スタンダード水色", savedAt: "2026-11-08T00:00:00.000Z" });
  });
  it("openProject → deck deep-equals the stored deck.json (no field dropped or rewritten by migrate/zod)", async () => {
    const { deck } = await openProject(bytes);
    expect(deck).toEqual(rawDeck);
    expect(deck.slides).toHaveLength(16);
  });
  it("the stored deck still carries the multi-visual slides in today's single fields", () => {
    const title = (t: string) => rawDeck.slides.find((s) => s.placeholders.some((p) => p.idx === "15" && p.paragraphs[0]?.segments[0]?.text === t))!;
    expect(title("表と図（現状は重なる）")).toMatchObject({ table: { placeholderIdx: "1" }, diagram: { placeholderIdx: "1" } });
    expect(title("col 表｜図")).toMatchObject({ table: { placeholderIdx: "1" }, diagram: { placeholderIdx: "2" } });
    expect(title("画像の属性つき").image).toMatchObject({ rect: { x: 1.5, y: 2, w: 4, h: 3 }, fit: "cover", aspect: 1.333 });
    expect(title("背面画像").image).toMatchObject({ behind: true });
  });
  it("save → open is idempotent (re-bundling the opened project opens to the same deck)", async () => {
    const { deck, template, meta } = await openProject(bytes);
    const again = await openProject(await bundleProject(deck, template, meta));
    expect(again.deck).toEqual(deck);
    expect(again.template.layouts.map((l) => l.name)).toEqual(template.layouts.map((l) => l.name));
  });
  it("the opened project exports the same slide XML as the source md on the shipped template", async () => {
    const { deck, template } = await openProject(bytes);
    const fromProject = await slideHashes(deck, await template.zip.generateAsync({ type: "uint8array" }));
    const fromMd = await slideHashes(parseMd(readFileSync(resolve(ROOT, "tests/fixtures/slideir-baseline/visuals.md"), "utf8")), readFileSync(TEMPLATE));
    // #392 段 1: 同種 2 つの「図が 2 つ」だけは md の意味が変わった（上記注記）。その 1 枚を除き一致すること。
    const sameKindPair = rawDeck.slides.findIndex((sl) => sl.placeholders.some((p) => p.paragraphs[0]?.segments[0]?.text?.startsWith("図が 2 つ")));
    expect(rawDeck.slides[sameKindPair].diagram!.yaml).toContain("id: two"); // saved by the last-wins parser
    expect(fromProject.filter((_, i) => i !== sameKindPair)).toEqual(fromMd.filter((_, i) => i !== sameKindPair));
    expect(fromProject[sameKindPair]).not.toBe(fromMd[sameKindPair]);
  });
});
