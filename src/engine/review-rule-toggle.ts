/**
 * review-rule-toggle.ts — Issue #247: レビュー規則の on/off（lint トグル）。
 *
 * 句読点（touten/kuten）のような規範は、配布資料など文体の違うデッキではノイズになる。利用者/上流 AI が
 * 規則を切れるよう、REVIEW_RULES（#244 の単一レジストリ）に「無効化」状態を重ねる。無効化した id の集合は
 * 呼び出し側（MCP セッション）が持ち、ここは純粋な射影だけを提供する（R2）。
 *
 * R8: guide の activeReviewRules（reviewRuleStates）と診断の間引き（withoutDisabledRules）は同じ
 * `disabled` 集合と同じ REVIEW_RULES から導く — off の規則は guide で level:"off"、診断には出ない。
 * 既定（空集合）は REVIEW_RULES そのもの・issues そのもの＝従来どおり。
 */
import { REVIEW_RULES, type DeckIssue, type ReviewRule, type ReviewRuleId } from "./deck-diagnostics";

export type ReviewRuleSwitch = "on" | "off";

/** guide 向けの規則状態：off の規則は level が "off" に置き換わる（id と順序は REVIEW_RULES のまま）。 */
export interface ReviewRuleState {
  id: ReviewRuleId;
  level: ReviewRule["level"] | "off";
}

/** 全規則 id（REVIEW_RULES の順）— MCP 入力の enum もここから作る（第 2 の id 列挙を持たない）。 */
export const REVIEW_RULE_IDS = REVIEW_RULES.map((r) => r.id) as [ReviewRuleId, ...ReviewRuleId[]];

export function reviewRuleStates(disabled: ReadonlySet<ReviewRuleId>): ReviewRuleState[] {
  return REVIEW_RULES.map((r) => ({ id: r.id, level: disabled.has(r.id) ? "off" : r.level }));
}

/** off の規則の issue を落とす。空集合なら入力配列をそのまま返す（既定の診断は byte-identical）。 */
export function withoutDisabledRules<T extends Pick<DeckIssue, "id">>(issues: T[], disabled: ReadonlySet<ReviewRuleId>): T[] {
  if (disabled.size === 0) return issues;
  return issues.filter((iss) => !(iss.id && disabled.has(iss.id)));
}

/** 無効化中の id を REVIEW_RULES の順で（出力を決定論にする）。 */
export function disabledRuleIds(disabled: ReadonlySet<ReviewRuleId>): ReviewRuleId[] {
  return REVIEW_RULE_IDS.filter((id) => disabled.has(id));
}
