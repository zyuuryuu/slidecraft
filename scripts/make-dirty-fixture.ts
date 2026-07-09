/**
 * make-dirty-fixture.ts — 「見た目はキレイだが構造が雑」な敵対的テンプレートを合成する。
 *
 * 目的: 属性ベースの機能推定（inferFunction）を鍛えるための試験台。同梱テンプレは
 * (1) 慣習（type/idx/命名）が正確で (2) 幾何もキレイ、の両方が揃っており、実運用で困る
 * 「幾何は生きているが慣習だけ崩壊」を全く再現しない。このスクリプトは、私（設計者）自身が
 * 「取りこぼす」と申告した病理をわざと全部盛り込み、自分の設計を自分で殴りにいく合成物を作る。
 *
 * 盛り込む病理:
 *   P1 title=生テキストボックス   … 見出しが <p:ph> を持たない p:sp（ローダーは staticText 扱い）
 *   P2 title=body 型             … 実際の見出しが body 型 placeholder（type が嘘をつく）
 *   P3 figure=body 型            … 図/ヒーロー枠が body 型（巨大面積×大フォント×疎）→ 散文 body ではない
 *   P4 装飾テキスト（章番号）      … 極大フォント×小面積の "03" は accent であって title ではない
 *   P5 命名ゴミ                  … レイアウト名/シェイプ名が意味を持たない
 *   P6 title 型が存在しない        … 章/本文レイアウトに title 型 placeholder が一切無い
 *
 * 出力は合成物（IP 非含有）なので repo にコミット可能。tests/fixtures/templates/ に置き golden 化する。
 * 生成物は loadTemplate が通ること（tests/dirty-fixture.test.ts で担保）。
 */
import JSZip from "jszip";
import { writeFileSync } from "fs";
import { resolve } from "path";

