/**
 * layout-augment.ts — マスター強化（#568 段 2）の「適用」半分: 計画（layout-augment-plan.ts）どおりに
 * 元レイアウトの XML を複製し、本文枠を N 列に分けた新しい slideLayout を足す。
 *
 * - 純粋変換 bytes → bytes（JSZip ＋ 文字列処理・faithful-remake.ts と同じ形・R2）。#570 のレシピ
 *   （書体置換 → 倍率 → 合成）では最後に掛ける。
 * - 追加のみ: 既存の slideLayout / rels / メディアには触れない。書き換えるのは、元レイアウトが属する
 *   master の sldLayoutIdLst（末尾に追加）と master の rels（追加）と [Content_Types].xml（Override 追加）だけ。
 * - 体裁はマスターとの relation で継承（rels を複製）。列の lstStyle にだけ縮小後の sz を書く。
 * - 検査ゲート（verifyAugmentation）: 合成 bytes を loadTemplate し直し、(a) 既存レイアウトの LayoutInfo と
 *   catalog が同一、(b) 新レイアウトが columns×N、(c) 1:1 全単射。1 つでも落ちたら適用しない。
 */
import { loadZipSafe, readCappedString, ZIP_LIMITS } from "./zip-safe";
import { loadTemplate, type LayoutInfo, type TemplateData } from "./template-loader";
import { buildCatalog } from "./template-catalog";
import { buildFieldMap, resolveBinding } from "./placeholder-binding";
import { columnFontSize, type ShrinkRule } from "./column-font-shrink";
import { columnGutterRatio, planAugmentation, type AugmentAddition, type AugmentOptions, type AugmentPlan } from "./layout-augment-plan";
import { setLevelSizes, stripRunSizes, explicitLevelSize } from "./layout-augment-xml";

const EMU = 914400;
const LAYOUT_CT = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const LAYOUT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

export interface AugmentedLayout extends AugmentAddition {
  part: string; // ppt/slideLayouts/slideLayoutN.xml
  layoutIndex: number;
}

const SP_RE = /<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g;
const phIdxOf = (sp: string) => {
  const ph = sp.match(/<p:ph\b([^>]*?)\/?>/);
  return ph ? (ph[1].match(/\bidx="(\d+)"/)?.[1] ?? "0") : null;
};
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 32bit FNV-1a（p14:creationId を決定論的に付け替える）。 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** 元の本文枠 1 つを N 列に複製する。 */
function splitBody(sp: string, a: AugmentAddition, rule: ShrinkRule, box: { x: number; y: number; cx: number; cy: number }, firstId: number): string {
  const gut = Math.round(box.cx * columnGutterRatio(a.columns));
  const w = Math.floor((box.cx - gut * (a.columns - 1)) / a.columns);
  const xfrm = (c: number) => `<a:xfrm><a:off x="${box.x + c * (w + gut)}" y="${box.y}"/><a:ext cx="${w}" cy="${box.cy}"/></a:xfrm>`;
  return a.idxs
    .map((idx, c) => {
      // id and name rewritten independently inside the one <p:cNvPr> tag (attribute order is free).
      let s = sp.replace(/<p:cNvPr\b[^>]*>/, (tag) =>
        tag.replace(/\bid="\d+"/, `id="${firstId + c}"`).replace(/\bname="([^"]*)"/, (_m, nm: string) => `name="${c === 0 ? nm : `${nm} ${c + 1}`}"`),
      );
      s = s.replace(/<p:ph\b([^>]*?)(\/?)>/, (_m, attrs: string, close: string) => {
        let at = attrs.replace(/\s*\bidx="\d+"/, "");
        if (Number(idx) >= 10) at = at.replace(/\s*\btype="[^"]*"/, "") + ' type="body"';
        return `<p:ph${at} idx="${idx}"${close}>`;
      });
      // Geometry: replace the own xfrm, or give an inheriting <p:spPr/> an explicit one.
      if (/<p:spPr\b[^>]*>(?:(?!<\/p:spPr>)[\s\S])*?<a:xfrm\b/.test(s)) s = s.replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/, xfrm(c));
      else if (/<p:spPr\s*\/>/.test(s)) s = s.replace(/<p:spPr\s*\/>/, `<p:spPr>${xfrm(c)}</p:spPr>`);
      else s = s.replace(/(<p:spPr\b[^>]*>)/, `$1${xfrm(c)}`);
      const sizes = new Map(a.levelSizes.map((pt, i) => [i + 1, pt] as const));
      for (let k = 5; k <= 9; k++) {
        const own = explicitLevelSize(s, k);
        if (own !== undefined) sizes.set(k, columnFontSize(own, a.columns, rule, k));
      }
      return setLevelSizes(stripRunSizes(s), sizes);
    })
    .join("");
}

