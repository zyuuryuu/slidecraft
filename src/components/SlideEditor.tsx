/**
 * SlideEditor.tsx — Per-slide editing panel.
 *
 * Shows editable fields for each placeholder in the selected slide.
 * For diagram slides, shows the YAML editor inline.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SlideIR, Paragraph } from "../engine/slide-schema";
import type { LayoutInfo } from "../engine/template-loader";
import { LAYOUT_NAMES } from "../engine/slide-schema";
import { buildFieldMap, bodyPlaceholders, nthBody, imagePlaceholder, imageRect, imageAspectRatio, SLIDE_IN, applyFieldEdit } from "../engine/placeholder-binding";
import { groupEditorPlan } from "../engine/group-binding";
import DiagramEditor from "./DiagramEditor";

interface SlideEditorProps {
  slide: SlideIR;
  layout: LayoutInfo | undefined;
  /** The LOADED template's actual layout names for the picker. Falls back to the canonical names
   *  when no template is loaded. (Offering canonical names for a non-canonical master made the picker
   *  a no-op: every pick was absent from the catalog and degraded to the same layout.) */
  layoutNames?: string[];
  /** The layout `Auto` actually resolved to (so the UI can show "Auto → X"). */
  resolvedLayout?: string;
  /** Ranked layout candidates (auto pick first) — shown as one-click "also try" chips. */
  suggestions?: string[];
  onChange: (updated: SlideIR) => void;
}

// ── Placeholder label mapping ──

const PH_LABELS: Record<string, string> = {
  "0": "Title",
  "1": "Body / Subtitle",
  "2": "Secondary",
  "3": "Tertiary",
  "4": "Quaternary",
  "5": "Fifth",
  "6": "Sixth",
  "10": "Category",
  "11": "Date / Meta",
  "12": "Footer",
  "15": "Slide Title",
  "16": "Slide Subtitle",
  "50": "Slide Number",
};

function getLabel(idx: string, layoutPh: LayoutInfo | undefined): string {
  const phInfo = layoutPh?.placeholders.find((p) => p.idx === idx);
  if (phInfo?.name) return phInfo.name;
  return PH_LABELS[idx] || `Placeholder ${idx}`;
}

// ── Convert paragraphs to plain text for textarea ──

function paragraphsToText(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => {
      const text = p.segments.map((s) => {
        let t = s.text;
        if (s.bold) t = `**${t}**`;
        if (s.italic) t = `*${t}*`;
        return t;
      }).join("");
      if (p.heading) return `### ${text}`;
      return p.bullet ? `- ${text}` : text;
    })
    .join("\n");
}

// ── Convert plain text back to paragraphs ──

function textToParagraphs(text: string): Paragraph[] {
  return text.split("\n").map((line) => {
    const headingMatch = line.match(/^###\s+(.*)/);
    const bulletMatch = headingMatch ? null : line.match(/^[-*]\s+(.*)/);
    const content = headingMatch ? headingMatch[1] : bulletMatch ? bulletMatch[1] : line;

    // Parse inline formatting
    const segments: { text: string; bold?: boolean; italic?: boolean }[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[2]) segments.push({ text: m[2], bold: true });
      else if (m[3]) segments.push({ text: m[3], italic: true });
      else if (m[4]) segments.push({ text: m[4] });
    }
    if (segments.length === 0) segments.push({ text: content });

    return {
      segments,
      ...(headingMatch ? { heading: true } : bulletMatch ? { bullet: true } : {}),
    };
  });
}

