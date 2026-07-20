/**
 * useUpdateBanner — polls GitHub Releases (Issue #113 / ADR-0021 follow-up) on mount + every 12h,
 * and surfaces a dismissible "new version available" banner. Dismissal is remembered PER VERSION
 * (localStorage), so dismissing v0.4.0 doesn't also suppress a later v0.5.0 notice.
 *
 * The show/hide decision itself is a plain function (shouldShowUpdateBanner, update-banner-state.ts)
 * so it's unit-tested directly — this hook is just the useEffect/localStorage wiring around it (this
 * repo's hooks aren't renderHook-tested).
 */
import { useCallback, useEffect, useState } from "react";
import { checkForUpdate } from "../ipc/release-check";
import { shouldShowUpdateBanner } from "./update-banner-state";

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h — frequent enough to notice a release, not chatty
const DISMISSED_KEY = "slidecraft_update_dismissed_version";

function loadDismissed(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(DISMISSED_KEY);
}

function saveDismissed(version: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DISMISSED_KEY, version);
}

export function useUpdateBanner(): { show: boolean; latestVersion: string | null; dismiss: () => void } {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => loadDismissed());

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      checkForUpdate().then((result) => {
        if (cancelled) return;
        setLatestVersion(result.status === "update-available" ? result.latestVersion : null);
      });
    };
    poll();
    const id = setInterval(poll, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!latestVersion) return;
    saveDismissed(latestVersion);
    setDismissed(latestVersion);
  }, [latestVersion]);

  const result = latestVersion ? ({ status: "update-available", latestVersion } as const) : ({ status: "current" } as const);
  return { show: shouldShowUpdateBanner(result, dismissed), latestVersion, dismiss };
}
