/**
 * notes-ooxml.ts — スピーカーノートの OOXML パート生成（#150 / ADR-0032 D1）。
 *
 * PPTX 主経路（placeholder-filler generatePptx）は自前 OOXML 組み立てなので、notesSlide /
 * notesMaster もここで文字列として生成する。呼び出し規約（ADR-0032 の構造担保）:
 * notes が空のスライドにはどのパートも生成しない — 「作らない」ことがノート無しデッキの
 * 出力不変の担保になる。Pure logic（R2）。
 */

import type { Paragraph } from "./slide-schema";
import { paragraphsToOoxml } from "./md-to-ooxml";

const NS =
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
  ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
  ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

const REL_NS = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`;
const REL_T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const NOTES_SLIDE_CT =
  "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
export const NOTES_MASTER_CT =
  "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml";

/** notesSlideN.xml — ノート本文（body placeholder idx=1）のみの最小 notes パート。 */
export function notesSlideXml(notes: Paragraph[]): string {
  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<p:notes ${NS}>` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphsToOoxml(notes)}</p:txBody>` +
    `</p:sp>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:notes>`
  );
}

/** notesSlideN.xml.rels — notesMaster と親スライドの両方を参照（PowerPoint 実出力と同型）。 */
export function notesSlideRels(slideNum: number, notesMasterNum: number): string {
  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<Relationships ${REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_T}/notesMaster"` +
    ` Target="../notesMasters/notesMaster${notesMasterNum}.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_T}/slide"` +
    ` Target="../slides/slide${slideNum}.xml"/>` +
    `</Relationships>`
  );
}

/** notesMaster1.xml — ノートページの最小マスター（body placeholder＋notesStyle）。
 *  ノートページサイズは presentation.xml の <p:notesSz> が既定を供給するため spPr の
 *  座標はノート本文の標準配置（上余白＋中央帯）に固定でよい。 */
export function notesMasterXml(): string {
  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<p:notesMaster ${NS}>` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="6858000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>` +
    `</p:sp>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"` +
    ` accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink"` +
    ` folHlink="folHlink"/>` +
    `<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle>` +
    `</p:notesMaster>`
  );
}

/** notesMaster1.xml.rels — テーマ参照のみ（`themeTarget` 例: "../theme/theme2.xml"）。 */
export function notesMasterRels(themeTarget: string): string {
  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>` +
    `<Relationships ${REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_T}/theme" Target="${themeTarget}"/>` +
    `</Relationships>`
  );
}
