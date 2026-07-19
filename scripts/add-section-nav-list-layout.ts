/**
 * add-section-nav-list-layout.ts — one-off: physically add the SectionNav.1TitleList.Single
 * slideLayout part (idx 31) to the canonical template PPTX (#167 / ADR-0032 D2 段階3).
 *
 * Unlike rebuild-template.ts (which PATCHES the 30 slideLayoutN.xml parts that already exist in
 * the zip), this script ADDS a brand-new part + wires it into Content_Types / the layout's own
 * rels / slideMaster1.xml's sldLayoutIdLst / slideMaster1.xml.rels. Run once; the result is
 * committed (both public/ and tests/fixtures/ copies, kept byte-identical).
 *
 * Usage: npx tsx scripts/add-section-nav-list-layout.ts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { BUILTIN_LAYOUTS, type LayoutPhDef } from "../src/engine/template-layout-library";

const EMU = (inches: number) => Math.round(inches * 914400);

const DEF = BUILTIN_LAYOUTS.find((d) => d.name === "SectionNav.1TitleList.Single");
if (!DEF) throw new Error("SectionNav.1TitleList.Single not found in BUILTIN_LAYOUTS");

// 色は Section.1Title.Single (create_30_layouts.py 由来) と同じキー→hex を踏襲。
const HEX: Record<string, string> = {
  titleText: "FFFFFF",
  subtle: "CADCFC",
};
const BG_NAVY = "141B41";
const ACCENT_BLUE = "3B82F6";

function buildLstStyleOverride(ph: LayoutPhDef): string {
  const isTitleType = ph.type === "ctrTitle" || ph.type === "title";
  const masterSz = isTitleType ? 4400 : 1400;
  const masterBold = isTitleType;
  const masterColor = isTitleType ? "FFFFFF" : "1E293B";

  const sz = ph.fontSize * 100;
  const color = HEX[ph.color] ?? ph.color;
  const needsSz = sz !== masterSz;
  const needsBold = ph.bold !== masterBold;
  const needsColor = color !== masterColor;
  const needsAlign = ph.align !== "l";
  if (!needsSz && !needsBold && !needsColor && !needsAlign) return "<a:lstStyle/>";

  let defRPrAttrs = "";
  let defRPrChildren = "";
  let defPPrAttrs = "";
  if (needsSz) defRPrAttrs += ` sz="${sz}"`;
  if (needsBold) defRPrAttrs += ` b="${ph.bold ? "1" : "0"}"`;
  if (needsColor) defRPrChildren += `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  if (needsAlign) defPPrAttrs += ` algn="${ph.align}"`;
  return `<a:lstStyle><a:defPPr${defPPrAttrs}><a:defRPr${defRPrAttrs}>${defRPrChildren}</a:defRPr></a:defPPr></a:lstStyle>`;
}

function buildPhShapeXml(ph: LayoutPhDef, shapeId: number): string {
  const typeAttr = ph.type ? ` type="${ph.type}"` : "";
  return `<p:sp>`
    + `<p:nvSpPr>`
    + `<p:cNvPr id="${shapeId}" name="${ph.name}"/>`
    + `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>`
    + `<p:nvPr><p:ph${typeAttr} idx="${ph.idx}"/></p:nvPr>`
    + `</p:nvSpPr>`
    + `<p:spPr>`
    + `<a:xfrm><a:off x="${EMU(ph.x)}" y="${EMU(ph.y)}"/><a:ext cx="${EMU(ph.w)}" cy="${EMU(ph.h)}"/></a:xfrm>`
    + `</p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" anchor="t" anchorCtr="0"/>`
    + buildLstStyleOverride(ph)
    + `<a:p><a:r><a:rPr lang="ja-JP"/><a:t> </a:t></a:r></a:p>`
    + `</p:txBody>`
    + `</p:sp>`;
}

// Section.1Title.Single と同じ BG（紺）+ AccentBar（左端）装飾 — dark family の見た目を踏襲。
function decoShapesXml(): string {
  const bg = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="BG"/>`
    + `<p:cNvSpPr><a:spLocks noGrp="1" noSelect="0" noRot="1" noMove="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm>`
    + `<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="${BG_NAVY}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  const bar = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="AccentBar"/>`
    + `<p:cNvSpPr><a:spLocks noGrp="1" noSelect="0" noRot="1" noMove="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="164592" cy="6858000"/></a:xfrm>`
    + `<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="${ACCENT_BLUE}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  return bg + bar;
}

async function run() {
  const paths = [
    "public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx",
    "tests/fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
  ];

  for (const relPath of paths) {
    const path = resolve(relPath);
    const zip = await JSZip.loadAsync(readFileSync(path));

    // 既存の最大 slideLayoutN を検出し、その次番号へ新規追加（gap-tolerant loader 前提・#146）。
    const existing = Object.keys(zip.files)
      .map((p) => p.match(/^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => parseInt(m[1]));
    const newIndex = Math.max(...existing) + 1;
    const newPath = `ppt/slideLayouts/slideLayout${newIndex}.xml`;
    if (zip.file(newPath)) {
      console.log(`  ${relPath}: ${newPath} already exists — skipping (idempotent)`);
      continue;
    }

    let shapeId = 4; // 2=BG, 3=AccentBar
    let shapesXml = decoShapesXml();
    for (const ph of DEF!.placeholders) {
      shapesXml += buildPhShapeXml(ph, shapeId);
      shapeId++;
    }

    const layoutXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>`
      + `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
      + ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
      + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
      + ` type="secHead" preserve="1">`
      + `<p:cSld name="${DEF!.name}"><p:spTree>`
      + `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
      + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
      + shapesXml
      + `</p:spTree></p:cSld>`
      + `<p:clrMapOvr/>`
      + `</p:sldLayout>`;
    zip.file(newPath, layoutXml);

    // slideLayout の rels（slideMaster1.xml への参照のみ — 他レイアウトと同形）。
    const layoutRels = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`
      + `</Relationships>`;
    zip.file(`ppt/slideLayouts/_rels/slideLayout${newIndex}.xml.rels`, layoutRels);

    // [Content_Types].xml — Override を追加。
    let ct = await zip.file("[Content_Types].xml")!.async("string");
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/ppt/slideLayouts/slideLayout${newIndex}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>`,
    );
    zip.file("[Content_Types].xml", ct);

    // slideMaster1.xml — sldLayoutIdLst に新エントリを追加。既存 id の最大値+1。
    let master = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
    const masterRels = await zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels")!.async("string");
    const usedRIds = [...masterRels.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1]));
    const newRId = `rId${Math.max(...usedRIds) + 1}`;
    const usedLayoutIds = [...master.matchAll(/<p:sldLayoutId id="(\d+)"/g)].map((m) => parseInt(m[1]));
    const newLayoutId = Math.max(...usedLayoutIds) + 1;
    master = master.replace(
      "</p:sldLayoutIdLst>",
      `<p:sldLayoutId id="${newLayoutId}" r:id="${newRId}"/></p:sldLayoutIdLst>`,
    );
    zip.file("ppt/slideMasters/slideMaster1.xml", master);

    const newMasterRels = masterRels.replace(
      "</Relationships>",
      `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${newIndex}.xml"/></Relationships>`,
    );
    zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", newMasterRels);

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(path, buf);
    console.log(`  ${relPath}: added ${newPath} (layoutId=${newLayoutId}, ${newRId})`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
