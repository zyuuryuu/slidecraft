/**
 * template-repair.ts — 登録支援（テーマ2 スライス1）: rejected マスターの診断→修復提案→最小 XML パッチ。
 *
 * 受け入れゲート（assessTemplateHealth）が block する NO_TITLE_ROLE / NO_BODY_ROLE を、既存の
 * 回復ラダー（type→idx 慣習→ジオメトリ→名前→面積）でも救えなかった placeholder に type 属性を
 * 付与する決定論パッチで解消する。「拒否」から「修復提案」へ — 提案は理由つきで返し、適用可否は
 * 呼び出し側（GUI 確認ダイアログ / 将来の MCP）が決める。純粋ロジック（R2: DOM/Tauri 禁止）。
 * 設計: docs/design/template-authoring.md S1。
 */
import { loadZipSafe, readCappedString, ZIP_LIMITS } from "./zip-safe";
import { loadTemplate, type TemplateData, type LayoutInfo, type PlaceholderInfo } from "./template-loader";
import { buildCatalog, assessTemplateHealth, placeholderRole, type TemplateHealth } from "./template-catalog";

// ── Types ──

export interface RepairOp {
  layoutIndex: number; // 実ファイル番号（slideLayout${n}.xml — LayoutInfo.index と同じ）
  layoutName: string;
  phIdx: string; // 対象 <p:ph> の idx 属性（属性なしは "0" — loader と同じ規約）
  phName: string; // cNvPr name（idx で照合できないときの第2キー）
  phOrdinal: number; // レイアウト内の placeholder 序数（重複 idx 除去後・文書順 — 最終照合キー）
  setType: "title" | "body"; // 付与する OOXML placeholder type
  reason: string; // 日本語・ユーザ提示用
}

export interface RepairPlan {
  health: TemplateHealth; // 修復前の健全性
  needed: boolean; // rejected（block あり）か
  repairable: boolean; // ops で全 block を解消できる見込みか
  ops: RepairOp[];
}

export interface RepairResult {
  bytes: Uint8Array; // 修復済み（修復不能/不要時は入力をそのまま返す）
  plan: RepairPlan;
  healthAfter: TemplateHealth; // 修復後の再評価（不要時は plan.health と同一）
}

// タイトルはマスター titleStyle 由来の大きな書式が lstStyle に残ることが多い。本文サイズ
// （既定 14pt）との分離点として 18pt を要求 — これ未満しか無いレイアウトでは提案しない。
const TITLE_MIN_FONT_PT = 18;

// ── 診断（提案の決定）──

/** 既存ラダーが救えなかった placeholder（role="other"）だけが修復候補。 */
function unresolved(layout: LayoutInfo): PlaceholderInfo[] {
  return layout.placeholders.filter((p) => placeholderRole(p) === "other");
}

function titleCandidate(cands: PlaceholderInfo[]): PlaceholderInfo | undefined {
  // フォントサイズ最大（マスター継承で唯一残る書式信号）→ 同点はジオメトリ上位（y 最小）→ 文書順。
  const best = [...cands].sort(
    (a, b) => b.style.fontSize - a.style.fontSize || a.style.y - b.style.y,
  )[0];
  return best && best.style.fontSize >= TITLE_MIN_FONT_PT ? best : undefined;
}

function bodyCandidate(cands: PlaceholderInfo[]): PlaceholderInfo | undefined {
  // 面積最大（ジオメトリが無ければ全て 0 → 文書順の先頭）。
  return [...cands].sort((a, b) => b.style.w * b.style.h - a.style.w * a.style.h)[0];
}

function opFor(layout: LayoutInfo, ph: PlaceholderInfo, setType: "title" | "body", reason: string): RepairOp {
  return {
    layoutIndex: layout.index,
    layoutName: layout.name,
    phIdx: ph.idx,
    phName: ph.name,
    phOrdinal: layout.placeholders.indexOf(ph),
    setType,
    reason,
  };
}

/**
 * 修復プランを決定論的に導出する。block された次元（title/body）ごとに、各レイアウトの
 * 未解決 placeholder から候補を推定して type 付与 op を提案。block の無いマスターには
 * 何も提案しない（過剰修復ゼロ — 回復ラダーで読めるマスターは無改変が正）。
 */
export function planRepairs(tpl: TemplateData): RepairPlan {
  const health = assessTemplateHealth(buildCatalog(tpl));
  const needed = health.status === "rejected";
  if (!needed) return { health, needed, repairable: false, ops: [] };

  const needTitle = health.findings.some((f) => f.code === "NO_TITLE_ROLE");
  const needBody = health.findings.some((f) => f.code === "NO_BODY_ROLE");
  const ops: RepairOp[] = [];

  for (const layout of tpl.layouts) {
    const cands = unresolved(layout);
    if (cands.length === 0) continue;
    const roles = new Set(layout.placeholders.map((p) => placeholderRole(p)));

    let title: PlaceholderInfo | undefined;
    if (needTitle && !roles.has("title")) {
      title = titleCandidate(cands);
      if (title)
        ops.push(opFor(layout, title, "title",
          `フォントサイズが最大（${title.style.fontSize}pt）のためタイトル枠と推定しました。`));
    }
    if (needBody && !roles.has("body")) {
      const rest = cands.filter((p) => p !== title);
      const body = bodyCandidate(rest);
      if (body)
        ops.push(opFor(layout, body, "body",
          body.style.w * body.style.h > 0
            ? `面積が最大（${(body.style.w * body.style.h).toFixed(1)} in²）のため本文枠と推定しました。`
            : "残りの placeholder のうち文書順で先頭のため本文枠と推定しました。"));
    }
  }

  const repairable =
    (!needTitle || ops.some((o) => o.setType === "title")) &&
    (!needBody || ops.some((o) => o.setType === "body"));
  return { health, needed, repairable, ops };
}

