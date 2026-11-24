/**
 * approval-tools.ts — #727 (ADR-0040 D1/D3-8): the GUI-only tools through which the human answers client
 * approval and the GUI hands its deck seed state to the host. They ride the GUI connection (GUI token, #730),
 * so no AI client can approve itself, and the keychain grants come IN over this port — never via argv.
 * Registered for the collab-gui profile only (tool-profiles.ts). A host without an approval port (a caller that
 * skipped it) refuses never-silently with host-mode-required, like register_templates without a registry.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApprovalPort } from "./host-approval";
import { GuardError } from "./guard-errors";
import { run } from "./tool-result";

export function registerApprovalTools(tool: McpServer["registerTool"], host: { approvals?: ApprovalPort }): void {
  const port = (): ApprovalPort => {
    if (!host.approvals) throw new GuardError("この接続には承認の口がありません（協働ホストの GUI 接続でのみ使えます）。", "host-mode-required");
    return host.approvals;
  };
  tool(
    "list_client_approvals",
    { description: "（GUI 専用）承認待ち・許可済み（秘密なし）・denyAll・aiActive" },
    () => run(() => port().view()),
  );
  tool(
    "decide_client_approval",
    { description: "（GUI 専用）承認待ちへの回答（allow はアダプタなら保存用 grant を返す）", inputSchema: { requestId: z.string(), decision: z.enum(["allow", "deny", "deny-all"]) } },
    (a) => run(() => ({ ok: true as const, ...port().decide(a.requestId, a.decision) })),
  );
  tool(
    "load_client_grants",
    { description: "（GUI 専用）keychain の grant を渡す（全置換）", inputSchema: { grants: z.array(z.object({ name: z.string(), version: z.string(), clientId: z.string(), secret: z.string() })) } },
    (a) =>
      run(() => {
        port().loadGrants(a.grants);
        return { ok: true as const, count: a.grants.length };
      }),
  );
  tool(
    "revoke_client_approval",
    { description: "（GUI 専用）許可の取り消し", inputSchema: { key: z.string() } },
    (a) => run(() => ({ ok: port().revoke(a.key) })),
  );
  tool(
    "report_seed",
    { description: "（GUI 専用）deck の seed 状態", inputSchema: { state: z.enum(["pending", "done", "failed"]), error: z.string().optional() } },
    (a) =>
      run(() => {
        port().reportSeed(a.state, a.error);
        return { ok: true as const };
      }),
  );
}
