/**
 * style-meta.ts — スタイルの密度（StylePreset.density）をテンプレの「メタ」として運ぶ（#596・純粋ロジック R2）。
 *
 * 置き場は OOXML 標準の「ユーザー設定のプロパティ」（docProps/custom.xml）。PowerPoint はファイル → 情報 →
 * プロパティで表示し、保存し直しても保つ。書くのは writePresetTemplate（目標帯を持つプリセットだけ）、読むのは
 * loadTemplate（TemplateData.styleDensity）。get_deck_issues の密度診断（density-hint.ts）はこの値だけを読む
 * ＝規則の出どころは「テンプレのメタ」の 1 経路で、デッキ側に第 2 の軸を作らない（R8）。
 *
 * 既存テンプレには custom.xml が無い（あっても本プロパティが無い）ので styleDensity は undefined ＝診断は出ない。
 * テンプレの zip はそのまま書き出しの土台になる（placeholder-filler）ので、出力デッキにも同じメタが残る。
 */
import JSZip from "jszip";
import { readEntryString } from "./zip-safe";

export interface StyleDensity {
  bodyPt: number; // 本文の基準サイズ（pt）。MASTER_BODY_PT との比で本文系のサイズ全体に掛かる
  marginIn: number; // 左右の余白（inch）。BASE_DENSITY.marginIn からの差で枠を左右に縮める／広げる
  // ── 文字量の目標帯（#596）。あるときだけ get_deck_issues が density-target（info）を出す ──
  maxBodyLines?: number; // 本文枠 1 つあたりの行（段落）の上限。グループの見出し（### 行）は数えない
  maxLineChars?: number; // 1 行（段落）の字数の上限
}

/** custom.xml のプロパティ名（書く側と読む側で共有する 1 か所・R8）。 */
export const STYLE_DENSITY_PROP = "SlideCraft.StyleDensity";

/** 目標帯を持つ密度か（持たないなら診断もメタも不要）。 */
export const hasDensityTargets = (d: StyleDensity | undefined): d is StyleDensity =>
  !!d && (d.maxBodyLines !== undefined || d.maxLineChars !== undefined);

const CUSTOM_PART = "docProps/custom.xml";
const CUSTOM_CT = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
const FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"; // ユーザー設定プロパティの既定 fmtid
const MAX_CUSTOM_XML = 64 * 1024;

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const propertyRe = () =>
  new RegExp(`<property\\b[^>]*\\bname="${STYLE_DENSITY_PROP.replace(/\./g, "\\.")}"[^>]*>\\s*<vt:lpwstr>([\\s\\S]*?)</vt:lpwstr>\\s*</property>`);

function customXml(density: StyleDensity): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"` +
    ` xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<property fmtid="${FMTID}" pid="2" name="${STYLE_DENSITY_PROP}"><vt:lpwstr>${escXml(JSON.stringify(density))}</vt:lpwstr></property>` +
    `</Properties>`;
}

/**
 * テンプレ bytes に密度のメタを書いた派生を返す（元の bytes は変えない）。custom.xml・[Content_Types] の
 * Override・_rels/.rels の関係を足す（既にあれば作り直さない＝冪等）。追加・更新したパートのエントリ日時は
 * [Content_Types].xml のものに揃え、同じ入力からは同じ bytes が出る（決定論）。
 */
export async function withStyleDensityMeta(bytes: Uint8Array, density: StyleDensity): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const ctFile = zip.file("[Content_Types].xml");
  const relsFile = zip.file("_rels/.rels");
  if (!ctFile || !relsFile) throw new Error("withStyleDensityMeta: [Content_Types].xml または _rels/.rels がありません");
  const date = ctFile.date;
  zip.file(CUSTOM_PART, customXml(density), { date, createFolders: false });
  let ct = await ctFile.async("string");
  if (!ct.includes(`PartName="/${CUSTOM_PART}"`)) {
    ct = ct.replace("</Types>", `<Override PartName="/${CUSTOM_PART}" ContentType="${CUSTOM_CT}"/></Types>`);
    zip.file("[Content_Types].xml", ct, { date, createFolders: false });
  }
  let rels = await relsFile.async("string");
  if (!rels.includes(`Target="${CUSTOM_PART}"`)) {
    const ids = [...rels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
    const id = `rId${Math.max(0, ...ids) + 1}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${CUSTOM_REL}" Target="${CUSTOM_PART}"/></Relationships>`);
    zip.file("_rels/.rels", rels, { date: relsFile.date, createFolders: false });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const isPos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** テンプレの zip から密度のメタを読む。無い・壊れている・形が違うなら undefined（診断は出ない）。 */
export async function readStyleDensity(zip: JSZip): Promise<StyleDensity | undefined> {
  const xml = await readEntryString(zip, CUSTOM_PART, MAX_CUSTOM_XML).catch(() => "");
  const m = xml && propertyRe().exec(xml);
  if (!m) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(unescXml(m[1]));
  } catch {
    return undefined;
  }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!isPos(o.bodyPt) || typeof o.marginIn !== "number" || !(o.marginIn >= 0)) return undefined;
  const out: StyleDensity = { bodyPt: o.bodyPt, marginIn: o.marginIn };
  if (o.maxBodyLines !== undefined) {
    if (!isPos(o.maxBodyLines) || !Number.isInteger(o.maxBodyLines)) return undefined;
    out.maxBodyLines = o.maxBodyLines;
  }
  if (o.maxLineChars !== undefined) {
    if (!isPos(o.maxLineChars) || !Number.isInteger(o.maxLineChars)) return undefined;
    out.maxLineChars = o.maxLineChars;
  }
  return out;
}
