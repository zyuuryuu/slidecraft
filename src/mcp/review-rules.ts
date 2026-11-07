/**
 * review-rules.ts — Issue #247: MCP `set_review_rules`（レビュー規則の on/off）。
 *
 * 置き場は MCP パラメータ＝セッション（doc）単位の状態 `Session.disabledReviewRules`。deck 構造
 * （schema.ts / DeckIR）には入れない（R4 回避）ので save_project / export には載らず、deck の rev / undo
 * 履歴にも入らない（診断の見え方の設定であって内容の編集ではない）。状態の射影は engine の
 * review-rule-toggle.ts が単一源（R8）：get_deck_issues はそこで間引き、get_authoring_guide の
 * activeReviewRules はそこで level:"off" を付ける。
 */
import type { Session } from "./session";
import type { ReviewRuleId } from "../engine/deck-diagnostics";
import { REVIEW_RULE_IDS, disabledRuleIds, reviewRuleStates, type ReviewRuleSwitch } from "../engine/review-rule-toggle";
import { GuardError } from "./guard-errors";

/** rules に書いた id だけを on/off に切り替える（書かない id は現状維持）。同じ状態の再指定は changed:false。
 *  未知の id は 1 つでもあれば何も変えずに never-silent 拒否（invalid-argument）。id の検証を inputSchema の
 *  enum でなくここで行うのは、21 個の id を tools/list の固定費（毎セッション送信）に載せないため —
 *  id 一覧は get_authoring_guide の activeReviewRules が既に語っている（ADR-0037 D2/D3）。 */
export function setReviewRules(s: Session, rules: Record<string, ReviewRuleSwitch>) {
  const known = new Set<string>(REVIEW_RULE_IDS);
  const unknown = Object.keys(rules).filter((id) => !known.has(id));
  if (unknown.length) {
    throw new GuardError(`未知のレビュー規則 id: ${unknown.join(", ")}（有効な id は get_authoring_guide の activeReviewRules）`, "invalid-argument");
  }
  const before = disabledRuleIds(s.disabledReviewRules).join(",");
  for (const [id, sw] of Object.entries(rules) as Array<[ReviewRuleId, ReviewRuleSwitch]>) {
    if (sw === "off") s.disabledReviewRules.add(id);
    else if (sw === "on") s.disabledReviewRules.delete(id);
  }
  const disabledReviewRules = disabledRuleIds(s.disabledReviewRules);
  return {
    ok: true as const,
    changed: disabledReviewRules.join(",") !== before,
    disabledReviewRules,
    activeReviewRules: reviewRuleStates(s.disabledReviewRules),
  };
}
