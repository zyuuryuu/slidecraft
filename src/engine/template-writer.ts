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

/** A logo image lifted from a source master (Re-make). Injected onto the dark-family layouts
 *  (cover/section/closing) — where corporate templates show their logo — as a native <p:pic>. */
export interface LogoSpec {
  bytes: Uint8Array;
  ext: "png" | "jpeg" | "gif"; // raster only (svg/emf need a fallback part — skipped in v1)
  aspect: number; // w/h, to preserve when placing
}

export interface TemplateSpec {
  name: string;
  // major=見出し / minor=本文. `*Ea` = the East-Asian (CJK) typeface for that role — for Japanese
  // masters the brand font usually lives HERE (theme <a:ea>), so it must round-trip or JP text loses it.
  fonts: { major: string; minor: string; majorEa?: string; minorEa?: string };
  palette: Record<PaletteKey, string>; // hex（# なし）
  layouts?: LayoutDef[]; // 省略時は組み込み 30 レイアウト
  logo?: LogoSpec; // Re-make: 元マスターのロゴを dark 系レイアウトへ載せる
  // Re-make: ソースが「フラット設計」（本文スライドは白地＋暗い見出し・ヘッダーバー無し。CX 等）なら true。
  // light 系レイアウトのヘッダーバーを外し、バー前提の明色（titleText/subtle）を暗色へ寄せる。
  flatContent?: boolean;
}

// 生成物での ext → MIME（[Content_Types] の Default 用）
const IMG_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif" };
// ロゴ配置（inch）: 表紙/章扉の左上、CX の実配置に倣う。幅上限＋アスペクト維持で高さを決める。
const LOGO_MAX_W = 2.3;
const LOGO_X = 0.5;
const LOGO_Y = 0.45;
/** dark 系レイアウトにロゴを載せるか（light 系はヘッダーバーと干渉するため v1 では載せない）。 */
const layoutHasLogo = (def: LayoutDef, spec: TemplateSpec): boolean => !!spec.logo && def.family === "dark";

