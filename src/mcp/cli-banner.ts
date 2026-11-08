/**
 * cli-banner.ts — the one stderr line cli.ts prints once it knows its mode, and the parser `--doctor` uses
 * to read that line back from the child it spawned (#517 子 4). Format and parse live side by side so the
 * mode a diagnosis reports is the mode the server announced — one meaning, one place (R8; the round trip is
 * pinned in tests/mcp-doctor.test.ts). The text is byte-identical to the pre-#517 cli.ts lines.
 */

const SOLO_PREFIX = "slidecraft mcp: ready (solo stdio, ";
const FORWARD_PREFIX = "slidecraft mcp: forwarding to live host at ";
const ROOT_MARK = "scoped fs — root=";
const METRICS_MARK = ", metrics → ";

export function soloReadyBanner(root: string | null, metricsPath: string | undefined): string {
  return `${SOLO_PREFIX}${root ? `${ROOT_MARK}${root}` : "--no-fs / base64"}${metricsPath ? `${METRICS_MARK}${metricsPath}` : ""})\n`;
}

export function forwardBanner(url: string): string {
  return `${FORWARD_PREFIX}${url}\n`;
}

export type ModeBanner =
  | { kind: "solo"; root: string | null }
  | { kind: "forward"; url: string }
  /** No mode line (the server exited before announcing, or output was cut). */
  | { kind: "unknown" };

/** The mode announced anywhere in `stderr` (other lines — notes, warnings — are ignored). */
export function parseModeBanner(stderr: string): ModeBanner {
  for (const line of stderr.split(/\r?\n/)) {
    if (line.startsWith(FORWARD_PREFIX)) return { kind: "forward", url: line.slice(FORWARD_PREFIX.length) };
    if (line.startsWith(SOLO_PREFIX) && line.endsWith(")")) {
      const body = line.slice(SOLO_PREFIX.length, -1);
      if (!body.startsWith(ROOT_MARK)) return { kind: "solo", root: null };
      const rest = body.slice(ROOT_MARK.length);
      const m = rest.lastIndexOf(METRICS_MARK);
      return { kind: "solo", root: m === -1 ? rest : rest.slice(0, m) };
    }
  }
  return { kind: "unknown" };
}
