/**
 * template-adjust.ts — #570 段 2「テンプレ調整」: テンプレの**派生コピー**に決定論の変換を掛ける純粋関数
 * `adjustTemplate(bytes, recipe) → bytes`。元テンプレは書き換えない（呼び出し側は戻り値を別の master として
 * 登録する）。変換は固定順で 2 段: (1) 書体置換 → (2) サイズ倍率。#568 のレイアウト合成はこの後に掛かる
 * 前提で、合成レイアウトの lstStyle も「全 defRPr@sz」に含まれるので、同じ変換が自然に効く。
 *
 * (1) 書体置換 — 旧名 → 新名の写像（名前で引く。theme と違う名前＝Consolas のコード枠などは写像に無いので不変）:
 *   - scope "theme": theme fontScheme の major/minor の `<a:latin>`（latin 写像）・`<a:ea>` と
 *     `<a:font script="Jpan">`（ea 写像）。latin/ea は faithful Re-make の rewriteThemeFonts を流用する。
 *   - scope "theme+inline"（既定）: 上に加えて、master／レイアウト XML に直書きされた `<a:latin>` /
 *     `<a:ea>` の実名（日本語テンプレは lstStyle に実名を書き、theme だけでは placeholder の 34〜50% に届か
 *     ない — #570 段 1 の実測）。テーマ参照トークン（`+mj-lt` 等）と `<a:cs>` は触らない。
 * (2) サイズ倍率 — タイトル／本文／その他の 3 系統。対象は master の `<p:txStyles>`（titleStyle→タイトル、
 *   bodyStyle→本文、otherStyle→その他）と、master／レイアウトの**全** `<a:defRPr sz>`（`defPPr` と
 *   `lvlNpPr` の両方）。図形の系統は loader の placeholderRole（レイアウト）／ph type（master）で決め、
 *   placeholder でない図形はその他。0.5pt 単位に丸め、[1pt, 400pt] に収める（1pt の区切り線枠は 1pt のまま）。
 *   本文倍率の上限 `scale.bodyMaxPt`（任意・既定なし＝全枠）: 指定すると本文系の枠のうち、倍率前の最大 sz
 *   （＝lvl1。入れ子段は lvl1 から導いた小さい値）がその値以下の枠だけに掛け、大数字などの表示用サイズの
 *   枠は据え置く（PR #635 裁定 B）。判定は枠（txStyles のブロック／`<p:sp>`）単位で、段ごとには判定しない
 *   （22pt の枠の lvl2 だけが拡大されて親子が逆転するのを防ぐ）。
 *   レシピに bodyMaxPt が無くても、テンプレがプリセット由来（メタ styleDensity を持つ）なら、プリセットが
 *   倍率を掛けた枠だけに掛ける（#670・bodyMaxPtFor が 1 か所で決める。adjust_template・GUI・
 *   get_deck_issues の倍率提案はすべて adjustTemplate を通るので、提案と適用の範囲が一致する＝R8）。
 *   run に直書きされた sz（静的ラベルの `<a:rPr sz>`）は対象外。容量見積りはマスターの sz を読む 1 経路の
 *   ままで、デッキ側に倍率を持たない（R8）。
 *
 * レシピが実質無変化（置換・倍率なし、または対象の名前がテンプレに無い）なら入力と byte-identical を返す。
 * 書き換えた part も元のエントリ日時を保つので、同じ入力＋レシピからは同じ bytes が出る（決定論）。
 *
 * Pure engine logic (R2): JSZip + string surgery only, no DOM / Tauri.
 */
import type JSZip from "jszip";
import { loadTemplate, type TemplateData } from "./template-loader";
import { MASTER_BODY_PT } from "./template-writer";
import type { StyleDensity } from "./style-meta";
import { placeholderRole } from "./template-catalog";
import { rewriteThemeFonts } from "./faithful-remake";
import { loadZipSafe, readEntryString, ZIP_LIMITS } from "./zip-safe";

export interface FontMapEntry {
  from: string;
  to: string;
}
export type FontScope = "theme" | "theme+inline";
export type SizeClass = "title" | "body" | "other";

