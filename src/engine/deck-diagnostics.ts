/**
 * deck-diagnostics.ts — NON-DESTRUCTIVE review of a deck against the template.
 *
 * The "差し戻し" half of the last-mile harness: instead of silently transforming
 * ambiguous content, flag slide-design issues (overflow, sentence-length bullets,
 * missing title, table-able key-value lists) + the LEVERS that would fix each, so
 * the human (or upstream AI) decides. Changes nothing — it only advises. The 3
 * intensity levels are meant to layer on top (which issues auto-fix vs are flagged).
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DeckIR, SlideIR, Paragraph } from "./slide-schema";
import type { LayoutCatalog } from "./template-catalog";
import { slideIdxRole } from "./template-catalog";
import type { LayoutInfo } from "./template-loader";
import { autoSelectLayout } from "./template-loader";
import { slideBindingPlan } from "./group-binding";
import { contentBodyBox, packParagraphs, paragraphLines } from "./distill";

export type Lever = "split" | "condense" | "visualize" | "title" | "polish";

export interface DeckIssue {
  slideIndex: number;
  title: string;
  level: "warn" | "info";
  message: string;
  levers: Lever[];
}

// Full-width chars: a bullet longer than this reads as a sentence, not a key phrase.
const SENTENCE_BULLET = 28;

function textOf(p: Paragraph | undefined): string {
  return p ? p.segments.map((s) => s.text).join("") : "";
}

// A bullet is "table-worthy key-value" only when the value is short and free of
// parenthetical context: "比率: 73%" yes, "比率: 73%（目標 90%）" no — the latter
// carries explanation and reads better as a bullet, so we don't nudge it to a table.
function isCleanKeyValue(text: string): boolean {
  const m = text.match(/^[^:：\n]{1,24}[:：]\s*(.+)$/);
  if (!m) return false;
  const value = m[1].trim();
  return !/[（(]/.test(value) && [...value].length <= 16;
}

function rolePlaceholder(slide: SlideIR, role: "title" | "body") {
  const hasCtr = slide.placeholders.some((p) => p.idx === "0");
  return slide.placeholders.find((p) => slideIdxRole(p.idx, hasCtr) === role);
}

export function diagnoseDeck(deck: DeckIR, catalog?: LayoutCatalog, layouts?: readonly LayoutInfo[]): DeckIssue[] {
  const box = catalog ? contentBodyBox(catalog) : undefined;
  const issues: DeckIssue[] = [];

  deck.slides.forEach((slide, i) => {
    const title = textOf(rolePlaceholder(slide, "title")?.paragraphs[0]);
    const add = (level: DeckIssue["level"], message: string, levers: Lever[]) =>
      issues.push({ slideIndex: i, title, level, message, levers });

    const isVisual = !!(slide.diagram || slide.mermaidBlock || slide.table);
    const body = rolePlaceholder(slide, "body");

    if (!title.trim() && (body || isVisual)) add("warn", "タイトルが無い", ["title"]);

    // 句読点はスライドでは prose に見える（体言止めが読みやすい）。読点「、」が最も可読性を落とすので
    // 強い警告（warn）、句点「。」は末尾を落とせば済むことが多いので軽い注意（info）。タイトル＋本文を走査。
    const prose = slide.placeholders.flatMap((ph) => ph.paragraphs).map(textOf).join("\n");
    if (prose.includes("、")) add("warn", "読点「、」が使われている（中黒「・」や改行で整えると読みやすい）", ["polish"]);
    if (prose.includes("。")) add("info", "句点「。」が使われている（スライドでは省くのが一般的）", ["polish"]);

    if (isVisual || !body) return;

    // Overflow: the body needs more than one box, or a single bullet is taller than the box.
    if (box) {
      const chunks = packParagraphs(body.paragraphs, box).length;
      const tallest = body.paragraphs.reduce((m, p) => Math.max(m, paragraphLines(p, box.charsPerLine)), 0);
      if (chunks > 1 || tallest > box.maxLines) {
        add("warn", `本文がテンプレ容量を超過（最大${box.maxLines}行）`, ["split", "condense", "visualize"]);
      }
    }

    const bullets = body.paragraphs.filter((p) => p.bullet);
    const longs = bullets.filter((p) => [...textOf(p)].length > SENTENCE_BULLET).length;
    if (longs > 0) add("info", `長い箇条書き ${longs}件（文章のまま）`, ["condense"]);

    // Suggest a table only for a real spec list on a SINGLE-body slide: 3+ bullets,
    // all clean short pairs. Skip multi-region layouts (columns / comparison / KPI /
    // process) — a table doesn't render inside a column, and a comparison reads fine
    // as bullets. Detect via extra body placeholders OR the layout directive's name.
    const multiRegion =
      slide.placeholders.some((p) => p.idx === "2" || p.idx === "3" || p.idx === "4") ||
      /column|comparison|process|kpi/i.test(slide.layout);
    const cleanKv = bullets.filter((p) => isCleanKeyValue(textOf(p))).length;
    if (!multiRegion && bullets.length >= 3 && cleanKv === bullets.length) add("info", "key-value形式 → 表にできます", ["visualize"]);
  });

  // ADR-0030 stage A — SURFACE content the resolved layout cannot hold (no-silent-drop / #97 ②a). Runs
  // ONLY when the raw layouts are supplied (a template is loaded), so every existing 2-arg call stays
  // byte-identical. Resolves each slide's layout exactly as export does (autoSelectLayout), then observes
  // the SAME binding dispatch export runs (slideBindingPlan) — so a warn appears iff content would truly
  // vanish. On a healthy deck all content binds → unbound is empty → not one diagnostic is added.
  if (layouts && layouts.length > 0 && catalog && catalog.length > 0) {
    const layoutByName = new Map(layouts.map((l) => [l.name, l] as const));
    deck.slides.forEach((slide, i) => {
      const layout = layoutByName.get(autoSelectLayout(slide, i, deck.slides.length, catalog));
      if (!layout) return;
      const n = slideBindingPlan(slide, layout).unbound.length;
      if (n === 0) return;
      const title = textOf(rolePlaceholder(slide, "title")?.paragraphs[0]);
      issues.push({ slideIndex: i, title, level: "warn", message: `内容 ${n} 件がこのレイアウト（${layout.name}）に入りません（未束縛・出力時に消えます）`, levers: [] });
    });
  }

  return issues;
}
