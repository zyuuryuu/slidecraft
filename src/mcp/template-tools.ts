/**
 * template-tools.ts — #568 段 3 / #570 段 3 の MCP 口: 開いている doc のテンプレから**派生テンプレ**を作って適用する
 * （augment_template / adjust_template）＋ get_deck_issues の本文倍率提案（overflow-scale-hint）。
 *
 * - 派生は常に「元テンプレ bytes ＋ レシピ（書体置換 → 倍率 → 合成の固定順）」から作り直す（Issue #570 裁定）。
 *   元 bytes とレシピは doc（Session）ごとに WeakMap で持つ（session.ts は R1 凍結なので触らない）。だから
 *   adjust を 2 回呼んでも倍率は重ならず、adjust と augment をどちらから呼んでも結果は同じ。
 *   元 bytes は最初の派生時点の doc のテンプレ（open/new 直後のもの）。.scft を保存して開き直すと、派生済みの
 *   テンプレが新しい「元」になる（レシピはデッキに保存しない — デッキ側に倍率を持たない・R8）。
 * - 元テンプレは書き換えない（adjustTemplate / augmentAndVerify は派生 bytes を返す）。適用は new_project と同じ
 *   健全性ゲート（loadTemplate → buildCatalog → assessTemplateHealth）を通す。deck は変えない（undo 履歴の外）。
 * - 何も変わらない（足すものが無い／元にできない）ときは適用せず理由を返す（never-silent）。
 */
import { z } from "zod";
import type { Session } from "./session";
import { requireLoaded, getDiagnostics } from "./session";
import { GuardError } from "./guard-errors";
import { loadTemplate, type TemplateData } from "../engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../engine/template-catalog";
import { adjustTemplate, isNoopRecipe, type TemplateAdjustRecipe } from "../engine/template-adjust";
import { augmentAndVerify } from "../engine/layout-augment";
import { ALL_AUGMENT_STRUCTURES, type AugmentStructure } from "../engine/layout-augment-structures";
import type { ShrinkRule } from "../engine/column-font-shrink";
import type { DeckIssue } from "../engine/deck-diagnostics";
import type { DeckIR } from "../engine/slide-schema";
import { countOverflows, overflowScaleIssue, suggestBodyScale, type OverflowScaleSuggestion } from "../engine/overflow-scale-hint";

interface Derivation {
  source: Uint8Array; // 元テンプレ（不変）
  sourceName: string;
  recipe?: TemplateAdjustRecipe;
  structures?: AugmentStructure[];
  rule?: ShrinkRule;
}
const derivations = new WeakMap<Session, Derivation>();

const bytesOf = (t: TemplateData) => t.zip.generateAsync({ type: "uint8array" });

async function derivationOf(s: Session): Promise<Derivation> {
  const { template } = requireLoaded(s);
  return derivations.get(s) ?? { source: await bytesOf(template), sourceName: s.meta.templateName };
}

/** 元 bytes ＋ レシピ → 派生 bytes（固定順）。合成のゲート不合格は理由付きで返す。 */
async function build(d: Derivation) {
  let bytes = d.source;
  if (d.recipe && !isNoopRecipe(d.recipe)) bytes = await adjustTemplate(bytes, d.recipe);
  if (!d.structures?.length) return { bytes, added: [], skipped: [], failures: [] as string[] };
  const r = await augmentAndVerify(bytes, { structures: d.structures, rule: d.rule });
  return { bytes: r.bytes, added: r.added, skipped: r.plan.skipped, failures: r.failures, reason: r.reason };
}

const derivedName = (d: Derivation) => `${d.sourceName || "テンプレ"}${d.recipe && !isNoopRecipe(d.recipe) ? "（調整）" : ""}${d.structures?.length ? "（強化）" : ""}`;

/** 派生 bytes を doc のテンプレとして入れる（new_project と同じ健全性ゲート）。deck は変えない。 */
async function install(s: Session, bytes: Uint8Array, d: Derivation): Promise<{ templateName: string; overflow: { before: number; after: number } }> {
  const overflowBefore = countOverflows(getDiagnostics(s).issues);
  const template = await loadTemplate(bytes);
  const catalog = buildCatalog(template);
  const health = assessTemplateHealth(catalog);
  if (health.status === "rejected") throw new Error(`派生テンプレが使用できません: ${health.findings.filter((f) => f.level === "block").map((f) => f.message).join(" ")}`);
  s.template = template;
  s.catalog = catalog;
  s.meta.templateName = derivedName(d);
  s.dirty = true;
  derivations.set(s, d);
  return { templateName: s.meta.templateName, overflow: { before: overflowBefore, after: countOverflows(getDiagnostics(s).issues) } };
}

