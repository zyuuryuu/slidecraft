/**
 * DeepMenu.tsx — ux-budget のネスト深さ検査が正しく数えるかを確かめる、意図的に違反した fixture。
 * 上部バー → メニュー → サブメニュー → 項目（深さ 3）。画面には使わない。
 *
 * #724: メニューは押すと開く（useState）。数え方は 2 通りあり、どちらも深さ 3 と数えること:
 *  - 全部「開」で描いた HTML の入れ子（probes の menuDepth・ux-budget.test.tsx の forceOpen）
 *  - 入口（aria-haspopup）を実際に押して開く（ux-budget-dom.ts の openDepth・Portal でも数えられる方式）
 */
import { useState } from "react";

export default function DeepMenu() {
  const [file, setFile] = useState(false);
  const [exp, setExp] = useState(false);
  return (
    <div>
      <div className="relative">
        <button aria-haspopup="menu" aria-expanded={file} onClick={() => setFile((v) => !v)}>File</button>
        {file && (
          <div className="absolute top-full">
            <button>Open</button>
            <div className="relative">
              <button aria-haspopup="menu" aria-expanded={exp} onClick={() => setExp((v) => !v)}>Export ▸</button>
              {exp && (
                <div className="absolute left-full">
                  <button>Deep item</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <span className="absolute">badge</span>
      <button>Plain</button>
    </div>
  );
}
