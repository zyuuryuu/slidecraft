/**
 * onboarding-state.test.ts — the pure show/hide decision + localStorage persistence behind
 * useOnboarding (Issue #259). This repo's convention is hooks aren't renderHook-tested; the
 * state logic is pulled into plain functions and driven directly (see update-banner-state.test.ts).
 * localStorage is shimmed for the node test env (see key-store.test.ts for the same pattern).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { shouldShowOnboarding, loadOnboardingSkip, saveOnboardingSkip, ONBOARDING_SKIP_KEY } from "../src/components/onboarding-state";

describe("shouldShowOnboarding", () => {
  it("shows on first run (no skip flag set)", () => {
    expect(shouldShowOnboarding(false)).toBe(true);
  });
  it("hides once the user checked 次回以降表示しない", () => {
    expect(shouldShowOnboarding(true)).toBe(false);
  });
});

describe("onboarding skip flag — localStorage persistence", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    // Minimal in-memory localStorage shim for the node test env.
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("defaults to false (panel shows) when nothing is saved yet", () => {
    expect(loadOnboardingSkip()).toBe(false);
  });

  it("persists true across loads once saved", () => {
    saveOnboardingSkip(true);
    expect(localStorage.getItem(ONBOARDING_SKIP_KEY)).toBe("1");
    expect(loadOnboardingSkip()).toBe(true);
  });

  it("un-saving (false) clears the key rather than leaving a stale value behind", () => {
    saveOnboardingSkip(true);
    saveOnboardingSkip(false);
    expect(localStorage.getItem(ONBOARDING_SKIP_KEY)).toBeNull();
    expect(loadOnboardingSkip()).toBe(false);
  });
});
