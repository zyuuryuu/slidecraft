/**
 * CollabDiagnostics.tsx — two blocks of the 協働 panel's registration area (#517):
 *  - McpbDownload (子 3): Claude Desktop's `.mcpb` for THIS OS from the latest release (installed from Claude
 *    Desktop's Settings → Extensions; #686). Every outcome is stated — loading / available / missing in that release / no Claude Desktop
 *    on this OS / lookup failed — so the JSON snippet above is never left as an unexplained only option.
 *  - McpDoctor (子 4): 接続テスト — runs the bundled server's own `--doctor` (Rust `mcp_doctor`) and shows its
 *    one-screen report verbatim.
 * Presentational + local state only; what to show is decided by collab-diagnostics-view.ts.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstallOs } from "../ipc/mcp-install";
import { lookupMcpbDownload, openMcpbDownload, type McpbDownload as McpbLookup } from "../ipc/mcpb-asset";
import { runMcpDoctor } from "../ipc/mcp-doctor";
import { doctorView, mcpbView, type DoctorView } from "./collab-diagnostics-view";

/** `os` null = no desktop install known (browser build / install lookup failed) → no release request. */
export function McpbDownload({ os }: { os: InstallOs | null }) {
  const { t } = useTranslation();
  const [lookup, setLookup] = useState<McpbLookup | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    if (!os) return;
    let alive = true;
    void lookupMcpbDownload(os).then((r) => { if (alive) setLookup(r); });
    return () => { alive = false; };
  }, [os]);
  const view = mcpbView(os ? lookup : { kind: "browser" });
  const text = t(`collabPanel.${view.message.key}` as const, view.message.params);

  return (
    <div>
      <div className="text-[10px] text-faint mb-0.5">{t("collabPanel.mcpbLabel")}</div>
      {view.url ? (
        <button
          onClick={async () => setOpenFailed(!(await openMcpbDownload(view.url as string)))}
          className="w-full py-1 rounded bg-edge hover:bg-accent/50 text-fg text-[11px]"
        >
          ⬇ {text}
        </button>
      ) : (
        <p className="text-[10px] text-dim leading-relaxed break-words">{text}</p>
      )}
      {openFailed && view.url && (
        <p role="alert" className="text-[10px] text-amber-300/80 leading-relaxed break-all">{t("collabPanel.mcpbOpenFailed", { url: view.url })}</p>
      )}
    </div>
  );
}

export function McpDoctor() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<DoctorView | null>(null);
  const run = async () => {
    setBusy(true);
    setView(null);
    setView(doctorView(await runMcpDoctor()));
    setBusy(false);
  };
  const ok = view?.tone === "ok";

  return (
    <div className="space-y-1">
      <button onClick={run} disabled={busy} className="w-full py-1 rounded bg-edge hover:bg-accent/50 disabled:opacity-50 text-fg text-[11px]">
        {busy ? t("collabPanel.doctorRunning") : t("collabPanel.doctorButton")}
      </button>
      {view && (
        <>
          <p role={ok ? "status" : "alert"} className={`text-[10px] leading-relaxed break-words ${ok ? "text-emerald-300/80" : "text-amber-300/80"}`}>
            {t(`collabPanel.${view.message.key}` as const, view.message.params)}
          </p>
          {(view.report || view.stderr) && (
            <pre className="px-2 py-1 rounded bg-void border border-edge text-fg2 text-[10px] font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto">
              {view.report ?? ""}
              {view.stderr && `${view.report ? "\n" : ""}--- stderr ---\n${view.stderr}`}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