function logoPicXml(spec: TemplateSpec, shapeId: number): string {
  const w = Math.min(LOGO_MAX_W, 4);
  const h = w / (spec.logo!.aspect > 0 ? spec.logo!.aspect : 3);
  return `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="Logo"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${EMU(LOGO_X)}" y="${EMU(LOGO_Y)}"/><a:ext cx="${EMU(w)}" cy="${EMU(h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
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

// 日本語ファーストの既定: spec が majorEa/minorEa を指定しない時に theme <a:ea> へ焼く CJK フォールバック
// フォント（#137）。Windows/Office 標準搭載で追加インストール不要なもの。
const DEFAULT_EA_FONT = "Yu Gothic";

// タイトルがサブタイトル枠と重ならないかの検査に使う行送り近似係数（実測フォントに依らない安全側の目安）。
export const TITLE_LINE_HEIGHT_FACTOR = 1.2;
// タイトル本文の下端とサブタイトル枠の間に最低限確保する余白（inch）。
export const MIN_TITLE_SUBTITLE_GAP_IN = 0.15;

/** タイトルが `lines` 行に折り返した時の本文下端（inch）。box は anchor="t" のため上端からテキストが
 *  積み上がる前提（#137: 表紙のタイトル/サブタイトル衝突の検査に使う）。 */
export function titleTextBottomIn(titleY: number, titleFontSizePt: number, lines: number): number {
  return titleY + (lines * titleFontSizePt * TITLE_LINE_HEIGHT_FACTOR) / 72;
}

// マスター既定（canonical と同値 — lstStyle は差分のみ出力するのでここが基準）
type MasterStyle = { sz: number; bold: boolean; font: "major" | "minor"; color: PaletteKey };
const MASTER_TITLE: MasterStyle = { sz: 4400, bold: true, font: "major", color: "titleText" };
const MASTER_BODY: MasterStyle = { sz: 1400, bold: false, font: "minor", color: "bodyText" };

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
    `<a:majorFont><a:latin typeface="${escXml(spec.fonts.major)}"/><a:ea typeface="${escXml(spec.fonts.majorEa ?? DEFAULT_EA_FONT)}"/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${escXml(spec.fonts.minor)}"/><a:ea typeface="${escXml(spec.fonts.minorEa ?? DEFAULT_EA_FONT)}"/><a:cs typeface=""/></a:minorFont>` +
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

// bodyStyle lvl1 の既定バレット（#137: 箇条書きが本文と区別できない = master に buChar/buAutoNum が
// 無いのが根本原因）。段落間スペーシングも合わせて焼き、長文箇条書きが「壁テキスト」に見えるのを防ぐ。
const BODY_BULLET_PPR =
  `<a:spcBef><a:spcPts val="600"/></a:spcBef>` +
  `<a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/>`;

function masterStyleXml(tag: string, base: MasterStyle, spec: TemplateSpec): string {
  // タイトルは単一行想定のためバレットを明示的に抑制。本文（bodyStyle）のみ既定バレットを持つ。
  const pPrExtra = tag === "bodyStyle" ? BODY_BULLET_PPR : `<a:buNone/>`;
  return `<p:${tag}><a:lvl1pPr algn="l">${pPrExtra}<a:defRPr sz="${base.sz}"${base.bold ? ` b="1"` : ""}>` +
    `<a:solidFill><a:srgbClr val="${spec.palette[base.color]}"/></a:solidFill>` +
    `<a:latin typeface="${escXml(spec.fonts[base.font])}"/></a:defRPr></a:lvl1pPr></p:${tag}>`;
}

// マスターの標準 placeholder 5種（継承の祖先）。レイアウト側 ph は全て明示 xfrm を持つため
// 幾何の継承には使われないが、sldNum/dt/ftr のフィールド挙動と「ヘッダーとフッター」対応、
// および周辺ツール互換のため OOXML 慣習どおり置く（16:9 標準配置）。
const MASTER_PLACEHOLDERS: Array<{ phAttrs: string; name: string; x: number; y: number; w: number; h: number }> = [
  { phAttrs: `type="title"`, name: "Title Placeholder 1", x: 0.5, y: 0.35, w: 12.33, h: 1.2 },
  { phAttrs: `type="body" idx="1"`, name: "Text Placeholder 2", x: 0.5, y: 1.75, w: 12.33, h: 4.9 },
  { phAttrs: `type="dt" sz="half" idx="2"`, name: "Date Placeholder 3", x: 0.5, y: 6.98, w: 3.0, h: 0.38 },
  { phAttrs: `type="ftr" sz="quarter" idx="3"`, name: "Footer Placeholder 4", x: 4.6, y: 6.98, w: 4.13, h: 0.38 },
  { phAttrs: `type="sldNum" sz="quarter" idx="4"`, name: "Slide Number Placeholder 5", x: 10.33, y: 6.98, w: 2.5, h: 0.38 },
];

function masterPhShapeXml(i: number): string {
  const ph = MASTER_PLACEHOLDERS[i];
  return `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="${ph.name}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${ph.phAttrs}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${EMU(ph.x)}" y="${EMU(ph.y)}"/><a:ext cx="${EMU(ph.w)}" cy="${EMU(ph.h)}"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}

function masterXml(spec: TemplateSpec, layoutCount: number): string {
  const layoutIds = Array.from({ length: layoutCount }, (_v, i) =>
    `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("");
  const phs = MASTER_PLACEHOLDERS.map((_p, i) => masterPhShapeXml(i)).join("");
  return `${XML_DECL}<p:sldMaster ${NS_A} ${NS_P} ${NS_R}>` +
    `<p:cSld>${bgXml(spec.palette.canvas)}<p:spTree>${emptySpTreeHeader}${phs}</p:spTree></p:cSld>` +
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
  // family が装飾を決める: dark=背景塗りのみ / light=canvas 塗り＋ヘッダーバー（白タイトルの可読性）。
  // flatContent（ソースがフラット設計）なら light のヘッダーバーを外し、バー前提の明色を暗色へ寄せる。
  const flat = !!spec.flatContent && def.family === "light";
  const bg = def.family === "dark" ? spec.palette.background : spec.palette.canvas;
  const decos = [
    ...(def.family === "light" && !flat ? [{ x: 0, y: 0, w: SLIDE_W, h: HEADER_BAR_H, color: "background" as PaletteKey }] : []),
    ...(def.decos ?? []),
  ];
  // バー上で白/薄色だった見出し・サブ見出しを、白 canvas でも読める暗色へ（title→emphasis, subtitle→muted）。
  const remap = (c: PaletteKey): PaletteKey => (flat ? (c === "titleText" ? "emphasis" : c === "subtle" ? "muted" : c) : c);
  let shapeId = 2;
  const shapes =
    decos.map((d) => decoShapeXml(d, spec, shapeId++)).join("") +
    def.placeholders.map((ph) => phShapeXml(flat ? { ...ph, color: remap(ph.color) } : ph, spec, shapeId++)).join("") +
    (layoutHasLogo(def, spec) ? logoPicXml(spec, shapeId++) : ""); // logo on top (last shape)
  return `${XML_DECL}<p:sldLayout ${NS_A} ${NS_P} ${NS_R} preserve="1">` +
    `<p:cSld name="${escXml(def.name)}">${bgXml(bg)}<p:spTree>${emptySpTreeHeader}${shapes}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

const relationships = (entries: string[]) =>
  `${XML_DECL}<Relationships ${REL_NS}>${entries.join("")}</Relationships>`;
const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${REL_T}/${type}" Target="${target}"/>`;
// docProps は officeDocument 系と関係型の名前空間が異なる（package / officeDocument）
const relRaw = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;

// ── 慣習パート（PowerPoint は欠落に寛容だが、周辺ツール互換と開封安全性のため canonical と揃える）──

function corePropsXml(spec: TemplateSpec): string {
  return `${XML_DECL}<cp:coreProperties` +
    ` xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"` +
    ` xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${escXml(spec.name)}</dc:title><dc:creator>SlideCraft</dc:creator></cp:coreProperties>`;
}

const APP_PROPS_XML =
  `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
  `<Application>SlideCraft</Application></Properties>`;
const PRES_PROPS_XML = `${XML_DECL}<p:presentationPr ${NS_A} ${NS_P}/>`;
const VIEW_PROPS_XML = `${XML_DECL}<p:viewPr ${NS_A} ${NS_P}/>`;
// PowerPoint 既定のテーブルスタイル GUID（空のスタイル一覧＝既定参照のみ）
const TABLE_STYLES_XML =
  `${XML_DECL}<a:tblStyleLst ${NS_A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

function contentTypesXml(layoutCount: number, logoExt?: string): string {
  const layoutOverrides = Array.from({ length: layoutCount }, (_v, i) =>
    `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml"` +
    ` ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join("");
  const imgDefault = logoExt ? `<Default Extension="${logoExt}" ContentType="${IMG_MIME[logoExt]}"/>` : "";
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    imgDefault +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    layoutOverrides +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>` +
    `<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>` +
    `<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
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

  zip.file("[Content_Types].xml", contentTypesXml(layouts.length, spec.logo?.ext));
  zip.file("_rels/.rels", relationships([
    rel("rId1", "officeDocument", "ppt/presentation.xml"),
    relRaw("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
    rel("rId3", "extended-properties", "docProps/app.xml"),
  ]));
  zip.file("docProps/core.xml", corePropsXml(spec));
  zip.file("docProps/app.xml", APP_PROPS_XML);
  zip.file("ppt/presentation.xml", presentationXml);
  zip.file("ppt/_rels/presentation.xml.rels", relationships([
    rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
    rel("rId2", "theme", "theme/theme1.xml"),
    rel("rId3", "presProps", "presProps.xml"),
    rel("rId4", "viewProps", "viewProps.xml"),
    rel("rId5", "tableStyles", "tableStyles.xml"),
  ]));
  zip.file("ppt/presProps.xml", PRES_PROPS_XML);
  zip.file("ppt/viewProps.xml", VIEW_PROPS_XML);
  zip.file("ppt/tableStyles.xml", TABLE_STYLES_XML);
  zip.file("ppt/theme/theme1.xml", themeXml(spec));
  zip.file("ppt/slideMasters/slideMaster1.xml", masterXml(spec, layouts.length));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", relationships([
    ...layouts.map((_d, i) => rel(`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`)),
    rel(`rId${layouts.length + 1}`, "theme", "../theme/theme1.xml"),
  ]));
  if (spec.logo) zip.file(`ppt/media/logo.${spec.logo.ext}`, spec.logo.bytes);
  layouts.forEach((def, i) => {
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(def, spec));
    const rels = [rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")];
    // rIdLogo (a non-numeric id, so it never collides with the master rId sequence) → the media part.
    if (layoutHasLogo(def, spec)) rels.push(rel("rIdLogo", "image", `../media/logo.${spec.logo!.ext}`));
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, relationships(rels));
  });

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