export interface TemplateAdjustRecipe {
  fonts?: { latin?: FontMapEntry[]; ea?: FontMapEntry[]; scope?: FontScope };
  /** Per-class factor (1 = unchanged). Omitted class = 1. `bodyMaxPt`: the body factor only applies to
   *  body frames whose largest pre-scale size is ≤ this (pt); larger display frames keep their size.
   *  Omitted = every body frame (the #570 behaviour). */
  scale?: Partial<Record<SizeClass, number>> & { bodyMaxPt?: number };
}

/** Normalised size step: per-class factors plus the optional body cap (hundredths of a point). */
export interface SizeStep {
  f: Record<SizeClass, number>;
  bodyMaxSz?: number;
}

const THEME_PART = "ppt/theme/theme1.xml";
const MASTER_RE = /^ppt\/slideMasters\/slideMaster\d+\.xml$/;
const LAYOUT_RE = /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/;
export const MIN_SZ = 100; // 1pt (hundredths of a point, as OOXML stores it)
export const MAX_SZ = 40000; // 400pt

const unescXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Scale one OOXML size (hundredths of a point) by `factor`: round to 0.5pt, clamp to [1pt, 400pt]. */
export function scaleSz(sz: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError(`scale factor must be a positive number: ${factor}`);
  const halfPts = Math.round(((sz / 100) * factor) * 2);
  return Math.min(MAX_SZ, Math.max(MIN_SZ, halfPts * 50));
}

/** name → name lookup; identity / empty entries dropped. First entry for a name wins (deterministic). */
function fontMap(entries: FontMapEntry[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const { from, to } of entries ?? []) if (from && to && from !== to && !m.has(from)) m.set(from, to);
  return m;
}

/** Validated per-class factors: undefined when every class is 1 (no size change at all). The body cap is
 *  decided later by bodyMaxPtFor (it may depend on the template's meta). */
function sizeStep(scale: TemplateAdjustRecipe["scale"]): SizeStep | undefined {
  const f = { title: scale?.title ?? 1, body: scale?.body ?? 1, other: scale?.other ?? 1 };
  for (const v of Object.values(f)) scaleSz(100, v); // validate (throws RangeError)
  const cap = scale?.bodyMaxPt;
  if (cap !== undefined && !(Number.isFinite(cap) && cap > 0)) throw new RangeError(`bodyMaxPt must be a positive number: ${cap}`);
  if (f.title === 1 && f.body === 1 && f.other === 1) return undefined;
  return { f };
}

/**
 * 本文倍率を掛ける枠の上限（pt）＝本文の大きさの帯（基準 14pt の 1.5 倍）。これを超える枠は大数字・
 * ステートメントなど表示用サイズで、幅は基準サイズ前提のため倍率を掛けると溢れる（PR #635 裁定 B）。
 */
export const PRESET_BODY_MAX_PT = MASTER_BODY_PT * 1.5;

/**
 * 本文倍率の適用範囲（上限 pt・undefined＝全枠）を決める唯一の関数（#670・R8）。
 *  - レシピが bodyMaxPt を持てばそれ。
 *  - 無く、テンプレがプリセット由来（メタ styleDensity あり）なら、プリセットが倍率を掛けた枠＝倍率前
 *    PRESET_BODY_MAX_PT 以下だった枠を、今の bytes の大きさで表した上限（PRESET_BODY_MAX_PT を
 *    bodyPt ÷ MASTER_BODY_PT 倍・scaleSz と同じ丸め）。生の 21pt を今の bytes に当てると、プリセットが
 *    21pt を超えて拡大済みの本文枠（Executive の 18→25.5pt 等）まで外れてしまう（#670 の実測）。
 *  - どちらも無ければ undefined（従来どおり全枠・プリセット由来でないテンプレは不変）。
 */
export function bodyMaxPtFor(scale: TemplateAdjustRecipe["scale"], density: StyleDensity | undefined): number | undefined {
  if (scale?.bodyMaxPt !== undefined) return scale.bodyMaxPt;
  return density ? scaleSz(PRESET_BODY_MAX_PT * 100, density.bodyPt / MASTER_BODY_PT) / 100 : undefined;
}

