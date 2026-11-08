/**
 * DeepMenu.tsx — ux-budget のネスト深さ検査（menuDepth）が正しく数えるかを確かめる、意図的に違反した fixture。
 * 上部バー → メニュー → サブメニュー → 項目（深さ 3）。画面には使わない。
 */
export default function DeepMenu() {
  return (
    <div>
      <div className="relative">
        <button>File</button>
        <div className="absolute top-full">
          <button>Open</button>
          <div className="relative">
            <button>Export ▸</button>
            <div className="absolute left-full">
              <button>Deep item</button>
            </div>
          </div>
        </div>
      </div>
      <span className="absolute">badge</span>
      <button>Plain</button>
    </div>
  );
}
