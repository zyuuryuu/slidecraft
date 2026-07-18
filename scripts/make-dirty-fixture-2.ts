/**
 * make-dirty-fixture-2.ts — 「実社会の汚れ」第2弾の敵対的テンプレート群を合成する。
 *
 * ポリシー（make-dirty-fixture.ts と同じ・より厳格に）: 出力は **OOXML として valid・
 * PowerPoint で開けば視覚的にキレイ**。汚れは type/idx/属性の使い方（＝ツールが読む慣習）
 * だけに仕込む。壊れたファイル・幾何エラー（w/h=0 等）・視覚破綻は仕込まない。
 *
 * 生成する 3 fixture（それぞれ 1 つの dirt ファミリに絞る）:
 *   Dirty_AllBody   … 全 placeholder が type="body"。見出しも副題も本文も body（型が全部嘘）。
 *                     実機で頻出：デザイナーがタイトル枠を使わず全部テキスト枠で組むパターン。
 *   Dirty_Legacy43  … 4:3（10×7.5）。レイアウト側 xfrm 省略＝master 継承だのみ。typeless ph
 *                     （幾何は自前で健全）と PowerPoint が実際に吐く巨大 idx。ftr/dt/sldNum
 *                     トリオが実機慣習の idx=2/3/4 で常駐（本文 idx 空間と衝突する形）。
 *   Dirty_Grouped   … 表紙見出しがスケール付き p:grpSp の中の生テキスト。PowerPoint は
 *                     グループ変換を合成して正しく描くが、フラットに <p:sp> を読むと子座標を掴む。
 *
 * 出力は合成物（IP 非含有）なので repo にコミット可能。tests/dirty-fixture-wild.test.ts が
 * 「仕込んだ病理が出る・仕込んでいない病理は出ない・loadTemplate が生存する」を固定する。
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

interface Box { x: number; y: number; w: number; h: number; }
const xfrm = (b: Box) => `<a:xfrm><a:off x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:ext cx="${EMU(b.w)}" cy="${EMU(b.h)}"/></a:xfrm>`;

interface TextOpts { bold?: boolean; align?: string; color?: string; }
const runXml = (text: string, fs: number, o: TextOpts) => {
  const col = o.color ? `<a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` : "";
  const rPr = `<a:rPr lang="ja-JP" sz="${fs * 100}"${o.bold ? ` b="1"` : ""}>${col}</a:rPr>`;
  const pPr = o.align ? `<a:pPr algn="${o.align}"/>` : "";
  return `<a:p>${pPr}<a:r>${rPr}<a:t>${escXml(text)}</a:t></a:r></a:p>`;
};

/** placeholder（ph 属性は呼び出し側が自由に指定＝ここに汚れを仕込む）。b 省略で xfrm 無し＝継承。
 *  書式は実テンプレの正攻法どおり ph の <a:lstStyle> に置く — プロンプト文はそれを継承し、
 *  スライドで実際に入力した文字も同じ書式を継承する（＝使っても見た目が崩れない）。 */
function ph(id: number, name: string, phAttrs: string, text: string, fs: number, b?: Box, o: TextOpts = {}): string {
  const col = o.color ? `<a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` : "";
  const lst = `<a:lstStyle><a:lvl1pPr${o.align ? ` algn="${o.align}"` : ""}><a:defRPr sz="${fs * 100}"${o.bold ? ` b="1"` : ""}>${col}</a:defRPr></a:lvl1pPr></a:lstStyle>`;
  const prompt = text ? `<a:p><a:r><a:rPr lang="ja-JP"/><a:t>${escXml(text)}</a:t></a:r></a:p>` : "<a:p><a:endParaRPr/></a:p>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr>${b ? xfrm(b) : ""}</p:spPr>` +
    `<p:txBody><a:bodyPr/>${lst}${prompt}</p:txBody></p:sp>`;
}