/** 計画どおりに合成した bytes と、足したレイアウト。計画が空なら入力 bytes をそのまま返す。 */
export async function augmentTemplate(source: ArrayBuffer | Uint8Array, plan: AugmentPlan): Promise<{ bytes: Uint8Array; added: AugmentedLayout[] }> {
  const input = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (!plan.base || plan.add.length === 0) return { bytes: input, added: [] };
  const base = plan.base;
  const zip = await loadZipSafe(input, { maxInputBytes: ZIP_LIMITS.templatePptx });
  const basePath = `ppt/slideLayouts/slideLayout${base.layoutIndex}.xml`;
  const baseFile = zip.file(basePath);
  if (!baseFile) throw new Error(`base layout part missing: ${basePath}`);
  const baseXml = await readCappedString(baseFile, ZIP_LIMITS.xmlEntry);
  if (!/<p:sldLayout\b/.test(baseXml)) throw new Error("元レイアウトの XML が標準の名前空間接頭辞（p:）ではないため合成できません。");
  const relsPath = `ppt/slideLayouts/_rels/slideLayout${base.layoutIndex}.xml.rels`;
  const rels = await readCappedString(zip.file(relsPath)!, ZIP_LIMITS.xmlEntry);
  const masterTarget = rels.match(/Target="\.\.\/slideMasters\/(slideMaster\d+\.xml)"/)?.[1];
  if (!masterTarget) throw new Error("元レイアウトの属する master が見つかりません。");
  const masterPath = `ppt/slideMasters/${masterTarget}`;
  const masterRelsPath = `ppt/slideMasters/_rels/${masterTarget}.rels`;
  let master = await readCappedString(zip.file(masterPath)!, ZIP_LIMITS.xmlEntry);
  let masterRels = await readCappedString(zip.file(masterRelsPath)!, ZIP_LIMITS.xmlEntry);
  let ct = await readCappedString(zip.file("[Content_Types].xml")!, ZIP_LIMITS.xmlEntry);
  if (!/<p:sldLayoutIdLst>/.test(master)) throw new Error("master に sldLayoutIdLst がありません。");

  const bodySp = [...baseXml.matchAll(SP_RE)].map((m) => m[0]).find((sp) => phIdxOf(sp) === base.bodyIdx);
  if (!bodySp) throw new Error(`元レイアウトに本文枠 idx=${base.bodyIdx} が見つかりません。`);
  const own = bodySp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/);
  const box = own
    ? { x: +own[1], y: +own[2], cx: +own[3], cy: +own[4] }
    : { x: Math.round(base.box.x * EMU), y: Math.round(base.box.y * EMU), cx: Math.round(base.box.w * EMU), cy: Math.round(base.box.h * EMU) };
  const firstId = Math.max(0, ...[...baseXml.matchAll(/<p:cNvPr\b[^>]*?\bid="(\d+)"/g)].map((m) => +m[1])) + 1;

  // Numbering for the new parts / ids.
  const files = Object.keys(zip.files);
  let layoutNo = Math.max(...files.map((p) => +(p.match(/^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/)?.[1] ?? 0))) + 1;
  const idSources = await Promise.all(
    files.filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p) || p === "ppt/presentation.xml").map((p) => readCappedString(zip.file(p)!, ZIP_LIMITS.xmlEntry)),
  );
  let nextId = Math.max(2147483648, ...idSources.flatMap((x) => [...x.matchAll(/<p:(?:sldLayoutId|sldMasterId)\b[^>]*?\bid="(\d+)"/g)].map((m) => +m[1]))) + 1;
  let nextRid = Math.max(0, ...[...masterRels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1])) + 1;
  const date = baseFile.date;

  const added: AugmentedLayout[] = [];
  for (const a of plan.add) {
    const part = `ppt/slideLayouts/slideLayout${layoutNo}.xml`;
    const name = escAttr(a.name);
    let xml = baseXml.replace(bodySp, splitBody(bodySp, a, plan.rule, box, firstId));
    xml = xml.replace(/<p:sldLayout\b[^>]*>/, (root) => {
      let r = root.replace(/\s+type="[^"]*"/, "").replace(/^<p:sldLayout\b/, `<p:sldLayout type="${a.columns === 2 ? "twoObj" : "cust"}"`);
      if (/\sname="/.test(r)) r = r.replace(/(\sname=")[^"]*"/, `$1${name}"`); // non-standard attr some generators write (the loader reads the first name=)
      return r;
    });
    xml = /<p:cSld\b[^>]*\bname="/.test(xml) ? xml.replace(/(<p:cSld\b[^>]*?\bname=")[^"]*"/, `$1${name}"`) : xml.replace(/<p:cSld\b/, `<p:cSld name="${name}"`);
    xml = xml.replace(/(<p14:creationId\b[^>]*?\bval=")\d+"/g, `$1${fnv1a(`${part}|${a.name}`)}"`);
    zip.file(part, xml, { date, createFolders: false });
    zip.file(`ppt/slideLayouts/_rels/slideLayout${layoutNo}.xml.rels`, rels, { date, createFolders: false });
    masterRels = masterRels.replace(/<\/Relationships>\s*$/, `<Relationship Id="rId${nextRid}" Type="${LAYOUT_REL}" Target="../slideLayouts/slideLayout${layoutNo}.xml"/></Relationships>`);
    master = master.replace("</p:sldLayoutIdLst>", `<p:sldLayoutId id="${nextId}" r:id="rId${nextRid}"/></p:sldLayoutIdLst>`);
    ct = ct.replace(/<\/Types>\s*$/, `<Override PartName="/${part}" ContentType="${LAYOUT_CT}"/></Types>`);
    added.push({ ...a, part, layoutIndex: layoutNo });
    layoutNo++; nextId++; nextRid++;
  }
  zip.file(masterPath, master, { date: zip.file(masterPath)!.date, createFolders: false });
  zip.file(masterRelsPath, masterRels, { date: zip.file(masterRelsPath)!.date, createFolders: false });
  zip.file("[Content_Types].xml", ct, { date: zip.file("[Content_Types].xml")!.date, createFolders: false });
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), added };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const txt = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) => c?.paragraphs[0]?.segments[0]?.text ?? "";