/** Replace `typeface="X"` in a tag when X is in the map (theme tokens like `+mj-lt` never are). */
function retypeface(tag: string, map: Map<string, string>): string {
  return tag.replace(/(\btypeface=")([^"]*)(")/, (all, a: string, v: string, b: string) => {
    const to = map.get(unescXml(v));
    return to === undefined || v.startsWith("+") ? all : `${a}${escXml(to)}${b}`;
  });
}

/** Theme fontScheme: latin/ea of major/minor via rewriteThemeFonts (faithful Re-make) + script="Jpan". */
export function rewriteThemeFontMap(themeXml: string, latin: Map<string, string>, ea: Map<string, string>): string {
  if (latin.size === 0 && ea.size === 0) return themeXml;
  const block = (tag: string) => themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?</a:${tag}>`))?.[0] ?? "";
  const face = (blk: string, kind: string) => unescXml(blk.match(new RegExp(`<a:${kind}\\b[^>]*\\btypeface="([^"]*)"`))?.[1] ?? "");
  const pick = (m: Map<string, string>, v: string) => (v ? (m.get(v) ?? v) : v);
  const major = block("majorFont");
  const minor = block("minorFont");
  let out = rewriteThemeFonts(themeXml, {
    majorLatin: pick(latin, face(major, "latin")),
    minorLatin: pick(latin, face(minor, "latin")),
    majorEa: pick(ea, face(major, "ea")),
    minorEa: pick(ea, face(minor, "ea")),
  });
  if (ea.size > 0) {
    const jpan = (blk: string) => blk.replace(/<a:font\b[^>]*\bscript="Jpan"[^>]*>/g, (tag) => retypeface(tag, ea));
    out = out
      .replace(/<a:majorFont>[\s\S]*?<\/a:majorFont>/, jpan)
      .replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, jpan);
  }
  return out;
}

/** master／レイアウト XML に直書きされた `<a:latin>` / `<a:ea>` の実名を写像で置換（`<a:cs>` 等は対象外）。 */
export function rewriteInlineFonts(xml: string, latin: Map<string, string>, ea: Map<string, string>): string {
  if (latin.size === 0 && ea.size === 0) return xml;
  return xml.replace(/<(?:\w+:)?(latin|ea)\s[^>]*>/g, (tag, kind: string) => retypeface(tag, kind === "latin" ? latin : ea));
}

/** The `<p:ph>` of a shape block: its type ("" when typeless) and idx ("0" when absent, as the loader). */
function phOf(sp: string): { type: string; idx: string } | null {
  const ph = sp.match(/<(?:\w+:)?ph\b([^>]*?)\/?>/);
  if (!ph) return null;
  return { type: ph[1].match(/\btype="(\w+)"/)?.[1] ?? "", idx: ph[1].match(/\bidx="(\d+)"/)?.[1] ?? "0" };
}

/** Class of a placeholder from its type alone (master placeholders, and a layout fallback). */
function typeClass(type: string): SizeClass {
  if (type === "title" || type === "ctrTitle") return "title";
  if (type === "body" || type === "obj" || type === "") return "body";
  return "other";
}

const STYLE_CLASS: Record<string, SizeClass> = { titleStyle: "title", bodyStyle: "body", otherStyle: "other" };

const DEF_RPR_SZ = /(<(?:\w+:)?defRPr\b[^>]*?\bsz=")(\d+)(")/g;

/** Largest `<a:defRPr sz>` of a frame (its lvl1; nested levels are derived smaller). 0 when none. */
const frameMaxSz = (frag: string) => Math.max(0, ...[...frag.matchAll(DEF_RPR_SZ)].map((m) => Number(m[2])));

/**
 * Scale every `<a:defRPr sz>` of one master/layout part. ONE pass over the part with an alternation, so a
 * size is scaled exactly once: a txStyles block → its class, a `<p:sp>` → `classOf(ph)` (null ph = a
 * non-placeholder shape → other), and any stray defRPr outside both (e.g. a table frame) → other.
 * With `bodyMaxSz`, a body block/frame whose largest size exceeds it is left as is (decided per frame).
 */
