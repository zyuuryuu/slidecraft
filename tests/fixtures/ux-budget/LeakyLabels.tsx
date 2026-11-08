/**
 * LeakyLabels.tsx — ux-budget の i18n 漏れ検査（i18nLeaks）が正しく数えるかを確かめる、意図的に違反した fixture。
 * 画面には使わない。期待値は tests/ux-budget.test.tsx の「道具の自己検査」。
 */
import { useTranslation } from "react-i18next";

export default function LeakyLabels({ busy, mode }: { busy: boolean; mode: string }) {
  const { t } = useTranslation();
  // A comment with English words — "Save the file" — is not a label.
  return (
    <div title="Leaky title">
      {/* JSX comment: 保存する */}
      <button aria-label={t("toolbar.undo")}>↶</button>
      <button>保存する</button>
      <input placeholder={busy ? "Loading…" : t("toolbar.file")} />
      <span>{mode === "locked" ? t("toolbar.redo") : "Ready"}</span>
      <span aria-label={`${mode} items`}>⚙ ▾ 12</span>
    </div>
  );
}