/** 生テキストボックス（<p:ph> 無し）。 */
function rawText(id: number, name: string, text: string, b: Box, fs: number, o: TextOpts): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${runXml(text, fs, o)}</p:txBody></p:sp>`;
}

/** 装飾パネル（テキスト無し・塗りのみ）。 */
function deco(id: number, b: Box, hex: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rectangle ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}

/** グループ（off/ext=スライド座標・chOff/chExt=子座標系）。 */
function group(id: number, name: string, o: Box, ch: Box, children: string): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="${EMU(o.x)}" y="${EMU(o.y)}"/><a:ext cx="${EMU(o.w)}" cy="${EMU(o.h)}"/>` +
    `<a:chOff x="${EMU(ch.x)}" y="${EMU(ch.y)}"/><a:chExt cx="${EMU(ch.w)}" cy="${EMU(ch.h)}"/></a:xfrm></p:grpSpPr>` +
    `${children}</p:grpSp>`;
}

const bgXml = (hex: string) => `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
const spTreeHead =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

interface Layout { name: string; bg: string; shapes: string; }
interface FixtureSpec {
  file: string;
  slideW: number; slideH: number;
  masterShapes: string; // master spTree の placeholder/装飾
  titleFont: string; bodyFont: string; eaFont: string;
  textColor: string; bg: string;
  layouts: Layout[];
}

// ══════════════ Fixture 1: Dirty_AllBody（16:9・全部 body 型・見た目は普通のきれいなテンプレ）══════════════
const AB = { ink: "1F2430", sub: "5A6472", accent: "2F6DF6", paper: "FFFFFF", panel: "EEF2FB" };
function allBodySpec(): FixtureSpec {
  const layouts: Layout[] = [
    {
      // 表紙: 大タイトルも副題も日付も body。中央寄せのきれいな表紙に見える。
      name: "タイトル スライド",
      bg: AB.paper,
      shapes:
        deco(2, { x: 0, y: 4.9, w: 13.333, h: 2.6 }, AB.panel) +
        ph(3, "テキスト プレースホルダー 3", `type="body" idx="1"`, "提案書タイトル", 40, { x: 1.2, y: 2.1, w: 10.9, h: 1.2 }, { bold: true, align: "ctr", color: AB.ink }) +
        ph(4, "テキスト プレースホルダー 4", `type="body" idx="2"`, "サブタイトル／部署名", 18, { x: 1.2, y: 3.5, w: 10.9, h: 0.6 }, { align: "ctr", color: AB.sub }) +
        ph(5, "テキスト プレースホルダー 5", `type="body" idx="3"`, "2026年7月", 12, { x: 1.2, y: 5.6, w: 10.9, h: 0.4 }, { align: "ctr", color: AB.sub }),
    },
    {
      // 本文: 見出し(idx=10)・本文(idx=1)とも body。上部見出し＝最大フォント＝幾何的には title。
      name: "タイトルとコンテンツ",
      bg: AB.paper,
      shapes:
        ph(2, "テキスト プレースホルダー 2", `type="body" idx="10"`, "セクション見出し", 24, { x: 0.62, y: 0.35, w: 12.1, h: 0.8 }, { bold: true, color: AB.ink }) +
        ph(3, "コンテンツ プレースホルダー 3", `type="body" idx="1"`, "本文テキスト", 14, { x: 0.62, y: 1.4, w: 12.1, h: 5.5 }, { color: AB.ink }),
    },
    {
      // 2 カラム: 見出しも 2 本文もぜんぶ body。
      name: "2 つのコンテンツ",
      bg: AB.paper,
      shapes:
        ph(2, "テキスト プレースホルダー 2", `type="body" idx="10"`, "比較見出し", 24, { x: 0.62, y: 0.35, w: 12.1, h: 0.8 }, { bold: true, color: AB.ink }) +
        ph(3, "コンテンツ プレースホルダー 3", `type="body" idx="1"`, "左", 14, { x: 0.62, y: 1.4, w: 5.95, h: 5.5 }, { color: AB.ink }) +
        ph(4, "コンテンツ プレースホルダー 4", `type="body" idx="2"`, "右", 14, { x: 6.77, y: 1.4, w: 5.95, h: 5.5 }, { color: AB.ink }),
    },
    {
      // 結び: 中央の一言も body。
      name: "クロージング",
      bg: AB.panel,
      shapes:
        ph(2, "テキスト プレースホルダー 2", `type="body" idx="1"`, "ご清聴ありがとうございました", 32, { x: 1.2, y: 3.0, w: 10.9, h: 1.2 }, { bold: true, align: "ctr", color: AB.ink }),
    },
  ];
  // master も body 1 枠のみ（タイトル枠を一度も使っていないテンプレ、という体）。
  const masterShapes = ph(2, "テキスト プレースホルダー 2", `type="body" idx="1"`, "", 14, { x: 0.62, y: 1.4, w: 12.1, h: 5.5 });
  return {
    file: "Dirty_AllBody_TemplateOnly.pptx", slideW: 13.333, slideH: 7.5,
    masterShapes, titleFont: "Yu Gothic", bodyFont: "Yu Gothic", eaFont: "Yu Gothic",
    textColor: AB.ink, bg: AB.paper, layouts,
  };
}

// ══════════════ Fixture 2: Dirty_Legacy43（4:3・継承だのみ・typeless/巨大 idx・ftr/dt/sldNum）══════════════
const LG = { navy: "1B3A66", ink: "222222", sub: "5A6472", paper: "FFFFFF", band: "E9EEF6" };
function legacy43Spec(): FixtureSpec {
  // 実機の既定マスターと同じく ftr/dt/sldNum が idx=2/3/4（本文 idx 空間と衝突する実機慣習）。
  const chromeTrio = (base: number) =>
    ph(base, "日付プレースホルダー", `type="dt" sz="half" idx="2"`, "", 10, { x: 0.5, y: 7.02, w: 2.3, h: 0.35 }, { color: LG.sub }) +
    ph(base + 1, "フッター プレースホルダー", `type="ftr" sz="quarter" idx="3"`, "", 10, { x: 3.1, y: 7.02, w: 3.8, h: 0.35 }, { align: "ctr", color: LG.sub }) +
    ph(base + 2, "スライド番号プレースホルダー", `type="sldNum" sz="quarter" idx="4"`, "", 10, { x: 8.7, y: 7.02, w: 0.8, h: 0.35 }, { align: "r", color: LG.sub });
  const layouts: Layout[] = [
    {
      // 表紙: ctrTitle は xfrm 省略（master title 幾何を継承）。副題は PowerPoint が実際に吐く
      // 巨大 idx の typeless placeholder（幾何は自前で健全）。
      name: "タイトル スライド",
      bg: LG.paper,
      shapes:
        deco(2, { x: 0, y: 4.6, w: 10, h: 0.12 }, LG.navy) +
        ph(3, "タイトル 3", `type="ctrTitle"`, "報告書タイトル", 36, undefined, { bold: true, color: LG.navy }) +
        ph(4, "テキスト プレースホルダー 4", `idx="4294967294"`, "副題テキスト", 18, { x: 0.9, y: 3.3, w: 8.2, h: 0.7 }, { color: LG.sub }) +
        chromeTrio(5),
    },
    {
      // 本文: title も body も xfrm 省略＝完全に master 継承だのみ（実機で頻出の作り）。
      name: "タイトルとコンテンツ",
      bg: LG.paper,
      shapes:
        ph(2, "タイトル 2", `type="title"`, "見出し", 28, undefined, { bold: true, color: LG.navy }) +
        ph(3, "コンテンツ プレースホルダー 3", `type="body" idx="1"`, "本文", 14) +
        chromeTrio(4),
    },
    {
      // 図表: 図の置き場が typeless idx=13（幾何は自前で健全・valid）。
      name: "図表",
      bg: LG.paper,
      shapes:
        ph(2, "タイトル 2", `type="title"`, "図表見出し", 28, undefined, { bold: true, color: LG.navy }) +
        ph(3, "図プレースホルダー 3", `idx="13"`, "", 20, { x: 0.55, y: 1.6, w: 8.9, h: 5.1 }) +
        chromeTrio(4),
    },
  ];
  const masterShapes =
    ph(2, "タイトル プレースホルダー 2", `type="title"`, "", 28, { x: 0.55, y: 0.4, w: 8.9, h: 1.0 }) +
    ph(3, "テキスト プレースホルダー 3", `type="body" idx="1"`, "", 14, { x: 0.55, y: 1.6, w: 8.9, h: 5.1 }) +
    chromeTrio(4);
  return {
    file: "Dirty_Legacy43_TemplateOnly.pptx", slideW: 10, slideH: 7.5,
    masterShapes, titleFont: "Meiryo", bodyFont: "Meiryo", eaFont: "Meiryo",
    textColor: LG.ink, bg: LG.paper, layouts,
  };
}

// ══════════════ Fixture 3: Dirty_Grouped（16:9・スケール付きグループ内のタイトル生テキスト）══════════════
const GR = { ink: "20242C", gold: "B98A2F", paper: "FFFFFF", panel: "F4F1E9" };
function groupedSpec(): FixtureSpec {
  const layouts: Layout[] = [
    {
      // 表紙: 見出しはスケール×2 のグループ内の生テキスト（子座標 w=3/y=0.25 → 実表示 w=6/y=1.5）。
      // PowerPoint は正しく描く。フラットに <p:sp> を読むツールだけが子座標を掴む。
      name: "表紙",
      bg: GR.paper,
      shapes:
        deco(2, { x: 0, y: 0, w: 13.333, h: 0.9 }, GR.panel) +
        group(3, "タイトル グループ 3", { x: 2, y: 1.25, w: 8, h: 2 }, { x: 0, y: 0, w: 4, h: 1 },
          deco(4, { x: 0.5, y: 0.05, w: 0.18, h: 0.18 }, GR.gold) +
          rawText(5, "TextBox 5", "年次報告 2026", { x: 0.5, y: 0.25, w: 3, h: 0.5 }, 40, { bold: true, color: GR.ink })) +
        rawText(6, "TextBox 6", "経営企画部", { x: 2, y: 3.6, w: 8, h: 0.5 }, 16, { align: "ctr", color: GR.gold }),
    },
    {
      // 本文: placeholder は健全。右下にネストしたグループ（ブランドマーク）＝ネスト生存の試験。
      name: "本文",
      bg: GR.paper,
      shapes:
        ph(2, "タイトル 2", `type="title"`, "見出し", 26, { x: 0.62, y: 0.3, w: 12.1, h: 0.8 }, { bold: true, color: GR.ink }) +
        ph(3, "コンテンツ 3", `type="body" idx="1"`, "本文", 14, { x: 0.62, y: 1.35, w: 12.1, h: 5.3 }, { color: GR.ink }) +
        group(4, "ブランド グループ 4", { x: 10.6, y: 6.85, w: 2.5, h: 0.45 }, { x: 0, y: 0, w: 2.5, h: 0.45 },
          group(5, "内側 グループ 5", { x: 0, y: 0, w: 2.5, h: 0.45 }, { x: 0, y: 0, w: 2.5, h: 0.45 },
            deco(6, { x: 0, y: 0.12, w: 0.2, h: 0.2 }, GR.gold) +
            rawText(7, "TextBox 7", "ANNUAL REPORT", { x: 0.3, y: 0, w: 2.2, h: 0.45 }, 9, { color: GR.ink }))),
    },
  ];
  const masterShapes =
    ph(2, "タイトル プレースホルダー 2", `type="title"`, "", 26, { x: 0.62, y: 0.3, w: 12.1, h: 0.8 }) +
    ph(3, "テキスト プレースホルダー 3", `type="body" idx="1"`, "", 14, { x: 0.62, y: 1.35, w: 12.1, h: 5.3 });
  return {
    file: "Dirty_Grouped_TemplateOnly.pptx", slideW: 13.333, slideH: 7.5,
    masterShapes, titleFont: "Yu Mincho", bodyFont: "Yu Gothic", eaFont: "Yu Gothic",
    textColor: GR.ink, bg: GR.paper, layouts,
  };
}

// ══════════════ 共通の梱包（make-dirty-fixture.ts と同じ部品構成）══════════════
function masterXml(s: FixtureSpec): string {
  const ids = s.layouts.map((_l, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("");
  const titleStyle = `<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800" b="1"><a:solidFill><a:srgbClr val="${s.textColor}"/></a:solidFill><a:latin typeface="${s.titleFont}"/><a:ea typeface="${s.eaFont}"/></a:defRPr></a:lvl1pPr></p:titleStyle>`;
  const bodyStyle = `<p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="${s.textColor}"/></a:solidFill><a:latin typeface="${s.bodyFont}"/><a:ea typeface="${s.eaFont}"/></a:defRPr></a:lvl1pPr></p:bodyStyle>`;
  return `${XML_DECL}<p:sldMaster ${NS_A} ${NS_P} ${NS_R}>` +
    `<p:cSld>${bgXml(s.bg)}<p:spTree>${spTreeHead}${s.masterShapes}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst>${ids}</p:sldLayoutIdLst>` +
    `<p:txStyles>${titleStyle}${bodyStyle}<p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function themeXml(s: FixtureSpec, name: string): string {
  const solid = (h: string) => `<a:srgbClr val="${h}"/>`;
  const fill3 = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`.repeat(3);
  const ln = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  return `${XML_DECL}<a:theme ${NS_A} name="${escXml(name)}"><a:themeElements>` +
    `<a:clrScheme name="${escXml(name)}">` +
    `<a:dk1>${solid(s.textColor)}</a:dk1><a:lt1>${solid(s.bg)}</a:lt1>` +
    `<a:dk2>${solid(s.textColor)}</a:dk2><a:lt2>${solid(s.bg)}</a:lt2>` +
    `<a:accent1>${solid("2F6DF6")}</a:accent1><a:accent2>${solid("B98A2F")}</a:accent2>` +
    `<a:accent3>${solid("1B3A66")}</a:accent3><a:accent4>${solid("5A6472")}</a:accent4>` +
    `<a:accent5>${solid("EEF2FB")}</a:accent5><a:accent6>${solid("F4F1E9")}</a:accent6>` +
    `<a:hlink>${solid("2F6DF6")}</a:hlink><a:folHlink>${solid("5A6472")}</a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="${escXml(name)}">` +
    `<a:majorFont><a:latin typeface="${s.titleFont}"/><a:ea typeface="${s.eaFont}"/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${s.bodyFont}"/><a:ea typeface="${s.eaFont}"/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="Office"><a:fillStyleLst>${fill3}</a:fillStyleLst><a:lnStyleLst>${ln.repeat(3)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${`<a:effectStyle><a:effectLst/></a:effectStyle>`.repeat(3)}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

const layoutXml = (l: Layout) =>
  `${XML_DECL}<p:sldLayout ${NS_A} ${NS_P} ${NS_R} preserve="1">` +
  `<p:cSld name="${escXml(l.name)}">${bgXml(l.bg)}<p:spTree>${spTreeHead}${l.shapes}</p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rels = (entries: string[]) => `${XML_DECL}<Relationships ${REL_NS}>${entries.join("")}</Relationships>`;
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${REL_T}/${type}" Target="${target}"/>`;
const relRaw = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;

