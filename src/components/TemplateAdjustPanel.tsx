/**
 * TemplateAdjustPanel.tsx — #570 段 2「テンプレ調整」の操作帯。ツールバー直下のフロー帯として出す（モーダルの
 * 背景幕でメインプレビューを隠さない＝調整がプレビューに即反映されるのを見ながら動かせる）。
 *
 * 書体 2 つ（見出し／本文。テンプレが両者で同じ名前を使うときは「共通」1 つ）＋置換の対象（テーマのみ／
 * テーマ＋直書き）＋文字サイズのスライダ 3 本（タイトル／本文／その他）。値が変わるたびに少し待ってから
 * レシピ（engine/template-adjust の recipeFor）を onPreview へ渡す。適用・取り消しは呼び出し側（useTemplateAdjust）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fontsLinked, isNoopRecipe, recipeFor, type FontScope, type SizeClass, type TemplateAdjustRecipe } from "../engine/template-adjust";
import type { AdjustSession } from "./useTemplateAdjust";

const FONT_SUGGESTIONS = [
  "Yu Gothic", "Yu Mincho", "Meiryo", "BIZ UDPGothic", "BIZ UDPMincho", "MS PGothic", "MS PMincho",
  "Noto Sans JP", "Noto Serif JP", "Arial", "Calibri", "Georgia", "Segoe UI", "Times New Roman",
];
const DEBOUNCE_MS = 250;
const DEFAULT_PCT: Record<SizeClass, number> = { title: 100, body: 100, other: 100 };

interface Props {
  session: AdjustSession;
  busy: boolean;
  onPreview: (recipe: TemplateAdjustRecipe) => void;
  onApply: (recipe: TemplateAdjustRecipe) => void;
  onCancel: () => void;
}

const inputCls = "w-40 px-2 py-1 rounded bg-canvas border border-edge text-sm text-fg focus:border-accent outline-none";

export default function TemplateAdjustPanel({ session, busy, onPreview, onApply, onCancel }: Props) {
  const { t } = useTranslation();
  const { slots } = session;
  const linked = fontsLinked(slots);
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<FontScope>("theme+inline");
  const [pct, setPct] = useState<Record<SizeClass, number>>(DEFAULT_PCT);

  const recipe = useMemo(() => recipeFor(slots, {
    heading: heading.trim(),
    body: body.trim(),
    scope,
    scale: { title: pct.title / 100, body: pct.body / 100, other: pct.other / 100 },
  }), [slots, heading, body, scope, pct]);

  // Live preview, debounced. Until the user first changes something the source as-is is already applied,
  // so the initial recipe is not sent (compared by value — StrictMode re-runs effects, so no "first" flag).
  const initialKey = useRef(JSON.stringify(recipe));
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current && JSON.stringify(recipe) === initialKey.current) return;
    touched.current = true;
    const h = setTimeout(() => onPreview(recipe), DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [recipe, onPreview]);

  const visible = (s: { latin: string; ea: string; jpan: string }) => s.jpan || s.ea || s.latin;
  const fontField = (label: string, value: string, set: (v: string) => void, current: string) => (
    <label className="flex items-center gap-1.5">
      <span className="text-fg2">{label}</span>
      <input
        className={inputCls}
        list="template-adjust-fonts"
        value={value}
        placeholder={t("templateAdjust.fontPlaceholder", { name: current })}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  const slider = (c: SizeClass, label: string) => (
    <label key={c} className="flex items-center gap-1.5">
      <span className="text-fg2">{label}</span>
      <input
        type="range"
        min={50}
        max={150}
        step={5}
        value={pct[c]}
        aria-label={label}
        onChange={(e) => setPct((p) => ({ ...p, [c]: Number(e.target.value) }))}
        className="w-24 accent-accent"
      />
      <span className="w-10 tabular-nums text-fg">{pct[c]}%</span>
    </label>
  );
  const scopeBtn = (s: FontScope, label: string, title: string) => (
    <button
      type="button"
      aria-pressed={scope === s}
      title={title}
      onClick={() => setScope(s)}
      className={`px-2 py-1 text-xs ${scope === s ? "bg-accent/30 text-fg" : "bg-canvas text-fg2 hover:bg-edge"}`}
    >
      {label}
    </button>
  );
  const noop = isNoopRecipe(recipe);

  return (
    <section role="region" aria-label={t("templateAdjust.title")} className="border-b border-edge bg-surface px-3 py-2 text-sm">
      <datalist id="template-adjust-fonts">{FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-col">
          <span className="font-medium text-fg">🔤 {t("templateAdjust.title")}</span>
          <span className="text-xs text-muted truncate max-w-[220px]" title={t("templateAdjust.source", { name: session.sourceName })}>{t("templateAdjust.source", { name: session.sourceName })}</span>
        </div>
        {linked ? (
          <span title={t("templateAdjust.sharedHint")}>{fontField(t("templateAdjust.sharedFont"), heading, setHeading, visible(slots.major))}</span>
        ) : (
          <>
            {fontField(t("templateAdjust.headingFont"), heading, setHeading, visible(slots.major))}
            {fontField(t("templateAdjust.bodyFont"), body, setBody, visible(slots.minor))}
          </>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-fg2">{t("templateAdjust.scope")}</span>
          <div className="inline-flex rounded border border-edge overflow-hidden">
            {scopeBtn("theme+inline", t("templateAdjust.scopeInline"), t("templateAdjust.scopeInlineTitle"))}
            {scopeBtn("theme", t("templateAdjust.scopeTheme"), t("templateAdjust.scopeThemeTitle"))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" title={t("templateAdjust.sizeHint")}>
          {slider("title", t("templateAdjust.sizeTitle"))}
          {slider("body", t("templateAdjust.sizeBody"))}
          {slider("other", t("templateAdjust.sizeOther"))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {busy && <span role="status" className="text-xs text-muted">{t("templateAdjust.updating")}</span>}
          <button
            type="button"
            onClick={() => { setHeading(""); setBody(""); setScope("theme+inline"); setPct(DEFAULT_PCT); }}
            className="px-2 py-1 rounded text-fg2 hover:bg-edge"
          >
            {t("templateAdjust.reset")}
          </button>
          <button type="button" onClick={onCancel} className="px-3 py-1 rounded bg-edge text-fg hover:bg-accent/30">
            {t("templateAdjust.cancel")}
          </button>
          <button
            type="button"
            disabled={noop}
            onClick={() => onApply(recipe)}
            title={t("templateAdjust.applyTitle", { name: session.sourceName + t("app.adjustSuffix") })}
            className="px-3 py-1 rounded bg-accent hover:bg-accent-hi disabled:opacity-40 text-on-accent font-medium"
          >
            {t("templateAdjust.apply")}
          </button>
        </div>
      </div>
    </section>
  );
}
