/**
 * CollabPanel.tsx — the P2.4 "Connect" surface. Starts/stops GUI-hosted collaboration and shows the
 * loopback URL + per-launch token plus a ready-to-paste `claude mcp add` snippet so an upstream AI
 * can connect. The deck mirrors the host's truth live while connected.
 */
import { useState } from "react";
import type { CollabStatus } from "../ipc/collab-projection";

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
      {done ? "コピー済" : "コピー"}
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

export default function CollabPanel({
  embedded, onClose, available, status, url, token, hostJsonPath, error, docCount, onStart, onStop,
}: CollabPanelProps) {
  const connected = status === "connected";
  const snippet =
    url && token ? `claude mcp add --transport http slidecraft ${url} --header "Authorization: Bearer ${token}"` : "";

  const dot = connected ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : status === "error" ? "bg-rose-500" : "bg-field";
  const statusLabel = connected ? "接続中" : status === "connecting" ? "接続中…" : status === "error" ? "エラー" : "未接続";

  return (
    <div className={embedded ? "flex-1 min-h-0 overflow-auto text-sm" : "fixed bottom-2 right-2 z-50 w-[420px] max-w-[calc(100vw-1rem)] bg-canvas border border-edge rounded-lg shadow-2xl text-sm"}>
      {!embedded && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
          <div className="flex items-center gap-2">
            <span role="img" aria-label={statusLabel} className={`w-2 h-2 rounded-full ${dot}`} />
            <span className="text-fg font-medium">🔗 協働（AI ライブ編集）</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg px-1" title="閉じる">
            ✕
          </button>
        </div>
      )}

      <div className="p-3 space-y-3">
        {!available ? (
          <p className="text-muted text-xs leading-relaxed">
            協働機能はデスクトップアプリ（<span className="font-mono">npm run tauri dev</span> / ビルド版）でのみ動作します。
            ローカルの MCP サイドカーを起動して、上流 AI と webview を同じデッキへ接続します。
          </p>
        ) : (
          <>
            <p className="text-muted text-xs leading-relaxed">
              開始すると、ローカルに MCP ホスト（サイドカー）を起動します。下の URL とトークンを上流 AI に渡すと、
              AI の編集が <span className="text-emerald-300">この画面にライブ反映</span> されます。
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
                {status === "connecting" ? "接続中…" : "協働を開始"}
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>
                    接続中・ホストの deck をライブ表示中
                  </span>
                  <span>ドキュメント: {docCount}</span>
                </div>
                <p className="text-[10px] text-emerald-300/80 leading-relaxed">
                  ✍️ 協働編集：あなたの編集はホスト（単一の真実）へ送られ AI とライブ共有されます。AI の編集もここに反映。取り消し（⌘Z）はホスト側の履歴で実行されます（構造変更・テンプレ・タブ切替は接続中ロック）。
                </p>

                {url && <Field label="MCP エンドポイント" value={url} />}
                {token && <Field label="トークン（per-launch）" value={token} />}

                {snippet && (
                  <div>
                    <div className="text-[10px] text-faint mb-0.5">Claude Code に追加（コピペ）</div>
                    <div className="flex items-start gap-1.5">
                      <textarea
                        readOnly
                        value={snippet}
                        onFocus={(e) => e.currentTarget.select()}
                        rows={3}
                        className="flex-1 min-w-0 px-2 py-1 rounded bg-void border border-edge text-fg2 text-[11px] font-mono resize-none"
                      />
                      <CopyButton value={snippet} />
                    </div>
                  </div>
                )}

                {hostJsonPath && (
                  <div className="text-[10px] text-dim break-all">handshake: {hostJsonPath}</div>
                )}

                <div className="flex items-center justify-end pt-1">
                  <button onClick={onStop} className="px-4 py-1.5 rounded bg-edge hover:bg-surface text-fg text-xs">
                    停止
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
