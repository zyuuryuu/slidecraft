/**
 * CollabPanel.tsx — the P2.4 "Connect" surface. Starts/stops GUI-hosted collaboration and shows the
 * loopback URL + per-launch token plus a ready-to-paste `claude mcp add` snippet so an upstream AI
 * can connect. The deck mirrors the host's truth live while connected; the "AI 編集をシミュレート"
 * button drives a real ai-role edit so the live-update loop can be confirmed without an external AI.
 */
import { useState } from "react";
import type { CollabStatus } from "../ipc/collab-projection";

interface CollabPanelProps {
  onClose: () => void;
  available: boolean;
  status: CollabStatus;
  url?: string;
  token?: string;
  hostJsonPath?: string;
  error?: string;
  docCount: number;
  simulating: boolean;
  onStart: () => void;
  onStop: () => void;
  onSimulate: () => void;
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
      className="px-2 py-1 text-[11px] rounded bg-[#2D3A6E] hover:bg-[#3B82F6]/50 text-white shrink-0"
    >
      {done ? "コピー済" : "コピー"}
    </button>
  );
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`flex-1 min-w-0 px-2 py-1 rounded bg-[#0a0e1a] border border-[#2D3A6E] text-gray-200 text-[11px] ${mono ? "font-mono" : ""}`}
        />
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export default function CollabPanel({
  onClose, available, status, url, token, hostJsonPath, error, docCount, simulating, onStart, onStop, onSimulate,
}: CollabPanelProps) {
  const connected = status === "connected";
  const snippet =
    url && token ? `claude mcp add --transport http slidecraft ${url} --header "Authorization: Bearer ${token}"` : "";

  const dot = connected ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : status === "error" ? "bg-rose-500" : "bg-gray-600";
  const statusLabel = connected ? "接続中" : status === "connecting" ? "接続中…" : status === "error" ? "エラー" : "未接続";

  return (
    <div className="fixed bottom-2 right-2 z-50 w-[420px] max-w-[calc(100vw-1rem)] bg-[#0f1117] border border-[#2D3A6E] rounded-lg shadow-2xl text-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2D3A6E]">
        <div className="flex items-center gap-2">
          <span role="img" aria-label={statusLabel} className={`w-2 h-2 rounded-full ${dot}`} />
          <span className="text-white font-medium">🔗 協働（AI ライブ編集）</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white px-1" title="閉じる">
          ✕
        </button>
      </div>

      <div className="p-3 space-y-3">
        {!available ? (
          <p className="text-gray-400 text-xs leading-relaxed">
            協働機能はデスクトップアプリ（<span className="font-mono">npm run tauri dev</span> / ビルド版）でのみ動作します。
            ローカルの MCP サイドカーを起動して、上流 AI と webview を同じデッキへ接続します。
          </p>
        ) : (
          <>
            <p className="text-gray-400 text-xs leading-relaxed">
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
                className="w-full py-2 rounded bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-medium"
              >
                {status === "connecting" ? "接続中…" : "協働を開始"}
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>
                    接続中・ホストの deck をライブ表示中
                  </span>
                  <span>ドキュメント: {docCount}</span>
                </div>

                {url && <Field label="MCP エンドポイント" value={url} />}
                {token && <Field label="トークン（per-launch）" value={token} />}

                {snippet && (
                  <div>
                    <div className="text-[10px] text-gray-500 mb-0.5">Claude Code に追加（コピペ）</div>
                    <div className="flex items-start gap-1.5">
                      <textarea
                        readOnly
                        value={snippet}
                        onFocus={(e) => e.currentTarget.select()}
                        rows={3}
                        className="flex-1 min-w-0 px-2 py-1 rounded bg-[#0a0e1a] border border-[#2D3A6E] text-gray-200 text-[11px] font-mono resize-none"
                      />
                      <CopyButton value={snippet} />
                    </div>
                  </div>
                )}

                {hostJsonPath && (
                  <div className="text-[10px] text-gray-600 break-all">handshake: {hostJsonPath}</div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={onSimulate}
                    disabled={simulating}
                    title="ai ロールで実際に接続し、スライドを編集して動作確認します"
                    className="flex-1 py-1.5 rounded bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 text-white text-xs"
                  >
                    {simulating ? "編集中…" : "🤖 AI 編集をシミュレート"}
                  </button>
                  <button onClick={onStop} className="px-3 py-1.5 rounded bg-[#2D3A6E] hover:bg-[#3B4684] text-white text-xs">
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
