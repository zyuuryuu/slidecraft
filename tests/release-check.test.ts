/**
 * release-check.test.ts — the GitHub Releases polling layer (Issue #113 / ADR-0021 follow-up).
 * appFetch is mocked so this never touches the network (see release-check-live.test.ts for the
 * real-polling smoke test). Covers: update found, same version, and every failure mode collapsing
 * to a non-throwing {status:"error"} result (never-silent — the failure is real and inspectable,
 * just never surfaces as a false "update available").
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/ipc/app-fetch", () => ({ appFetch: vi.fn() }));

import { appFetch } from "../src/ipc/app-fetch";
import { fetchLatestReleaseTag, checkForUpdate } from "../src/ipc/release-check";

const mockedFetch = vi.mocked(appFetch);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  mockedFetch.mockReset();
});

describe("fetchLatestReleaseTag", () => {
  it("hits the GitHub Releases 'latest' endpoint and returns tag_name", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: "v0.4.0" }));
    await expect(fetchLatestReleaseTag()).resolves.toBe("v0.4.0");
    const [url] = mockedFetch.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/zyuuryuu/slidecraft/releases/latest");
  });

  it("throws on a non-OK HTTP response", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({}, false, 404));
    await expect(fetchLatestReleaseTag()).rejects.toThrow(/404/);
  });

  it("throws when the response has no usable tag_name (malformed API shape)", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: null }));
    await expect(fetchLatestReleaseTag()).rejects.toThrow();
  });
});

describe("checkForUpdate — never throws, never silently drops a failure", () => {
  it("newer published release → update-available", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: "v0.9.0" }));
    await expect(checkForUpdate("0.3.0")).resolves.toEqual({ status: "update-available", latestVersion: "0.9.0" });
  });

  it("same version as the latest release → current", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: "v0.3.0" }));
    await expect(checkForUpdate("0.3.0")).resolves.toEqual({ status: "current" });
  });

  it("network failure (fetch rejects) → status 'error' with a real message, not a thrown exception", async () => {
    mockedFetch.mockRejectedValue(new Error("network unreachable"));
    const result = await checkForUpdate("0.3.0");
    expect(result.status).toBe("error");
    expect(result).toMatchObject({ error: expect.stringContaining("network unreachable") });
  });

  it("HTTP failure (rate-limited / not found) → status 'error', not a crash", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({}, false, 403));
    const result = await checkForUpdate("0.3.0");
    expect(result.status).toBe("error");
  });

  it("malformed tag from the API → status 'error' (unparseable, never a false positive)", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ tag_name: "not-a-semver-tag" }));
    const result = await checkForUpdate("0.3.0");
    expect(result.status).toBe("error");
  });
});