/** augment_template: 無い構造を合成して足す（structures 省略＝全構造）。前回までに足した構造は保つ（和集合）。 */
export async function augmentDocTemplate(s: Session, structures?: readonly AugmentStructure[], rule?: ShrinkRule) {
  const d = await derivationOf(s);
  const want = new Set([...(d.structures ?? []), ...(structures ?? ALL_AUGMENT_STRUCTURES)]);
  const next: Derivation = { ...d, structures: ALL_AUGMENT_STRUCTURES.filter((x) => want.has(x)), rule: rule ?? d.rule };
  const r = await build(next);
  if (r.failures.length) return { ok: false as const, changed: false, failures: r.failures };
  const fresh = r.added.filter((a) => !(d.structures ?? []).includes(a.structure) || rule !== d.rule);
  const asked = new Set(structures ?? ALL_AUGMENT_STRUCTURES);
  const skipped = [
    ...r.skipped.filter((x) => asked.has(x.structure)).map((x) => ({ structure: x.structure, reason: x.reason })),
    ...r.added.filter((a) => asked.has(a.structure) && !fresh.includes(a)).map((a) => ({ structure: a.structure, reason: `この doc では「${a.name}」として追加済みです。` })),
  ];
  if (fresh.length === 0) return { changed: false, added: [], skipped, ...(r.reason ? { reason: r.reason } : {}) };
  const res = await install(s, r.bytes, next);
  return { changed: true, ...res, added: fresh.map((a) => ({ structure: a.structure, name: a.name })), skipped };
}

const FontMap = z.array(z.object({ from: z.string().min(1), to: z.string().min(1) }).strict());
const Factor = z.number().positive();
export const RecipeSchema = z
  .object({
    fonts: z.object({ latin: FontMap.optional(), ea: FontMap.optional(), scope: z.enum(["theme", "theme+inline"]).optional() }).strict().optional(),
    scale: z.object({ title: Factor.optional(), body: Factor.optional(), other: Factor.optional() }).strict().optional(),
  })
  .strict();

/** adjust_template: レシピ（JSON 文字列）で書体置換・倍率を掛けた派生を適用する。前回の合成は保つ（固定順で掛け直す）。 */
export async function adjustDocTemplate(s: Session, recipeJson: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(recipeJson);
  } catch {
    throw new GuardError("recipe が JSON として読めません（例: {\"scale\":{\"body\":0.9}}）。", "invalid-argument");
  }
  const v = RecipeSchema.safeParse(parsed);
  if (!v.success) throw new GuardError(`recipe が不正です: ${v.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join(" / ")}`, "invalid-argument");
  const d = await derivationOf(s);
  const next: Derivation = { ...d, recipe: v.data };
  const r = await build(next);
  if (r.failures.length) return { ok: false as const, changed: false, failures: r.failures };
  return { changed: true, ...(await install(s, r.bytes, next)), recipe: v.data };
}

// ── get_deck_issues: 本文倍率の提案（#570 段 3）──
const suggestionCache = new WeakMap<TemplateData, WeakMap<DeckIR, OverflowScaleSuggestion | null>>();

/** 溢れがあるときだけ提案を 1 件足す（無ければ入力の配列をそのまま返す＝応答は従来どおり）。
 *  hint 用に、adjust_template に渡す**絶対**レシピ（前回の本文倍率 × 提案倍率）も返す。 */
export async function withOverflowScaleHint(s: Session, issues: DeckIssue[]): Promise<{ issues: DeckIssue[]; recipe?: string }> {
  if (countOverflows(issues) === 0 || s.disabledReviewRules.has("overflow-scale-hint")) return { issues };
  const { deck, template } = requireLoaded(s);
  let byDeck = suggestionCache.get(template);
  if (!byDeck) suggestionCache.set(template, (byDeck = new WeakMap()));
  let sug = byDeck.get(deck);
  if (sug === undefined) byDeck.set(deck, (sug = (await suggestBodyScale(await bytesOf(template), deck)) ?? null));
  if (!sug) return { issues };
  const prev = derivations.get(s)?.recipe;
  const body = Math.round((prev?.scale?.body ?? 1) * sug.scale * 10000) / 10000;
  const recipe = JSON.stringify({ ...(prev ?? {}), scale: { ...(prev?.scale ?? {}), body } });
  return { issues: [...issues, overflowScaleIssue(sug, issues)], recipe };
}
