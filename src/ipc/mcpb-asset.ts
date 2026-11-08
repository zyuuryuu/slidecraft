/**
 * mcpb-asset.ts — the 協働 panel's "Claude Desktop: .mcpb をダウンロード" link (#517 子 3). Finds THIS OS's
 * bundle in the latest published release via release-check.ts's existing GitHub Releases request (the one the
 * update notice uses — same endpoint, same egress allowlist, ADR-0010). Never throws: every outcome is a
 * value the panel states (never-silent) — there is deliberately no "hide the link" outcome.
 *
 * The asset name rule mirrors scripts/mcpb-manifest.mjs `mcpbAssetName` (what release.yml uploads);
 * tests/mcpb-bundle.test.ts pins the two against each other (R8).
 */
import type { InstallOs } from "./mcp-install";
import { fetchLatestRelease, type LatestRelease } from "./release-check";
import { runningInTauri } from "./commands";

/** Only links under this prefix are opened (src-tauri/capabilities opener allowlist lists the same prefix). */
export const MCPB_DOWNLOAD_PREFIX = "https://github.com/zyuuryuu/slidecraft/releases/download/";

/** The release asset for this OS, or null where Claude Desktop does not exist (Linux). */
export function mcpbAssetNameFor(os: InstallOs): string | null {
  if (os === "macos") return "slidecraft-darwin-arm64.mcpb";
  if (os === "windows") return "slidecraft-win32-x64.mcpb";
  return null;
}

export type McpbDownload =
  | { kind: "available"; tag: string; name: string; url: string }
  /** The latest release has no bundle for this OS (e.g. a release from before .mcpb existed). */
  | { kind: "missing"; tag: string; name: string }
  /** No Claude Desktop on this OS. */
  | { kind: "unsupported" }
  | { kind: "error"; error: string };

export function pickMcpbDownload(release: LatestRelease, os: InstallOs): McpbDownload {
  const name = mcpbAssetNameFor(os);
  if (!name) return { kind: "unsupported" };
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) return { kind: "missing", tag: release.tag, name };
  if (!asset.url.startsWith(MCPB_DOWNLOAD_PREFIX)) return { kind: "error", error: `unexpected download URL for ${name}: ${asset.url}` };
  return { kind: "available", tag: release.tag, name, url: asset.url };
}

export async function lookupMcpbDownload(os: InstallOs): Promise<McpbDownload> {
  if (!mcpbAssetNameFor(os)) return { kind: "unsupported" };
  try {
    return pickMcpbDownload(await fetchLatestRelease(), os);
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Open a bundle download in the user's browser (desktop: the opener plugin, allowlisted to this prefix only).
 *  Resolves false — never throws — when it could not open, so the panel can show the URL instead. */
export async function openMcpbDownload(url: string): Promise<boolean> {
  if (!url.startsWith(MCPB_DOWNLOAD_PREFIX)) return false;
  if (runningInTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return true;
    } catch {
      return false;
    }
  }
  // Not the "noopener" feature string: with it window.open always returns null, so success could not be told apart.
  const w = typeof window !== "undefined" && typeof window.open === "function" ? window.open(url, "_blank") : null;
  if (w) w.opener = null;
  return !!w;
}
