/**
 * visual-baseline-392.test.ts — #392 段 0（既存動作の固定・テストのみ）: 出荷 3 テンプレでの
 * (1) ビジュアル配置（slideRoleRegions の役割と body 領域数・autoSelectLayout・visual-placement の ordinal 解決）
 * (2) PPTX golden（書き出した slide XML／rels の sha256）。
 *
 * - 入力: `tests/fixtures/slideir-baseline/visuals.md`（ビジュアル 1 つ・本文＋ビジュアル・表＋図・col・同種 2 つ・
 *   Mermaid を 1 スライドずつ）。テンプレは `public/templates/slide/*_TemplateOnly.pptx`（アプリ同梱の 3 本・commit 済み）。
 * - 既存の golden（layout-augment-golden.test.ts の 3 列テキスト）とは重ならない。
 * - 段 0 では「表＋図が重なる」挙動（表と図が両方 ordinal 1 → 同じ placeholder を取り合う）を固定していた。
 *   #392 段 2 で別々の body 領域に置くよう変わった（figure-placement）— MULTI のスライドだけ再固定。
 *
 * 更新手順: 挙動を意図して変えたときだけ `npx vitest run tests/visual-baseline-392.test.ts -u` で
 * tests/__snapshots__/visual-baseline-392.test.ts.snap を書き直す。sha256 の差分は、書き出した XML を実際に
 * 開いて読んでから更新すること。**#392 段 1 以降で変わってよいのは複数ビジュアルのスライドだけ**
 * （MULTI に列挙したタイトル）。単一ビジュアルのスライドの差分は不変条件（byte-identical）違反。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, autoSelectLayout, slideRoleRegions, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import {
  bodyPlaceholders, nthBody, imagePlaceholder, visualOccupancy, visualCollisions, unboundVisuals,
} from "../src/engine/visual-placement";
import type { SlideIR } from "../src/engine/slide-schema";

const ROOT = resolve(__dirname, "..");
const TPL_DIR = resolve(ROOT, "public/templates/slide");
const TEMPLATES = readdirSync(TPL_DIR).filter((f) => f.endsWith(".pptx")).sort();
const deck = parseMd(readFileSync(resolve(ROOT, "tests/fixtures/slideir-baseline/visuals.md"), "utf8"));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const titleOf = (s: SlideIR) => s.placeholders.find((p) => p.idx === "15")?.paragraphs[0]?.segments[0]?.text ?? "";

/** Slides that carry 2+ visuals (or lost one) today — the only ones #392 may change. */
const MULTI = ["表と図（現状は重なる）", "col 表｜図", "図が 2 つ（現状は先の図が落ちる）"];

const loaded: Record<string, TemplateData> = {};
beforeAll(async () => {
  for (const f of TEMPLATES) loaded[f] = await loadTemplate(readFileSync(resolve(TPL_DIR, f)));
});

// #595 Pitch・#596 エグゼクティブ・#598 マーケ（writer プリセット）を出荷に追加 → 入力は 6 本（既存の snapshot は不変）。
it("#392 段 0: the shipped templates are the input (committed under public/)", () => {
  expect(TEMPLATES).toEqual([
    "エグゼクティブ_Executive_TemplateOnly.pptx", // #596 で追加（5 本目）
    "セールスピッチ_Pitch_TemplateOnly.pptx", // #595 で追加（4 本目）。既存 3 本の golden は不変
    "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
    "マーケ_Campaign_TemplateOnly.pptx", // #598 で追加（6 本目）。既存 5 本の golden は不変
    "技術報告_スタンダード水色_TemplateOnly.pptx",
    "配布資料_公文書高密度_TemplateOnly.pptx",
  ]);
  expect(deck.slides.map(titleOf)).toEqual(expect.arrayContaining(MULTI));
});

describe("#392 段 0: slideRoleRegions (template-independent role + body-region count)", () => {
  it("per slide of visuals.md", () => {
    const n = deck.slides.length;
    expect(Object.fromEntries(deck.slides.map((s, i) => [`${i} ${titleOf(s)}`, slideRoleRegions(s, i, n)]))).toMatchSnapshot();
  });
});

