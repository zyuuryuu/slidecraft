/**
 * builtin-semantic-roles.test.ts — #293: 層3（根本対策）。
 *
 * root cause: idx-META 規約（idx 10/11/12→category/date/footer, ADR-0023）は第三者マスター向けだが、
 * template-catalog.ts の placeholderRole() が `ph.metaIdxConvention ?? true` で既定 true を採るため、
 * 組み込みレイアウト（template-layout-library.ts）にも idx→role 推定が掛かってしまっていた。
 * Contact.Bottom/Date.Bottom/Description.Right/Summary.Right/Meta.Right 等は idx 10/11/12 を使うが
 * 実際には footer/date/category ではなく実コンテンツ（body）— idx-META 規約が誤爆する。
 *
 * 修正: LayoutPhDef に明示 role を持たせ（template-layout-library.ts）、template-writer.ts が
 * <p:cNvPr descr> マーカー（BUILTIN_ROLE_DESCR_PREFIX, template-catalog.ts）としてスタンプ、
 * template-loader.ts が読み戻して PlaceholderInfo.builtinRole に復元し、
 * placeholderRole()（template-catalog.ts）が idx-META 規約より優先して採用する。
 * 明示ロールが無い（＝第三者マスター）placeholder は従来どおり idx-META 規約にフォールバックする
 * ため、ADR-0023 は変わらない。
 */
import { describe, it, expect } from "vitest";
import { placeholderRole, BUILTIN_ROLE_DESCR_PREFIX } from "../src/engine/template-catalog";
import { loadTemplate, findLayout } from "../src/engine/template-loader";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import { writeTemplate, MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import { bindContentByRole, unboundContent } from "../src/engine/placeholder-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const spec = (): TemplateSpec => ({
  name: "Test",
  fonts: { major: "Georgia", minor: "Calibri" },
  palette: { ...MIDNIGHT_PALETTE },
});

const bodyPh = (idx: string, name: string, builtinRole?: PlaceholderInfo["builtinRole"]): PlaceholderInfo => ({
  idx,
  type: "body",
  name,
  shapeXml: "<p:sp/>",
  style: { x: 1, y: 1, w: 2, h: 1, fontSize: 12, fontColor: "000000", fontName: "Calibri", bold: false, align: "l", bulletChar: "" },
  ...(builtinRole ? { builtinRole } : {}),
});

// ── placeholderRole 単体 — 受け入れ基準1: 明示ロールが idx-META 規約より優先される ──

describe("placeholderRole: builtinRole が idx-META 規約より優先される (#293)", () => {
  it("Contact.Bottom/Date.Bottom/Description.Right の idx-12/11 は builtinRole があれば footer/date へ誤解決されない", () => {
    expect(placeholderRole(bodyPh("12", "Contact.Bottom", "body"))).toBe("body");
    expect(placeholderRole(bodyPh("11", "Date.Bottom", "date"))).toBe("date"); // Title.1Title.Single+1Summary の idx=12 相当（名前どおり date）
    expect(placeholderRole(bodyPh("12", "Description.Right", "body"))).toBe("body");
    expect(placeholderRole(bodyPh("11", "Summary.Right", "body"))).toBe("body");
    expect(placeholderRole(bodyPh("11", "Meta.Right", "body"))).toBe("body");
  });

  it("builtinRole が無い（第三者マスター）placeholder は従来どおり idx-META 規約にフォールバックする（ADR-0023 は不変）", () => {
    expect(placeholderRole(bodyPh("10", "何かの枠"))).toBe("category");
    expect(placeholderRole(bodyPh("11", "何かの枠"))).toBe("date");
    expect(placeholderRole(bodyPh("12", "何かの枠"))).toBe("footer");
  });

  it("builtinRole は明示 type（dt/ftr 等）より優先しても実害が無い範囲でのみ使う設計だが、優先順位としては最上位", () => {
    const ph: PlaceholderInfo = { ...bodyPh("11", "x", "body"), type: "dt" };
    expect(placeholderRole(ph)).toBe("body");
  });
});

// ── writeTemplate → loadTemplate round-trip — 実際の生成経路で機能する ──

