/**
 * DiffView — renders a before→after line diff so an AI edit is reviewable:
 * dropped lines (del) in red with a −, added lines (add) in green with a +,
 * unchanged lines muted. Makes "what did the AI change/remove?" visible before apply.
 */

import { lineDiff, diffStat } from "../engine/line-diff";

export default function DiffView({ before, after }: { before: string; after: string }) {
  const rows = lineDiff(before, after);
  const { del, add } = diffStat(rows);
  return (
    <div className="overflow-auto text-[11px] font-mono leading-relaxed" style={{ maxHeight: 160 }}>
      <div className="px-3 py-0.5 text-gray-500 sticky top-0 bg-[#0a0e1a]">
        変更: <span className="text-red-400">−{del}</span> <span className="text-green-400">+{add}</span>
        {del === 0 && add === 0 && <span className="text-gray-600"> （変更なし）</span>}
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
                  : "text-gray-500"
            }
          >
            <span className="select-none text-gray-600">{r.type === "del" ? "−" : r.type === "add" ? "+" : " "} </span>
            {r.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}