function contentTypesXml(n: number): string {
  const overrides = Array.from({ length: n }, (_v, i) =>
    `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join("");
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    overrides +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;
}

async function buildFixture(s: FixtureSpec, themeName: string): Promise<void> {
  const zip = new JSZip();
  const n = s.layouts.length;
  zip.file("[Content_Types].xml", contentTypesXml(n));
  zip.file("_rels/.rels", rels([
    rel("rId1", "officeDocument", "ppt/presentation.xml"),
    relRaw("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
    rel("rId3", "extended-properties", "docProps/app.xml"),
  ]));
  zip.file("docProps/core.xml", `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escXml(themeName)}</dc:title><dc:creator>SlideCraft fixture</dc:creator></cp:coreProperties>`);
  zip.file("docProps/app.xml", `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SlideCraft</Application></Properties>`);
  zip.file("ppt/presentation.xml",
    `${XML_DECL}<p:presentation ${NS_A} ${NS_P} ${NS_R}>` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst/>` +
    `<p:sldSz cx="${EMU(s.slideW)}" cy="${EMU(s.slideH)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", rels([
    rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
    rel("rId2", "theme", "theme/theme1.xml"),
  ]));
  zip.file("ppt/theme/theme1.xml", themeXml(s, themeName));
  zip.file("ppt/slideMasters/slideMaster1.xml", masterXml(s));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([
    ...s.layouts.map((_d, i) => rel(`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`)),
    rel(`rId${n + 1}`, "theme", "../theme/theme1.xml"),
  ]));
  s.layouts.forEach((l, i) => {
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(l));
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]));
  });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const out = resolve(process.cwd(), "tests/fixtures/templates", s.file);
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes, ${n} layouts)`);
}

async function main() {
  await buildFixture(allBodySpec(), "Dirty AllBody");
  await buildFixture(legacy43Spec(), "Dirty Legacy 4x3");
  await buildFixture(groupedSpec(), "Dirty Grouped");
}

main();