const EMU = (inches: number) => Math.round(inches * 914400);
const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NS_A = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;
const NS_P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const NS_R = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL_NS = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`;
const REL_T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// 「キレイに見える」デザイン配色（coral + teal / 白・紺）。
const C = {
  navy: "10243A",
  teal: "0E4D4A",
  white: "FFFFFF",
  coral: "FF6B5B",
  tealAcc: "17BEBB",
  lightText: "DCE7F0",
  darkText: "1A2B33",
};

interface Box { x: number; y: number; w: number; h: number; }
const xfrm = (b: Box) => `<a:xfrm><a:off x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:ext cx="${EMU(b.w)}" cy="${EMU(b.h)}"/></a:xfrm>`;

/** P1/P4: 見出し・章番号を担う生テキストボックス（<p:ph> 無し・noFill）。ローダーは staticText として拾う。 */
function rawText(id: number, name: string, text: string, b: Box, fs: number, o: { bold?: boolean; align?: string; color: string }): string {
  const rPr = `<a:rPr lang="ja-JP" sz="${fs * 100}"${o.bold ? ` b="1"` : ""}><a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill></a:rPr>`;
  const pPr = o.align ? `<a:pPr algn="${o.align}"/>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p>${pPr}<a:r>${rPr}<a:t>${escXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

/** P2/P3: body 型 placeholder（見出しや図枠が body を騙る）。idx で区別。 */
function bodyPh(id: number, name: string, idx: number, text: string, b: Box, fs: number, o: { bold?: boolean; align?: string; color?: string } = {}): string {
  const col = o.color ? `<a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` : "";
  const rPr = `<a:rPr lang="ja-JP" sz="${fs * 100}"${o.bold ? ` b="1"` : ""}>${col}</a:rPr>`;
  const pPr = o.align ? `<a:pPr algn="${o.align}"/>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="body" idx="${idx}"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm(b)}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${pPr}<a:r>${rPr}<a:t>${escXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

/** 装飾の色パネル/帯（テキスト無し）。 */
function deco(id: number, b: Box, hex: string, radius = 0): string {
  const prst = radius ? "roundRect" : "rect";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Graphic ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(b)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}

const bgXml = (hex: string) => `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
const spTreeHead =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

interface DirtyLayout { name: string; bg: string; shapes: string; }

// ── 4 つの敵対レイアウト（各々が反証可能な失敗を仕込む）──
const LAYOUTS: DirtyLayout[] = [
  {
    // P1: 見出し・サブが「placeholder ですらない」生テキストボックス。placeholder は 0 個。
    name: "1_カスタム レイアウト",
    bg: C.navy,
    shapes:
      deco(2, { x: 0, y: 6.4, w: 5.2, h: 1.1 }, C.coral) +
      rawText(3, "TextBox 3", "2026 事業戦略プロジェクト", { x: 1.0, y: 2.55, w: 11.3, h: 1.3 }, 40, { bold: true, align: "ctr", color: C.white }) +
      rawText(4, "TextBox 4", "戦略企画部 ／ 2026年度上期", { x: 1.0, y: 4.05, w: 11.3, h: 0.6 }, 18, { align: "ctr", color: C.lightText }),
  },
  {
    // P2: 見出しが body 型（idx=10）。3 カラム本文も body。title 型は無い（P6）。命名ゴミ（P5）。
    name: "Custom Layout 2",
    bg: C.white,
    shapes:
      deco(2, { x: 0, y: 0, w: 13.333, h: 0.18 }, C.coral) +
      bodyPh(3, "テキスト プレースホルダー 3", 10, "本日お伝えする3つの論点", { x: 0.62, y: 0.34, w: 12.1, h: 0.92 }, 24, { bold: true, color: C.darkText }) +
      bodyPh(4, "コンテンツ 4", 11, "論点A", { x: 0.62, y: 1.62, w: 3.9, h: 4.6 }, 12) +
      bodyPh(5, "コンテンツ 5", 12, "論点B", { x: 4.72, y: 1.62, w: 3.9, h: 4.6 }, 12) +
      bodyPh(6, "コンテンツ 6", 13, "論点C", { x: 8.82, y: 1.62, w: 3.9, h: 4.6 }, 12),
  },
  {
    // P1+P3: 見出しは生テキストボックス。図枠は body 型（巨大面積×大フォント×疎）＝散文ではない。
    name: "レイアウト 3",
    bg: C.white,
    shapes:
      deco(2, { x: 0.5, y: 0.5, w: 0.55, h: 0.55 }, C.tealAcc, 0.1) +
      rawText(3, "TextBox 3", "図：システム全体構成", { x: 1.25, y: 0.4, w: 11.4, h: 0.8 }, 22, { bold: true, color: C.darkText }) +
      bodyPh(4, "図版エリア 4", 1, "", { x: 0.7, y: 1.55, w: 8.3, h: 4.9 }, 28) +   // 図/ヒーロー枠（body 型）
      bodyPh(5, "注記 5", 2, "各コンポーネントの役割はこちらを参照", { x: 9.3, y: 1.55, w: 3.4, h: 4.9 }, 11), // 脇の注記
  },
  {
    // P4: 極大フォントの章番号 "03"（accent）を title と誤認させる罠。実タイトルは body 型。
    name: "カスタム 4",
    bg: C.teal,
    shapes:
      deco(2, { x: 0, y: 0, w: 3.6, h: 7.5 }, C.coral) +
      rawText(3, "TextBox 3", "03", { x: 0.55, y: 2.35, w: 2.5, h: 1.7 }, 60, { bold: true, align: "ctr", color: C.white }) + // 章番号=装飾
      bodyPh(4, "章タイトル 4", 1, "第3章　導入計画とスケジュール", { x: 4.1, y: 3.0, w: 8.6, h: 1.2 }, 28, { bold: true, color: C.white }),
  },
];

// ── マスター（title + body の 2 枠のみ・命名ゴミ・typed chrome 無し ⇒ 明確に "bare third-party"）──
const masterPh = (id: number, name: string, phAttrs: string, b: Box): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
  `<p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(b)}</p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;

function masterXml(n: number): string {
  const ids = Array.from({ length: n }, (_v, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("");
  const phs = masterPh(2, "オブジェクト 2", `type="title"`, { x: 0.5, y: 0.35, w: 12.3, h: 1.2 }) +
    masterPh(3, "オブジェクト 3", `type="body" idx="1"`, { x: 0.5, y: 1.75, w: 12.3, h: 4.9 });
  const titleStyle = `<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="${C.darkText}"/></a:solidFill><a:latin typeface="Poppins"/></a:defRPr></a:lvl1pPr></p:titleStyle>`;
  const bodyStyle = `<p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="${C.darkText}"/></a:solidFill><a:latin typeface="Inter"/></a:defRPr></a:lvl1pPr></p:bodyStyle>`;
  return `${XML_DECL}<p:sldMaster ${NS_A} ${NS_P} ${NS_R}>` +
    `<p:cSld>${bgXml(C.white)}<p:spTree>${spTreeHead}${phs}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst>${ids}</p:sldLayoutIdLst>` +
    `<p:txStyles>${titleStyle}${bodyStyle}<p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function themeXml(): string {
  const solid = (h: string) => `<a:srgbClr val="${h}"/>`;
  const fill3 = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`.repeat(3);
  const ln = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  return `${XML_DECL}<a:theme ${NS_A} name="Dirty Adversarial"><a:themeElements>` +
    `<a:clrScheme name="Dirty Adversarial">` +
    `<a:dk1>${solid(C.darkText)}</a:dk1><a:lt1>${solid(C.white)}</a:lt1>` +
    `<a:dk2>${solid(C.navy)}</a:dk2><a:lt2>${solid(C.lightText)}</a:lt2>` +
    `<a:accent1>${solid(C.coral)}</a:accent1><a:accent2>${solid(C.tealAcc)}</a:accent2>` +
    `<a:accent3>${solid(C.teal)}</a:accent3><a:accent4>${solid(C.navy)}</a:accent4>` +
    `<a:accent5>${solid(C.lightText)}</a:accent5><a:accent6>${solid(C.white)}</a:accent6>` +
    `<a:hlink>${solid(C.coral)}</a:hlink><a:folHlink>${solid(C.tealAcc)}</a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="Dirty Adversarial">` +
    `<a:majorFont><a:latin typeface="Poppins"/><a:ea typeface="Noto Sans JP"/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Inter"/><a:ea typeface="Noto Sans JP"/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="Office"><a:fillStyleLst>${fill3}</a:fillStyleLst><a:lnStyleLst>${ln.repeat(3)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${`<a:effectStyle><a:effectLst/></a:effectStyle>`.repeat(3)}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function layoutXml(l: DirtyLayout): string {
  return `${XML_DECL}<p:sldLayout ${NS_A} ${NS_P} ${NS_R} preserve="1">` +
    `<p:cSld name="${escXml(l.name)}">${bgXml(l.bg)}<p:spTree>${spTreeHead}${l.shapes}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

const rels = (entries: string[]) => `${XML_DECL}<Relationships ${REL_NS}>${entries.join("")}</Relationships>`;
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${REL_T}/${type}" Target="${target}"/>`;
const relRaw = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;

function contentTypesXml(n: number): string {
  const layoutOverrides = Array.from({ length: n }, (_v, i) =>
    `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join("");
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    layoutOverrides +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;
}

const presentationXml =
  `${XML_DECL}<p:presentation ${NS_A} ${NS_P} ${NS_R}>` +
  `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst/>` +
  `<p:sldSz cx="${EMU(13.333)}" cy="${EMU(7.5)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

async function main() {
  const zip = new JSZip();
  const n = LAYOUTS.length;
  zip.file("[Content_Types].xml", contentTypesXml(n));
  zip.file("_rels/.rels", rels([
    rel("rId1", "officeDocument", "ppt/presentation.xml"),
    relRaw("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
    rel("rId3", "extended-properties", "docProps/app.xml"),
  ]));
  zip.file("docProps/core.xml", `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Dirty Adversarial</dc:title><dc:creator>SlideCraft fixture</dc:creator></cp:coreProperties>`);
  zip.file("docProps/app.xml", `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SlideCraft</Application></Properties>`);
  zip.file("ppt/presentation.xml", presentationXml);
  zip.file("ppt/_rels/presentation.xml.rels", rels([
    rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
    rel("rId2", "theme", "theme/theme1.xml"),
  ]));
  zip.file("ppt/theme/theme1.xml", themeXml());
  zip.file("ppt/slideMasters/slideMaster1.xml", masterXml(n));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([
    ...LAYOUTS.map((_d, i) => rel(`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`)),
    rel(`rId${n + 1}`, "theme", "../theme/theme1.xml"),
  ]));
  LAYOUTS.forEach((l, i) => {
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(l));
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]));
  });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const out = resolve(process.cwd(), "tests/fixtures/templates/Dirty_Adversarial_TemplateOnly.pptx");
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes, ${n} layouts)`);
}

main();
