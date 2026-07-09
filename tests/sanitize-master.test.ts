/**
 * sanitize-master.test.ts — 構造双子の「忠実性の機械証明」（master-intake.md §3.1）。
 *
 * 双子は実物と、パーサが見る全てにおいて一致しなければならない:
 *   - buildCatalog: レイアウト数・各レイアウトの role/bodyCount・placeholder の (role,idx,type) 列
 *   - detectPathologies: flag のカウント（parse-audit 一致）
 *   - slideSize
 * 一致すれば「twin は parser 検証用途で実物と等価」＝機密ゼロでコミット可能。
 * さらに sanitizeName がロール分類キーワードを保存すること（機密は落ちること）も検証。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { detectPathologies } from "../src/engine/master-pathology";
import { sanitizeMasterBytes, sanitizeName } from "../scripts/sanitize-master";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);

// 実物と twin で「パーサが見る構造」が完全一致することを assert
async function assertTwinFaithful(bytes: Uint8Array, label: string) {
  const real = await loadTemplate(bytes);
  const twin = await loadTemplate(await sanitizeMasterBytes(bytes));

  const rc = buildCatalog(real), tc = buildCatalog(twin);
  expect(tc.length, `${label}: layout count`).toBe(rc.length);
  for (let i = 0; i < rc.length; i++) {
    expect(tc[i].role, `${label}: layout[${i}] classifyLayout role`).toBe(rc[i].role);
    expect(tc[i].bodyCount, `${label}: layout[${i}] bodyCount`).toBe(rc[i].bodyCount);
    expect(tc[i].placeholders.map((p) => `${p.role}@${p.idx}`), `${label}: layout[${i}] placeholder roles`)
      .toEqual(rc[i].placeholders.map((p) => `${p.role}@${p.idx}`));
  }
  // parse-audit（病理 flag）も一致
  const rp = detectPathologies(real, "real"), tp = detectPathologies(twin, "twin");
  expect(tp.counts, `${label}: pathology flag counts`).toEqual(rp.counts);
  expect(tp.slideSize, `${label}: slide size`).toEqual(rp.slideSize);
  return { real, twin };
}

describe("sanitizeMasterBytes — 構造双子は parser 検証用途で実物と等価", () => {
  it("velis_CC0（実世界 outlier: A4・複数master・typeless高idx）で忠実", async () => {
    await assertTwinFaithful(readFileSync(fx("lrk-slides-velis_CC0.pptx")), "velis");
  });
  it("Midnight_Executive（canonical・ドット名・idx-META）で忠実", async () => {
    await assertTwinFaithful(readFileSync(pub("Midnight_Executive_30_TemplateOnly.pptx")), "Midnight");
  });
  it("配布資料_公文書高密度（日本語・高密度）で忠実", async () => {
    await assertTwinFaithful(readFileSync(pub("配布資料_公文書高密度_TemplateOnly.pptx")), "配布資料");
  });
  // CX / 会社 .potx は gitignore（IP）→ ローカルのみ実行（CI では skip）。
  it.skipIf(!existsSync(fx("CX_sample_MSGothic.pptx")))("CX_sample（bare third-party）で忠実", async () => {
    await assertTwinFaithful(readFileSync(fx("CX_sample_MSGothic.pptx")), "CX");
  });
});

describe("sanitizeName — 分類キーワードを保存し機密を落とす", () => {
  it("ロールキーワードは残る", () => {
    expect(sanitizeName("Title Slide_white_CX")).toMatch(/Title/i); // "Title" 保存
    expect(sanitizeName("06_まとめ")).toContain("まとめ"); // closing 保存
    expect(sanitizeName("Two Column Content")).toMatch(/Column/i); // columns 保存
    expect(sanitizeName("Column.3Body.Equal")).toMatch(/^Column\./); // ドット family 保存
  });
  it("機密（社名/製品名/非キーワード語）は落ちる", () => {
    expect(sanitizeName("AcmeCorp Presentation")).not.toMatch(/Acme|Presentation/); // 落ちる
    expect(sanitizeName("Title Slide_white_CX")).not.toContain("CX"); // "CX" 落ちる
    expect(sanitizeName("Title Slide_white_CX")).not.toMatch(/white/); // "white" 落ちる
  });
});