/** field-map-bijection.test.ts と同じ 3 検査（単射・全部埋めて往復・1 枠だけ埋めて漏れなし）。失敗理由の配列。 */
function bijectionFailures(l: LayoutInfo): string[] {
  const out: string[] = [];
  const hasCtr = l.placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle"));
  const para = (t: string) => [{ segments: [{ text: t }] }];
  const map = buildFieldMap({ layout: l.name, placeholders: hasCtr ? [{ idx: "0", paragraphs: para("T") }] : [] }, l.placeholders);
  const bind = (placeholders: { idx: string; paragraphs: ReturnType<typeof para> }[]) =>
    new Map(resolveBinding({ layout: l.name, placeholders }, l.placeholders).assignments.map((x) => [x.placeholder.idx, x.content.content] as const));
  if (new Set(map.map((m) => m.contentIdx)).size !== map.length) out.push(`${l.name}: 入力欄の content idx が重複`);
  const full = bind(map.map((m, i) => ({ idx: m.contentIdx, paragraphs: para(` ${i}`) })));
  map.forEach((m, i) => { if (txt(full.get(m.phIdx)) !== ` ${i}`) out.push(`${l.name}: 枠 ${m.phIdx} が往復しない`); });
  for (const s of map) {
    const b = bind([{ idx: s.contentIdx, paragraphs: para("S") }]);
    if (txt(b.get(s.phIdx)) !== "S") out.push(`${l.name}: 枠 ${s.phIdx} 単独で届かない`);
    for (const o of map) if (o.phIdx !== s.phIdx && txt(b.get(o.phIdx)) === "S") out.push(`${l.name}: 枠 ${s.phIdx} が ${o.phIdx} へ漏れる`);
  }
  return out;
}

