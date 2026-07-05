/**
 * SlideList.tsx — Slide thumbnail list using the same SlideCard as the preview.
 */

import { useMemo } from "react";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { SlideCard } from "./SlidePreview";

const THUMB_SCALE = 18;

interface SlideListProps {
  deck: DeckIR | null;
  template: TemplateData | null;
  activeIndex: number;
  /** Highlighted multi-selection (focused = activeIndex). */
  selected?: Set<number>;
  onSelect: (index: number, mods?: { shift?: boolean; meta?: boolean }) => void;
}

export default function SlideList({
  deck,
  template,
  activeIndex,
  selected,
  onSelect,
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

        return (
          <div key={i} className="flex flex-col items-center">
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
            <span className="text-[10px] text-faint mt-0.5">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
