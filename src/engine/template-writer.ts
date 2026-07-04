/**
 * template-writer.ts — TemplateSpec → template-only PPTX のフル OOXML 生成（テーマ2 S3・純粋ロジック R2）。
 *
 * マスター/レイアウト/テーマ/配管（[Content_Types]・rels・presentation）をゼロから書き出す。
 * レイアウト定義は template-layout-library.ts（canonical 実証済みの座標/idx/type）を既定とし、
 * 配色（セマンティックなパレットキー）とフォント（major/minor）はスペックで自由に差し替える。
 * 検証ゲートは「読む側」の再利用 — loadTemplate → assessTemplateHealth が ok であること
 * （tests/template-writer.test.ts）。設計: docs/design/template-authoring.md S3。
 */
import JSZip from "jszip";
import {
  BUILTIN_LAYOUTS,
  type LayoutDef,
  type LayoutPhDef,
  type PaletteKey,
} from "./template-layout-library";

export interface TemplateSpec {
  name: string;
  fonts: { major: string; minor: string }; // major=見出し / minor=本文
  palette: Record<PaletteKey, string>; // hex（# なし）
  layouts?: LayoutDef[]; // 省略時は組み込み 30 レイアウト
}

/** 既定パレット＝Midnight Executive（canonical の焼き込み色）。スペックはこれを spread して部分差し替えできる。 */
export const MIDNIGHT_PALETTE: Record<PaletteKey, string> = {
  background: "1E2761",
  canvas: "FFFFFF",
  titleText: "FFFFFF",
  bodyText: "1E293B",
  subtle: "CADCFC",
  muted: "94A3B8",
  accent: "3B82F6",
  accent2: "06B6D4",
  emphasis: "1E2761",
};

// ── 定数（設計パラメータ: スライド 13.33×7.5in / EMU 換算）──
const EMU = (inches: number) => Math.round(inches * 914400);
const SLIDE_W = 13.333;
const HEADER_BAR_H = 1.18; // light 系レイアウトのヘッダーバー（idx15/16 ヘッダーを覆う）

// マスター既定（canonical と同値 — lstStyle は差分のみ出力するのでここが基準）
const MASTER_TITLE = { sz: 4400, bold: true, font: "major" as const, color: "titleText" as PaletteKey };
const MASTER_BODY = { sz: 1400, bold: false, font: "minor" as const, color: "bodyText" as PaletteKey };

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NS_A = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;
const NS_P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const NS_R = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL_NS = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`;
const REL_T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ── パーツ生成 ──

function themeXml(spec: TemplateSpec): string {
  const c = spec.palette;
  const solid = (hex: string) => `<a:srgbClr val="${hex}"/>`;
  const fill3 = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`.repeat(3);
  const ln = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  return `${XML_DECL}<a:theme ${NS_A} name="${escXml(spec.name)}"><a:themeElements>` +
    `<a:clrScheme name="${escXml(spec.name)}">` +
    `<a:dk1>${solid(c.bodyText)}</a:dk1><a:lt1>${solid(c.canvas)}</a:lt1>` +
    `<a:dk2>${solid(c.background)}</a:dk2><a:lt2>${solid(c.subtle)}</a:lt2>` +
    `<a:accent1>${solid(c.accent)}</a:accent1><a:accent2>${solid(c.accent2)}</a:accent2>` +
    `<a:accent3>${solid(c.emphasis)}</a:accent3><a:accent4>${solid(c.muted)}</a:accent4>` +
    `<a:accent5>${solid(c.subtle)}</a:accent5><a:accent6>${solid(c.titleText)}</a:accent6>` +
    `<a:hlink>${solid(c.accent)}</a:hlink><a:folHlink>${solid(c.muted)}</a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="${escXml(spec.name)}">` +
    `<a:majorFont><a:latin typeface="${escXml(spec.fonts.major)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${escXml(spec.fonts.minor)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="Office">` +
    `<a:fillStyleLst>${fill3}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln.repeat(3)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${`<a:effectStyle><a:effectLst/></a:effectStyle>`.repeat(3)}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill3}</a:bgFillStyleLst>` +
    `</a:fmtScheme></a:themeElements></a:theme>`;
}

const bgXml = (hex: string) =>
  `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;

const emptySpTreeHeader =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

function masterStyleXml(tag: string, base: typeof MASTER_TITLE, spec: TemplateSpec): string {
  return `<p:${tag}><a:lvl1pPr algn="l"><a:defRPr sz="${base.sz}"${base.bold ? ` b="1"` : ""}>` +
    `<a:solidFill><a:srgbClr val="${spec.palette[base.color]}"/></a:solidFill>` +
    `<a:latin typeface="${escXml(spec.fonts[base.font])}"/></a:defRPr></a:lvl1pPr></p:${tag}>`;
}

function masterXml(spec: TemplateSpec, layoutCount: number): string {
  const layoutIds = Array.from({ length: layoutCount }, (_v, i) =>
    `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("");
  return `${XML_DECL}<p:sldMaster ${NS_A} ${NS_P} ${NS_R}>` +
    `<p:cSld>${bgXml(spec.palette.canvas)}<p:spTree>${emptySpTreeHeader}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"` +
    ` accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>` +
    `<p:txStyles>${masterStyleXml("titleStyle", MASTER_TITLE, spec)}${masterStyleXml("bodyStyle", MASTER_BODY, spec)}<p:otherStyle/></p:txStyles>` +
    `</p:sldMaster>`;
}

