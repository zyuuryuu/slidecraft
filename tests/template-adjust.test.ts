/**
 * template-adjust.test.ts — #570 段 2: テンプレの派生コピーに決定論の変換（書体置換 → サイズ倍率）を掛ける
 * `adjustTemplate(bytes, recipe) → bytes`。
 *
 * fixture 4 種（Midnight／配布資料_公文書高密度／ビジュアルデッキ_マガジン／技術報告_スタンダード水色）で:
 *  (a) レシピ無し・倍率 1.0・置換なし・実質無変化のレシピは byte-identical（元テンプレ不変）
 *  (b) 全 defRPr@sz が規則どおり（0.5pt 丸め・[1pt, 400pt]・1pt の区切り線枠は 1pt のまま）
 *  (c) theme と違う名前（Consolas のコード枠）は不変
 *  (d) 調整後の loadTemplate で masterBodyStyle / placeholderCapacity / title-fit が追随（容量見積りは
 *      マスターの sz を読む 1 経路のまま）
 *  (e) scope の切替で lstStyle 直書きの実名が置換される／されない（theme の script="Jpan" も置換）
 *  (f) golden（調整済みテンプレで書き出した PPTX の sha256）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth, placeholderRole, placeholderCapacity } from "../src/engine/template-catalog";
import { fitTitle } from "../src/engine/title-fit";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import { adjustTemplate, scaleSz, type TemplateAdjustRecipe } from "../src/engine/template-adjust";

const fx = (f: string) => readFileSync(resolve(__dirname, "fixtures/templates", f));
const FIXTURES = {
  midnight: "Midnight_Executive_30_TemplateOnly.pptx",
  koubun: "配布資料_公文書高密度_全レイアウト見本.pptx",
  magazine: "ビジュアルデッキ_マガジン_全レイアウト見本.pptx",
  tech: "技術報告_スタンダード水色_全レイアウト見本.pptx",
} as const;
const ALL = Object.entries(FIXTURES) as [keyof typeof FIXTURES, string][];

const STYLE_PART = /^ppt\/(slideMasters\/slideMaster\d+|slideLayouts\/slideLayout\d+)\.xml$/;
const THEME = "ppt/theme/theme1.xml";

/** Every master/layout part's XML, keyed by path (sorted). */
async function styleParts(bytes: Uint8Array | Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const p of Object.keys(zip.files).filter((n) => STYLE_PART.test(n)).sort()) out[p] = await zip.file(p)!.async("string");
  return out;
}
const defRPrSizes = (xml: string) => [...xml.matchAll(/<a:defRPr\b[^>]*\bsz="(\d+)"/g)].map((m) => Number(m[1]));
const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const text = async (bytes: Uint8Array | Buffer, part: string) => (await JSZip.loadAsync(bytes)).file(part)!.async("string");

describe("scaleSz (pure): 0.5pt rounding, clamped to [1pt, 400pt]", () => {
  it("rounds to the nearest 0.5pt", () => {
    expect(scaleSz(1000, 0.9)).toBe(900);
    expect(scaleSz(1050, 0.9)).toBe(950); // 9.45pt → 9.5pt
    expect(scaleSz(1400, 1.1)).toBe(1550); // 15.4pt → 15.5pt
    expect(scaleSz(2400, 0.85)).toBe(2050); // 20.4pt → 20.5pt
  });
  it("never goes below 1pt nor above 400pt; a 1pt rule frame stays 1pt", () => {
    expect(scaleSz(100, 0.9)).toBe(100);
    expect(scaleSz(100, 1.1)).toBe(100);
    expect(scaleSz(200, 0.1)).toBe(100);
    expect(scaleSz(16000, 3)).toBe(40000);
  });
  it("rejects a non-positive / non-finite factor", () => {
    expect(() => scaleSz(1000, 0)).toThrow(RangeError);
    expect(() => scaleSz(1000, Number.NaN)).toThrow(RangeError);
  });
});

describe("(a) byte-identical when the recipe changes nothing", () => {
  const noops: [string, TemplateAdjustRecipe][] = [
    ["empty recipe", {}],
    ["scale 1.0 everywhere", { scale: { title: 1, body: 1, other: 1 } }],
    ["identity font map", { fonts: { latin: [{ from: "Georgia", to: "Georgia" }], ea: [], scope: "theme+inline" } }],
    ["font map for a name the template does not use", { fonts: { latin: [{ from: "No Such Font", to: "Meiryo" }], scope: "theme+inline" } }],
  ];
  for (const [key, file] of ALL) {
    for (const [label, recipe] of noops) {
      it(`${key}: ${label}`, async () => {
        const src = fx(file);
        const out = await adjustTemplate(src, recipe);
        expect(Buffer.compare(Buffer.from(out), src)).toBe(0);
      });
    }
  }
});

