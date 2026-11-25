/**
 * CollabPanel.tsx — the 協働 surface, in two layers (#689):
 *  - top: ONE status line (協働中 / AI 待ち / 停止中 …, the allowed clients, 承認待ち N 件) + 停止 / 再開.
 *  - bottom: 「接続の設定」 (CollabSetup) — the stdio registration (#520/#530), .mcpb, 接続テスト, the folded
 *    HTTP-direct fallback (#283/#297), the allowed-clients list and the follow toggle. Open until the user has ever
 *    connected (collab-panel-view.ts), folded after; the fold is remembered by the same rule as ai-settings-fold.ts (#669/#743).
 * What is locked while collaborating, and why, is said ONCE in the notice slot (NoticeSlot, #689) — not here.
 * 「協働中か」 comes from collabEditLocked only (collab-lock.ts, R8).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CollabStatus } from "../ipc/collab-projection";
import type { GrantView } from "../mcp/host-approval";
import { collabEditLocked } from "./collab-lock";
import {
  collabEverConnected, collabSetupDecidable, collabStatusView, initialSetupOpen, loadSetupFolded, rememberSetupFold, saveSetupFolded,
} from "./collab-panel-view";
import CollabSetup from "./CollabSetup";

export { AdvancedHttp, ClientGrantList } from "./CollabSetup";

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
  onStart: () => void;
  onStop: () => void;
  /** #727 (ADR-0040 D1): an allowed AI has started calling (= collaborating, edit-locked). The host itself runs
   *  from app launch, so `connected` without this means "waiting for an AI". */
  aiActive?: boolean;
  /** #727 (D3-5): the clients the human allowed, each revocable. Omitted → the list is hidden. */
  grants?: GrantView[];
  onRevoke?: (key: string) => void;
  /** #689 review a: false while the allowed clients are still being read (keychain → host) — the setup fold is not
   *  decided until then (no open-then-fold flicker at launch). Omitted → read. */
  grantsRead?: boolean;
  /** #689: AI clients waiting for [許可] (the decision is the approval dialog) — shown in the status line. */
  pendingCount?: number;
  /** #407: whether the view follows (jumps to + flashes) the AI's edits. Omitted → toggle hidden. */
  followAi?: boolean;
  onFollowAiChange?: (v: boolean) => void;
}

/** The setup fold: open until the user has ever connected; a fold made before that is remembered.
 *  `everConnected` null = not decidable yet (the allowed clients are still being read) → stay folded, decide once
 *  they are known (no open-then-fold flicker at launch; #689 review a). */
function useSetupFold(everConnected: boolean | null) {
  const [open, setOpen] = useState(() => everConnected !== null && initialSetupOpen(everConnected, loadSetupFolded()));
  const toggle = (next: boolean) => {
    setOpen(next);
    saveSetupFolded(rememberSetupFold(loadSetupFolded(), next, !!everConnected));
  };
  // Decided, or connected for the first time while the panel is open → (re)decide (and forget an old fold).
  const prev = useRef(everConnected);
  useEffect(() => {
    if (everConnected === null || everConnected === prev.current) return;
    prev.current = everConnected;
    saveSetupFolded(rememberSetupFold(loadSetupFolded(), null, everConnected));
    setOpen(initialSetupOpen(everConnected, loadSetupFolded()));
  }, [everConnected]);
  return [open, toggle] as const;
}

export default function CollabPanel({
  embedded, onClose, available, status, url, token, hostJsonPath, error, onStart, onStop, aiActive, grants, onRevoke, grantsRead = true,
  pendingCount = 0, followAi, onFollowAiChange,
}: CollabPanelProps) {
  const { t } = useTranslation();
  const connected = status === "connected";
  const locked = collabEditLocked({ status, aiActive: !!aiActive });
  const decidable = collabSetupDecidable({ available, locked, grantsRead });
  const [setupOpen, setSetupOpen] = useSetupFold(decidable ? collabEverConnected({ locked, grants }) : null);
  const view = collabStatusView(status, locked);
  const statusLabel = t(`collabPanel.${view.key}`);
  const clients = [...new Set((grants ?? []).map((g) => g.name))].join(t("collabPanel.clientSeparator"));
  const parts = [
    statusLabel,
    connected && clients ? t("collabPanel.allowedClients", { names: clients }) : null,
    pendingCount > 0 ? t("collabPanel.pendingCount", { count: pendingCount }) : null,
  ].filter((p): p is string => !!p);

  return (
    <div className={embedded ? "flex-1 min-h-0 overflow-auto text-sm" : "fixed bottom-2 right-2 z-50 w-[420px] max-w-[calc(100vw-1rem)] bg-canvas border border-edge rounded-lg shadow-2xl text-sm"}>
      {!embedded && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
          <span className="text-fg font-medium">🔗 {t("collabPanel.headerTitle")}</span>
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
          <div data-testid="collab-status" className="flex items-center gap-2">
            <span role="img" aria-label={statusLabel} className={`shrink-0 w-2 h-2 rounded-full ${view.dot}`} />
            <span className="flex-1 min-w-0 text-xs text-fg2 leading-relaxed">{parts.join(t("collabPanel.statusSeparator"))}</span>
            {view.action === "stop" && (
              <button onClick={onStop} className="shrink-0 px-3 py-1 rounded bg-edge hover:bg-surface text-fg text-xs">
                {t("collabPanel.stopButton")}
              </button>
            )}
            {view.action === "start" && (
              <button onClick={onStart} className="shrink-0 px-3 py-1 rounded bg-accent hover:bg-accent-hi text-on-accent text-xs font-medium">
                {t("collabPanel.startButton")}
              </button>
            )}
          </div>
        )}

        {available && error && (
          <div role="alert" className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded px-2 py-1.5 break-words">
            {error}
          </div>
        )}

        <CollabSetup
          open={setupOpen} onOpenChange={setSetupOpen} connected={available && connected} locked={locked}
          url={url} token={token} hostJsonPath={hostJsonPath} grants={grants} onRevoke={onRevoke}
          followAi={followAi} onFollowAiChange={onFollowAiChange}
        />
      </div>
    </div>
  );
}
