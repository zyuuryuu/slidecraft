/**
 * ai-validate.ts — the small-model GUARDRAIL (roadmap #2 P1).
 *
 * A ~3B model condenses reliably MOST of the time but occasionally drops a fact,
 * drifts language (JA→中文 / EN→JA), or returns the wrong format (JSON ops). Phase-0
 * proved these are the residual failure modes. This deterministic validator catches
 * them so [[refine]] can REJECT + retry a bad candidate instead of applying it blind —
 * the load-bearing piece that makes the in-app model trustworthy (NOT constrained
 * decoding, which can't express SlideCraft's dual-mode Markdown). See [[inapp_ai_design]].
 *
 * HARD violations (parse / fact / language) → never apply, retry, keep original on
 * exhaustion. SOFT violations (budget) → still an improvement, accept best-effort.
 *
 * Pure logic (R2): no DOM / Tauri / AI. Just text in, a verdict out.
 */

import type { FitBox } from "./distill";
import type { SlideIR } from "./slide-schema";
import { parseMd } from "./md-parser";
import { META_IDXS, titleSubtitleIdx } from "./slide-roles";

export type CondenseViolation = {
  kind: "parse" | "language" | "fact" | "budget" | "structure";
  severity: "hard" | "soft";
  detail: string;
};

export interface CondenseVerdict {
  ok: boolean; // no violations at all
  hasHard: boolean; // any HARD violation → reject + retry (drives refine's retry policy)
  violations: CondenseViolation[];
}

const KANA = /[぀-ヿ]/; // hiragana + katakana (incl. ー) — a reliable "this is Japanese" signal
const HAN = /[一-鿿]/; // CJK unified ideographs
// Simplified-Chinese chars whose codepoint differs from the Japanese form — a positive
// "drifted to 中文" signal. Script alone can't tell all-kanji Japanese from Chinese, so we
// detect Chinese by these glyphs instead of by "kana is missing" (which a valid all-kanji
// condense also is). Conservative set of high-frequency simplified-only characters.
const SIMPLIFIED = /[们这个时间说话运过进还让给经现实总应该务动单关门问题见长车业产每稳营张龙图书购买卖]/;

/** Count of CJK (kana + han) characters — "how Japanese is this string". */
function jaCount(s: string): number {
  return (s.match(/[぀-ヿ一-鿿]/g) ?? []).length;
}
/** Count of Latin letters, and of Latin WORDS (≥2 letters) — "how English is this string". */
function latinCount(s: string): number {
  return (s.match(/[A-Za-z]/g) ?? []).length;
}
function latinWords(s: string): number {
  return (s.match(/[A-Za-z]{2,}/g) ?? []).length;
}

