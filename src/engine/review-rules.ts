/**
 * review-rules.ts — the review-rule registry of deck-diagnostics (#244), split out of deck-diagnostics.ts
 * for R1 (#593). deck-diagnostics re-exports REVIEW_RULES / ReviewRuleId / ReviewRule, so every consumer
 * keeps importing them from there. Pure (R2).
 */

/**
 * REVIEW_RULES — the ONE registry of review-rule id → level (#244). Every DeckIssue deck-diagnostics
 * produces sets `id` from here (via RULE_LEVEL, so the level literal itself is written ONCE), and
 * `get_authoring_guide`'s `activeReviewRules` (src/mcp/guides.ts) is a literal projection of this
 * same array — so the rules an agent is told about up front can never drift from what
 * `get_deck_issues` actually flags later (R8; locked by tests/review-rules-agreement.test.ts).
 */
export type ReviewRuleId =
  | "missing-title"
  | "unknown-layout-pin"
  | "touten-used"
  | "kuten-used"
  | "image-markdown-leftover"
  | "unrecognized-meta-key"
  | "body-overflow"
  | "title-overflow"
  | "long-bullet"
  | "key-value-table"
  | "unbound-content"
  | "visual-shadowed-content"
  | "visual-collision"
  | "table-overflow"
  | "diagram-node-shrink"
  | "diagram-invalid"
  | "table-dropped"
  | "image-dropped"
  | "meta-key-dropped"
  | "figure-dropped"
  | "pre-separator-dropped"
  | "section-footer-injected"
  | "missing-column-layout"
  | "field-row-rescued"
  | "marker-layout-missing";

export interface ReviewRule {
  id: ReviewRuleId;
  level: "warn" | "info";
}

export const REVIEW_RULES: readonly ReviewRule[] = [
  { id: "missing-title", level: "warn" },
  { id: "unknown-layout-pin", level: "warn" },
  { id: "touten-used", level: "warn" },
  { id: "kuten-used", level: "info" },
  { id: "image-markdown-leftover", level: "info" },
  { id: "unrecognized-meta-key", level: "warn" },
  { id: "body-overflow", level: "warn" },
  { id: "title-overflow", level: "warn" },
  { id: "long-bullet", level: "info" },
  { id: "key-value-table", level: "info" },
  { id: "unbound-content", level: "warn" },
  { id: "visual-shadowed-content", level: "warn" },
  { id: "visual-collision", level: "warn" },
  { id: "table-overflow", level: "warn" },
  { id: "diagram-node-shrink", level: "warn" },
  { id: "diagram-invalid", level: "warn" },
  { id: "table-dropped", level: "info" },
  { id: "image-dropped", level: "info" },
  { id: "meta-key-dropped", level: "warn" },
  { id: "figure-dropped", level: "info" },
  { id: "pre-separator-dropped", level: "warn" },
  { id: "section-footer-injected", level: "info" },
  { id: "missing-column-layout", level: "info" },
  { id: "field-row-rescued", level: "info" },
  { id: "marker-layout-missing", level: "info" },
];

export const RULE_LEVEL: Record<ReviewRuleId, "warn" | "info"> = Object.fromEntries(
  REVIEW_RULES.map((r) => [r.id, r.level]),
) as Record<ReviewRuleId, "warn" | "info">;