export function scaleStylePart(
  xml: string,
  step: SizeStep,
  classOf: (ph: { type: string; idx: string }) => SizeClass,
): string {
  const { f, bodyMaxSz } = step;
  // A class at ×1 is passed through untouched (no re-rounding of e.g. 10.25pt, no clamping).
  const scaleIn = (frag: string, c: SizeClass) =>
    f[c] === 1 || (c === "body" && bodyMaxSz !== undefined && frameMaxSz(frag) > bodyMaxSz)
      ? frag
      : frag.replace(DEF_RPR_SZ, (_m, a: string, v: string, b: string) => `${a}${scaleSz(Number(v), f[c])}${b}`);
  const RE = /<(\w+:)(titleStyle|bodyStyle|otherStyle)\b[^>]*>[\s\S]*?<\/\1\2>|<(\w+:)sp(?:\s[^>]*)?>[\s\S]*?<\/\3sp>|<(?:\w+:)?defRPr\b[^>]*>/g;
  return xml.replace(RE, (m: string, _p1: string | undefined, style: string | undefined) => {
    if (style) return scaleIn(m, STYLE_CLASS[style]);
    if (/^<(?:\w+:)?defRPr\b/.test(m)) return scaleIn(m, "other");
    const ph = phOf(m);
    return scaleIn(m, ph ? classOf(ph) : "other");
  });
}

/** Per layout file number: placeholder (type|idx) → class, from the loader's placeholderRole. */
function layoutClasses(tpl: TemplateData): Map<number, Map<string, SizeClass>> {
  const out = new Map<number, Map<string, SizeClass>>();
  for (const l of tpl.layouts) {
    const m = new Map<string, SizeClass>();
    for (const p of l.placeholders) {
      const role = placeholderRole(p);
      m.set(`${p.type}|${p.idx}`, role === "title" ? "title" : role === "body" ? "body" : "other");
    }
    out.set(l.index, m);
  }
  return out;
}

// ── GUI helpers: from "heading font / body font / scope / 3 factors" to a recipe ──

/** The current names of one theme font slot (major = heading, minor = body). "" when absent. */
export interface ThemeFontSlot {
  latin: string;
  ea: string;
  jpan: string; // <a:font script="Jpan"> — the visible Japanese font (the <a:ea> slot is often empty)
}
export interface ThemeFontSlots {
  major: ThemeFontSlot;
  minor: ThemeFontSlot;
}

