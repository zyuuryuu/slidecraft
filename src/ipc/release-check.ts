/**
 * release-check.ts — polls GitHub Releases for a newer published version than the running app
 * (Issue #113 / ADR-0021 follow-up: notify-only, no auto-download/signing). Dual-mode via appFetch
 * (ADR-0001): desktop routes through tauri-plugin-http, browser uses native fetch — same call site
 * either way. Egress is pinned to api.github.com specifically (ADR-0010 — CSP connect-src allowlists
 * this one host; no broad grant added for this feature).
 */
import { appFetch } from "./app-fetch";
import { APP_VERSION } from "./app-version";
import { evaluateUpdate } from "../engine/release-version";

const RELEASES_URL = "https://api.github.com/repos/zyuuryuu/slidecraft/releases/latest";

/** Fetch the latest PUBLISHED (GitHub excludes drafts/prereleases from this endpoint) release tag.
 *  Throws on any failure — checkForUpdate is the non-throwing wrapper callers should use. */
export async function fetchLatestReleaseTag(): Promise<string> {
  const res = await appFetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub Releases API HTTP ${res.status}`);
  const json = (await res.json()) as { tag_name?: unknown };
  if (typeof json.tag_name !== "string" || !json.tag_name) throw new Error("GitHub Releases API: missing tag_name");
  return json.tag_name;
}

export type UpdateCheckResult =
  | { status: "update-available"; latestVersion: string }
  | { status: "current" }
  | { status: "error"; error: string };

/** Never throws — every failure mode (network, HTTP, malformed JSON, unparseable tag) resolves to
 *  {status:"error"} so a flaky/offline poll never crashes the app or shows a false "update available".
 *  Never-silent: the error is real and returned, not swallowed — callers choose to hide the banner
 *  on it, which is a UX decision, not a lost failure. */
export async function checkForUpdate(currentVersion: string = APP_VERSION): Promise<UpdateCheckResult> {
  let tag: string;
  try {
    tag = await fetchLatestReleaseTag();
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
  const verdict = evaluateUpdate(currentVersion, tag);
  if (verdict.kind === "update-available") return { status: "update-available", latestVersion: verdict.latest };
  if (verdict.kind === "current") return { status: "current" };
  return { status: "error", error: `unparseable version: current="${currentVersion}" latest tag="${tag}"` };
}
