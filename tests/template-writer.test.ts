/**
 * template-writer.test.ts — テーマ2 S3: TemplateSpec → template-only PPTX のフル OOXML 生成。
 * 検証ゲートは「読む側」の再利用: writeTemplate(spec) を自前ローダで読み戻し、
 * (W1) 受け入れゲート ok・レイアウト/プレースホルダがスペックどおり、
 * (W2) 配色/フォントがスペックのパレットを反映（Midnight 以外のパレットでも）、
 * (W3) 生成テンプレで実際にコンテンツ入り PPTX が組み立てられる（distill→generatePptx 生存）、
 * (W4) レイアウトのサブセット指定・autoSelectLayout のロール解決、を担保する。
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";
import {
  writeTemplate,
  MIDNIGHT_PALETTE,
  titleTextBottomIn,
  MIN_TITLE_SUBTITLE_GAP_IN,
  type TemplateSpec,
} from "../src/engine/template-writer";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";

const midnightSpec = (): TemplateSpec => ({
  name: "Generated Midnight",
  fonts: { major: "Georgia", minor: "Calibri" },
  palette: { ...MIDNIGHT_PALETTE },
});

// 別デザイン（緑基調ライト）— パレット差し替えが素通しで反映されることの検証用
const forestSpec = (): TemplateSpec => ({
  name: "Forest Report",
  fonts: { major: "Times New Roman", minor: "Arial" },
  palette: {
    ...MIDNIGHT_PALETTE,
    background: "1B4332",
    titleText: "F0FFF4",
    accent: "40916C",
    bodyText: "1B2E22",
  },
});

const SAMPLE = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n\n---\n\n# まとめ\n\n- ありがとう";

describe("W1 round-trip — 生成テンプレは自前ローダ/受け入れゲートを素で通る", () => {
  it("全 30 レイアウトが読み戻せて health=ok", async () => {
    const bytes = await writeTemplate(midnightSpec());
    const tpl = await loadTemplate(bytes);
    expect(tpl.layouts.length).toBe(BUILTIN_LAYOUTS.length);
    expect(tpl.layouts.map((l) => l.name)).toEqual(BUILTIN_LAYOUTS.map((d) => d.name));
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
  });

  it("プレースホルダの idx/type/ジオメトリがスペックどおり（±1% 以内）", async () => {
    const tpl = await loadTemplate(await writeTemplate(midnightSpec()));
    for (let i = 0; i < BUILTIN_LAYOUTS.length; i++) {
      const def = BUILTIN_LAYOUTS[i];
      const got = tpl.layouts[i];
      expect(got.placeholders.length).toBe(def.placeholders.length);
      for (const phDef of def.placeholders) {
        const ph = got.placeholders.find((p) => p.idx === String(phDef.idx))!;
        expect(ph, `${def.name}/${phDef.name}`).toBeDefined();
        expect(ph.type).toBe(phDef.type);
        for (const [axis, want] of [["x", phDef.x], ["y", phDef.y], ["w", phDef.w], ["h", phDef.h]] as const) {
          expect(Math.abs(ph.style[axis] - want), `${def.name}/${phDef.name}.${axis}`).toBeLessThanOrEqual(Math.max(0.02, want * 0.01));
        }
      }
    }
  });
});

describe("W2 デザイン反映 — パレット/フォントが素通しで効く", () => {
  it("マスター既定: タイトル色/フォント・本文色/フォントがスペック値", async () => {
    const tpl = await loadTemplate(await writeTemplate(forestSpec()));
    expect(tpl.masterTitleStyle.fontColor.toUpperCase()).toBe("F0FFF4");
    expect(tpl.masterTitleStyle.fontName).toBe("Times New Roman");
    expect(tpl.masterBodyStyle.fontColor.toUpperCase()).toBe("1B2E22");
    expect(tpl.masterBodyStyle.fontName).toBe("Arial");
  });

  it("カバー系レイアウトの背景はスペックの background、コンテンツ系は canvas", async () => {
    const tpl = await loadTemplate(await writeTemplate(forestSpec()));
    const cover = tpl.layouts.find((l) => l.name === "Title.1Title.Single")!;
    const content = tpl.layouts.find((l) => l.name === "Content.1Body.Single")!;
    expect(cover.background?.toUpperCase()).toBe("1B4332");
    expect(content.background?.toUpperCase()).toBe(MIDNIGHT_PALETTE.canvas.toUpperCase());
  });
});

describe("W3 実戦 — 生成テンプレでコンテンツ入り PPTX が組み立てられる", () => {
  it("distill→generatePptx が生存し、全テキストがスライド XML に現れる", async () => {
    const tpl = await loadTemplate(await writeTemplate(midnightSpec()));
    const catalog = buildCatalog(tpl);
    const out = await generatePptx(distillDeck(parseMd(SAMPLE), catalog), tpl);
    expect(out.length).toBeGreaterThan(1000);
    expect(out[0]).toBe(0x50); // PK
    const z = await JSZip.loadAsync(out);
    const names = Object.keys(z.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n));
    const text = (await Promise.all(names.map((n) => z.files[n].async("string")))).join("");
    for (const t of ["表紙", "中身", "速度", "まとめ"]) expect(text).toContain(t);
  });
});

describe("W4 サブセットとロール — レイアウト選択に耐える", () => {
  it("3 レイアウトのサブセット指定でも health は rejected でなく、名前が一致する", async () => {
    const subset = BUILTIN_LAYOUTS.filter((d) =>
      ["Title.1Title.Single", "Content.1Body.Single", "Section.1Title.Single"].includes(d.name));
    const bytes = await writeTemplate({ ...midnightSpec(), layouts: subset });
    const tpl = await loadTemplate(bytes);
    expect(tpl.layouts.map((l) => l.name)).toEqual(subset.map((d) => d.name));
    expect(assessTemplateHealth(buildCatalog(tpl)).status).not.toBe("rejected");
  });

  it("カタログに title/section/content/columns ロールが揃う（フルセット）", async () => {
    const catalog = buildCatalog(await loadTemplate(await writeTemplate(midnightSpec())));
    const roles = new Set(catalog.map((e) => e.role));
    for (const r of ["title", "section", "content", "columns"]) expect(roles.has(r as never), r).toBe(true);
  });
});

// Issue #137: create_template が日本語前提の体裁を満たさない（buChar 無し・ea 未設定・表紙ジオメトリ衝突）。
describe("W5 日本語前提の体裁（#137）", () => {
  it("master bodyStyle の lvl1 に bullet 定義（buChar）がある — 段落と箇条書きを区別できる", async () => {
    const bytes = await writeTemplate(midnightSpec());
    const z = await JSZip.loadAsync(bytes);
    const masterXml = await z.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
    const bodyStyle = masterXml.match(/<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/)?.[0] ?? "";
    const lvl1 = bodyStyle.match(/<a:lvl1pPr\b[\s\S]*?<\/a:lvl1pPr>/)?.[0] ?? "";
    const buChar = lvl1.match(/<a:buChar[^>]*char="([^"]+)"/)?.[1];
    expect(buChar).toBeTruthy();
  });

  it("theme の majorFont/minorFont に ea typeface（CJK フォールバック）が既定で入る", async () => {
    const bytes = await writeTemplate(midnightSpec()); // spec は majorEa/minorEa を指定しない
    const z = await JSZip.loadAsync(bytes);
    const themeXml = await z.file("ppt/theme/theme1.xml")!.async("string");
    for (const tag of ["majorFont", "minorFont"]) {
      const block = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?<\\/a:${tag}>`))?.[0] ?? "";
      const ea = block.match(/<a:ea typeface="([^"]*)"/)?.[1];
      expect(ea, tag).toBeTruthy();
    }
  });

  it("spec が majorEa/minorEa を明示した時は既定を上書きしてそのまま使う", async () => {
    const bytes = await writeTemplate({ ...midnightSpec(), fonts: { major: "Georgia", minor: "Calibri", majorEa: "MS Mincho", minorEa: "MS Gothic" } });
    const z = await JSZip.loadAsync(bytes);
    const themeXml = await z.file("ppt/theme/theme1.xml")!.async("string");
    expect(themeXml).toContain('<a:ea typeface="MS Mincho"/>');
    expect(themeXml).toContain('<a:ea typeface="MS Gothic"/>');
  });

  it("表紙: タイトルが2行に折り返してもサブタイトル枠と重ならない（ジオメトリ計算）", () => {
    const covers = BUILTIN_LAYOUTS.filter(
      (l) => l.placeholders.some((p) => p.type === "ctrTitle") && l.placeholders.some((p) => p.type === "subTitle"),
    );
    expect(covers.length).toBeGreaterThan(0); // このアサーションが空振りしない（対象が実在する）ことを担保
    for (const l of covers) {
      const title = l.placeholders.find((p) => p.type === "ctrTitle")!;
      const subtitle = l.placeholders.find((p) => p.type === "subTitle")!;
      const titleBottom = titleTextBottomIn(title.y, title.fontSize, 2);
      expect(subtitle.y, l.name).toBeGreaterThanOrEqual(titleBottom + MIN_TITLE_SUBTITLE_GAP_IN);
    }
  });
});