describe("template-writer → template-loader round-trip: builtinRole がマーカー経由で復元される (#293)", () => {
  it("Closing.1Message.Single の Contact.Bottom/PresenterName.Bottom は body（footer/date ではない）", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = findLayout(tpl, "Closing.1Message.Single");
    const contact = layout.placeholders.find((p) => p.name === "Contact.Bottom")!;
    const presenter = layout.placeholders.find((p) => p.name === "PresenterName.Bottom")!;
    expect(contact.builtinRole).toBe("body");
    expect(placeholderRole(contact)).toBe("body");
    expect(placeholderRole(presenter)).toBe("body");
    // カテゴリ枠は既存どおり category のまま（byte-identical for the correctly-resolving slots）
    const category = layout.placeholders.find((p) => p.name === "CategoryLabel.Top")!;
    expect(placeholderRole(category)).toBe("category");
  });

  it("SectionNav.1Title.Single の Description.Right/SectionNumber.Left/SectionLabel.Left は body", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = findLayout(tpl, "SectionNav.1Title.Single");
    for (const name of ["Description.Right", "SectionNumber.Left", "SectionLabel.Left"]) {
      const ph = layout.placeholders.find((p) => p.name === name)!;
      expect(placeholderRole(ph)).toBe("body");
    }
  });

  it("Title.1Title.Single+1Summary の Summary.Right は body, Date.Bottom(idx=12) は date", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = findLayout(tpl, "Title.1Title.Single+1Summary");
    const summary = layout.placeholders.find((p) => p.name === "Summary.Right")!;
    const date = layout.placeholders.find((p) => p.name === "Date.Bottom")!;
    expect(placeholderRole(summary)).toBe("body");
    expect(placeholderRole(date)).toBe("date");
  });

  it("Title.1Title.Single+1Meta の Meta.Right は body", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = findLayout(tpl, "Title.1Title.Single+1Meta");
    const meta = layout.placeholders.find((p) => p.name === "Meta.Right")!;
    expect(placeholderRole(meta)).toBe("body");
  });

  it("Section.1Title.Single / SectionBreak.1Title.Single の Description.Bottom は body", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    for (const layoutName of ["Section.1Title.Single", "SectionBreak.1Title.Single"]) {
      const layout = findLayout(tpl, layoutName);
      const desc = layout.placeholders.find((p) => p.name === "Description.Bottom")!;
      expect(placeholderRole(desc)).toBe("body");
    }
  });

  it("descr マーカーは BUILTIN_ROLE_DESCR_PREFIX を実際に使っている（cNvPr に埋め込まれる）", async () => {
    const bytes = await writeTemplate(spec());
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const layoutIdx = 1; // Title.1Title.Single = slideLayout1.xml
    const xml = await zip.file(`ppt/slideLayouts/slideLayout${layoutIdx}.xml`)!.async("string");
    expect(xml).toContain(`descr="${BUILTIN_ROLE_DESCR_PREFIX}category"`);
    expect(xml).toContain(`descr="${BUILTIN_ROLE_DESCR_PREFIX}date"`);
    expect(xml).toContain(`descr="${BUILTIN_ROLE_DESCR_PREFIX}footer"`);
  });
});

// ── 受け入れ基準2: Footer:/Date:/Category: メタが正しい枠に束縛される ──

describe("bindContentByRole: メタが正しい枠に束縛される、または誤爆せず unbound になる (#293)", () => {
  it("Closing.1Message.Single には本物の footer/date 枠が無いので、Footer:/Date: メタは Contact.Bottom/PresenterName.Bottom に誤束縛されず unbound になる（no-silent-drop）", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = findLayout(tpl, "Closing.1Message.Single");
    const slide: SlideIR = {
      layout: "Closing.1Message.Single",
      placeholders: [
        { idx: "0", paragraphs: [{ segments: [{ text: "クロージング" }] }] },
        { idx: "11", paragraphs: [{ segments: [{ text: "2026-07-20" }] }] }, // canonical date idx
        { idx: "12", paragraphs: [{ segments: [{ text: "手動フッタ" }] }] }, // canonical footer idx
      ],
    };
    const bound = bindContentByRole(slide, layout.placeholders);
    // Contact.Bottom(idx=12 の LAYOUT 枠) が「手動フッタ」で上書きされていない
    const contactContent = bound.get("12");
    expect(contactContent?.paragraphs[0]?.segments[0]?.text).not.toBe("手動フッタ");
    const unbound = unboundContent(slide, layout.placeholders);
    expect(unbound.some((u) => u.role === "date")).toBe(true);
    expect(unbound.some((u) => u.role === "footer")).toBe(true);
  });

  it("Title.1Title.Single（健全 built-in）の Footer:/Date:/Category: メタは従来どおり正しい枠に束縛される（回帰なし）", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = findLayout(tpl, "Title.1Title.Single");
    const slide: SlideIR = {
      layout: "Title.1Title.Single",
      placeholders: [
        { idx: "10", paragraphs: [{ segments: [{ text: "カテゴリA" }] }] },
        { idx: "11", paragraphs: [{ segments: [{ text: "2026-07-20" }] }] },
        { idx: "12", paragraphs: [{ segments: [{ text: "本物のフッタ" }] }] },
      ],
    };
    const bound = bindContentByRole(slide, layout.placeholders);
    expect(bound.get("10")?.paragraphs[0]?.segments[0]?.text).toBe("カテゴリA");
    expect(bound.get("11")?.paragraphs[0]?.segments[0]?.text).toBe("2026-07-20");
    expect(bound.get("12")?.paragraphs[0]?.segments[0]?.text).toBe("本物のフッタ");
    expect(unboundContent(slide, layout.placeholders)).toEqual([]);
  });
});
