/**
 * CollabRegistration.tsx — the MCP registration block of the 協働 panel (#520). Generates the Claude Code
 * one-liner / Claude Desktop entry / generic mcp.json from THIS install's real facts (Rust `mcp_install_info`
 * via ipc/mcp-install.ts): launcher on PATH → one word; otherwise the bundled node + cli.cjs paths, quoted
 * per OS. In a plain browser (dev/demo) or on IPC failure it shows the launcher form and SAYS why.
 *
 * "Claude Code に登録" copies the command (never runs anything, never writes a config file): what was
 * copied stays visible in the field below, and a clipboard failure is reported, not swallowed.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { lookupMcpInstall, type McpInstallLookup } from "../ipc/mcp-install";
import { buildRegistrationSnippets } from "./collab-panel-snippets";

export function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked — the field is selectable as a fallback */
        }
      }}
      className="px-2 py-1 text-[11px] rounded bg-edge hover:bg-accent/50 text-fg shrink-0"
    >
      {done ? t("collabPanel.copied") : t("collabPanel.copy")}
    </button>
  );
}

export function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-faint mb-0.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`flex-1 min-w-0 px-2 py-1 rounded bg-void border border-edge text-fg2 text-[11px] ${mono ? "font-mono" : ""}`}
        />
        <CopyButton value={value} />
      </div>
    </div>
  );
}

/** The install lookup is a one-shot read; `null` = still resolving (the launcher form shows meanwhile). */
function useMcpInstall(): McpInstallLookup | null {
  const [lookup, setLookup] = useState<McpInstallLookup | null>(null);
  useEffect(() => {
    let alive = true;
    void lookupMcpInstall().then((r) => { if (alive) setLookup(r); });
    return () => { alive = false; };
  }, []);
  return lookup;
}

export default function CollabRegistration() {
  const { t } = useTranslation();
  const lookup = useMcpInstall();
  const info = lookup?.kind === "resolved" ? lookup.info : null;
  const snippets = buildRegistrationSnippets(info);
  const [registerState, setRegisterState] = useState<"idle" | "copied" | "failed">("idle");
  const [jsonOpen, setJsonOpen] = useState(false);

  const sourceHint =
    lookup === null ? null
    : lookup.kind === "browser" ? t("collabPanel.pathsBrowserHint")
    : lookup.kind === "error" ? t("collabPanel.pathsErrorHint", { error: lookup.error })
    : lookup.info.launcherOnPath ? t("collabPanel.pathsLauncherHint", { os: lookup.info.os })
    : t("collabPanel.pathsRealHint", { os: lookup.info.os });

  return (
    <div className="space-y-2">
      {/* Primary action: copy the exact command shown in the field below (default = copy; running
          `claude mcp add` itself needs a fixed-arg Rust command — pending review, see PR #520). */}
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(snippets.claudeCode);
            setRegisterState("copied");
          } catch {
            setRegisterState("failed");
          }
        }}
        className="w-full py-1.5 rounded bg-edge hover:bg-accent/50 text-fg text-xs font-medium"
      >
        {t("collabPanel.registerClaudeCode")}
      </button>
      {registerState === "copied" && (
        <p role="status" className="text-[10px] text-emerald-300/80 leading-relaxed">{t("collabPanel.registerCopiedNotice")}</p>
      )}
      {registerState === "failed" && (
        <p role="alert" className="text-[10px] text-amber-300/80 leading-relaxed">{t("collabPanel.copyFailedNotice")}</p>
      )}

      <Field label={t("collabPanel.addToClaudeCode")} value={snippets.claudeCode} />
      <Field label={t("collabPanel.desktopClientsLabel")} value={snippets.desktopJson} />

      <button
        onClick={() => setJsonOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-accent-soft hover:text-fg py-0.5"
      >
        <span>{jsonOpen ? "▾" : "▸"}</span>
        <span>{t("collabPanel.mcpJsonLabel")}</span>
      </button>
      {jsonOpen && (
        <div className="flex items-start gap-1.5">
          <textarea
            readOnly
            value={snippets.mcpJson}
            onFocus={(e) => e.currentTarget.select()}
            rows={snippets.mcpJson.split("\n").length}
            className="flex-1 min-w-0 px-2 py-1 rounded bg-void border border-edge text-fg2 text-[11px] font-mono resize-none"
          />
          <CopyButton value={snippets.mcpJson} />
        </div>
      )}

      {sourceHint && <p className="text-[10px] text-dim leading-relaxed break-words">{sourceHint}</p>}
      <p className="text-[10px] text-faint leading-relaxed">{t("collabPanel.otherClientsHint")}</p>
    </div>
  );
}
