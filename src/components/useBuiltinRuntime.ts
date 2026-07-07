/**
 * useBuiltinRuntime — the bundled llamafile runtime lifecycle, split out of useAiGeneration (R1).
 *
 * startBuiltin SPAWNS it (Rust start_local_ai polls /health, returns the loopback baseURL) and adopts
 * the reported model; it serves auto-start-on-generate (runTask), which needs the weights already
 * downloaded. switchToBuiltin is the explicit enable: it DOWNLOADS the model on first use (with
 * progress) then spawns. stopBuiltin frees the memory. Desktop-only. The parent hook injects its
 * setConfigs/setProvider so this owns only the runtime state, not the whole config store.
 */
import { useState, useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import i18n from "../i18n";
import { runningInTauri } from "../ipc/commands";
import { listProviderModels, type ProviderId } from "../ipc/ai";
import type { AiConfigMap, BuiltinModelInfo } from "./ai-generation-types";

export interface BuiltinStatus {
  kind: "idle" | "downloading" | "starting" | "running" | "error";
  message?: string;
  pct?: number;
}

export function useBuiltinRuntime(deps: {
  setConfigs: Dispatch<SetStateAction<AiConfigMap>>;
  setProvider: Dispatch<SetStateAction<ProviderId>>;
}) {
  const { setConfigs, setProvider } = deps;
  const [builtinStatus, setBuiltinStatus] = useState<BuiltinStatus>({ kind: "idle" });
  const [weightsPresent, setWeightsPresent] = useState<boolean | null>(null);
  // The capability-selected default model (name + real DL size) — so the UI shows "Granite 4.1 8B"
  // and the true size, not a stale saved config / hard-coded "2.4GB". Auto-detected in Rust.
  const [builtinModel, setBuiltinModel] = useState<BuiltinModelInfo | null>(null);

  useEffect(() => {
    if (!runningInTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const present = await invoke<boolean>("model_weights_present");
        if (!cancelled) setWeightsPresent(present);
        const info = await invoke<BuiltinModelInfo>("builtin_model_info");
        if (!cancelled) setBuiltinModel(info);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startBuiltin = useCallback(async (): Promise<string> => {
    if (!runningInTauri()) throw new Error(i18n.t("builtinRuntime.desktopOnly"));
    setBuiltinStatus({ kind: "starting" });
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ baseUrl: string }>("start_local_ai");
    // The reported model id (/v1/models = loaded GGUF basename) won't match the preset name, so
    // adopt it → the badge shows 接続OK, not モデルを選択.
    let model: string | undefined;
    try {
      const list = await listProviderModels("builtin", info.baseUrl, "");
      model = list[0];
    } catch {
      /* keep the preset model name */
    }
    setConfigs((c) => ({ ...c, builtin: { ...c.builtin, baseURL: info.baseUrl, ...(model ? { model } : {}) } }));
    setBuiltinStatus({ kind: "running" });
    return info.baseUrl;
  }, [setConfigs]);

  // Explicit enable: download the model on first use (streamed, with progress), then spawn + select.
  const switchToBuiltin = useCallback(async () => {
    if (!runningInTauri()) {
      setBuiltinStatus({ kind: "error", message: i18n.t("builtinRuntime.desktopOnly") });
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!(await invoke<boolean>("model_weights_present"))) {
        setBuiltinStatus({ kind: "downloading", pct: 0 });
        const { listen } = await import("@tauri-apps/api/event");
        const un = await listen<{ pct: number }>("builtin://download", (e) => setBuiltinStatus({ kind: "downloading", pct: e.payload.pct }));
        try {
          await invoke("ensure_model_weights");
        } finally {
          un();
        }
        setWeightsPresent(true);
      }
      await startBuiltin();
      setProvider("builtin");
    } catch (e) {
      setBuiltinStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [startBuiltin, setProvider]);

  // Stop the runtime + free its memory (~GB); the next generate auto-starts it again.
  const stopBuiltin = useCallback(async () => {
    if (!runningInTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_local_ai");
    } catch {
      /* ignore */
    }
    setConfigs((c) => ({ ...c, builtin: { ...c.builtin, baseURL: "" } }));
    setBuiltinStatus({ kind: "idle" });
  }, [setConfigs]);

  return { builtinStatus, weightsPresent, builtinModel, startBuiltin, switchToBuiltin, stopBuiltin };
}
