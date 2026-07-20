/**
 * onboarding-state.ts — the pure show/hide decision + localStorage persistence behind
 * useOnboarding (Issue #259). Same flavor as update-banner-state.ts (Issue #113): framework-free
 * so it's directly testable (this repo's hooks aren't renderHook-tested). Unlike the update
 * banner's per-version dismissal, this is a single version-independent flag (#236 と同じ流儀).
 */
export const ONBOARDING_SKIP_KEY = "slidecraft_onboarding_skip";

/** Show the first-run panel unless the user checked "次回以降表示しない". */
export function shouldShowOnboarding(skipped: boolean): boolean {
  return !skipped;
}

export function loadOnboardingSkip(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ONBOARDING_SKIP_KEY) === "1";
}

export function saveOnboardingSkip(skip: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (skip) localStorage.setItem(ONBOARDING_SKIP_KEY, "1");
  else localStorage.removeItem(ONBOARDING_SKIP_KEY);
}
