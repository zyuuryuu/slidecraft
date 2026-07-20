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
import { slideIdxRole, isSectionFooterTarget } from "./template-catalog";
import type { LayoutInfo } from "./template-loader";
import { autoSelectLayout } from "./template-loader";
import { slideBindingPlan } from "./group-binding";
import { contentBodyBox, packParagraphs, paragraphLines } from "./distill";
import { IMAGE_MARKDOWN_RE, unrecognizedMetaKey, type SlideParseNotice } from "./parse-notice";
import { sectionFooterFor } from "./deck-sections";

export type Lever = "split" | "condense" | "visualize" | "title" | "polish";

/**
 * REVIEW_RULES — the ONE registry of review-rule id → level (#244). Every DeckIssue this module
 * produces sets `id` from here (via RULE_LEVEL, so the level literal itself is written ONCE), and
 * `get_authoring_guide`'s `activeReviewRules` (src/mcp/guides.ts) is a literal projection of this
 * same array — so the rules an agent is told about up front can never drift from what
 * `get_deck_issues` actually flags later (R8; locked by tests/review-rules-agreement.test.ts).
 */
export type ReviewRuleId =
  | "missing-title"
  | "touten-used"
  | "kuten-used"
  | "image-markdown-leftover"
  | "unrecognized-meta-key"
  | "body-overflow"
  | "long-bullet"
  | "key-value-table"
  | "unbound-content"
  | "table-dropped"
  | "image-dropped"
  | "meta-key-dropped"
  | "section-footer-injected";

export interface ReviewRule {
  id: ReviewRuleId;
  level: "warn" | "info";
}

export const REVIEW_RULES: readonly ReviewRule[] = [
  { id: "missing-title", level: "warn" },
  { id: "touten-used", level: "warn" },
  { id: "kuten-used", level: "info" },
  { id: "image-markdown-leftover", level: "info" },
  { id: "unrecognized-meta-key", level: "warn" },
  { id: "body-overflow", level: "warn" },
  { id: "long-bullet", level: "info" },
  { id: "key-value-table", level: "info" },
  { id: "unbound-content", level: "warn" },
  { id: "table-dropped", level: "info" },
  { id: "image-dropped", level: "info" },
  { id: "meta-key-dropped", level: "warn" },
  { id: "section-footer-injected", level: "info" },
];

const RULE_LEVEL: Record<ReviewRuleId, "warn" | "info"> = Object.fromEntries(
  REVIEW_RULES.map((r) => [r.id, r.level]),
) as Record<ReviewRuleId, "warn" | "info">;

export interface DeckIssue {
  slideIndex: number;
  title: string;
  level: "warn" | "info";
  message: string;
  levers: Lever[];
  /** Optional so pre-#244 hand-built DeckIssue fixtures in other tests keep compiling (additive
   *  field, ADR-0015-style non-breaking contract). Every issue THIS module produces always sets it. */
  id?: ReviewRuleId;
}

// Full-width chars: a bullet longer than this reads as a sentence, not a key phrase.
const SENTENCE_BULLET = 28;

function textOf(p: Paragraph | undefined): string {
  return p ? p.segments.map((s) => s.text).join("") : "";
}

function rolePlaceholder(slide: SlideIR, role: "title" | "body") {
  const hasCtr = slide.placeholders.some((p) => p.idx === "0");
  return slide.placeholders.find((p) => slideIdxRole(p.idx, hasCtr) === role);
}