/** Normalize 全角 digits (U+FF10–19) → ASCII and 全角 comma → "," so number extraction sees them. */
function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/，/g, ",");
}
/** Distinct numeric tokens (with decimals), commas stripped — the facts a condense must keep. */
function numbers(s: string): Set<string> {
  return new Set((normalizeDigits(s).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")));
}
function bullets(md: string): string[] {
  return md.split("\n").filter((l) => /^\s*[-*]\s/.test(l)).map((l) => l.replace(/^\s*[-*]\s/, "").trim());
}
/** Non-heading, non-directive body text — used to tell a body WIPE from a prose merge. */
function bodyText(md: string): string {
  return md.split("\n").map((l) => l.trim())
    .filter((t) => t && !t.startsWith("#") && !t.startsWith(">") && !t.startsWith("<!--"))
    .join(" ").trim();
}

/** Drop `<!-- slide: Layout.Name -->` scaffolding (md-serializer emits it) — it is not
 *  content, and a layout name like "Content.1Body.Single" would pollute fact extraction. */
function stripScaffold(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

export function validateCondense(beforeRaw: string, afterRaw: string, box?: FitBox): CondenseVerdict {
  const v: CondenseViolation[] = [];
  const before = stripScaffold(beforeRaw);
  const after = stripScaffold(afterRaw);
  const trimmed = after.trim();

  // ── parse (HARD): must be Markdown, not JSON ops, and yield a slide with content ──
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    v.push({ kind: "parse", severity: "hard", detail: "JSON が返った（Markdown ではない）" });
  } else {
    const slide = parseMd(trimmed).slides[0];
    // SlideIR has no `.title` — a title lands in a placeholder. "Has content" = any placeholder
    // carries non-empty text, or the raw markdown has bullets.
    const hasPlaceholderText = !!slide && slide.placeholders.some((p) =>
      p.paragraphs.some((pp) => pp.segments.some((s) => s.text.trim().length > 0)));
    const hasContent = hasPlaceholderText || bullets(trimmed).length > 0;
    if (!hasContent) v.push({ kind: "parse", severity: "hard", detail: "パース可能なスライド本文が無い" });
  }

  // ── language (HARD): JA input doesn't drift to 中文 / English; ASCII input isn't translated.
  // Judge by DOMINANT script, not "any CJK gone": a valid condense keeps most JA nouns and may leave a
  // few Latin acronyms; a translation replaces the script. So English-drift needs a real English
  // SENTENCE (≥3 Latin words) with JA collapsed (or gone), and a digit/emoji-only result is not a
  // translation at all. 中文 is still detected by simplified glyphs. ──
  const beforeJA = KANA.test(before);
  const beforeEN = !KANA.test(before) && !HAN.test(before);
  if (beforeJA) {
    if (SIMPLIFIED.test(after)) {
      v.push({ kind: "language", severity: "hard", detail: "中国語に drift した" });
    } else if (
      (jaCount(after) === 0 && latinCount(after) > 0) || // wholly de-Japanized into Latin
      (latinWords(after) >= 3 && jaCount(after) < jaCount(before) * 0.4) // English sentence, JA collapsed
    ) {
      v.push({ kind: "language", severity: "hard", detail: "日本語が英語に翻訳された" });
    }
  } else if (beforeEN && jaCount(after) > latinCount(after)) {
    // English input turned dominantly Japanese (a stray place-name kanji alone doesn't count).
    v.push({ kind: "language", severity: "hard", detail: "英語入力が翻訳された" });
  }

  // ── fact (HARD): every number in the input must survive (the "丸ごとOmit" guard) ──
  const beforeNums = numbers(before);
  const afterNums = numbers(after);
  const lost = [...beforeNums].filter((n) => !afterNums.has(n));
  if (lost.length > 0) {
    v.push({ kind: "fact", severity: "hard", detail: `数値の欠落: ${lost.join(", ")}` });
  }

  // ── content wipe (HARD): a condense must SHORTEN, not delete — if the input carried ≥2 bullets and
  // the output has no bullets AND no body text at all, the body was wiped (a merge into prose or one
  // bullet keeps body text, so this only fires on a true deletion). ──
  if (bullets(before).length >= 2 && bullets(after).length === 0 && bodyText(after) === "") {
    v.push({ kind: "fact", severity: "hard", detail: "本文（箇条書き）が全て失われた" });
  }

  // ── budget (SOFT): fits the template's content box — still an improvement if slightly over ──
  if (box) {
    const bs = bullets(after);
    if (bs.length > box.maxLines) {
      v.push({ kind: "budget", severity: "soft", detail: `項目数 ${bs.length} > ${box.maxLines}` });
    }
    const over = bs.filter((b) => b.length > box.charsPerLine);
    if (over.length > 0) {
      v.push({ kind: "budget", severity: "soft", detail: `${over.length}項が ${box.charsPerLine}字超` });
    }
  }

  return { ok: v.length === 0, hasHard: v.some((x) => x.severity === "hard"), violations: v };
}

// ── Structure preservation (the 構造ヘッダー保全 guard) ──
// Complements validateCondense: it checks FACTS/language, this checks the SlideIR's structural
// scaffolding (layout pin, title, figure, group hint, meta). Drives the same retry policy — a HARD
// violation is rejected + retried, and [[ai-reconcile]] restores the dropped scaffolding on apply.
// strictness by `kind`: a `condense` never intends a structural change (all losses HARD), whereas a
// free-form `edit` may legitimately restructure — only losing the LAYOUT PIN is HARD there.

function phPlainText(s: SlideIR, idx: string): string {
  const ph = s.placeholders.find((p) => p.idx === idx);
  return ph ? ph.paragraphs.flatMap((p) => p.segments).map((x) => x.text).join("").trim() : "";
}
/** A slide's title lives at its OWN namespace idx (0 for title-namespace, 15 for content) — judged by
 *  the same rule the parser uses (slide-roles), so unrelated text in the other idx isn't mistaken for
 *  a surviving title across a namespace boundary. */
function titleText(s: SlideIR): string {
  const hasMeta = META_IDXS.some((idx) => phPlainText(s, idx).length > 0);
  return phPlainText(s, titleSubtitleIdx(s.layout, hasMeta).title);
}
function hasFigure(s: SlideIR): boolean {
  return !!(s.diagram || s.mermaidBlock || s.table || s.code);
}
/** How many non-empty group columns (idx 1..9) a slide has — a dropped column = a lost card/step/kpi. */
function groupColCount(s: SlideIR): number {
  return s.placeholders.filter((p) => /^[1-9]$/.test(p.idx) && p.paragraphs.some((pp) => pp.segments.some((x) => x.text.trim()))).length;
}

export function validateStructure(before: SlideIR, after: SlideIR, kind: "condense" | "edit"): CondenseVerdict {
  const v: CondenseViolation[] = [];
  const sev = (): "hard" | "soft" => (kind === "condense" ? "hard" : "soft");
  const push = (severity: "hard" | "soft", detail: string) => v.push({ kind: "structure", severity, detail });

  // layout pin loss — ALWAYS hard: dropping the `<!-- slide: ... -->` header re-selects the layout.
  if (before.layout !== "auto" && after.layout === "auto") push("hard", "レイアウト指定(ヘッダー)が失われた");
  // title loss — the slide had a title, the edit returned none.
  if (titleText(before) && !titleText(after)) push(sev(), "タイトルが失われた");
  // figure loss — flagged only for a `condense` (which returns the FULL slide and must not drop it).
  // A free-form `edit` that returns text-only is NORMAL: reconcileEdit carries the figure, so flagging
  // it would announce a "restore" on every routine text edit of a figure-bearing slide. Kept silent.
  if (hasFigure(before) && !hasFigure(after) && kind === "condense") push("hard", "図/表/コードが失われた");
  // group hint loss — a card/step/kpi slide lost its group kind.
  if (before.groupKind && !after.groupKind) push(sev(), "グループ指定が失われた");
  // group column loss — a grouped slide came back with fewer columns (a whole card/step/kpi dropped).
  if (before.groupKind && groupColCount(after) < groupColCount(before)) push(sev(), "グループの列が失われた");
  // meta loss (Category/Date/Footer) — always SOFT (reconcile restores; a real edit may drop one).
  for (const idx of META_IDXS) {
    if (phPlainText(before, idx) && !phPlainText(after, idx)) push("soft", `メタ情報(idx${idx})が失われた`);
  }

  return { ok: v.length === 0, hasHard: v.some((x) => x.severity === "hard"), violations: v };
}

/** Combine two verdicts: ok when both ok, hard when either is hard, violations concatenated. */
export function mergeVerdicts(a: CondenseVerdict, b: CondenseVerdict): CondenseVerdict {
  return { ok: a.ok && b.ok, hasHard: a.hasHard || b.hasHard, violations: [...a.violations, ...b.violations] };
}