export function themeFontSlots(themeXml: string): ThemeFontSlots {
  const slot = (tag: string): ThemeFontSlot => {
    const blk = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?</a:${tag}>`))?.[0] ?? "";
    const face = (re: RegExp) => unescXml(blk.match(re)?.[1] ?? "");
    return {
      latin: face(/<a:latin\b[^>]*\btypeface="([^"]*)"/),
      ea: face(/<a:ea\b[^>]*\btypeface="([^"]*)"/),
      jpan: face(/<a:font\b(?=[^>]*\bscript="Jpan")[^>]*\btypeface="([^"]*)"/),
    };
  };
  return { major: slot("majorFont"), minor: slot("minorFont") };
}

/** themeFontSlots of a template's bytes (empty slots when the part is missing). */
export async function readThemeFontSlots(bytes: ArrayBuffer | Uint8Array): Promise<ThemeFontSlots> {
  const zip = await loadZipSafe(bytes, { maxInputBytes: ZIP_LIMITS.templatePptx });
  return themeFontSlots(zip.file(THEME_PART) ? await readEntryString(zip, THEME_PART, ZIP_LIMITS.xmlEntry) : "");
}

const slotNames = (s: ThemeFontSlot) => [...new Set([s.latin, s.ea, s.jpan].filter((n) => n && !n.startsWith("+")))];

/** Heading and body share a name → a name→name map cannot tell them apart; the GUI offers ONE choice. */
export function fontsLinked(slots: ThemeFontSlots): boolean {
  const major = new Set(slotNames(slots.major));
  return slotNames(slots.minor).some((n) => major.has(n));
}

export interface AdjustChoice {
  heading: string; // new heading font ("" = unchanged)
  body: string; // new body font ("" = unchanged; ignored when the slots are linked)
  scope: FontScope;
  scale: Record<SizeClass, number>;
}

/** Build a recipe: each chosen font replaces EVERY name of its slot (latin / ea / Jpan aliases), in both
 *  maps, so an inline `<a:ea typeface="MS PGothic">` follows a theme `ＭＳ Ｐゴシック` / `MS PGothic` pair. */
export function recipeFor(slots: ThemeFontSlots, c: AdjustChoice): TemplateAdjustRecipe {
  const entries: FontMapEntry[] = [];
  const add = (names: string[], to: string) => {
    if (to) for (const from of names) if (from !== to) entries.push({ from, to });
  };
  if (fontsLinked(slots)) add([...new Set([...slotNames(slots.major), ...slotNames(slots.minor)])], c.heading || c.body);
  else {
    add(slotNames(slots.major), c.heading);
    add(slotNames(slots.minor), c.body);
  }
  return {
    ...(entries.length ? { fonts: { latin: entries, ea: entries.map((e) => ({ ...e })), scope: c.scope } } : {}),
    scale: { ...c.scale },
  };
}

/** True when the recipe cannot change anything (no effective font entry, every factor 1). */
export function isNoopRecipe(r: TemplateAdjustRecipe): boolean {
  return fontMap(r.fonts?.latin).size === 0 && fontMap(r.fonts?.ea).size === 0 && !sizeStep(r.scale);
}

/** Write `xml` back only when it changed, keeping the entry's original date (deterministic bytes). */
function put(zip: JSZip, path: string, before: string, after: string): boolean {
  if (after === before) return false;
  zip.file(path, after, { date: zip.file(path)!.date, createFolders: false });
  return true;
}

/**
 * Apply `recipe` to a template's bytes and return the DERIVED template's bytes (the input is never
 * modified). Fixed order: font replacement → size scaling. A recipe that changes nothing returns bytes
 * identical to the input.
 */
export async function adjustTemplate(bytes: ArrayBuffer | Uint8Array, recipe: TemplateAdjustRecipe): Promise<Uint8Array> {
  const latin = fontMap(recipe.fonts?.latin);
  const ea = fontMap(recipe.fonts?.ea);
  const inline = (recipe.fonts?.scope ?? "theme+inline") === "theme+inline";
  let f = sizeStep(recipe.scale);
  const copy = () => new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (isNoopRecipe(recipe)) return copy();

  const zip = await loadZipSafe(bytes, { maxInputBytes: ZIP_LIMITS.templatePptx });
  let changed = false;
  if (zip.file(THEME_PART)) {
    const theme = await readEntryString(zip, THEME_PART, ZIP_LIMITS.xmlEntry);
    changed = put(zip, THEME_PART, theme, rewriteThemeFontMap(theme, latin, ea)) || changed;
  }
  let classes: Map<number, Map<string, SizeClass>> | undefined;
  if (f) {
    const tpl = await loadTemplate(bytes);
    classes = layoutClasses(tpl);
    const cap = bodyMaxPtFor(recipe.scale, tpl.styleDensity);
    if (cap !== undefined) f = { ...f, bodyMaxSz: Math.round(cap * 100) };
  }
  const parts = Object.keys(zip.files).filter((p) => MASTER_RE.test(p) || LAYOUT_RE.test(p)).sort();
  for (const path of parts) {
    const before = await readEntryString(zip, path, ZIP_LIMITS.xmlEntry);
    let xml = inline ? rewriteInlineFonts(before, latin, ea) : before;
    if (f) {
      const layoutNo = path.match(LAYOUT_RE)?.[1];
      const byPh = layoutNo ? classes?.get(Number(layoutNo)) : undefined;
      xml = scaleStylePart(xml, f, (ph) => byPh?.get(`${ph.type}|${ph.idx}`) ?? typeClass(ph.type));
    }
    changed = put(zip, path, before, xml) || changed;
  }
  if (!changed) return copy();
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