/** The slide's title text, or "" — shared by every issue-producing pass (incl. ParseNotice→DeckIssue). */
function slideTitle(slide: SlideIR): string {
  return textOf(rolePlaceholder(slide, "title")?.paragraphs[0]);
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

export function diagnoseDeck(deck: DeckIR, catalog?: LayoutCatalog, layouts?: readonly LayoutInfo[]): DeckIssue[] {
  const box = catalog ? contentBodyBox(catalog) : undefined;
  const issues: DeckIssue[] = [];

  deck.slides.forEach((slide, i) => {
    const title = slideTitle(slide);
    const add = (id: ReviewRuleId, message: string, levers: Lever[]) =>
      issues.push({ slideIndex: i, title, id, level: RULE_LEVEL[id], message, levers });

    const isVisual = !!(slide.diagram || slide.mermaidBlock || slide.table);
    const body = rolePlaceholder(slide, "body");

    if (!title.trim() && (body || isVisual)) add("missing-title", "タイトルが無い", ["title"]);

    // 句読点はスライドでは prose に見える（体言止めが読みやすい）。読点「、」が最も可読性を落とすので
    // 強い警告（warn）、句点「。」は末尾を落とせば済むことが多いので軽い注意（info）。タイトル＋本文を走査。
    const allParas = slide.placeholders.flatMap((ph) => ph.paragraphs);
    const prose = allParas.map(textOf).join("\n");
    if (prose.includes("、")) add("touten-used", "読点「、」が使われている（中黒「・」や改行で整えると読みやすい）", ["polish"]);
    if (prose.includes("。")) add("kuten-used", "句点「。」が使われている（スライドでは省くのが一般的）", ["polish"]);

    // #148: a paragraph carrying literal `![alt](src)` Markdown means an image line fell through to
    // body text (a 2nd+ image, or one with an unsupported src) — never rendered, just dead text.
    if (allParas.some((p) => IMAGE_MARKDOWN_RE.test(textOf(p)))) {
      add("image-markdown-leftover", "画像記法（![alt](src)）が本文テキストとして残っています（2枚目以降の画像、または未対応の画像パスの可能性）", []);
    }

    // #148: a non-bullet/non-heading paragraph shaped like the parser's own recognized-field regex
    // (`Key: Value`), but whose key ISN'T Category/Date/Footer, means it fell through unrecognized.
    for (const p of allParas) {
      if (p.bullet || p.heading) continue;
      const key = unrecognizedMetaKey(textOf(p));
      if (key) add("unrecognized-meta-key", `「${key}:」は認識されないメタキーのため本文テキスト化されました（Category/Date/Footer のみ対応）`, []);
    }

    if (isVisual || !body) return;

    // Overflow: the body needs more than one box, or a single bullet is taller than the box.
    if (box) {
      const chunks = packParagraphs(body.paragraphs, box).length;
      const tallest = body.paragraphs.reduce((m, p) => Math.max(m, paragraphLines(p, box.charsPerLine)), 0);
      if (chunks > 1 || tallest > box.maxLines) {
        add("body-overflow", `本文がテンプレ容量を超過（最大${box.maxLines}行）`, ["split", "condense", "visualize"]);
      }
    }

    const bullets = body.paragraphs.filter((p) => p.bullet);
    const longs = bullets.filter((p) => [...textOf(p)].length > SENTENCE_BULLET).length;
    if (longs > 0) add("long-bullet", `長い箇条書き ${longs}件（文章のまま）`, ["condense"]);

    // Suggest a table only for a real spec list on a SINGLE-body slide: 3+ bullets,
    // all clean short pairs. Skip multi-region layouts (columns / comparison / KPI /
    // process) — a table doesn't render inside a column, and a comparison reads fine
    // as bullets. Detect via extra body placeholders OR the layout directive's name.
    const multiRegion =
      slide.placeholders.some((p) => p.idx === "2" || p.idx === "3" || p.idx === "4") ||
      /column|comparison|process|kpi/i.test(slide.layout);
    const cleanKv = bullets.filter((p) => isCleanKeyValue(textOf(p))).length;
    if (!multiRegion && bullets.length >= 3 && cleanKv === bullets.length) add("key-value-table", "key-value形式 → 表にできます", ["visualize"]);
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
      const plan = slideBindingPlan(slide, layout);
      const n = plan.unbound.length;
      if (n > 0) {
        issues.push({ slideIndex: i, title: slideTitle(slide), id: "unbound-content", level: RULE_LEVEL["unbound-content"], message: `内容 ${n} 件がこのレイアウト（${layout.name}）に入りません（未束縛・出力時に消えます）`, levers: [] });
      }

      // #292: never-silent visibility for the section-footer auto-inject (#168) — the SAME
      // eligibility check (isSectionFooterTarget) and the SAME "did binding leave it empty"
      // signal (plan.unfilled) that placeholder-filler.buildSlideXml / SlideCard actually use, so
      // this info diagnostic appears iff the injection would truly happen (R8, no 2nd judgment).
      const sectionFooterText = sectionFooterFor(deck, i);
      if (sectionFooterText != null) {
        for (const u of plan.unfilled) {
          const ph = layout.placeholders.find((p) => p.idx === u.idx);
          if (!ph || !isSectionFooterTarget(ph, layout.name)) continue;
          issues.push({
            slideIndex: i,
            title: slideTitle(slide),
            id: "section-footer-injected",
            level: RULE_LEVEL["section-footer-injected"],
            message: `章名フッタ「${sectionFooterText}」がこの枠（${ph.name}）に自動注入されます（明示 Footer: 未指定）`,
            levers: [],
          });
        }
      }
    });
  }

  return issues;
}

