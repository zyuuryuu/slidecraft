/**
 * TemplateCreator.tsx — 新規テンプレ作成モーダル（テーマ2 S4）。
 *
 * パレット（セマンティック配色 9 スロット）とフォント（見出し/本文）・名前を編集し、
 * template-writer（ゼロから生成）でテンプレ PPTX を作ってレジストリ登録＋適用する。
 * 生成→適用後はメインプレビューが即時反映されるので、モーダル内に埋め込みプレビューは
 * 持たない（作り直しは再オープンで反復）。レイアウトは組み込み 30 種固定（サブセット UI は後続）。
 */
import { useState } from "react";
import { MIDNIGHT_PALETTE, type TemplateSpec } from "../engine/template-writer";
import { PALETTE_KEYS, type PaletteKey } from "../engine/template-layout-library";

interface TemplateCreatorProps {
  isOpen: boolean;
  onCancel: () => void;
  /** 生成・登録・適用は呼び出し側（App）が行う。resolve 後にモーダルは閉じられる。 */
  onCreate: (spec: TemplateSpec) => Promise<void>;
}

const PALETTE_LABELS: Record<PaletteKey, string> = {
  background: "背景（カバー/ヘッダーバー）",
  canvas: "背景（コンテンツ）",
  titleText: "タイトル文字",
  bodyText: "本文文字",
  subtle: "補助文字（カバー上）",
  muted: "弱い文字（出典など）",
  accent: "アクセント",
  accent2: "第2アクセント",
  emphasis: "強調数字（KPI）",
};

const inputCls =
  "w-full px-2 py-1 rounded bg-[#0f1117] border border-[#2D3A6E] text-sm text-gray-100 focus:border-[#3B82F6] outline-none";

export default function TemplateCreator({ isOpen, onCancel, onCreate }: TemplateCreatorProps) {
  const [name, setName] = useState("マイテンプレート");
  const [majorFont, setMajorFont] = useState("Georgia");
  const [minorFont, setMinorFont] = useState("Calibri");
  const [palette, setPalette] = useState<Record<PaletteKey, string>>({ ...MIDNIGHT_PALETTE });
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const setColor = (key: PaletteKey, hex: string) =>
    setPalette((p) => ({ ...p, [key]: hex.replace(/^#/, "").toUpperCase() }));

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), fonts: { major: majorFont.trim() || "Georgia", minor: minorFont.trim() || "Calibri" }, palette });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="テンプレを作成"
        className="bg-[#0a0e1a] border border-[#3B82F6]/40 rounded-lg shadow-2xl w-full max-w-lg flex flex-col"
      >
        <div className="px-4 py-2.5 border-b border-[#2D3A6E] flex items-center justify-between">
          <span className="text-sm font-medium text-gray-100">🎨 テンプレを作成</span>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-200 text-sm">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs text-gray-300 overflow-y-auto" style={{ maxHeight: "70vh" }}>
          <label className="flex flex-col gap-1">
            <span>テンプレ名</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span>見出しフォント</span>
              <input value={majorFont} onChange={(e) => setMajorFont(e.target.value)} className={inputCls} placeholder="Georgia" />
            </label>
            <label className="flex flex-col gap-1">
              <span>本文フォント</span>
              <input value={minorFont} onChange={(e) => setMinorFont(e.target.value)} className={inputCls} placeholder="Calibri" />
            </label>
          </div>

          <div className="flex items-center justify-between mt-1">
            <span className="text-gray-400">配色</span>
            <button
              onClick={() => setPalette({ ...MIDNIGHT_PALETTE })}
              className="text-[#93C5FD] hover:text-white"
              title="内蔵 Midnight Executive の配色に戻す"
            >
              既定に戻す
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {PALETTE_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="color"
                  value={`#${palette[key]}`}
                  onChange={(e) => setColor(key, e.target.value)}
                  className="w-7 h-7 rounded border border-[#2D3A6E] bg-transparent p-0 shrink-0 cursor-pointer"
                />
                <span className="truncate" title={PALETTE_LABELS[key]}>{PALETTE_LABELS[key]}</span>
              </label>
            ))}
          </div>

          <p className="text-gray-500 leading-relaxed">
            レイアウトは内蔵 30 種（表紙/セクション/本文/2-3カラム/KPI/チャート/表/比較/プロセス/クロージング）。
            作成するとこのデッキに適用され、マスター一覧にも登録されます。
          </p>
        </div>

        <div className="px-4 py-2.5 border-t border-[#2D3A6E] flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded text-gray-300 hover:bg-[#2D3A6E]">
            キャンセル
          </button>
          <button
            onClick={create}
            disabled={!name.trim() || busy}
            className="px-3 py-1.5 text-sm rounded bg-[#3B82F6] hover:bg-[#2563EB] text-white disabled:opacity-40"
          >
            {busy ? "生成中…" : "生成して適用"}
          </button>
        </div>
      </div>
    </div>
  );
}
