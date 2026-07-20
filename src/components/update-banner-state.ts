/**
 * update-banner-state.ts — the pure show/hide decision behind useUpdateBanner (Issue #113).
 * Framework-free so it's directly testable (this repo's hooks aren't renderHook-tested; the state
 * logic is pulled out into a plain function instead — see gui-serialize-binding-plan.test.ts).
 */
import type { UpdateCheckResult } from "../ipc/release-check";

/** Show the banner only for a genuine, not-yet-dismissed update. "current" and "error" both hide it
 *  (a failed poll must never surface as a scary/wrong banner — see release-check.ts's never-silent
 *  note: the error itself isn't lost, it's just not this component's job to display it). */
export function shouldShowUpdateBanner(result: UpdateCheckResult, dismissedVersion: string | null): boolean {
  return result.status === "update-available" && result.latestVersion !== dismissedVersion;
}