// ── 適用（最小 XML パッチ）──

const SP_BLOCK_RE = /<(p|ns\d+):sp>[\s\S]*?<\/\1:sp>/g;
const PH_TAG_RE = /<(?:\w+:)?ph\b([^>]*?)(\/?)>/;

/** ブロック内 <p:ph> の idx（属性なしは "0" — loader と同じ規約）。ph なしは null。 */
function blockPhIdx(block: string): string | null {
  const tag = block.match(PH_TAG_RE);
  if (!tag) return null;
  return tag[1].match(/idx="(\d+)"/)?.[1] ?? "0";
}

function blockPhName(block: string): string {
  return block.match(/cNvPr[^>]*name="([^"]*)"/)?.[1] ?? "";
}

/** <p:ph> タグに type 属性を付与（既存 type は置換）。タグ以外は不変。 */
function setPhType(block: string, type: string): string {
  return block.replace(PH_TAG_RE, (_m, attrs: string, close: string) => {
    const cleaned = attrs.replace(/\s*type="[^"]*"/, "");
    return `<p:ph type="${type}"${cleaned}${close}>`;
  });
}

/**
 * ops を PPTX bytes に適用し、新しい bytes を返す。対象レイアウト XML の <p:ph> タグ以外は
 * 一切変更しない（最小パッチ）。対象照合は idx → 名前 → 序数のラダー（loader と同じ
 * 重複 idx 先勝ちで序数を数える）。照合できない op はスキップ（部分適用 — 再評価が最終ゲート）。
 */
export async function applyRepairs(
  buf: ArrayBuffer | Uint8Array,
  ops: RepairOp[],
): Promise<Uint8Array> {
  const zip = await loadZipSafe(buf, { maxInputBytes: ZIP_LIMITS.templatePptx });
  const byLayout = new Map<number, RepairOp[]>();
  for (const op of ops) byLayout.set(op.layoutIndex, [...(byLayout.get(op.layoutIndex) ?? []), op]);

  for (const [index, layoutOps] of byLayout) {
    const path = `ppt/slideLayouts/slideLayout${index}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    const xml = await readCappedString(file, ZIP_LIMITS.xmlEntry);

    // placeholder ブロックを文書順に列挙（重複 idx は loader と同じ先勝ちで序数から除外）
    const blocks: Array<{ start: number; end: number; text: string; idx: string; name: string }> = [];
    const seen = new Set<string>();
    for (const m of xml.matchAll(SP_BLOCK_RE)) {
      const idx = blockPhIdx(m[0]);
      if (idx === null || seen.has(idx)) continue;
      seen.add(idx);
      blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0], idx, name: blockPhName(m[0]) });
    }

    const replaced = new Map<number, string>(); // block ordinal → patched text
    for (const op of layoutOps) {
      const ordinal =
        blocks.findIndex((b) => b.idx === op.phIdx) !== -1
          ? blocks.findIndex((b) => b.idx === op.phIdx)
          : blocks.findIndex((b) => b.name !== "" && b.name === op.phName) !== -1
            ? blocks.findIndex((b) => b.name !== "" && b.name === op.phName)
            : op.phOrdinal < blocks.length
              ? op.phOrdinal
              : -1;
      if (ordinal === -1) continue;
      replaced.set(ordinal, setPhType(replaced.get(ordinal) ?? blocks[ordinal].text, op.setType));
    }
    if (replaced.size === 0) continue;

    // オフセットを保ったまま後ろから差し替え（ブロック本文の重複に耐える）
    let out = xml;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const patched = replaced.get(i);
      if (patched === undefined) continue;
      out = out.slice(0, blocks[i].start) + patched + out.slice(blocks[i].end);
    }
    zip.file(path, out);
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// ── 一括便宜 API（診断→パッチ→再評価）──

/**
 * bytes を診断し、修復可能なら適用して再評価まで行う。呼び出し側は plan を確認ダイアログ等で
 * 提示し、healthAfter が rejected でないことを確認して登録すればよい。修復不要/不能なら
 * 入力 bytes をそのまま返す（healthAfter = 修復前の健全性）。
 */
export async function repairTemplate(buf: ArrayBuffer | Uint8Array): Promise<RepairResult> {
  const input = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const plan = planRepairs(await loadTemplate(input));
  if (!plan.needed || !plan.repairable || plan.ops.length === 0)
    return { bytes: input, plan, healthAfter: plan.health };
  const bytes = await applyRepairs(input, plan.ops);
  const healthAfter = assessTemplateHealth(buildCatalog(await loadTemplate(bytes)));
  return { bytes, plan, healthAfter };
}
