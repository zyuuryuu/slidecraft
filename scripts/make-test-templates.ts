/**
 * make-test-templates.ts — 実機テスト用の「realistic messy 会社テンプレ」を生成する。
 *
 * Dirty_Adversarial は chrome（header/footer/date/番号）を持たないので header 誤注入の消失を体感できない。
 * 本テンプレは「見た目は普通の会社デッキだが構造が雑」で、F1 の改善を実機で確認するための試験台:
 *   - hdr 型ヘッダー帯 → scorer が chrome 判定 → 本文が流れ込まない（②b do-no-harm）
 *   - body 型の見出し（title 型でない）→ scorer が title へ昇格（②b 復元）
 *   - typed footer/date/番号（chrome）→ 本文が入らない
 *   - 図枠（body 型・大面積大フォント）→ figure 判定
 * 出力は合成物（IP 非含有）。test-data/master-intake/ に置く。
 */
import JSZip from "jszip";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EMU = (inch: number) => Math.round(inch * 914400);
const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NS_A = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;
const NS_P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const NS_R = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL_NS = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`;
const REL_T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const C = { navy: "1F3A5F", white: "FFFFFF", slate: "334155", steel: "64748B", accent: "2E7DD1", light: "E8EEF5", darkText: "1A2430" };

interface Box { x: number; y: number; w: number; h: number; }
const xfrm = (b: Box) => `<a:xfrm><a:off x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:ext cx="${EMU(b.w)}" cy="${EMU(b.h)}"/></a:xfrm>`;

/** 型付き placeholder（title/subTitle/dt/ftr/sldNum、および見出し/本文の body）。 */
function typedPh(id: number, name: string, phAttrs: string, b: Box, fs: number, o: { bold?: boolean; align?: string; color?: string } = {}): string {
  const col = o.color ? `<a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` : "";
  const rPr = `<a:rPr lang="ja-JP" sz="${fs * 100}"${o.bold ? ` b="1"` : ""}>${col}</a:rPr>`;
  const pPr = o.align ? `<a:pPr algn="${o.align}"/>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(b)}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${pPr}<a:r>${rPr}<a:t> </a:t></a:r></a:p></p:txBody></p:sp>`;
}
function deco(id: number, b: Box, hex: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bar ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}

const bg = (hex: string) => `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
const spHead = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

// 下部 chrome（typed date/footer/番号）— どのコンテンツ層にも付ける
const chromeStrip = (base: number) =>
  typedPh(base, "日付", `type="dt" sz="half" idx="21"`, { x: 0.5, y: 7.04, w: 3, h: 0.34 }, 10, { color: C.steel }) +
  typedPh(base + 1, "フッター", `type="ftr" sz="quarter" idx="22"`, { x: 4.6, y: 7.04, w: 4.1, h: 0.34 }, 10, { color: C.steel, align: "ctr" }) +
  typedPh(base + 2, "スライド番号", `type="sldNum" sz="quarter" idx="23"`, { x: 10.3, y: 7.04, w: 2.5, h: 0.34 }, 10, { color: C.steel, align: "r" });

