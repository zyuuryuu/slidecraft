/**
 * CollabSetup.tsx — #689: 協働パネルの下の層「接続の設定」（並びは 登録 → 接続テスト → HTTP 直結 → 許可したクライアント → 追随・#689 裁定）。登録の手順（CollabRegistration: コマンド・
 * JSON・.mcpb・mcp.json・接続テスト）、上級の HTTP 直結、許可したクライアントの一覧、AI の変更への追随、協働編集の
 * 仕組みの説明をひとつの折りたたみ（shadcn/ui Collapsible・Base UI）に収める。閉じているときは中身を描かない。
 * 開くか閉じるか（と記憶）は CollabPanel が collab-panel-view.ts で決める。ここは描くだけ。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GrantView } from "../mcp/host-approval";
import { maskToken, httpSnippet } from "./collab-panel-snippets";
import CollabRegistration, { CopyButton, Field } from "./CollabRegistration";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

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
            <div className="text-[10px] text-dim break-all">{t("collabPanel.handshakeLabel", { path: hostJsonPath })}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** #727 (D3-5): the allowed clients as ONE folded line ("許可したクライアント（N）"); opened, one row per client
 *  with its own 取り消し (= that pair's secret is void; the shared token is not rotated). */
export function ClientGrantList({ open, onToggle, grants, onRevoke }: { open: boolean; onToggle: () => void; grants: GrantView[]; onRevoke: (key: string) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-1 text-[11px] text-accent-soft hover:text-fg py-1">
        <span>{open ? "▾" : "▸"}</span>
        <span>{t("collabPanel.grantsSummary", { count: grants.length })}</span>
      </button>
      {open && (
        <ul className="space-y-1 pl-3 border-l border-edge">
          {grants.length === 0 && <li className="text-[11px] text-dim">{t("collabPanel.grantsEmpty")}</li>}
          {grants.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-2 text-[11px] text-fg2">
              <span className="min-w-0 truncate">
                {g.name} <span className="text-dim">{g.version}</span> <span className="font-mono text-dim">{g.fingerprint}</span>
                {g.kind === "session" && <span className="text-dim"> · {t("collabPanel.grantSessionOnly")}</span>}
              </span>
              <button onClick={() => onRevoke(g.key)} className="shrink-0 text-rose-300 hover:text-rose-200">{t("collabPanel.revoke")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface CollabSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The host runs (the HTTP-direct fallback has a URL/token only then). */
  connected: boolean;
  /** 協働中 (edit-locked) — the co-edit explanation applies only then. */
  locked: boolean;
  url?: string;
  token?: string;
  hostJsonPath?: string;
  grants?: GrantView[];
  onRevoke?: (key: string) => void;
  followAi?: boolean;
  onFollowAiChange?: (v: boolean) => void;
}

export default function CollabSetup({
  open, onOpenChange, connected, locked, url, token, hostJsonPath, grants, onRevoke, followAi, onFollowAiChange,
}: CollabSetupProps) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [grantsOpen, setGrantsOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-t border-edge/60 pt-1">
      <CollapsibleTrigger
        data-testid="collab-setup-toggle"
        className="w-full flex items-center gap-1 text-[11px] text-accent-soft hover:text-fg py-1"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{t("collabPanel.setupSummary")}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-1">
        <p className="text-muted text-xs leading-relaxed">
          {t("collabPanel.introBefore")}<span className="text-emerald-300">{t("collabPanel.introHighlight")}</span>{t("collabPanel.introAfter")}
        </p>
        {/* Registration is independent of the connection (register once; stdio auto-discovers the host — ADR-0033),
            so it is here in EVERY state, browser demo included (#520). */}
        <CollabRegistration />
        {connected && (
          <AdvancedHttp open={advancedOpen} onToggle={() => setAdvancedOpen((v) => !v)} url={url} token={token} hostJsonPath={hostJsonPath} />
        )}
        {/* Only while the host runs: 取り消し goes through it (after 停止 the last known grants are kept for the fold
            decision, but a revoke there would do nothing). */}
        {connected && grants && onRevoke && <ClientGrantList open={grantsOpen} onToggle={() => setGrantsOpen((v) => !v)} grants={grants} onRevoke={onRevoke} />}
        {connected && onFollowAiChange && (
          <label className="flex items-center gap-1.5 text-[11px] text-fg2 cursor-pointer select-none">
            <input type="checkbox" checked={!!followAi} onChange={(e) => onFollowAiChange(e.target.checked)} />
            {t("collabPanel.followAi")}
          </label>
        )}
        {locked && <p className="text-[10px] text-emerald-300/80 leading-relaxed">{t("collabPanel.coEditNotice")}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
