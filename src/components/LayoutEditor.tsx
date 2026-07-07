/**
 * LayoutEditor.tsx — form editor for CUSTOM layout definitions (テーマ2 後続・カスタムレイアウト定義).
 *
 * Edits a list of LayoutDef (the same shape template-writer consumes) — name, family, and a set of
 * placeholders (role type + inch geometry + font/colour/align). No drag canvas: numeric fields keep
 * it deterministic and small; the TemplateCreator's live preview shows the result immediately (each
 * custom layout is pinned to a showcase slide). Placeholder `idx` is auto-assigned by position, so
 * the user never hand-manages it. Output feeds spec.layouts (appended to the chosen built-ins).
 */
import { useTranslation } from "react-i18next";
import { PALETTE_KEYS, type PaletteKey, type LayoutDef, type LayoutPhDef } from "../engine/template-layout-library";

// Stable placeholder-type enum values (kept module-level); the UI labels are translated at render time.
const PH_TYPE_VALUES = ["ctrTitle", "body", "subTitle", "sldNum"] as const; // `as const` → t() key narrows to the valid union
// Stable alignment enum values; UI labels are translated at render time.
const ALIGN_VALUES = ["l", "ctr", "r"] as const;
const GEO: ("x" | "y" | "w" | "h")[] = ["x", "y", "w", "h"];

const cls = "px-1.5 py-0.5 rounded bg-canvas border border-edge text-fg outline-none focus:border-accent";
const numCls = `${cls} w-12 tabular-nums`;

function newPlaceholder(idx: number): LayoutPhDef {
  return { name: `Placeholder ${idx + 1}`, type: "body", idx, x: 1.2, y: 2.2, w: 10.5, h: 4, fontSize: 18, font: "minor", color: "bodyText", bold: false, align: "l" };
}
function newLayout(n: number): LayoutDef {
  return {
    name: `カスタム${n}`,
    family: "light",
    placeholders: [
      { name: "Title", type: "ctrTitle", idx: 0, x: 1.2, y: 0.8, w: 10.5, h: 1.2, fontSize: 40, font: "major", color: "titleText", bold: true, align: "l" },
      { name: "Body", type: "body", idx: 1, x: 1.2, y: 2.2, w: 10.5, h: 4.5, fontSize: 18, font: "minor", color: "bodyText", bold: false, align: "l" },
    ],
  };
}

export default function LayoutEditor({ layouts, onChange }: { layouts: LayoutDef[]; onChange: (l: LayoutDef[]) => void }) {
  const { t } = useTranslation();
  // Enum value → translated label, built inside the component so the hook order is respected.
  const phTypes: { v: string; l: string }[] = PH_TYPE_VALUES.map((v) => ({ v, l: t(`layoutEditor.phType.${v}`) }));
  const aligns: { v: string; l: string }[] = ALIGN_VALUES.map((v) => ({ v, l: t(`layoutEditor.align.${v}`) }));

  const update = (i: number, patch: Partial<LayoutDef>) => onChange(layouts.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const updatePh = (i: number, j: number, patch: Partial<LayoutPhDef>) =>
    update(i, { placeholders: layouts[i].placeholders.map((p, k) => (k === j ? { ...p, ...patch } : p)) });
  // Removing a placeholder re-indexes idx by position so multi-body ordering stays 0..n-1.
  const removePh = (i: number, j: number) =>
    update(i, { placeholders: layouts[i].placeholders.filter((_, k) => k !== j).map((p, k) => ({ ...p, idx: k })) });

  return (
    <div className="flex flex-col gap-2">
      {layouts.map((lay, i) => (
        <div key={i} className="border border-edge rounded p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input value={lay.name} onChange={(e) => update(i, { name: e.target.value })} className={`${cls} flex-1`} placeholder={t("layoutEditor.layoutNamePlaceholder")} />
            <select value={lay.family} onChange={(e) => update(i, { family: e.target.value as "dark" | "light" })} className={cls}>
              <option value="light">{t("layoutEditor.familyLight")}</option>
              <option value="dark">{t("layoutEditor.familyDark")}</option>
            </select>
            <button onClick={() => onChange(layouts.filter((_, k) => k !== i))} className="text-muted hover:text-red-400" title={t("layoutEditor.deleteLayout")}>✕</button>
          </div>
          <div className="flex flex-col gap-1">
            {lay.placeholders.map((ph, j) => (
              <div key={j} className="flex flex-wrap items-center gap-1 text-[11px]">
                <select value={ph.type} onChange={(e) => updatePh(i, j, { type: e.target.value })} className={cls}>
                  {phTypes.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
                {GEO.map((f) => (
                  <label key={f} className="flex items-center gap-0.5">
                    <span className="text-faint">{f}</span>
                    {/* Guard non-finite input ('-', '1e', '.') → NaN would emit malformed OOXML (x="NaN"). */}
                    <input type="number" step={0.1} value={ph[f]} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) updatePh(i, j, { [f]: n }); }} className={numCls} />
                  </label>
                ))}
                <label className="flex items-center gap-0.5">
                  <span className="text-faint">pt</span>
                  <input type="number" step={1} value={ph.fontSize} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) updatePh(i, j, { fontSize: n }); }} className={numCls} />
                </label>
                <select value={ph.font} onChange={(e) => updatePh(i, j, { font: e.target.value as "major" | "minor" })} className={cls}>
                  <option value="major">{t("layoutEditor.fontMajor")}</option>
                  <option value="minor">{t("layoutEditor.fontMinor")}</option>
                </select>
                <select value={ph.color} onChange={(e) => updatePh(i, j, { color: e.target.value as PaletteKey })} className={cls}>
                  {PALETTE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <select value={ph.align} onChange={(e) => updatePh(i, j, { align: e.target.value })} className={cls}>
                  {aligns.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
                </select>
                <label className="flex items-center gap-0.5">
                  <input type="checkbox" checked={ph.bold} onChange={(e) => updatePh(i, j, { bold: e.target.checked })} />
                  <span className="text-faint">{t("layoutEditor.bold")}</span>
                </label>
                <button onClick={() => removePh(i, j)} className="text-muted hover:text-red-400" title={t("layoutEditor.deletePlaceholder")}>－</button>
              </div>
            ))}
            <button onClick={() => update(i, { placeholders: [...lay.placeholders, newPlaceholder(lay.placeholders.length)] })} className="self-start text-accent-soft hover:text-fg">
              {t("layoutEditor.addPlaceholder")}
            </button>
          </div>
        </div>
      ))}
      <button onClick={() => onChange([...layouts, newLayout(layouts.length + 1)])} className="self-start text-accent-soft hover:text-fg">
        {t("layoutEditor.addCustomLayout")}
      </button>
    </div>
  );
}
