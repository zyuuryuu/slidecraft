/**
 * GenerateSlideMenu.tsx — 「便利スライドを生成」ボタン＋メニュー（ADR-0034 / #277）。
 * タイプ選択（今回は目次のみ）→ live/static モード選択 → 挿入。static モードでは、選択中の
 * スライドを現在の章構成から作り直す「作り直す」アクションも並べる（ADR-0034 の明示再生成）。
 *
 * #739-5: 上部バーのメニューと同じ BarMenu（shadcn/ui の DropdownMenu＝Base UI の Menu）で描く。開閉・Portal・
 * Esc・外側クリック・項目を押したら閉じる、は部品が担う（以前は手製の document の mousedown／keydown）。
 * 区画・項目・名前は置き換え前と同じ: 項目は「挿入」と（static のとき）「作り直す」の 2 つ。モードの切り替えは
 * 項目でない行（role="group"＋aria-pressed・矢印キーは飛ばし Tab で届く・押してもメニューは閉じない）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BarMenuContent, BarMenuItem } from "./BarMenu";
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
  const [mode, setMode] = useState<GenerateSlideMode>("live"); // 既定は live（ADR-0034: 目次は乖離の害が大きい）

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" />}
        disabled={disabled}
        title={t("generateSlide.buttonTitle")}
        className="w-5 h-5 -my-0.5 flex items-center justify-center rounded text-muted hover:bg-accent hover:text-on-accent text-sm leading-none disabled:opacity-40"
      >
        📑
      </DropdownMenuTrigger>

      <BarMenuContent align="end" className="w-64 p-0 py-2 shadow-2xl">
        <div className="px-3 pb-2 text-xs text-muted">{t("generateSlide.typeLabel")}: {t("generateSlide.typeToc")}</div>

        <div className="px-3 pb-1 text-xs text-muted">{t("generateSlide.modeLabel")}</div>
        <div role="group" aria-label={t("generateSlide.modeLabel")} className="px-3 flex gap-1 mb-1">
          {(["live", "static"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
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
          <BarMenuItem
            onClick={() => onInsert(mode)}
            className="justify-center px-2 rounded bg-accent text-on-accent hover:opacity-90 focus:bg-accent focus:text-on-accent focus:opacity-90 text-xs font-medium"
          >
            {t("generateSlide.insert")}
          </BarMenuItem>
        </div>

        {mode === "static" && (
          <>
            <DropdownMenuSeparator className="my-2" />
            <div className="px-3">
              <BarMenuItem
                onClick={() => onRegenerateActive()}
                disabled={!hasActiveSlide}
                title={t("generateSlide.regenerateTitle")}
                className="px-2 rounded text-fg2 text-xs"
              >
                ♻️ {t("generateSlide.regenerate")}
              </BarMenuItem>
            </div>
          </>
        )}
      </BarMenuContent>
    </DropdownMenu>
  );
}
