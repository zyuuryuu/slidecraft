/**
 * useDeckRefine — drives the Harness-directed AI loop (ROADMAP "①③の交点", stage C)
 * from the Edit surface. Wraps the pure engine core [[refine]] with React state: it
 * runs the loop, holds the resulting PROPOSAL for review (before→after per slide),
 * and applies it as ONE undoable deck commit only on 採用 — AI edits are never
 * applied blind. The AI itself is injected (ai.runOnce) so the loop stays the same
 * "制約＋診断 ⇄ AI" contract the engine defines, re-usable later by stage D (MCP).
 */

import { useCallback, useState } from "react";
import { refineDeck, type RefineLevel, type RefineResult, type AiSlideFix } from "../engine/refine";
import type { DeckIR } from "../engine/slide-schema";
import type { LayoutCatalog } from "../engine/template-catalog";
import type { HistoryMode } from "./useHistoryState";

interface RefineDeps {
  deck: DeckIR | null;
  catalog: LayoutCatalog | undefined;
  setDeck: (deck: DeckIR, mode: HistoryMode) => void;
  aiFix: AiSlideFix; // ai.runOnce(req, "slide")
  aiReady: boolean; // ai.connection.ok — gates the Lv3 AI pass
}

export function useDeckRefine({ deck, catalog, setDeck, aiFix, aiReady }: RefineDeps) {
  const [refining, setRefining] = useState(false);
  const [proposal, setProposal] = useState<RefineResult | null>(null);
  const [refineError, setRefineError] = useState<string | null>(null);

  const runRefine = useCallback(
    async (level: RefineLevel) => {
      if (!deck || !catalog || refining) return;
      setRefineError(null);
      setRefining(true);
      try {
        const result = await refineDeck(deck, catalog, {
          level,
          // Lv3 only engages the AI when a provider is actually configured; otherwise
          // the loop runs deterministic-only and reports what still needs the AI.
          aiFix: level >= 3 && aiReady ? aiFix : undefined,
        });
        setProposal(result);
      } catch (e) {
        setRefineError(e instanceof Error ? e.message : String(e));
      } finally {
        setRefining(false);
      }
    },
    [deck, catalog, refining, aiReady, aiFix],
  );

  const acceptProposal = useCallback(() => {
    if (proposal && proposal.changes.length > 0) setDeck(proposal.deck, "commit");
    setProposal(null);
  }, [proposal, setDeck]);

  const cancelProposal = useCallback(() => setProposal(null), []);

  return { refining, proposal, refineError, runRefine, acceptProposal, cancelProposal };
}
