/**
 * update-banner-state.test.ts — the pure show/hide decision behind useUpdateBanner (Issue #113).
 * This repo's convention is hooks aren't renderHook-tested; the state logic is pulled into a plain
 * function and driven directly (see gui-serialize-binding-plan.test.ts's header note).
 */
import { describe, it, expect } from "vitest";
import { shouldShowUpdateBanner } from "../src/components/update-banner-state";

describe("shouldShowUpdateBanner", () => {
  it("shows when an update is available and not yet dismissed", () => {
    expect(shouldShowUpdateBanner({ status: "update-available", latestVersion: "0.4.0" }, null)).toBe(true);
  });
  it("hides once the user dismissed THIS version", () => {
    expect(shouldShowUpdateBanner({ status: "update-available", latestVersion: "0.4.0" }, "0.4.0")).toBe(false);
  });
  it("re-shows for a NEWER version even if an older one was dismissed", () => {
    expect(shouldShowUpdateBanner({ status: "update-available", latestVersion: "0.5.0" }, "0.4.0")).toBe(true);
  });
  it("hides when already current (no banner for a non-event)", () => {
    expect(shouldShowUpdateBanner({ status: "current" }, null)).toBe(false);
  });
  it("hides on a failed check — never-silent means the caller still gets the error, but no banner", () => {
    expect(shouldShowUpdateBanner({ status: "error", error: "network unreachable" }, null)).toBe(false);
  });
});
