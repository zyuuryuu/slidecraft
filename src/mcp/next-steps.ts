/**
 * next-steps.ts — turn deck diagnostics into DETERMINISTIC "next-step" hints for the upstream AI
 * (Theme 3, S6). A hint maps a diagnosed issue to the ONE tool that fixes it — but only via a pure
 * issue→lever→tool table (no model, no ranking): same deck → same hints. It lives in src/mcp (not
 * src/engine) because it references MCP TOOL NAMES; keeping those out of the engine preserves purity
 * (R2). The deterministic-lever fixes (split, key-value → table) get a concrete tool + args; the
 * AI-authoring levers (condense / add-a-title) point at get_slide_fix_request, which packages the
 * constraints for the agent to fulfil AS the model. See docs/design/mcp-brushup.md §E.
 */
import type { DeckIssue } from "../engine/deck-diagnostics";

export interface NextStepHint {
  slideIndex: number;
  tool: "split_overflowing_slides" | "convert_bullets_to_table" | "get_slide_fix_request";
  reason: string;
  args?: { index: number };
}

/** Pure diagnostics → hints. Precedence per issue: overflow (split lever) → split (a deck-wide lever,
 *  emitted once); key-value (visualize lever, no split) → convert_bullets_to_table(index); long-bullets
 *  / missing-title (condense / title) → get_slide_fix_request(index). */
export function nextStepHints(issues: DeckIssue[]): NextStepHint[] {
  const hints: NextStepHint[] = [];
  let splitEmitted = false;
  for (const iss of issues) {
    if (iss.levers.includes("split")) {
      if (!splitEmitted) {
        hints.push({ slideIndex: iss.slideIndex, tool: "split_overflowing_slides", reason: iss.message });
        splitEmitted = true;
      }
    } else if (iss.levers.includes("visualize")) {
      hints.push({ slideIndex: iss.slideIndex, tool: "convert_bullets_to_table", reason: iss.message, args: { index: iss.slideIndex } });
    } else if (iss.levers.includes("condense") || iss.levers.includes("title")) {
      hints.push({ slideIndex: iss.slideIndex, tool: "get_slide_fix_request", reason: iss.message, args: { index: iss.slideIndex } });
    }
  }
  return hints;
}