interface L { name: string; bgc: string; shapes: string; }
const LAYOUTS: L[] = [
  {
    // 表紙: クリーン（ctrTitle + subtitle）。デッキに正しい表紙を与える。
    name: "表紙",
    bgc: C.navy,
    shapes:
      deco(2, { x: 0, y: 5.7, w: 4.6, h: 0.12 }, C.accent) +
      typedPh(3, "Title", `type="ctrTitle"`, { x: 1.0, y: 2.6, w: 11.3, h: 1.4 }, 40, { bold: true, color: C.white }) +
      typedPh(4, "Subtitle", `type="subTitle"`, { x: 1.0, y: 4.1, w: 11.3, h: 0.7 }, 18, { color: C.light }),
  },
  {
    // 本文（ヘッダー付き）: hdr 帯 + body 見出し(idx1) + body 本文(idx2) + 下部 chrome。
    //   → header は chrome 判定で本文を受けない／見出しは title へ昇格。
    name: "本文（ヘッダー付き）",
    bgc: C.white,
    shapes:
      deco(2, { x: 0, y: 0, w: 13.333, h: 0.5 }, C.light) +
      typedPh(3, "オブジェクト 3", `type="hdr" idx="20"`, { x: 0.5, y: 0.12, w: 6, h: 0.26 }, 10, { color: C.steel }) +
      typedPh(4, "テキスト プレースホルダー", `type="body" idx="1"`, { x: 0.6, y: 0.72, w: 12.1, h: 0.9 }, 24, { bold: true, color: C.navy }) +
      typedPh(5, "本文", `type="body" idx="2"`, { x: 0.6, y: 1.85, w: 12.1, h: 4.9 }, 14, { color: C.darkText }) +
      chromeStrip(10),
  },
  {
    // 3カラム: body 見出し(idx1) + 3 カラム(idx2/3/4) + 下部 chrome。
    name: "3カラム",
    bgc: C.white,
    shapes:
      typedPh(2, "テキスト プレースホルダー", `type="body" idx="1"`, { x: 0.6, y: 0.4, w: 12.1, h: 0.9 }, 24, { bold: true, color: C.navy }) +
      typedPh(3, "左", `type="body" idx="2"`, { x: 0.6, y: 1.6, w: 3.9, h: 4.9 }, 13, { color: C.darkText }) +
      typedPh(4, "中", `type="body" idx="3"`, { x: 4.72, y: 1.6, w: 3.9, h: 4.9 }, 13, { color: C.darkText }) +
      typedPh(5, "右", `type="body" idx="4"`, { x: 8.83, y: 1.6, w: 3.9, h: 4.9 }, 13, { color: C.darkText }) +
      chromeStrip(10),
  },
  {
    // 図＋説明: body 見出し(idx1) + 図枠(idx2・大面積大フォント=figure) + 注記(idx3) + chrome。
    name: "図＋説明",
    bgc: C.white,
    shapes:
      typedPh(2, "テキスト プレースホルダー", `type="body" idx="1"`, { x: 0.6, y: 0.4, w: 12.1, h: 0.9 }, 24, { bold: true, color: C.navy }) +
      typedPh(3, "図版エリア", `type="body" idx="2"`, { x: 0.6, y: 1.6, w: 8.4, h: 4.9 }, 28, { color: C.steel }) +
      typedPh(4, "注記", `type="body" idx="3"`, { x: 9.2, y: 1.6, w: 3.5, h: 4.9 }, 12, { color: C.darkText }) +
      chromeStrip(10),
  },
];