/** Turn the parser's ParseNotice[] (#148 — drops only IT could see, e.g. a dropped 2nd table) into
 *  DeckIssue[] so they read like every other diagnostic. Called at the point notices were captured
 *  (parse time) AND on every later re-read (the caller persists the result — deck-diagnostics itself
 *  has nothing left to reconstruct these from, per the ParseNotice module doc). */
export function parseNoticesToIssues(deck: DeckIR, notices: readonly SlideParseNotice[]): DeckIssue[] {
  return notices.map((n) => {
    const slide = deck.slides[n.slideIndex];
    const title = slide ? slideTitle(slide) : "";
    const base = { slideIndex: n.slideIndex, title, levers: [] as Lever[] };
    switch (n.kind) {
      case "table-dropped":
        return { ...base, id: "table-dropped" as const, level: RULE_LEVEL["table-dropped"], message: "2つ目以降の表（とその前後の内容）が変換時に失われました（ネイティブ表として保持されるのは1つのみ）" };
      case "image-dropped":
        return { ...base, id: "image-dropped" as const, level: RULE_LEVEL["image-dropped"], message: "画像記法（![alt](src)）を含む内容が2つ目以降の表と衝突し変換時に失われました" };
      case "meta-key-dropped":
        return { ...base, id: "meta-key-dropped" as const, level: RULE_LEVEL["meta-key-dropped"], message: `「${n.detail ?? "?"}:」等の認識されないメタキーを含む内容が2つ目以降の表と衝突し変換時に失われました（Category/Date/Footer のみ対応）` };
    }
  });
}

/** #148: turn distillDeckReport's `offsets` (offsets[k] = where ORIGINAL slide k's first resulting
 *  part landed) into one info DeckIssue per split — "this overflowing slide became N slides" — so an
 *  auto-split at intake (new_project) or via the `distill` lever isn't silent. `deck` must be the
 *  POST-split deck (title reads clean off the run's first slide — only continuations past it carry
 *  the "（続き）" marker).
 *
 *  MUST derive run boundaries from `offsets`, NOT by grouping `newIndices` into contiguous runs: two
 *  back-to-back ORIGINAL slides that both split produce ADJACENT post-split ranges (e.g. slide0→[0,1],
 *  slide1→[2,3]), so `newIndices=[0,1,2,3]` is indistinguishable, by contiguity alone, from ONE
 *  4-part split — offsets keeps each original slide's boundary explicit regardless of adjacency. */
export function splitInfoIssues(deck: DeckIR, offsets: readonly number[]): DeckIssue[] {
  const issues: DeckIssue[] = [];
  offsets.forEach((start, k) => {
    const end = k + 1 < offsets.length ? offsets[k + 1] : deck.slides.length;
    const count = end - start;
    if (count <= 1) return;
    issues.push({
      slideIndex: start,
      title: slideTitle(deck.slides[start]),
      level: "info",
      message: `スライドはテンプレ容量に収まらず ${count} 枚に分割されました`,
      levers: [],
    });
  });
  return issues;
}
