/**
 * mcpb-download.test.ts — the 協働 panel's "Claude Desktop: .mcpb をダウンロード" link (#517 子 3).
 * It reuses release-check.ts's one GitHub Releases request (`fetchLatestRelease`, the same endpoint the
 * update notice polls) and picks THIS OS's bundle from the latest published release. Every outcome is
 * stated (never-silent): available / the latest release has no bundle yet / no Claude Desktop on this OS /
 * the lookup failed (reason kept). appFetch is mocked — no network.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/ipc/app-fetch", () => ({ appFetch: vi.fn() }));

import { appFetch } from "../src/ipc/app-fetch";
import { fetchLatestRelease, fetchLatestReleaseTag } from "../src/ipc/release-check";
import { pickMcpbDownload, lookupMcpbDownload, MCPB_DOWNLOAD_PREFIX } from "../src/ipc/mcpb-asset";

const mockedFetch = vi.mocked(appFetch);
const jsonResponse = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as unknown as Response;
const dl = (name: string, tag = "v0.6.0") => ({ name, browser_download_url: `${MCPB_DOWNLOAD_PREFIX}${tag}/${name}` });

afterEach(() => mockedFetch.mockReset());

describe("fetchLatestRelease — one request, tag + assets", () => {
  it("returns the tag and each asset's name + download URL; the tag-only helper is the same request", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: "v0.6.0", assets: [dl("slidecraft-win32-x64.mcpb"), { name: 3 }] }));
    await expect(fetchLatestRelease()).resolves.toEqual({
      tag: "v0.6.0",
      assets: [{ name: "slidecraft-win32-x64.mcpb", url: `${MCPB_DOWNLOAD_PREFIX}v0.6.0/slidecraft-win32-x64.mcpb` }],
    });
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: "v0.6.0" }));
    await expect(fetchLatestReleaseTag()).resolves.toBe("v0.6.0");
    expect(String(mockedFetch.mock.calls[1][0])).toBe("https://api.github.com/repos/zyuuryuu/slidecraft/releases/latest");
  });
});

describe("pickMcpbDownload — this OS's bundle from the latest release", () => {
  const release = { tag: "v0.6.0", assets: [dl("slidecraft-darwin-arm64.mcpb"), dl("slidecraft-win32-x64.mcpb"), dl("SlideCraft_0.6.0_x64-setup.exe")].map((a) => ({ name: a.name, url: a.browser_download_url })) };

  it("Windows → the win32-x64 bundle", () => {
    expect(pickMcpbDownload(release, "windows")).toEqual({
      kind: "available", tag: "v0.6.0", name: "slidecraft-win32-x64.mcpb", url: `${MCPB_DOWNLOAD_PREFIX}v0.6.0/slidecraft-win32-x64.mcpb`,
    });
  });
  it("macOS → the darwin-arm64 bundle", () => {
    expect(pickMcpbDownload(release, "macos")).toMatchObject({ kind: "available", name: "slidecraft-darwin-arm64.mcpb" });
  });
  it("Linux has no Claude Desktop → unsupported (not a broken link)", () => {
    expect(pickMcpbDownload(release, "linux")).toEqual({ kind: "unsupported" });
  });
  it("a release from before .mcpb existed → missing, naming the tag and the expected file", () => {
    expect(pickMcpbDownload({ tag: "v0.5.1", assets: [] }, "windows")).toEqual({ kind: "missing", tag: "v0.5.1", name: "slidecraft-win32-x64.mcpb" });
  });
  it("refuses a download URL outside this repository's release downloads (the opener allowlist)", () => {
    const bad = { tag: "v0.6.0", assets: [{ name: "slidecraft-win32-x64.mcpb", url: "https://evil.example/slidecraft-win32-x64.mcpb" }] };
    expect(pickMcpbDownload(bad, "windows")).toEqual({ kind: "error", error: expect.stringContaining("https://evil.example/") });
  });
});

describe("lookupMcpbDownload — never throws", () => {
  it("a failed request becomes {kind:'error'} with the reason", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({}, false, 503));
    await expect(lookupMcpbDownload("windows")).resolves.toEqual({ kind: "error", error: expect.stringContaining("503") });
  });
  it("Linux answers unsupported without any request", async () => {
    await expect(lookupMcpbDownload("linux")).resolves.toEqual({ kind: "unsupported" });
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("opener capability allows exactly the release-download prefix", () => {
  it("default capability lists the prefix the picker accepts", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "../src-tauri/capabilities");
    const all = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(all).toContain(`"${MCPB_DOWNLOAD_PREFIX}**"`);
  });
});