/** lstStyle はマスター既定との差分のみ（canonical の rebuild-template と同じ規約＋フォント差も明示）。 */
function phLstStyle(ph: LayoutPhDef, spec: TemplateSpec): string {
  const isTitleType = ph.type === "ctrTitle" || ph.type === "title";
  const base = isTitleType ? MASTER_TITLE : MASTER_BODY;
  const sz = ph.fontSize * 100;
  let rPrAttrs = "";
  let rPrChildren = "";
  let pPrAttrs = "";
  if (sz !== base.sz) rPrAttrs += ` sz="${sz}"`;
  if (ph.bold !== base.bold) rPrAttrs += ` b="${ph.bold ? "1" : "0"}"`;
  if (ph.color !== base.color) rPrChildren += `<a:solidFill><a:srgbClr val="${spec.palette[ph.color]}"/></a:solidFill>`;
  if (ph.font !== base.font) rPrChildren += `<a:latin typeface="${escXml(spec.fonts[ph.font])}"/>`;
  if (ph.align !== "l") pPrAttrs += ` algn="${ph.align}"`;
  if (!rPrAttrs && !rPrChildren && !pPrAttrs) return `<a:lstStyle/>`;
  return `<a:lstStyle><a:defPPr${pPrAttrs}><a:defRPr${rPrAttrs}>${rPrChildren}</a:defRPr></a:defPPr></a:lstStyle>`;
}

function phShapeXml(ph: LayoutPhDef, spec: TemplateSpec, shapeId: number): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${escXml(ph.name)}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="${ph.type}" idx="${ph.idx}"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${EMU(ph.x)}" y="${EMU(ph.y)}"/><a:ext cx="${EMU(ph.w)}" cy="${EMU(ph.h)}"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" anchor="t" anchorCtr="0"/>${phLstStyle(ph, spec)}` +
    `<a:p><a:r><a:rPr lang="ja-JP"/><a:t> </a:t></a:r></a:p></p:txBody></p:sp>`;
}

function decoShapeXml(
  d: { x: number; y: number; w: number; h: number; color: PaletteKey; radius?: number },
  spec: TemplateSpec,
  shapeId: number,
): string {
  const prst = d.radius ? "roundRect" : "rect";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Deco${shapeId}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${EMU(d.x)}" y="${EMU(d.y)}"/><a:ext cx="${EMU(d.w)}" cy="${EMU(d.h)}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${spec.palette[d.color]}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}

function layoutXml(def: LayoutDef, spec: TemplateSpec): string {
  // family が装飾を決める: dark=背景塗りのみ / light=canvas 塗り＋ヘッダーバー（白タイトルの可読性）
  const bg = def.family === "dark" ? spec.palette.background : spec.palette.canvas;
  const decos = [
    ...(def.family === "light" ? [{ x: 0, y: 0, w: SLIDE_W, h: HEADER_BAR_H, color: "background" as PaletteKey }] : []),
    ...(def.decos ?? []),
  ];
  let shapeId = 2;
  const shapes =
    decos.map((d) => decoShapeXml(d, spec, shapeId++)).join("") +
    def.placeholders.map((ph) => phShapeXml(ph, spec, shapeId++)).join("");
  return `${XML_DECL}<p:sldLayout ${NS_A} ${NS_P} ${NS_R} preserve="1">` +
    `<p:cSld name="${escXml(def.name)}">${bgXml(bg)}<p:spTree>${emptySpTreeHeader}${shapes}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

const relationships = (entries: string[]) =>
  `${XML_DECL}<Relationships ${REL_NS}>${entries.join("")}</Relationships>`;
const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${REL_T}/${type}" Target="${target}"/>`;

function contentTypesXml(layoutCount: number): string {
  const layoutOverrides = Array.from({ length: layoutCount }, (_v, i) =>
    `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml"` +
    ` ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join("");
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    layoutOverrides +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `</Types>`;
}

const presentationXml =
  `${XML_DECL}<p:presentation ${NS_A} ${NS_P} ${NS_R}>` +
  `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  `<p:sldIdLst/>` +
  `<p:sldSz cx="${EMU(SLIDE_W)}" cy="${EMU(7.5)}"/><p:notesSz cx="6858000" cy="9144000"/>` +
  `</p:presentation>`;

// ── エントリポイント ──

/**
 * TemplateSpec から template-only PPTX（スライド本体なし・マスター＋レイアウト＋テーマ）を生成する。
 * 生成物は loadTemplate → assessTemplateHealth=ok を満たし、既存の distill/placeholder-filler で
 * そのままコンテンツを流し込める（テストで担保）。
 */
export async function writeTemplate(spec: TemplateSpec): Promise<Uint8Array> {
  const layouts = spec.layouts ?? BUILTIN_LAYOUTS;
  if (layouts.length === 0) throw new Error("TemplateSpec.layouts must not be empty");
  const zip = new JSZip();

  zip.file("[Content_Types].xml", contentTypesXml(layouts.length));
  zip.file("_rels/.rels", relationships([rel("rId1", "officeDocument", "ppt/presentation.xml")]));
  zip.file("ppt/presentation.xml", presentationXml);
  zip.file("ppt/_rels/presentation.xml.rels", relationships([
    rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
    rel("rId2", "theme", "theme/theme1.xml"),
  ]));
  zip.file("ppt/theme/theme1.xml", themeXml(spec));
  zip.file("ppt/slideMasters/slideMaster1.xml", masterXml(spec, layouts.length));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", relationships([
    ...layouts.map((_d, i) => rel(`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`)),
    rel(`rId${layouts.length + 1}`, "theme", "../theme/theme1.xml"),
  ]));
  layouts.forEach((def, i) => {
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(def, spec));
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`,
      relationships([rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]));
  });

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
