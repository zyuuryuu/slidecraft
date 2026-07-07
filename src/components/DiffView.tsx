/**
 * DiffView — renders a before→after line diff so an AI edit is reviewable:
 * dropped lines (del) in red with a −, added lines (add) in green with a +,
 * unchanged lines muted. Makes "what did the AI change/remove?" visible before apply.
 */

import { useTranslation } from "react-i18next";
import { lineDiff, diffStat } from "../engine/line-diff";

export default function DiffView({ before, after, fill }: { before: string; after: string; fill?: boolean }) {
  const { t } = useTranslation();
  const rows = lineDiff(before, after);
  const { del, add } = diffStat(rows);
  return (
    <div
      className={`overflow-auto text-[11px] font-mono leading-relaxed ${fill ? "flex-1 min-h-0" : ""}`}
      style={fill ? undefined : { maxHeight: 160 }}
    >
      <div className="px-3 py-0.5 text-faint sticky top-0 bg-void">
        {t("diffView.changes")} <span className="text-red-400">−{del}</span> <span className="text-green-400">+{add}</span>
        {del === 0 && add === 0 && <span className="text-dim"> {t("diffView.noChanges")}</span>}
      </div>
      <div className="px-3 pb-2">
        {rows.map((r, i) => (
          <div
            key={i}
            className={
              r.type === "del"
                ? "text-red-300 bg-red-900/20"
                : r.type === "add"
                  ? "text-green-200 bg-green-900/20"
                  : "text-faint"
            }
          >
            <span className="select-none text-dim">{r.type === "del" ? "−" : r.type === "add" ? "+" : " "} </span>
            {r.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}
