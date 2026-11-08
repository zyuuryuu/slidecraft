// #663 — `stage-llamafile.mjs` gave up on the FIRST failed download, so a transient 504 from GitHub
// Releases turned the CI `build` job red (PR #656/#657/#658 on 2026-11-08). The download now retries
// with exponential backoff, but ONLY on transient failures (5xx / connection errors). A 4xx is a real
// error (wrong URL / pinned asset missing) and a SHA256 mismatch must fail closed — neither is retried.
import { describe, it, expect } from "vitest";
import { isRetryableStatus, backoffMs, downloadWithRetry } from "../scripts/download-retry.mjs";

const URL_ = "https://example.invalid/llamafile-0.10.3-thin";

/** A fake fetch that plays back a script of responses; each entry is a status code or an Error to throw. */
function scriptedFetch(script: Array<number | Error>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step instanceof Error) throw step;
    return new Response(step === 200 ? new Uint8Array([1, 2, 3]) : "err", {
      status: step,
      statusText: step === 504 ? "Gateway Time-out" : "",
    });
  };
  return { impl, calls };
}

function recordingSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => void waits.push(ms), waits };
}

describe("isRetryableStatus (#663)", () => {
  it("5xx is transient → retry", () => {
    for (const s of [500, 502, 503, 504, 599]) expect(isRetryableStatus(s)).toBe(true);
  });
  it("4xx is a real error → no retry", () => {
    for (const s of [400, 403, 404, 410, 429]) expect(isRetryableStatus(s)).toBe(false);
  });
  it("2xx / 3xx are not failures to retry", () => {
    for (const s of [200, 301, 302]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe("backoffMs (#663)", () => {
  it("doubles from the base: 2s, 4s, 8s", () => {
    expect([0, 1, 2].map((i) => backoffMs(i))).toEqual([2000, 4000, 8000]);
  });
  it("honours a custom base", () => {
    expect([0, 1, 2].map((i) => backoffMs(i, 100))).toEqual([100, 200, 400]);
  });
});

describe("downloadWithRetry (#663)", () => {
  it("returns the body on the first success without sleeping", async () => {
    const f = scriptedFetch([200]);
    const s = recordingSleep();
    const buf = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, log: () => {} });
    expect([...buf]).toEqual([1, 2, 3]);
    expect(f.calls).toHaveLength(1);
    expect(s.waits).toEqual([]);
  });

  it("retries a 504 with 2s/4s backoff and succeeds", async () => {
    const f = scriptedFetch([504, 504, 200]);
    const s = recordingSleep();
    const buf = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, log: () => {} });
    expect([...buf]).toEqual([1, 2, 3]);
    expect(f.calls).toHaveLength(3);
    expect(s.waits).toEqual([2000, 4000]);
  });

  it("retries a connection error (fetch throws)", async () => {
    const f = scriptedFetch([new TypeError("fetch failed"), 200]);
    const s = recordingSleep();
    const buf = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, log: () => {} });
    expect([...buf]).toEqual([1, 2, 3]);
    expect(f.calls).toHaveLength(2);
    expect(s.waits).toEqual([2000]);
  });

  it("gives up after 3 retries (4 attempts) and names the URL, the cause and that a re-run usually fixes it", async () => {
    const f = scriptedFetch([504]);
    const s = recordingSleep();
    const err = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, log: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(f.calls).toHaveLength(4);
    expect(s.waits).toEqual([2000, 4000, 8000]);
    expect(err.message).toContain(URL_);
    expect(err.message).toContain("504 Gateway Time-out");
    expect(err.message).toMatch(/after 4 attempts/);
    expect(err.message).toMatch(/re-run/i);
  });

  it("fails a 4xx immediately, without retrying", async () => {
    const f = scriptedFetch([404]);
    const s = recordingSleep();
    const err = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, log: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(f.calls).toHaveLength(1);
    expect(s.waits).toEqual([]);
    expect(err.message).toContain(URL_);
    expect(err.message).toContain("404");
  });

  it("does NOT retry when verification (SHA256) rejects the body — fails closed with verify's error", async () => {
    const f = scriptedFetch([200]);
    const s = recordingSleep();
    const verify = () => {
      throw new Error("SHA256 mismatch");
    };
    const err = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, verify, log: () => {} }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("SHA256 mismatch");
    expect(f.calls).toHaveLength(1);
    expect(s.waits).toEqual([]);
  });

  it("honours a custom retry count", async () => {
    const f = scriptedFetch([503]);
    const s = recordingSleep();
    const err = await downloadWithRetry(URL_, { fetchImpl: f.impl, sleep: s.sleep, retries: 1, log: () => {} }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(f.calls).toHaveLength(2);
    expect(s.waits).toEqual([2000]);
  });
});