/** Where each visual of a slide resolves on the auto-picked layout of `tpl` — the same resolvers export uses. */
function placement(tpl: TemplateData, s: SlideIR, i: number) {
  const catalog = buildCatalog(tpl);
  const layoutName = autoSelectLayout(s, i, deck.slides.length, catalog);
  const phs = findLayout(tpl, layoutName)!.placeholders;
  const body = bodyPlaceholders(phs);
  const resolved: Record<string, string | null> = {};
  for (const k of ["diagram", "mermaidBlock", "table", "code"] as const) {
    const v = s[k];
    if (v) resolved[k] = `${v.placeholderIdx} → ${nthBody(body, v.placeholderIdx)?.idx ?? "none"}`;
  }
  if (s.image) resolved.image = `${s.image.placeholderIdx} → ${s.image.behind ? "behind" : imagePlaceholder(phs, s.image.placeholderIdx)?.idx ?? "none"}`;
  return {
    layout: layoutName,
    bodyIdxs: body.map((p) => p.idx),
    resolved,
    occupancy: Object.fromEntries(visualOccupancy(s, phs)),
    collisions: visualCollisions(s, phs),
    unbound: unboundVisuals(s, phs),
  };
}

describe("#392 段 0: visual placement per shipped template (auto layout · ordinal → placeholder · collisions)", () => {
  for (const f of TEMPLATES) {
    it(f, () => {
      const out = Object.fromEntries(deck.slides.map((s, i) => [`${i} ${titleOf(s)}`, placement(loaded[f], s, i)]));
      expect(out).toMatchSnapshot();
    });
  }
  it("[#392 段 2 で変更] table + diagram (no col): each gets its own body region → no collision, nothing unbound, on every template", () => {
    const i = deck.slides.findIndex((s) => titleOf(s) === MULTI[0]);
    for (const f of TEMPLATES) {
      const p = placement(loaded[f], deck.slides[i], i);
      expect(p.collisions, f).toEqual([]);
      expect(p.unbound, f).toEqual([]);
      expect(Object.values(p.occupancy).sort(), f).toEqual(["diagram", "table"]); // two different placeholders
    }
  });
  it("single-visual and col slides have no collision on any template", () => {
    for (const f of TEMPLATES) {
      deck.slides.forEach((s, i) => {
        if (MULTI.includes(titleOf(s))) return;
        expect(placement(loaded[f], s, i).collisions, `${f} / ${titleOf(s)}`).toEqual([]);
      });
    }
  });
});

describe("#392 段 0: PPTX golden — slide XML / rels sha256 per shipped template", () => {
  for (const f of TEMPLATES) {
    it(f, async () => {
      const zip = await JSZip.loadAsync(await generatePptx(deck, loaded[f]));
      const out: Record<string, string> = {};
      for (let n = 1; n <= deck.slides.length; n++) {
        const title = titleOf(deck.slides[n - 1]);
        out[`slide${n}.xml ${title}`] = sha(await zip.file(`ppt/slides/slide${n}.xml`)!.async("string"));
        out[`slide${n}.xml.rels ${title}`] = sha(await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async("string"));
      }
      expect(zip.file(`ppt/slides/slide${deck.slides.length + 1}.xml`)).toBeNull();
      expect(out).toMatchSnapshot();
    });
  }
  // 現状の挙動（#392 の範囲外・PR で統括に報告）: 本文＋画像のスライドは画像が ordinal 1 のまま本文の
  // placeholder を占有するので、本文テキストは PPTX に描かれない（deck-diagnostics の visual-shadowed-content が報告）。
  // 表／図／コードは本文の隣で ordinal 2 に移る（#390）ので本文は残る。この差も固定しておく。
  it("body text beside an image is NOT drawn; beside a table/diagram/code it is (current behavior)", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(deck, loaded["技術報告_スタンダード水色_TemplateOnly.pptx"])); // 名前で指す（#595 で並びが変わった）
    const xmlOf = async (title: string) =>
      zip.file(`ppt/slides/slide${deck.slides.findIndex((s) => titleOf(s) === title) + 1}.xml`)!.async("string");
    expect(await xmlOf("画像の属性つき")).not.toContain("本文の箇条");
    expect(await xmlOf("col 本文｜画像")).not.toContain("画像の説明");
    expect(await xmlOf("背面画像")).toContain("前面の本文"); // a behind image claims no placeholder
    expect(await xmlOf("本文と図")).toContain("左の説明");
    expect(await xmlOf("本文と表")).toContain("表の説明");
    expect(await xmlOf("本文とコード")).toContain("コードの説明");
    expect(await xmlOf("col 本文｜図")).toContain("左カラムの本文");
  });
});
