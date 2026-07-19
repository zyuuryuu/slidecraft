/**
 * template-writer-conventions.test.ts — 生成 PPTX の OOXML 慣習準拠（プリフライト指摘の解消ゲート）。
 *
 * 実機確認プリフライトで生成物に残った2指摘を恒久ゲートする:
 * (C1) スライドマスターに標準 placeholder 5種（title / body / dt / ftr / sldNum）が無い
 *      → フィールド継承（スライド番号・日付・フッター）や「ヘッダーとフッター」の挙動に影響しうる
 * (C2) 慣習パート（docProps/core・app、presProps、viewProps、tableStyles）が無い
 *      → PowerPoint は寛容だが、周辺ツール互換と開封安全性のため canonical と揃える
 * いずれも rels / [Content_Types] の整合込みで検査し、既存の読み戻しゲートが壊れないことも見る。
 */
import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";

let bytes: Uint8Array;
let zip: JSZip;
const part = (name: string) => zip.files[name]?.async("string");

beforeAll(async () => {
  bytes = await writeTemplate({
    name: "Conventions Gate",
    fonts: { major: "Georgia", minor: "Calibri" },
    palette: { ...MIDNIGHT_PALETTE },
  });
  zip = await JSZip.loadAsync(bytes);
});

describe("C1 マスター placeholder（継承の祖先）", () => {
  it("title / body(1) / dt(2) / ftr(3) / sldNum(4) の5種が存在する", async () => {
    const master = await part("ppt/slideMasters/slideMaster1.xml");
    expect(master).toBeDefined();
    expect(master).toMatch(/<p:ph type="title"\/>/);
    expect(master).toMatch(/<p:ph type="body" idx="1"\/>/);
    expect(master).toMatch(/<p:ph type="dt" sz="half" idx="2"\/>/);
    expect(master).toMatch(/<p:ph type="ftr" sz="quarter" idx="3"\/>/);
    expect(master).toMatch(/<p:ph type="sldNum" sz="quarter" idx="4"\/>/);
  });

  it("読み戻しゲートは不変（health ok・レイアウト数・マスター ph がレイアウトを汚染しない）", async () => {
    const tpl = await loadTemplate(bytes);
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
    expect(tpl.layouts.length).toBe(BUILTIN_LAYOUTS.length);
    // レイアウト側の placeholder 構成は従来どおり（マスター ph はレイアウトに混入しない）
    expect(tpl.layouts[0].placeholders.length).toBe(5);
  });
});

describe("C2 慣習パートと配管の整合", () => {
  it("docProps/presProps/viewProps/tableStyles が存在する", () => {
    for (const p of [
      "docProps/core.xml",
      "docProps/app.xml",
      "ppt/presProps.xml",
      "ppt/viewProps.xml",
      "ppt/tableStyles.xml",
    ]) expect(zip.files[p], p).toBeDefined();
  });

  it("[Content_Types] が新パートを全てカバーする", async () => {
    const ct = (await part("[Content_Types].xml"))!;
    expect(ct).toContain('PartName="/docProps/core.xml"');
    expect(ct).toContain('PartName="/docProps/app.xml"');
    expect(ct).toContain('PartName="/ppt/presProps.xml"');
    expect(ct).toContain('PartName="/ppt/viewProps.xml"');
    expect(ct).toContain('PartName="/ppt/tableStyles.xml"');
  });

  it("ルート .rels が core/app を、presentation.xml.rels が props 類を参照する", async () => {
    const root = (await part("_rels/.rels"))!;
    expect(root).toMatch(/core-properties.*docProps\/core\.xml|docProps\/core\.xml.*core-properties/);
    expect(root).toMatch(/extended-properties.*docProps\/app\.xml|docProps\/app\.xml.*extended-properties/);
    const pres = (await part("ppt/_rels/presentation.xml.rels"))!;
    for (const t of ["presProps", "viewProps", "tableStyles"]) expect(pres).toContain(t);
  });

  it("core.xml にテンプレ名が dc:title として入る", async () => {
    expect(await part("docProps/core.xml")).toContain("Conventions Gate");
  });
});
