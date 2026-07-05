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
  /** AI スペック提案（テーマ2 S5）: 説明 → 検証済み TemplateSpec。省略時は AI 行を出さない。 */
  onProposeSpec?: (description: string) => Promise<TemplateSpec>;
  /** AI 接続が生成可能な状態か（未設定なら提案ボタンを無効化して案内を出す）。 */
  aiReady?: boolean;
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
  "w-full px-2 py-1 rounded bg-canvas border border-edge text-sm text-fg focus:border-accent outline-none";

export default function TemplateCreator({ isOpen, onCancel, onCreate, onProposeSpec, aiReady }: TemplateCreatorProps) {
  const [name, setName] = useState("マイテンプレート");
  const [majorFont, setMajorFont] = useState("Georgia");
  const [minorFont, setMinorFont] = useState("Calibri");
  const [palette, setPalette] = useState<Record<PaletteKey, string>>({ ...MIDNIGHT_PALETTE });
  const [busy, setBusy] = useState(false);
  const [aiDesc, setAiDesc] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  if (!isOpen) return null;

  // AI は提案のみ（フォームに反映するだけ）— 生成・適用は従来どおりユーザの「生成して適用」で。
  const propose = async () => {
    if (!onProposeSpec || !aiDesc.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const spec = await onProposeSpec(aiDesc.trim());
      setName(spec.name);
      setMajorFont(spec.fonts.major);
      setMinorFont(spec.fonts.minor);
      setPalette({ ...spec.palette });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

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
      className="fixed inset-0 z-40 bg-void/60 flex items-center justify-center p-4"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="テンプレを作成"
        className="bg-void border border-accent/40 rounded-lg shadow-2xl w-full max-w-lg flex flex-col"
      >
        <div className="px-4 py-2.5 border-b border-edge flex items-center justify-between">
          <span className="text-sm font-medium text-fg">🎨 テンプレを作成</span>
          <button onClick={onCancel} className="text-muted hover:text-fg2 text-sm">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs text-fg2 overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {onProposeSpec && (
            <div className="flex flex-col gap-1.5 pb-3 border-b border-edge">
              <span className="text-muted">✨ AI におまかせ（雰囲気・用途を書くと下のフォームに提案を反映）</span>
              <div className="flex gap-2">
                <input
                  value={aiDesc}
                  onChange={(e) => setAiDesc(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void propose(); }}
                  className={inputCls}
                  placeholder="例: 官公庁向けの落ち着いた報告書、緑基調"
                />
                <button
                  onClick={() => void propose()}
                  disabled={!aiReady || !aiDesc.trim() || aiBusy}
                  title={aiReady ? "AI に配色とフォントを提案させる" : "AI 接続が未設定です（✨AI ドックで設定）"}
                  className="px-3 py-1 shrink-0 rounded bg-edge hover:bg-accent/40 text-fg disabled:opacity-40"
                >
                  {aiBusy ? "提案中…" : "提案"}
                </button>
              </div>
              {aiError && <span className="text-red-400">{aiError}</span>}
            </div>
          )}
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
            <span className="text-muted">配色</span>
            <button
              onClick={() => setPalette({ ...MIDNIGHT_PALETTE })}
              className="text-accent-soft hover:text-fg"
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
                  className="w-7 h-7 rounded border border-edge bg-transparent p-0 shrink-0 cursor-pointer"
                />
                <span className="truncate" title={PALETTE_LABELS[key]}>{PALETTE_LABELS[key]}</span>
              </label>
            ))}
          </div>

          <p className="text-faint leading-relaxed">
            レイアウトは内蔵 30 種（表紙/セクション/本文/2-3カラム/KPI/チャート/表/比較/プロセス/クロージング）。
            作成するとこのデッキに適用され、マスター一覧にも登録されます。
          </p>
        </div>

        <div className="px-4 py-2.5 border-t border-edge flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded text-fg2 hover:bg-edge">
            キャンセル
          </button>
          <button
            onClick={create}
            disabled={!name.trim() || busy}
            className="px-3 py-1.5 text-sm rounded bg-accent hover:bg-accent-hi text-on-accent disabled:opacity-40"
          >
            {busy ? "生成中…" : "生成して適用"}
          </button>
        </div>
      </div>
    </div>
  );
}
