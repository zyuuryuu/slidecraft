/**
 * WideSegmentMenu.tsx — ux-budget のセグメント行の選択肢数の検査（Hick・#716）が違反を見落とさないかを確かめる、
 * 意図的に違反した fixture。上部バーの入口 → メニューの中のセグメント行（選択肢 5＝予算 4 に 1 つ足した数）。
 * 画面には使わない。形は ThemeToggle／LanguageToggle／HtmlTransitionPicker と同じ（role="group"＋aria-pressed）。
 */
import { useState } from "react";

const OPTIONS = ["a", "b", "c", "d", "e"];

export default function WideSegmentMenu() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("a");
  return (
    <div className="relative">
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Settings</button>
      {open && (
        <div className="absolute top-full">
          <div role="group" aria-label="wide">
            {OPTIONS.map((o) => (
              <button key={o} aria-pressed={value === o} onClick={() => setValue(o)}>{o}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