/** 検査ゲート。空配列なら合格。 */
export function verifyAugmentation(before: TemplateData, after: TemplateData, added: readonly Pick<AugmentedLayout, "name" | "columns">[]): string[] {
  const failures: string[] = [];
  const n = before.layouts.length;
  if (after.layouts.length !== n + added.length) failures.push(`レイアウト数が想定外（${n} + ${added.length} ≠ ${after.layouts.length}）`);
  for (let i = 0; i < n; i++)
    if (!sameJson(before.layouts[i], after.layouts[i])) failures.push(`(a) 既存レイアウト「${before.layouts[i].name}」の読み込み結果が変わった`);
  const catBefore = buildCatalog(before);
  const catAfter = buildCatalog(after);
  for (let i = 0; i < n; i++)
    if (!sameJson(catBefore[i], catAfter[i])) failures.push(`(a) 既存レイアウト「${catBefore[i].name}」の分類が変わった`);
  for (const a of added) {
    const e = catAfter.find((x) => x.name === a.name);
    const l = after.layouts.find((x) => x.name === a.name);
    if (!e || !l) { failures.push(`(b) 新レイアウト「${a.name}」が読み込めない`); continue; }
    if (e.role !== "columns" || e.bodyCount !== a.columns || !e.hasTitle)
      failures.push(`(b) 「${a.name}」が columns×${a.columns} にならない（role=${e.role}・body=${e.bodyCount}）`);
    failures.push(...bijectionFailures(l).map((f) => `(c) ${f}`));
  }
  return failures;
}

export interface AugmentResult {
  applied: boolean; // ゲート合格で、足したものが 1 つ以上ある
  bytes: Uint8Array; // applied なら合成後、そうでなければ入力そのまま
  plan: AugmentPlan;
  added: AugmentedLayout[];
  failures: string[]; // ゲートの不合格理由（合成失敗の例外もここに入る）
  reason?: string; // 足すものが無い理由（plan.reason）
}

/** 読み込み → 計画 → 合成 → 検査ゲートを一括で。ゲートで落ちたら入力 bytes を返す（非適用）。 */
export async function augmentAndVerify(source: ArrayBuffer | Uint8Array, opts: AugmentOptions = {}): Promise<AugmentResult> {
  const input = source instanceof Uint8Array ? source : new Uint8Array(source);
  const before = await loadTemplate(input);
  const plan = planAugmentation(before, buildCatalog(before), opts);
  if (!plan.base || plan.add.length === 0) return { applied: false, bytes: input, plan, added: [], failures: [], reason: plan.reason };
  try {
    const { bytes, added } = await augmentTemplate(input, plan);
    const failures = verifyAugmentation(before, await loadTemplate(bytes), added);
    return failures.length === 0 ? { applied: true, bytes, plan, added, failures } : { applied: false, bytes: input, plan, added: [], failures };
  } catch (err) {
    return { applied: false, bytes: input, plan, added: [], failures: [err instanceof Error ? err.message : String(err)] };
  }
}

