/**
 * host-options.ts — what the collab sidecar may be told at launch (#727, 統括補記 2026-11-23). The always-on
 * host listens on LOOPBACK ONLY (ADR-0009/0010/0040 "採らないもの": no network access): no option, environment
 * variable or argument can move the bind address to 0.0.0.0 / a LAN address. A future "connect from another
 * machine" request needs its own ADR — not a flag here.
 */
export const LOOPBACK_BIND = "127.0.0.1";

/** The one accepted bind address. Anything else is refused loudly (never silently rewritten to loopback, so a
 *  caller that asked for 0.0.0.0 learns it cannot have it). */
export function resolveBindHost(requested: string | undefined): string {
  if (requested === undefined || requested === LOOPBACK_BIND) return LOOPBACK_BIND;
  throw new Error(`collab host binds to ${LOOPBACK_BIND} only (requested: ${JSON.stringify(requested)})`);
}

export interface SidecarEnvOptions {
  port: number;
  hostJsonPath: string | null;
  metricsPath: string | null;
}

/** The sidecar's options from its environment. Deliberately has NO bind-address key: the host is always
 *  127.0.0.1 (resolveBindHost's default). */
export function hostOptionsFromEnv(env: Record<string, string | undefined>): SidecarEnvOptions {
  return {
    port: Number(env.SLIDECRAFT_PORT ?? 5174),
    hostJsonPath: env.SLIDECRAFT_HOST_JSON ?? null,
    // #512: opt-in local JSONL call log (no egress). Unset/empty = OFF.
    metricsPath: env.SLIDECRAFT_MCP_METRICS || null,
  };
}
