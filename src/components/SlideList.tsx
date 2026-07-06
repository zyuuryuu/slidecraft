/**
 * SlideList.tsx — Slide thumbnail list using the same SlideCard as the preview.
 */

import { Fragment, useMemo, useRef, useState } from "react";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { SlideCard, SLIDE_W } from "./SlidePreview";

const THUMB_SCALE = 15;
const CARD_W = SLIDE_W * THUMB_SCALE; // thumbnail px width — sizes the insertion indicator to match

interface SlideListProps {
  deck: DeckIR | null;
  template: TemplateData | null;
  activeIndex: number;
  /** Highlighted multi-selection (focused = activeIndex). */
  selected?: Set<number>;
  onSelect: (index: number, mods?: { shift?: boolean; meta?: boolean }) => void;
  /** Per-slide structure ops (undo-able). Omitted / disabled → controls hidden (e.g. collab observe-only).
   *  "Add" lives in the panel header (App), not here. */
  onDelete?: (index: number) => void;
  onDuplicate?: (index: number) => void;
  /** Drag-reorder: move slide `from` → position `to`. Omitted / disabled → drag off (e.g. collab). */
  onMove?: (from: number, to: number) => void;
  disabled?: boolean;
}

export default function SlideList({
  deck,
  template,
  activeIndex,
  selected,
  onSelect,
  onDelete,
  onDuplicate,
  onMove,
  disabled,
}: SlideListProps) {
  const catalog = useMemo(() => (template ? buildCatalog(template) : undefined), [template]);
  // Drag-reorder via POINTER events (NOT native HTML5 DnD — unreliable in the Tauri webviews: WebKitGTK
  // on Linux, WKWebView on macOS). `insIdx` = the 0..N INSERTION gap (PowerPoint-style: an indicator line
  // shows exactly where the slide lands, above/below the hovered slide's midpoint). The live drag lives
  // in a ref so pointerup reads the final gap without a stale closure.
  const slideCount = deck?.slides.length ?? 0;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [insIdx, setInsIdx] = useState<number | null>(null);
  const dragRef = useRef<{ from: number; ins: number; active: boolean } | null>(null);
  const justDragged = useRef(false); // swallow the click that follows a real drag (else it re-selects a stale idx)
  const canDrag = !disabled && !!onMove;

  const startDrag = (e: React.PointerEvent, from: number) => {
    if (!canDrag || e.button !== 0) return;
    const startY = e.clientY;
    dragRef.current = { from, ins: from, active: false };
    const onMovePtr = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.abs(ev.clientY - startY) < 5) return; // below the threshold it's still a click, not a drag
        d.active = true;
        setDragIdx(from);
      }
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("[data-slide-idx]") as HTMLElement | null;
      if (el) {
        const idx = Number(el.dataset.slideIdx);
        const r = el.getBoundingClientRect();
        d.ins = ev.clientY < r.top + r.height / 2 ? idx : idx + 1; // drop before/after by the midpoint
        setInsIdx(d.ins);
      }
    };
    const onUpPtr = () => {
      window.removeEventListener("pointermove", onMovePtr);
      window.removeEventListener("pointerup", onUpPtr);
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.active) {
        justDragged.current = true; // the trailing click must not also fire onSelect
        // Insertion gap → final index: removing `from` shifts everything after it down by one.
        const to = d.ins > d.from ? d.ins - 1 : d.ins;
        if (to !== d.from && to >= 0 && to < slideCount) onMove?.(d.from, to);
      }
      setDragIdx(null);
      setInsIdx(null);
    };
    window.addEventListener("pointermove", onMovePtr);
    window.addEventListener("pointerup", onUpPtr);
  };
  // Show the indicator at a gap unless dropping there is a no-op (right where the slide already is).
  const showBar = (gap: number) => canDrag && dragIdx !== null && insIdx === gap && gap !== dragIdx && gap !== dragIdx + 1;
  const insertionBar = (
    <div className="pointer-events-none flex items-center gap-1 my-0.5" style={{ width: CARD_W }} aria-hidden>
      <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
      <div className="h-[3px] flex-1 rounded-full bg-accent" />
    </div>
  );

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
    <div className={`h-full overflow-auto p-2 flex flex-col gap-2 items-center select-none ${dragIdx !== null ? "cursor-grabbing" : ""}`}>
      {deck.slides.map((slide, i) => {
        // ALWAYS via autoSelectLayout — it honors a valid pinned name but degrades one this template
        // lacks to a real layout (else a canonical-pinned cover on an alien master = blank thumbnail).
        const layoutName = autoSelectLayout(slide, i, deck.slides.length, catalog);
        const layout = template ? findLayout(template, layoutName) : undefined;

        const showOps = !disabled && (onDuplicate || onDelete);
        return (
          <Fragment key={i}>
            {showBar(i) && insertionBar}
            <div
              data-slide-idx={i}
              className={`flex flex-col items-center transition-[transform,opacity] duration-150 ${canDrag ? "cursor-grab" : ""} ${dragIdx === i ? "opacity-40 scale-95" : ""}`}
              title={canDrag ? "ドラッグで並べ替え" : undefined}
              onPointerDown={canDrag ? (e) => startDrag(e, i) : undefined}
              onClickCapture={(e) => { if (justDragged.current) { justDragged.current = false; e.stopPropagation(); } }} // swallow the post-drag click
            >
              <div className="relative group rounded">
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
          </Fragment>
        );
      })}
      {showBar(slideCount) && insertionBar}
    </div>
  );
}
