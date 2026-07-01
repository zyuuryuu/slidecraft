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
import { parseMd } from "./md-parser";

export type CondenseViolation = {
  kind: "parse" | "language" | "fact" | "budget";
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
/** Distinct numeric tokens (with decimals), commas stripped — the facts a condense must keep. */
function numbers(s: string): Set<string> {
  return new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")));
}
function bullets(md: string): string[] {
  return md.split("\n").filter((l) => /^\s*[-*]\s/.test(l)).map((l) => l.replace(/^\s*[-*]\s/, "").trim());
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
  // All-kanji condensed Japanese is valid + kana-free, so detect 中文 by simplified glyphs (not
  // by "kana missing") and English-ization by "all CJK gone". ──
  const beforeJA = KANA.test(before);
  const beforeEN = !KANA.test(before) && !HAN.test(before);
  if (beforeJA) {
    if (SIMPLIFIED.test(after)) {
      v.push({ kind: "language", severity: "hard", detail: "中国語に drift した" });
    } else if (!KANA.test(after) && !HAN.test(after)) {
      v.push({ kind: "language", severity: "hard", detail: "日本語が英語に翻訳された" });
    }
  } else if (beforeEN && (KANA.test(after) || HAN.test(after))) {
    v.push({ kind: "language", severity: "hard", detail: "英語入力が翻訳された" });
  }

  // ── fact (HARD): every number in the input must survive (the "丸ごとOmit" guard) ──
  const beforeNums = numbers(before);
  const afterNums = numbers(after);
  const lost = [...beforeNums].filter((n) => !afterNums.has(n));
  if (lost.length > 0) {
    v.push({ kind: "fact", severity: "hard", detail: `数値の欠落: ${lost.join(", ")}` });
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
