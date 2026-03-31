/**
 * SlideList.tsx — Slide thumbnail list for the left panel.
 *
 * Shows miniature slide cards. Clicking selects a slide for editing.
 */

import type { DeckIR, SlideIR } from "../engine/slide-schema";
import type { TemplateData, LayoutInfo } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const THUMB_SCALE = 16; // small thumbnails

interface SlideListProps {
  deck: DeckIR | null;
  template: TemplateData | null;
  activeIndex: number;
  onSelect: (index: number) => void;
}

function SlideThumbnail({
  slide,
  slideIndex,
  layout,
  masterBgColor,
  isActive,
  onClick,
}: {
  slide: SlideIR;
  slideIndex: number;
  layout: LayoutInfo | undefined;
  masterBgColor: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const pxW = SLIDE_W * THUMB_SCALE;
  const pxH = SLIDE_H * THUMB_SCALE;

  // Get title text for label
  const titlePh = slide.placeholders.find(
    (p) => p.idx === "15" || p.idx === "0",
  );
  const titleText = titlePh?.paragraphs[0]?.segments[0]?.text || "";

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded transition-all ${
        isActive
          ? "ring-2 ring-[#3B82F6] ring-offset-1 ring-offset-[#0f1117]"
          : "hover:ring-1 hover:ring-[#3B82F6]/50"
      }`}
    >
      {/* Mini slide card */}
      <div
        style={{
          width: pxW,
          height: pxH,
          backgroundColor: `#${masterBgColor}`,
          position: "relative",
          overflow: "hidden",
          borderRadius: 2,
        }}
      >
        {/* Decorative shapes */}
        {layout?.decorations.map((d, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(d.x / SLIDE_W) * 100}%`,
              top: `${(d.y / SLIDE_H) * 100}%`,
              width: `${(d.w / SLIDE_W) * 100}%`,
              height: `${(d.h / SLIDE_H) * 100}%`,
              backgroundColor: `#${d.color}`,
            }}
          />
        ))}

        {/* Title text (tiny) */}
        {titlePh && layout && (
          <div
            style={{
              position: "absolute",
              left: "8%",
              top: layout.name.startsWith("Title.") ? "30%" : "3%",
              width: "84%",
              fontSize: 5,
              color: layout.name.startsWith("Title.") ||
                layout.name.startsWith("Closing.") ||
                layout.name.startsWith("Section.")
                ? "#fff"
                : `#${layout.placeholders.find(p => p.idx === "15" || p.idx === "0")?.style.fontColor || "1E293B"}`,
              fontWeight: "bold",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {titleText}
          </div>
        )}
      </div>

      {/* Slide number + label */}
      <div className="flex items-center gap-1 mt-1 px-0.5">
        <span className="text-[10px] text-gray-500">{slideIndex + 1}</span>
        <span className="text-[10px] text-gray-400 truncate" style={{ maxWidth: pxW - 20 }}>
          {titleText || "Untitled"}
        </span>
      </div>
    </div>
  );
}

export default function SlideList({
  deck,
  template,
  activeIndex,
  onSelect,
}: SlideListProps) {
  if (!deck || deck.slides.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-xs p-2">
        No slides
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-2 flex flex-col gap-2">
      {deck.slides.map((slide, i) => {
        const layoutName =
          slide.layout === "auto"
            ? autoSelectLayout(slide, i, deck.slides.length)
            : slide.layout;
        const layout = template ? findLayout(template, layoutName) : undefined;

        return (
          <SlideThumbnail
            key={i}
            slide={slide}
            slideIndex={i}
            layout={layout}
            masterBgColor={template?.masterBgColor ?? "FFFFFF"}
            isActive={activeIndex === i}
            onClick={() => onSelect(i)}
          />
        );
      })}
    </div>
  );
}