describe("(b) every defRPr@sz follows the rule (uniform factor, so role does not matter)", () => {
  for (const [key, file] of ALL) {
    for (const f of [0.9, 1.1]) {
      it(`${key} ×${f}: each sz == clamp(round0.5(sz×f)) and the 1pt frames stay 1pt`, async () => {
        const src = fx(file);
        const before = await styleParts(src);
        const after = await styleParts(await adjustTemplate(src, { scale: { title: f, body: f, other: f } }));
        expect(Object.keys(after)).toEqual(Object.keys(before));
        let n = 0;
        for (const part of Object.keys(before)) {
          const b = defRPrSizes(before[part]);
          const a = defRPrSizes(after[part]);
          expect(a.length, part).toBe(b.length);
          b.forEach((v, i) => {
            const pt = Math.min(400, Math.max(1, Math.round((v / 100) * f * 2) / 2));
            expect(a[i], `${part}#${i} (${v})`).toBe(Math.round(pt * 100));
            expect(a[i] % 50).toBe(0);
          });
          n += b.length;
          // nothing but sz changes: strip the sz values and the parts are identical
          const strip = (x: string) => x.replace(/(<a:defRPr\b[^>]*\bsz=")\d+"/g, '$1"');
          expect(strip(after[part]), part).toBe(strip(before[part]));
        }
        expect(n).toBeGreaterThan(100); // sanity: the fixture really carries its sizes in master + layouts
        const ones = (parts: Record<string, string>) => Object.values(parts).reduce((s, x) => s + defRPrSizes(x).filter((v) => v === 100).length, 0);
        expect(ones(after)).toBe(ones(before));
      });
    }
  }

  it("magazine: the 160pt display number clamps at 400pt under an extreme factor", async () => {
    const after = await styleParts(await adjustTemplate(fx(FIXTURES.magazine), { scale: { title: 3, body: 3, other: 3 } }));
    const all = Object.values(after).flatMap(defRPrSizes);
    expect(Math.max(...all)).toBe(40000);
  });

  it("is deterministic (same input + recipe → same bytes)", async () => {
    const r: TemplateAdjustRecipe = { scale: { title: 0.9, body: 0.9, other: 0.9 }, fonts: { latin: [{ from: "Yu Gothic", to: "Meiryo" }], scope: "theme+inline" } };
    const a = await adjustTemplate(fx(FIXTURES.tech), r);
    const b = await adjustTemplate(fx(FIXTURES.tech), r);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});

describe("(b') title / body / other scale independently (role = loader placeholderRole)", () => {
  for (const [key, file] of ALL) {
    it(`${key}: title ×1.2 moves only title-role sizes; body/other stay`, async () => {
      const before = await loadTemplate(fx(file));
      const after = await loadTemplate(await adjustTemplate(fx(file), { scale: { title: 1.2, body: 1, other: 1 } }));
      expect(after.masterTitleStyle.fontSize).toBe(scaleSz(before.masterTitleStyle.fontSize * 100, 1.2) / 100);
      expect(after.masterBodyStyle.fontSize).toBe(before.masterBodyStyle.fontSize);
      let titles = 0;
      before.layouts.forEach((l, li) => l.placeholders.forEach((p, pi) => {
        const q = after.layouts[li].placeholders[pi];
        const ownSz = /<a:defRPr[^>]*\bsz="/.test(p.shapeXml);
        const role = placeholderRole(p);
        if (role === "title" && ownSz) {
          titles++;
          expect(q.style.fontSize, `${l.name}/${p.idx}`).toBe(scaleSz(p.style.fontSize * 100, 1.2) / 100);
        } else if (role !== "title") {
          expect(q.style.fontSize, `${l.name}/${p.idx} (${role})`).toBe(p.style.fontSize);
        }
      }));
      expect(titles).toBeGreaterThan(0);
    });
  }
});

describe("(c) a name that is not a theme font (Consolas code frames) is never touched", () => {
  for (const key of ["koubun", "tech"] as const) {
    it(`${key}: Consolas count unchanged after replacing the theme font everywhere`, async () => {
      const src = fx(FIXTURES[key]);
      const before = Object.values(await styleParts(src)).join("");
      const tpl = await loadTemplate(src);
      const old = tpl.themeFonts.minorLatin!;
      const out = await adjustTemplate(src, {
        fonts: { latin: [{ from: old, to: "Meiryo" }], ea: [{ from: old, to: "Meiryo" }], scope: "theme+inline" },
        scale: { title: 0.9, body: 0.9, other: 0.9 },
      });
      const after = Object.values(await styleParts(out)).join("");
      expect(count(before, /typeface="Consolas"/g)).toBeGreaterThan(0);
      expect(count(after, /typeface="Consolas"/g)).toBe(count(before, /typeface="Consolas"/g));
    });
  }
});

describe("(d) the loader's readers follow the adjusted template (one path: the master's sz)", () => {
  for (const [key, file] of ALL) {
    it(`${key} ×0.9: masterBodyStyle / placeholderCapacity / fitTitle base all follow`, async () => {
      const before = await loadTemplate(fx(file));
      const out = await adjustTemplate(fx(file), { scale: { title: 0.9, body: 0.9, other: 0.9 } });
      const after = await loadTemplate(out);
      expect(after.masterBodyStyle.fontSize).toBe(scaleSz(before.masterBodyStyle.fontSize * 100, 0.9) / 100);
      expect(after.masterTitleStyle.fontSize).toBe(scaleSz(before.masterTitleStyle.fontSize * 100, 0.9) / 100);
      let grew = 0;
      let titleChecked = 0;
      const longTitle = parseMd("# " + "長いタイトルの文字列が続きます".repeat(6)).slides[0].placeholders[0].paragraphs;
      before.layouts.forEach((l, li) => l.placeholders.forEach((p, pi) => {
        const q = after.layouts[li].placeholders[pi];
        expect(q.style.fontSize).toBe(scaleSz(p.style.fontSize * 100, 0.9) / 100);
        const role = placeholderRole(p);
        if (role === "body" && placeholderCapacity(q.style) > placeholderCapacity(p.style)) grew++;
        if (role === "title") {
          titleChecked++;
          expect(fitTitle(longTitle, q.style).basePt).toBe(q.style.fontSize);
        }
      }));
      expect(grew).toBeGreaterThan(0);
      expect(titleChecked).toBeGreaterThan(0);
      expect(after.layouts.map((l) => l.name)).toEqual(before.layouts.map((l) => l.name));
      expect(assessTemplateHealth(buildCatalog(after)).status).toBe(assessTemplateHealth(buildCatalog(before)).status);
    });
  }
});

describe("(e) font scope: theme only vs theme + inline lstStyle names", () => {
  const RECIPE = (scope: "theme" | "theme+inline"): TemplateAdjustRecipe => ({
    fonts: {
      latin: [{ from: "MS PGothic", to: "Meiryo" }],
      ea: [{ from: "MS PGothic", to: "Meiryo" }, { from: "ＭＳ Ｐゴシック", to: "Meiryo" }],
      scope,
    },
  });

  it("koubun theme: theme latin + script=\"Jpan\" replaced, inline lstStyle names untouched", async () => {
    const src = fx(FIXTURES.koubun);
    const out = await adjustTemplate(src, RECIPE("theme"));
    const theme = await text(out, THEME);
    expect(count(theme, /<a:latin typeface="Meiryo"/g)).toBe(2);
    expect(count(theme, /<a:font script="Jpan" typeface="Meiryo"\/>/g)).toBe(2);
    expect(theme).not.toContain('typeface="MS PGothic"');
    expect(theme).not.toContain('typeface="ＭＳ Ｐゴシック"');
    expect(await styleParts(out)).toEqual(await styleParts(src)); // master/layouts byte-equal
    const t = await loadTemplate(out);
    expect(t.themeFonts.majorLatin).toBe("Meiryo");
    expect(t.themeFonts.minorLatin).toBe("Meiryo");
  });

  it("koubun theme+inline: every inline latin/ea MS PGothic becomes Meiryo; cs, tokens and Consolas stay", async () => {
    const src = fx(FIXTURES.koubun);
    const before = Object.values(await styleParts(src)).join("");
    const out = await adjustTemplate(src, RECIPE("theme+inline"));
    const after = Object.values(await styleParts(out)).join("");
    expect(count(after, /<a:(latin|ea) typeface="MS PGothic"/g)).toBe(0);
    expect(count(after, /<a:latin typeface="Meiryo"/g)).toBe(count(before, /<a:latin typeface="MS PGothic"/g));
    expect(count(after, /<a:ea typeface="Meiryo"/g)).toBe(count(before, /<a:ea typeface="MS PGothic"/g));
    expect(count(after, /<a:cs typeface="MS PGothic"/g)).toBe(count(before, /<a:cs typeface="MS PGothic"/g)); // cs: out of scope
    expect(count(after, /typeface="\+m[jn]-(lt|ea|cs)"/g)).toBe(count(before, /typeface="\+m[jn]-(lt|ea|cs)"/g));
    expect(count(after, /typeface="Consolas"/g)).toBe(count(before, /typeface="Consolas"/g));
    const t = await loadTemplate(out);
    const named = t.layouts.flatMap((l) => l.placeholders).filter((p) => /<a:latin typeface="Meiryo"/.test(p.shapeXml));
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((p) => p.style.fontName === "Meiryo")).toBe(true);
  });

  it("magazine: a latin-only map does not touch <a:ea> (the two maps are independent)", async () => {
    const src = fx(FIXTURES.magazine);
    const out = await adjustTemplate(src, { fonts: { latin: [{ from: "Yu Gothic", to: "Meiryo" }], scope: "theme+inline" } });
    const after = Object.values(await styleParts(out)).join("");
    expect(count(after, /<a:latin typeface="Yu Gothic"/g)).toBe(0);
    expect(count(after, /<a:ea typeface="Yu Gothic"/g)).toBeGreaterThan(0);
    const theme = await text(out, THEME);
    expect(theme).toContain('<a:font script="Jpan" typeface="Yu Gothic"/>'); // ea map was empty
    expect(theme).toContain('<a:latin typeface="Yu Mincho"'); // major stays (not in the map)
  });

  it("midnight: the theme's major latin is replaced by name, minor kept", async () => {
    const out = await adjustTemplate(fx(FIXTURES.midnight), { fonts: { latin: [{ from: "Georgia", to: "Yu Mincho" }], scope: "theme" } });
    const t = await loadTemplate(out);
    expect(t.themeFonts.majorLatin).toBe("Yu Mincho");
    expect(t.themeFonts.minorLatin).toBe("Calibri");
  });

  it("escapes XML-special characters in the new name", async () => {
    const out = await adjustTemplate(fx(FIXTURES.midnight), { fonts: { latin: [{ from: "Georgia", to: 'A&B "x"' }], scope: "theme" } });
    const theme = await text(out, THEME);
    expect(theme).toContain('<a:latin typeface="A&amp;B &quot;x&quot;"');
  });
});

describe("(f) golden: a deck exported with an adjusted template", () => {
  const MD = "# 調整済みテンプレの表紙\n\n---\n\n## 本文スライド\n\n- 箇条書き 1\n- 箇条書き 2\n  - 入れ子\n";
  const RECIPE: TemplateAdjustRecipe = {
    fonts: { latin: [{ from: "Georgia", to: "Yu Mincho" }], ea: [{ from: "ＭＳ Ｐゴシック", to: "Yu Mincho" }], scope: "theme+inline" },
    scale: { title: 0.9, body: 0.9, other: 0.9 },
  };
  // Pinned after a by-hand read of the adjusted XML (theme fonts + scaled sz) — see the PR body.
  const GOLDEN: Record<string, string> = {
    "ppt/theme/theme1.xml": "702e27fcd49cadb32d67b995ba9ef11c15a6d849b9001012bd073d6d1b28ff87",
    "ppt/slideMasters/slideMaster1.xml": "4dd5bb10e4451c3af370bba8e81779beba716ab5349e712a7a7e565509e2820b",
    "ppt/slides/slide1.xml": "54d186c3500ab00e9fab457929a1778fac8d0386b2e87838bf54d8782d00e044",
    "ppt/slides/slide2.xml": "059e46d4b1e7a97af29a9e8c3fa2126a3dfc71cfd9b0560add137f375fa40bad",
  };
  it("midnight: theme / master / slide XML == golden", async () => {
    const tpl = await loadTemplate(await adjustTemplate(fx(FIXTURES.midnight), RECIPE));
    const deck = parseMd(MD, buildCatalog(tpl));
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const got: Record<string, string> = {};
    for (const f of Object.keys(GOLDEN)) got[f] = sha(await zip.file(f)!.async("string"));
    expect(got).toEqual(GOLDEN);
  });
});
