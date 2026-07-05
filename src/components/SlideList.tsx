/**
 * SlideList.tsx — Slide thumbnail list using the same SlideCard as the preview.
 */

import { useMemo } from "react";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { SlideCard } from "./SlidePreview";

const THUMB_SCALE = 15;

interface SlideListProps {
  deck: DeckIR | null;
  template: TemplateData | null;
  activeIndex: number;
  /** Highlighted multi-selection (focused = activeIndex). */
  selected?: Set<number>;
  onSelect: (index: number, mods?: { shift?: boolean; meta?: boolean }) => void;
  /** Slide structure ops (undo-able). Omitted / disabled → controls hidden (e.g. collab observe-only). */
  onAdd?: () => void;
  onDelete?: (index: number) => void;
  onDuplicate?: (index: number) => void;
  disabled?: boolean;
}

export default function SlideList({
  deck,
  template,
  activeIndex,
  selected,
  onSelect,
  onAdd,
  onDelete,
  onDuplicate,
  disabled,
}: SlideListProps) {
  const catalog = useMemo(() => (template ? buildCatalog(template) : undefined), [template]);
  if (!deck || deck.slides.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-faint text-xs p-2">
        No slides
      </div>
    );
  }

  return (
    // select-none: thumbnails aren't selectable text, so Shift/⌘-click multi-select
    // doesn't drag a blue text-selection highlight along with it.
    <div className="h-full overflow-auto p-2 flex flex-col gap-2 items-center select-none">
      {deck.slides.map((slide, i) => {
        // ALWAYS via autoSelectLayout — it honors a valid pinned name but degrades one this template
        // lacks to a real layout (else a canonical-pinned cover on an alien master = blank thumbnail).
        const layoutName = autoSelectLayout(slide, i, deck.slides.length, catalog);
        const layout = template ? findLayout(template, layoutName) : undefined;

        const showOps = !disabled && (onDuplicate || onDelete);
        return (
          <div key={i} className="flex flex-col items-center">
            <div className="relative group">
              <SlideCard
                slide={slide}
                slideIndex={i}
                totalSlides={deck.slides.length}
                layout={layout}
                masterBgColor={template?.masterBgColor ?? "FFFFFF"}
                masterDecorations={template?.masterDecorations}
                masterStaticTexts={template?.masterStaticTexts}
                scale={THUMB_SCALE}
                isActive={activeIndex === i}
                selected={selected?.has(i)}
                onClick={(e) => onSelect(i, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
              />
              {showOps && (
                // Per-slide hover controls — stopPropagation so a control click doesn't also select.
                <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onDuplicate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDuplicate(i); }}
                      title="このスライドを複製"
                      className="w-5 h-5 flex items-center justify-center rounded bg-surface/90 border border-edge text-fg2 hover:bg-accent hover:text-on-accent text-[11px] leading-none"
                    >
                      ⧉
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDelete(i); }}
                      title="このスライドを削除"
                      className="w-5 h-5 flex items-center justify-center rounded bg-surface/90 border border-edge text-fg2 hover:bg-danger hover:text-on-accent text-[11px] leading-none"
                    >
                      🗑
                    </button>
                  )}
                </div>
              )}
            </div>
            <span className="text-[10px] text-faint mt-0.5">{i + 1}</span>
          </div>
        );
      })}
      {onAdd && !disabled && (
        <button
          type="button"
          onClick={onAdd}
          title="選択中のスライドの後ろに新しいスライドを追加"
          className="mt-1 px-4 py-1.5 rounded border border-dashed border-edge text-faint hover:text-fg hover:border-accent text-xs transition-colors"
        >
          ＋ スライド追加
        </button>
      )}
    </div>
  );
}
