/**
 * useOnboarding — first-run orientation panel (Issue #259). Shows once until the user checks
 * "次回以降表示しない"; the flag is a single version-independent localStorage bool (#236 と同じ流儀,
 * see useUpdateBanner.ts for the analogous per-version pattern this is simplified from).
 *
 * The show/hide decision is the plain shouldShowOnboarding() (onboarding-state.ts) so it's unit-
 * tested directly — this hook is just the useState/localStorage wiring around it.
 */
import { useCallback, useState } from "react";
import { loadOnboardingSkip, saveOnboardingSkip, shouldShowOnboarding } from "./onboarding-state";

export function useOnboarding(): { show: boolean; dismiss: (skipNextTime: boolean) => void } {
  const [skipped, setSkipped] = useState(() => loadOnboardingSkip());
  // Picking a start action (or closing) hides the panel for THIS session even when the
  // checkbox is left unchecked; only checking it persists the skip so it stays hidden next launch.
  const [dismissed, setDismissed] = useState(false);

  const dismiss = useCallback((skipNextTime: boolean) => {
    if (skipNextTime) {
      saveOnboardingSkip(true);
      setSkipped(true);
    }
    setDismissed(true);
  }, []);

  return { show: !dismissed && shouldShowOnboarding(skipped), dismiss };
}