const masterPh = (id: number, name: string, phAttrs: string, b: Box) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
  `<p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(b)}</p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;

function masterXml(n: number): string {
  const ids = Array.from({ length: n }, (_v, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("");
  const phs =
    masterPh(2, "Title", `type="title"`, { x: 0.6, y: 0.4, w: 12.1, h: 1.0 }) +
    masterPh(3, "Body", `type="body" idx="1"`, { x: 0.6, y: 1.6, w: 12.1, h: 4.9 }) +
    masterPh(4, "Date", `type="dt" sz="half" idx="21"`, { x: 0.5, y: 7.04, w: 3, h: 0.34 }) +
    masterPh(5, "Footer", `type="ftr" sz="quarter" idx="22"`, { x: 4.6, y: 7.04, w: 4.1, h: 0.34 }) +
    masterPh(6, "SlideNum", `type="sldNum" sz="quarter" idx="23"`, { x: 10.3, y: 7.04, w: 2.5, h: 0.34 });
  const ts = `<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800" b="1"><a:solidFill><a:srgbClr val="${C.navy}"/></a:solidFill><a:latin typeface="Yu Gothic"/></a:defRPr></a:lvl1pPr></p:titleStyle>`;
  const bs = `<p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="${C.darkText}"/></a:solidFill><a:latin typeface="Yu Gothic"/></a:defRPr></a:lvl1pPr></p:bodyStyle>`;
  return `${XML}<p:sldMaster ${NS_A} ${NS_P} ${NS_R}><p:cSld>${bg(C.white)}<p:spTree>${spHead}${phs}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst>${ids}</p:sldLayoutIdLst>` +
    `<p:txStyles>${ts}${bs}<p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function themeXml(): string {
  const s = (h: string) => `<a:srgbClr val="${h}"/>`;
  const f3 = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`.repeat(3);
  const ln = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  return `${XML}<a:theme ${NS_A} name="Test Corporate"><a:themeElements><a:clrScheme name="Test Corporate">` +
    `<a:dk1>${s(C.darkText)}</a:dk1><a:lt1>${s(C.white)}</a:lt1><a:dk2>${s(C.navy)}</a:dk2><a:lt2>${s(C.light)}</a:lt2>` +
    `<a:accent1>${s(C.accent)}</a:accent1><a:accent2>${s(C.steel)}</a:accent2><a:accent3>${s(C.slate)}</a:accent3>` +
    `<a:accent4>${s(C.navy)}</a:accent4><a:accent5>${s(C.light)}</a:accent5><a:accent6>${s(C.white)}</a:accent6>` +
    `<a:hlink>${s(C.accent)}</a:hlink><a:folHlink>${s(C.steel)}</a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Test Corporate"><a:majorFont><a:latin typeface="Yu Gothic"/><a:ea typeface="游ゴシック"/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Yu Gothic"/><a:ea typeface="游ゴシック"/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Office"><a:fillStyleLst>${f3}</a:fillStyleLst><a:lnStyleLst>${ln.repeat(3)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${`<a:effectStyle><a:effectLst/></a:effectStyle>`.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${f3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

const layoutXml = (l: L) =>
  `${XML}<p:sldLayout ${NS_A} ${NS_P} ${NS_R} preserve="1"><p:cSld name="${escXml(l.name)}">${bg(l.bgc)}<p:spTree>${spHead}${l.shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rels = (e: string[]) => `${XML}<Relationships ${REL_NS}>${e.join("")}</Relationships>`;
const rel = (id: string, t: string, tg: string) => `<Relationship Id="${id}" Type="${REL_T}/${t}" Target="${tg}"/>`;
const relRaw = (id: string, t: string, tg: string) => `<Relationship Id="${id}" Type="${t}" Target="${tg}"/>`;

function contentTypes(n: number): string {
  const ov = Array.from({ length: n }, (_v, i) => `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join("");
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` + ov +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}
const presentation = `${XML}<p:presentation ${NS_A} ${NS_P} ${NS_R}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst/><p:sldSz cx="${EMU(13.333)}" cy="${EMU(7.5)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

async function main() {
  const zip = new JSZip();
  const n = LAYOUTS.length;
  zip.file("[Content_Types].xml", contentTypes(n));
  zip.file("_rels/.rels", rels([rel("rId1", "officeDocument", "ppt/presentation.xml"), relRaw("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"), rel("rId3", "extended-properties", "docProps/app.xml")]));
  zip.file("docProps/core.xml", `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>テスト用 会社テンプレ（乱雑）</dc:title><dc:creator>SlideCraft test-data</dc:creator></cp:coreProperties>`);
  zip.file("docProps/app.xml", `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SlideCraft</Application></Properties>`);
  zip.file("ppt/presentation.xml", presentation);
  zip.file("ppt/_rels/presentation.xml.rels", rels([rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml"), rel("rId2", "theme", "theme/theme1.xml")]));
  zip.file("ppt/theme/theme1.xml", themeXml());
  zip.file("ppt/slideMasters/slideMaster1.xml", masterXml(n));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([...LAYOUTS.map((_d, i) => rel(`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`)), rel(`rId${n + 1}`, "theme", "../theme/theme1.xml")]));
  LAYOUTS.forEach((l, i) => {
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(l));
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]));
  });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const dir = resolve(process.cwd(), "test-data/master-intake");
  mkdirSync(dir, { recursive: true });
  const out = resolve(dir, "messy-corporate.pptx");
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes, ${n} layouts)`);
}
main();
