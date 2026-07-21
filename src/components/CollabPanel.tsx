/**
 * CollabPanel.tsx — the P2.4 "Connect" surface. Starts/stops GUI-hosted collaboration and shows the
 * ready-to-paste stdio registration (`claude mcp add slidecraft -- slidecraft-mcp`) so an upstream AI
 * can connect — stdio auto-discovers and forwards to this host while the GUI runs (ADR-0033), so no
 * url/token management is needed. The loopback URL + per-launch token direct-HTTP path stays available
 * as a folded "advanced" fallback for clients that can't spawn stdio (#283 anti-pattern, #297). The
 * deck mirrors the host's truth live while connected.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CollabStatus } from "../ipc/collab-projection";
import { STDIO_SNIPPET, DESKTOP_JSON_SNIPPET, maskToken, httpSnippet } from "./collab-panel-snippets";

interface CollabPanelProps {
  /** When embedded in the AI hub's 協働 tab: render body-only (no floating card, no own header/close). */
  embedded?: boolean;
  onClose: () => void;
  available: boolean;
  status: CollabStatus;
  url?: string;
  token?: string;
  hostJsonPath?: string;
  error?: string;
  docCount: number;
  onStart: () => void;
  onStop: () => void;
}

function CopyButton({ value }: { value: string }) {
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

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
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

/**
 * The HTTP-direct registration path — folded away by default (ADR-0033 / #283: registering the collab
 * host's URL+token directly is an anti-pattern, since the port is ephemeral and the token rotates every
 * GUI launch). Kept as a fallback for clients that can't spawn a stdio process. The token stays masked
 * even once this block is opened; only the explicit reveal toggle shows it.
 */
export function AdvancedHttp({
  open, onToggle, url, token, hostJsonPath,
}: { open: boolean; onToggle: () => void; url?: string; token?: string; hostJsonPath?: string }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const snippetFull = url && token ? httpSnippet(url, token) : "";
  const snippetDisplay = url && token ? httpSnippet(url, revealed ? token : maskToken(token)) : "";

  return (
    <div className="pt-1 border-t border-edge/60">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 text-[11px] text-accent-soft hover:text-fg py-1"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{t("collabPanel.advancedHttpSummary")}</span>
      </button>
      {open && (
        <div className="space-y-2 pl-3 border-l border-edge">
          <p className="text-[10px] text-amber-300/80 leading-relaxed">{t("collabPanel.httpAntipatternNotice")}</p>

          {url && <Field label={t("collabPanel.endpointLabel")} value={url} />}

          {token && (
            <div>
              <div className="text-[10px] text-faint mb-0.5 flex items-center justify-between">
                <span>{t("collabPanel.tokenLabel")}</span>
                <button onClick={() => setRevealed((v) => !v)} className="text-accent-soft hover:text-fg text-[10px]">
                  {revealed ? t("collabPanel.hideToken") : t("collabPanel.revealToken")}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={revealed ? token : maskToken(token)}
                  onFocus={(e) => { if (revealed) e.currentTarget.select(); }}
                  className="flex-1 min-w-0 px-2 py-1 rounded bg-void border border-edge text-fg2 text-[11px] font-mono"
                />
                <CopyButton value={token} />
              </div>
            </div>
          )}

          {snippetDisplay && (
            <div>
              <div className="text-[10px] text-faint mb-0.5">{t("collabPanel.httpSnippetLabel")}</div>
              <div className="flex items-start gap-1.5">
                <textarea
                  readOnly
                  value={snippetDisplay}
                  onFocus={(e) => { if (revealed) e.currentTarget.select(); }}
                  rows={3}
                  className="flex-1 min-w-0 px-2 py-1 rounded bg-void border border-edge text-fg2 text-[11px] font-mono resize-none"
                />
                <CopyButton value={snippetFull} />
              </div>
            </div>
          )}

          {hostJsonPath && (
            <div className="text-[10px] text-dim break-all">handshake: {hostJsonPath}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CollabPanel({
  embedded, onClose, available, status, url, token, hostJsonPath, error, docCount, onStart, onStop,
}: CollabPanelProps) {
  const { t } = useTranslation();
  const connected = status === "connected";
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const dot = connected ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : status === "error" ? "bg-rose-500" : "bg-field";
  const statusLabel = connected ? t("collabPanel.statusConnected") : status === "connecting" ? t("collabPanel.statusConnecting") : status === "error" ? t("collabPanel.statusError") : t("collabPanel.statusDisconnected");

  return (
    <div className={embedded ? "flex-1 min-h-0 overflow-auto text-sm" : "fixed bottom-2 right-2 z-50 w-[420px] max-w-[calc(100vw-1rem)] bg-canvas border border-edge rounded-lg shadow-2xl text-sm"}>
      {!embedded && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
          <div className="flex items-center gap-2">
            <span role="img" aria-label={statusLabel} className={`w-2 h-2 rounded-full ${dot}`} />
            <span className="text-fg font-medium">🔗 {t("collabPanel.headerTitle")}</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg px-1" title={t("collabPanel.close")}>
            ✕
          </button>
        </div>
      )}

      <div className="p-3 space-y-3">
        {!available ? (
          <p className="text-muted text-xs leading-relaxed">
            {t("collabPanel.unavailableBefore")}<span className="font-mono">npm run tauri dev</span>{t("collabPanel.unavailableAfter")}
          </p>
        ) : (
          <>
            <p className="text-muted text-xs leading-relaxed">
              {t("collabPanel.introBefore")}<span className="text-emerald-300">{t("collabPanel.introHighlight")}</span>{t("collabPanel.introAfter")}
            </p>

            {error && (
              <div role="alert" className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded px-2 py-1.5 break-words">
                {error}
              </div>
            )}

            {!connected ? (
              <button
                onClick={onStart}
                disabled={status === "connecting"}
                className="w-full py-2 rounded bg-accent hover:bg-accent-hi disabled:opacity-50 text-on-accent font-medium"
              >
                {status === "connecting" ? t("collabPanel.statusConnecting") : t("collabPanel.startButton")}
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>
                    {t("collabPanel.liveViewing")}
                  </span>
                  <span>{t("collabPanel.documentCount", { docCount })}</span>
                </div>
                <p className="text-[10px] text-emerald-300/80 leading-relaxed">
                  ✍️ {t("collabPanel.coEditNotice")}
                </p>

                {/* Primary registration line — static, unconditional, never needs rewriting (#297 / ADR-0033). */}
                <Field label={t("collabPanel.addToClaudeCode")} value={STDIO_SNIPPET} />
                <Field label={t("collabPanel.desktopClientsLabel")} value={DESKTOP_JSON_SNIPPET} />
                <p className="text-[10px] text-faint leading-relaxed">{t("collabPanel.otherClientsHint")}</p>

                <AdvancedHttp
                  open={advancedOpen}
                  onToggle={() => setAdvancedOpen((v) => !v)}
                  url={url}
                  token={token}
                  hostJsonPath={hostJsonPath}
                />

                <div className="flex items-center justify-end pt-1">
                  <button onClick={onStop} className="px-4 py-1.5 rounded bg-edge hover:bg-surface text-fg text-xs">
                    {t("collabPanel.stopButton")}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
