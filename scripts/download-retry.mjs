// download-retry.mjs — the side-effect-free part of staging a pinned sidecar download (#663): fetch with
// exponential-backoff retry on TRANSIENT failures only. Split out of stage-llamafile.mjs so tests can drive
// it with a fake fetch / sleep (no network, no waiting).
//
// Retry policy:
//   - 5xx status and connection errors (fetch throws, or the body stream breaks) → transient → retry.
//   - 4xx status → a real error (wrong URL, pinned asset gone) → fail immediately.
//   - `verify(buf)` throwing (e.g. SHA256 mismatch) → fail closed immediately; a hostile or corrupted
//     payload is never "retried until it looks fine" (ADR-0017 pinned + verified download).

/** True when an HTTP status is a transient server-side failure worth retrying (5xx only). */
export function isRetryableStatus(status) {
  return status >= 500 && status <= 599;
}

/** Backoff before retry #`retryIndex` (0-based): base, 2·base, 4·base … — 2s/4s/8s by default. */
export function backoffMs(retryIndex, baseMs = 2000) {
  return baseMs * 2 ** retryIndex;
}

const TRANSIENT_HINT =
  "This is usually a transient upstream error (e.g. GitHub Releases returning 5xx) — re-running the job usually fixes it.";

/**
 * Download `url` into a Buffer, retrying transient failures up to `retries` times (default 3 → 4 attempts).
 * `verify(buf)` runs on each successful body; if it throws, that error is rethrown as-is with no retry.
 * Throws an Error whose message names the URL (and, for transient exhaustion, the re-run hint).
 */
export async function downloadWithRetry(
  url,
  { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 3, baseMs = 2000, verify, log = console.warn } = {},
) {
  const attempts = retries + 1;
  let lastCause = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const wait = backoffMs(attempt - 1, baseMs);
      log(`  ${lastCause} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${attempts}) ...`);
      await sleep(wait);
    }
    let buf;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        const status = `${res.status} ${res.statusText}`.trim();
        if (!isRetryableStatus(res.status)) {
          throw new PermanentError(`download failed: ${status}\n  url: ${url}`);
        }
        lastCause = status;
        continue;
      }
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof PermanentError) throw new Error(e.message);
      lastCause = `connection error: ${e?.cause?.code ?? e?.message ?? String(e)}`;
      continue;
    }
    if (verify) verify(buf); // throws → propagates; never retried
    return buf;
  }
  throw new Error(`download failed after ${attempts} attempts: ${lastCause}\n  url: ${url}\n  ${TRANSIENT_HINT}`);
}

class PermanentError extends Error {}