export default function SlideEditor({ slide, layout, layoutNames, resolvedLayout, suggestions, onChange }: SlideEditorProps) {
  const { t } = useTranslation();
  // Layout is meta/structural (which master layout), changed rarely — collapse it by default so the
  // content fields lead; the header still shows the active layout, expand to change it.
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [aspectLock, setAspectLock] = useState(true); // resize keeps the image's aspect ratio (案B)
  // ── Update a specific placeholder ──
  const updatePlaceholder = useCallback(
    (idx: string, text: string) => {
      // Clearing a field DROPS its placeholder (applyFieldEdit) instead of leaving an empty paragraph.
      const newPlaceholders = applyFieldEdit(slide.placeholders, idx, textToParagraphs(text));
      onChange({ ...slide, placeholders: newPlaceholders });
    },
    [slide, onChange],
  );

  // ── Update layout ──
  const updateLayout = useCallback(
    (newLayout: string) => {
      onChange({ ...slide, layout: newLayout });
    },
    [slide, onChange],
  );

  // ── Update diagram YAML ──
  const updateDiagramYaml = useCallback(
    (yaml: string) => {
      onChange({
        ...slide,
        diagram: slide.diagram
          ? { ...slide.diagram, yaml }
          : { yaml, placeholderIdx: "1" },
      });
    },
    [slide, onChange],
  );

  // ── Update mermaid syntax ──
  const updateMermaid = useCallback(
    (mermaidText: string) => {
      onChange({
        ...slide,
        mermaidBlock: slide.mermaidBlock
          ? { ...slide.mermaidBlock, mermaid: mermaidText }
          : { mermaid: mermaidText, placeholderIdx: "1" },
      });
    },
    [slide, onChange],
  );

  // The field map: a VERIFIED 1:1 between the layout's editable placeholders and the content idxs
  // this editor reads/writes. Each field owns exactly one content slot, so editing one can NEVER
  // touch another (no bleed), and what you type role-binds back to that placeholder (buildFieldMap
  // proves both, for every bundled template). Auto slide-number placeholders are excluded. With no
  // template loaded, fall back to the slide's own placeholders (identity map).
  // A GROUPED slide (card/step/kpi) edits ONE field per group (content idx 1..N = the group's
  // "### 見出し\n本文" markdown) instead of buildFieldMap over the layout's many per-group cells. Meta
  // (title/date/…) still uses buildFieldMap on the NON-group placeholders. Non-grouped slides keep the
  // full buildFieldMap 1:1 path unchanged.
  const groupPlan = layout ? groupEditorPlan(slide, layout) : null;
  const groupN = groupPlan
    ? Math.max(groupPlan.columns, slide.placeholders.filter((c) => /^[1-9]$/.test(c.idx)).length)
    : 0;
  const fields = groupPlan
    ? [
        ...buildFieldMap(slide, groupPlan.metaPhs),
        ...Array.from({ length: groupN }, (_, k) => ({ phIdx: String(k + 1), contentIdx: String(k + 1) })),
      ]
    : layout
      ? buildFieldMap(slide, layout.placeholders)
      : slide.placeholders.map((p) => ({ phIdx: p.idx, contentIdx: p.idx }));

  // Which RAW placeholder idxs are occupied by a diagram/mermaid/table? Each rides the Nth BODY
  // placeholder, and its placeholderIdx is a 1-based body ORDINAL — NOT a raw idx. Resolve it via
  // nthBody (exactly as the preview + export do), else on a gapped-body layout (bodies at [1,3]) the
  // editor would show a text field OVER the diagram's box and silently drop what you type on export.
  const bodyPhs = layout ? bodyPlaceholders(layout.placeholders) : [];
  const visualIdx = new Set(
    [
      slide.diagram && nthBody(bodyPhs, slide.diagram.placeholderIdx)?.idx,
      slide.mermaidBlock && nthBody(bodyPhs, slide.mermaidBlock.placeholderIdx)?.idx,
      slide.table && nthBody(bodyPhs, slide.table.placeholderIdx)?.idx,
      slide.code && nthBody(bodyPhs, slide.code.placeholderIdx)?.idx,
      // A BEHIND image occupies no placeholder → don't suppress any field (the body text stays editable).
      slide.image && !slide.image.behind && layout && imagePlaceholder(layout.placeholders, slide.image.placeholderIdx)?.idx,
    ].filter((x): x is string => !!x),
  );
  // The concrete placeholder the image is bound to (role-resolved, as the preview/export do) — so the
  // form can say WHICH placeholder holds it, not just that an image exists. B: a real PICTURE frame
  // (type="pic") wins when the master has one; else it resolves to the body region as before.
  const imagePh = slide.image && !slide.image.behind && layout ? imagePlaceholder(layout.placeholders, slide.image.placeholderIdx) : undefined;
  // Fine-tune geometry (案B): the manual rect override, else the resolved placeholder box (a behind
  // image rides the SAME box as a body figure — normal size, just at the back). Editing promotes to rect.
  const imageBoxPh = slide.image && layout ? imagePlaceholder(layout.placeholders, slide.image.placeholderIdx) : undefined;
  const imgBox = slide.image ? imageRect(slide.image, imageBoxPh) : undefined;
  const imgAspect = slide.image ? imageAspectRatio(slide.image, imgBox) : undefined;
  const updateImageRect = (k: "x" | "y" | "w" | "h", val: number) => {
    if (!slide.image || !imgBox || !Number.isFinite(val)) return;
    // W/H must stay positive and X/Y non-negative — a 0/negative dimension makes the image invisible in
    // preview AND emits a broken 0×0 <p:pic> (the drag path already guards this via dragImageRect's MIN).
    const v = k === "w" || k === "h" ? Math.max(0.1, val) : Math.max(0, val);
    let next = { ...(slide.image.rect ?? imgBox), [k]: v };
    if (aspectLock && imgAspect && imgAspect > 0) {
      if (k === "w") next = { ...next, h: v / imgAspect };
      else if (k === "h") next = { ...next, w: v * imgAspect };
    }
    onChange({ ...slide, image: { ...slide.image, rect: next } });
  };
  // Size SLIDER: scale the image to width `w` (aspect-locked), keeping its CENTER fixed so it grows/
  // shrinks in place. Clamped onto the slide. The numeric X/Y/W/H stay for precision.
  const updateImageSize = (w: number) => {
    if (!slide.image || !imgBox || !Number.isFinite(w)) return;
    const nw = Math.max(0.3, Math.min(w, SLIDE_IN.w));
    const nh = imgAspect && imgAspect > 0 ? nw / imgAspect : imgBox.h * (nw / imgBox.w);
    const cx = imgBox.x + imgBox.w / 2, cy = imgBox.y + imgBox.h / 2;
    const rect = {
      x: Math.min(Math.max(0, cx - nw / 2), Math.max(0, SLIDE_IN.w - nw)),
      y: Math.min(Math.max(0, cy - nh / 2), Math.max(0, SLIDE_IN.h - nh)),
      w: nw,
      h: nh,
    };
    onChange({ ...slide, image: { ...slide.image, rect } });
  };
  const toggleImageFit = () =>
    slide.image && onChange({ ...slide, image: { ...slide.image, fit: slide.image.fit === "cover" ? "contain" : "cover" } });
  const resetImageRect = () => {
    if (!slide.image) return;
    const img = { ...slide.image };
    delete img.rect;
    onChange({ ...slide, image: img });
  };
  // Switch between a backmost layer (最背面, behind existing content, full-slide default) and a body
  // figure that occupies its placeholder. Clears the manual rect so each mode gets its natural box.
  const toggleImageBehind = () => {
    if (!slide.image) return;
    const img = { ...slide.image };
    delete img.rect;
    if (img.behind) delete img.behind;
    else { img.behind = true; img.fit = "cover"; }
    onChange({ ...slide, image: img });
  };

  // What the collapsed Layout header shows: the ACTIVE layout (Auto resolves to a concrete name).
  const layoutLabel = slide.layout === "auto" ? (resolvedLayout ? t("slideEditor.autoResolvedTo", { layout: resolvedLayout }) : t("slideEditor.auto")) : slide.layout;

  return (
    <div className="h-full overflow-auto p-3 flex flex-col gap-3">
      {/* Layout = meta/structural, collapsed by default. The header row shows the ACTIVE (resolved)
          layout so nothing is hidden; expanding reveals the full picker + ranked candidate chips. */}
      <div>
        <button
          type="button"
          onClick={() => setLayoutOpen((o) => !o)}
          aria-expanded={layoutOpen}
          className="w-full flex items-center justify-between gap-2 py-0.5 text-left group"
        >
          <span className="text-[10px] text-faint uppercase tracking-wider">Layout</span>
          <span className="flex items-center gap-1 min-w-0 text-[11px] text-muted group-hover:text-fg2">
            <span className="truncate">{layoutLabel}</span>
            <span className="shrink-0 text-dim">{layoutOpen ? "▾" : "▸"}</span>
          </span>
        </button>

        {layoutOpen && (
          <div className="mt-1">
            <select
              value={slide.layout}
              onChange={(e) => updateLayout(e.target.value)}
              className="w-full px-2 py-1.5 bg-field border border-edge rounded text-sm text-fg"
            >
              <option value="auto">{resolvedLayout ? t("slideEditor.autoResolvedTo", { layout: resolvedLayout }) : t("slideEditor.auto")}</option>
              {(layoutNames && layoutNames.length > 0 ? layoutNames : LAYOUT_NAMES).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {/* Ranked candidates (★ = Auto's top pick = best score; the rest are the next-best) + an Auto
                toggle. Picking a candidate PINS it; ⟳Auto re-adapts (keeps slide.layout === "auto"). */}
            {suggestions && suggestions.length > 1 && (
              <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-faint">{t("slideEditor.candidates")}</span>
                {suggestions.map((name, i) => {
                  const active = slide.layout === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => updateLayout(name)}
                      title={i === 0 ? t("slideEditor.topCandidateTitle") : t("slideEditor.nextCandidateTitle")}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        active ? "bg-accent border-accent text-on-accent" : "bg-field border-edge text-fg2 hover:border-accent/60"
                      }`}
                    >
                      {i === 0 && "★ "}{name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => updateLayout("auto")}
                  title={t("slideEditor.resetToAutoTitle")}
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                    slide.layout === "auto" ? "bg-accent border-accent text-on-accent" : "bg-field border-edge text-fg2 hover:border-accent/60"
                  }`}
                >
                  ⟳ Auto
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Placeholder fields — one per field-map slot, reading/writing its own content idx (1:1). For a
          grouped slide, idx 1..N are GROUP fields (### 見出し + 本文); meta fields stay buildFieldMap. */}
      {fields.map(({ phIdx, contentIdx }) => {
        const isGroup = !!groupPlan && /^[1-9]$/.test(phIdx);
        const over = isGroup && Number(phIdx) > groupPlan!.columns;
        const label = isGroup
          ? `${t("slideEditor.group", { n: phIdx })}${over ? ` ${t("slideEditor.groupOverflow")}` : ""}`
          : getLabel(phIdx, layout);
        const currentText = paragraphsToText(
          slide.placeholders.find((p) => p.idx === contentIdx)?.paragraphs || [],
        );

        // Skip the placeholder a diagram/mermaid/table occupies (edited in the block editor below).
        if (visualIdx.has(phIdx)) return null;

        return (
          <div key={phIdx}>
            <label className={`text-[10px] uppercase tracking-wider ${over ? "text-danger-soft" : "text-faint"}`}>
              {label}
              {!isGroup && <span className="text-dim ml-1">(idx {phIdx})</span>}
            </label>
            <textarea
              value={currentText}
              onChange={(e) => updatePlaceholder(contentIdx, e.target.value)}
              rows={isGroup ? 4 : phIdx === "1" || phIdx === "2" ? 6 : 2}
              className="w-full mt-0.5 px-2 py-1.5 bg-field border border-edge rounded text-sm text-fg font-mono resize-y"
              placeholder={isGroup ? t("slideEditor.groupPlaceholder") : label}
            />
          </div>
        );
      })}

      {/* Diagram / Mermaid editor with mode switching */}
      {(slide.diagram || slide.mermaidBlock) && (
        <DiagramEditor
          slide={slide}
          onUpdateDiagramYaml={updateDiagramYaml}
          onUpdateMermaid={updateMermaid}
          onChange={onChange}
        />
      )}

      {/* Image block — the body figure isn't a text field, so the form reflects it as a thumbnail + a
          remove (delete → the body reverts to an editable field). Replace = paste/drop another image. */}
      {slide.image && (
        <div className="border border-edge rounded p-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <img src={slide.image.src} alt={slide.image.alt} className="w-16 h-12 object-contain bg-field rounded shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="text-fg2">{t("slideEditor.image")}{slide.image.alt ? ` — ${slide.image.alt}` : ""}</div>
              {/* WHERE it sits: a backmost layer (最背面, behind the content) or WHICH placeholder it fills. */}
              <div className="truncate text-faint" title={t("slideEditor.replaceByPasteDrop")}>
                {slide.image.behind
                  ? t("slideEditor.backmostLayer")
                  : imagePh ? t("slideEditor.boundToPlaceholder", { label: getLabel(imagePh.idx, layout), idx: imagePh.idx }) : t("slideEditor.replaceByPasteDrop")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { const next = { ...slide }; delete next.image; onChange(next); }}
              title={t("slideEditor.deleteImage")}
              className="w-6 h-6 flex items-center justify-center rounded bg-field border border-edge text-fg2 hover:bg-danger hover:text-on-accent text-xs shrink-0"
            >
              🗑
            </button>
          </div>

          {/* Size SLIDER — the primary size control (numeric is fiddly); scales in place, aspect-locked. */}
          {imgBox && (
            <div className="flex items-center gap-2 text-[10px] text-faint">
              <span className="shrink-0">{t("slideEditor.size")}</span>
              <input
                type="range"
                min={0.5}
                max={Number(SLIDE_IN.w.toFixed(2))}
                step={0.05}
                value={Number(imgBox.w.toFixed(2))}
                onChange={(e) => updateImageSize(e.target.valueAsNumber)}
                title={t("slideEditor.sizeSliderTitle")}
                className="flex-1 accent-accent"
              />
              <span className="shrink-0 w-12 text-right tabular-nums">{Math.round((imgBox.w / SLIDE_IN.w) * 100)}%</span>
            </div>
          )}

          {/* Position/size fine-tune (案B): X/Y/W/H in inches, contain/cover, aspect-lock, reset. */}
          {imgBox && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
              {(["x", "y", "w", "h"] as const).map((k) => (
                <label key={k} className="flex items-center gap-0.5" title={k === "w" ? t("slideEditor.width") : k === "h" ? t("slideEditor.height") : k === "x" ? t("slideEditor.left") : t("slideEditor.top")}>
                  <span className="uppercase">{k}</span>
                  <input
                    type="number"
                    step="0.05"
                    min={k === "w" || k === "h" ? 0.1 : 0}
                    value={Number(imgBox[k].toFixed(2))}
                    onChange={(e) => updateImageRect(k, e.target.valueAsNumber)}
                    className="w-14 px-1 py-0.5 bg-field border border-edge rounded text-fg text-[10px]"
                  />
                </label>
              ))}
              <span>inch</span>
              <button
                type="button"
                onClick={toggleImageBehind}
                title={slide.image.behind ? t("slideEditor.replaceIntoBodyTitle") : t("slideEditor.makeBackmostTitle")}
                className={`px-1.5 py-0.5 rounded border ${slide.image.behind ? "bg-accent border-accent text-on-accent" : "bg-field border-edge text-fg2 hover:border-accent/60"}`}
              >
                {slide.image.behind ? t("slideEditor.backmost") : t("slideEditor.bodyFrame")}
              </button>
              <button
                type="button"
                onClick={toggleImageFit}
                title={t("slideEditor.fitTitle")}
                className="px-1.5 py-0.5 rounded border border-edge bg-field text-fg2 hover:border-accent/60"
              >
                {slide.image.fit === "cover" ? "◱ cover" : "▭ contain"}
              </button>
              <label className="flex items-center gap-0.5 cursor-pointer" title={t("slideEditor.aspectLockTitle")}>
                <input type="checkbox" checked={aspectLock} onChange={(e) => setAspectLock(e.target.checked)} />
                {t("slideEditor.aspectLock")}
              </label>
              {slide.image.rect && (
                <button
                  type="button"
                  onClick={resetImageRect}
                  title={t("slideEditor.resetRectTitle")}
                  className="px-1.5 py-0.5 rounded border border-edge bg-field text-fg2 hover:border-accent/60"
                >
                  {slide.image.behind ? t("slideEditor.resetToDefault") : t("slideEditor.resetToFrame")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
