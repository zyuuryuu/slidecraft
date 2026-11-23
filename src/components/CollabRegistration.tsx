/**
 * CollabRegistration.tsx — the MCP registration block of the 協働 panel (#520). Generates the Claude Code
 * one-liner / Claude Desktop entry / generic mcp.json from THIS install's real facts (Rust `mcp_install_info`
 * via ipc/mcp-install.ts): launcher on PATH → one word; otherwise the bundled node + cli.cjs paths, quoted
 * per OS. In a plain browser (dev/demo) or on IPC failure it shows the launcher form and SAYS why.
 *
 * "Claude Code に登録" (#530): on desktop with `claude` found, it shows the EXACT command (built in Rust —
 * the webview passes no strings) in a confirm dialog and runs it only on OK (`claude mcp add --scope user`),
 * then shows the exit code + stdout/stderr. Otherwise — browser build, `claude` missing, spawn/IPC error, or a
 * failed run — it copies the command shown in the field below (the #520 path) and says why. A clipboard
 * failure is reported, not swallowed.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { lookupMcpInstall, type McpInstallLookup } from "../ipc/mcp-install";
import { planClaudeRegister, runClaudeRegister, type RegisterPlanLookup } from "../ipc/claude-register";
import { buildRegistrationSnippets } from "./collab-panel-snippets";
import { outcomeView, planAction, type OutcomeView } from "./claude-register-view";
import { RegisterConfirm, RegisterResult } from "./ClaudeRegisterFlow";
import { McpbDownload, McpDoctor } from "./CollabDiagnostics";

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

/** Read-only plan lookup at mount — only to label the button (a click re-plans before confirming). */
function useRegisterPlan(): RegisterPlanLookup | null {
  const [plan, setPlan] = useState<RegisterPlanLookup | null>(null);
  useEffect(() => {
    let alive = true;
    void planClaudeRegister().then((r) => { if (alive) setPlan(r); });
    return () => { alive = false; };
  }, []);
  return plan;
}

type Flow =
  | { step: "idle" }
  | { step: "confirm"; command: string; busy: boolean }
  | { step: "done"; view: OutcomeView; copy: "copied" | "failed" | null };

export default function CollabRegistration() {
  const { t } = useTranslation();
  const lookup = useMcpInstall();
  const info = lookup?.kind === "resolved" ? lookup.info : null;
  const snippets = buildRegistrationSnippets(info);
  const mountPlan = useRegisterPlan();
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [jsonOpen, setJsonOpen] = useState(false);

  /** The #520 path: copy the command shown in the field below. Reports a blocked clipboard. */
  const finish = async (view: OutcomeView) => {
    let copy: "copied" | "failed" | null = null;
    if (view.copyFallback) {
      try {
        await navigator.clipboard.writeText(snippets.claudeCode);
        copy = "copied";
      } catch {
        copy = "failed";
      }
    }
    setFlow({ step: "done", view, copy });
  };

  /** Click: re-plan (fresh `claude` lookup) → confirm dialog, or straight to the copy fallback with the reason. */
  const start = async () => {
    const action = planAction(await planClaudeRegister(), info?.os ?? "linux");
    if (action.kind === "confirm") setFlow({ step: "confirm", command: action.command, busy: false });
    else await finish(action.view);
  };

  /** Confirm OK: the only path that executes anything. */
  const run = async () => {
    if (flow.step !== "confirm") return;
    setFlow({ ...flow, busy: true });
    await finish(outcomeView(await runClaudeRegister()));
  };

  const sourceHint =
    lookup === null ? null
    : lookup.kind === "browser" ? t("collabPanel.pathsBrowserHint")
    : lookup.kind === "error" ? t("collabPanel.pathsErrorHint", { error: lookup.error })
    : lookup.info.launcherOnPath ? t("collabPanel.pathsLauncherHint", { os: lookup.info.os })
    : t("collabPanel.pathsRealHint", { os: lookup.info.os });

  return (
    <div className="space-y-2">
      {/* Primary action (#530): run `claude mcp add --scope user` after an explicit confirm, else copy. */}
      {flow.step === "confirm" ? (
        <RegisterConfirm command={flow.command} busy={flow.busy} onCancel={() => setFlow({ step: "idle" })} onRun={run} />
      ) : (
        <button onClick={start} className="w-full py-1.5 rounded bg-edge hover:bg-accent/50 text-fg text-xs font-medium">
          {mountPlan?.kind === "ready" ? t("collabPanel.registerClaudeCodeRun") : t("collabPanel.registerClaudeCode")}
        </button>
      )}
      {flow.step === "done" && <RegisterResult view={flow.view} copy={flow.copy} />}

      <Field label={t("collabPanel.addToClaudeCode")} value={snippets.claudeCode} />
      <Field label={t("collabPanel.desktopClientsLabel")} value={snippets.desktopJson} />
      {/* #517 子 3: Claude Desktop's no-JSON install (Settings → Extensions; #686). The JSON above stays (Cursor etc. use it, and it is
          the fallback when the latest release has no bundle). */}
      <McpbDownload os={info?.os ?? null} />

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

      {/* #517 子 4: does the registered server actually answer? Runs the bundled server's own --doctor. */}
      <McpDoctor />

      {sourceHint && <p className="text-[10px] text-dim leading-relaxed break-words">{sourceHint}</p>}
      <p className="text-[10px] text-faint leading-relaxed">{t("collabPanel.otherClientsHint")}</p>
    </div>
  );
}
