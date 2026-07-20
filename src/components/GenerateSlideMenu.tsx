/**
 * GenerateSlideMenu.tsx — 「便利スライドを生成」ボタン＋ポップオーバー（ADR-0034 / #277）。
 * タイプ選択（今回は目次のみ）→ live/static モード選択 → 挿入。static モードでは、選択中の
 * スライドを現在の章構成から作り直す「作り直す」アクションも並べる（ADR-0034 の明示再生成）。
 * 開閉・外側クリック/Escape での close は MasterPicker.tsx と同じパターン。
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { GenerateSlideMode } from "./useGenerateSlide";

interface GenerateSlideMenuProps {
  /** 選択中のスライドが存在するか（「作り直す」の有効化条件）。deck が null/空なら false。 */
  hasActiveSlide: boolean;
  onInsert: (mode: GenerateSlideMode) => void;
  /** static モードの「作り直す」— 呼び出し側で確認ダイアログを挟む想定。 */
  onRegenerateActive: () => void;
  disabled?: boolean;
}

export default function GenerateSlideMenu({ hasActiveSlide, onInsert, onRegenerateActive, disabled }: GenerateSlideMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GenerateSlideMode>("live"); // 既定は live（ADR-0034: 目次は乖離の害が大きい）
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("generateSlide.buttonTitle")}
        className="w-5 h-5 -my-0.5 flex items-center justify-center rounded text-muted hover:bg-accent hover:text-on-accent text-sm leading-none disabled:opacity-40"
      >
        ✨
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-canvas border border-edge rounded-lg shadow-2xl py-2 text-sm">
          <div className="px-3 pb-2 text-xs text-muted">{t("generateSlide.typeLabel")}: {t("generateSlide.typeToc")}</div>

          <div className="px-3 pb-1 text-xs text-muted">{t("generateSlide.modeLabel")}</div>
          <div className="px-3 flex gap-1 mb-1">
            {(["live", "static"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 px-2 py-1 rounded text-xs ${mode === m ? "bg-accent text-on-accent" : "bg-field text-fg2 hover:bg-edge"}`}
              >
                {m === "live" ? t("generateSlide.modeLive") : t("generateSlide.modeStatic")}
              </button>
            ))}
          </div>
          <div className="px-3 pb-2 text-[11px] text-faint">
            {mode === "live" ? t("generateSlide.modeLiveDesc") : t("generateSlide.modeStaticDesc")}
          </div>

          <div className="px-3">
            <button
              type="button"
              onClick={() => { onInsert(mode); setOpen(false); }}
              className="w-full px-2 py-1.5 rounded bg-accent text-on-accent hover:opacity-90 text-xs font-medium"
            >
              {t("generateSlide.insert")}
            </button>
          </div>

          {mode === "static" && (
            <>
              <div className="my-2 h-px bg-edge" />
              <div className="px-3">
                <button
                  type="button"
                  onClick={() => { onRegenerateActive(); setOpen(false); }}
                  disabled={!hasActiveSlide}
                  title={t("generateSlide.regenerateTitle")}
                  className="w-full text-left px-2 py-1.5 rounded text-fg2 hover:bg-edge text-xs disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  ♻️ {t("generateSlide.regenerate")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
