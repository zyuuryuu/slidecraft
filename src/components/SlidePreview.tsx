/**
 * SlidePreview.tsx — WYSIWYG-style slide preview from DeckIR.
 *
 * Renders slides as scaled-down HTML cards that approximate the PPTX layout.
 * Each slide uses layout placeholder positions from the template registry.
 */

import type { DeckIR, SlideIR, Paragraph, InlineSegment } from "../engine/slide-schema";
import { autoSelectLayout } from "../engine/template-loader";

// ── Slide dimensions (inches → relative units) ──
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

// ── Midnight Executive palette ──
const C = {
  navy: "#1E2761",
  dark_navy: "#141B41",
  ice_blue: "#CADCFC",
  white: "#FFFFFF",
  light_gray: "#F5F7FA",
  panel_gray: "#EDF0F7",
  mid_gray: "#94A3B8",
  dark_text: "#1E293B",
  accent: "#3B82F6",
};

// ── Layout background configs ──
interface LayoutBg {
  bg: string;
  headerBar?: boolean;
  rects?: { x: number; y: number; w: number; h: number; color: string }[];
}

function getLayoutBg(name: string): LayoutBg {
  if (name.startsWith("Title.") || name.startsWith("Closing.")) {
    return {
      bg: C.navy,
      rects: [
        { x: 0, y: 0, w: 0.18, h: SLIDE_H, color: C.accent },
        { x: 0, y: 5.2, w: SLIDE_W, h: 2.3, color: C.dark_navy },
      ],
    };
  }
  if (name.startsWith("Section.") || name.startsWith("SectionNav.") || name.startsWith("SectionBreak.")) {
    return {
      bg: C.dark_navy,
      rects: [{ x: 0, y: 0, w: 0.18, h: SLIDE_H, color: C.accent }],
    };
  }
  // Content, Column, KPI, Chart, Table, Compare, Process, Summary
  return {
    bg: C.light_gray,
    headerBar: true,
  };
}

// ── Approximate placeholder positions per layout category ──
interface PhPos {
  idx: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  color: string;
  bold?: boolean;
  align?: string;
}

function getPlaceholderPositions(layoutName: string): PhPos[] {
  // Title layouts
  if (layoutName.startsWith("Title.") || layoutName === "Closing.1Message.Single") {
    return [
      { idx: "10", x: 1.2, y: 1.5, w: 9, h: 0.45, fontSize: 15, color: C.accent, bold: true },
      { idx: "0", x: 1.2, y: 2.1, w: 10.5, h: 1.5, fontSize: 42, color: C.white, bold: true },
      { idx: "1", x: 1.2, y: 3.7, w: 9, h: 0.7, fontSize: 18, color: C.ice_blue },
      { idx: "11", x: 1.2, y: 5.6, w: 8, h: 0.4, fontSize: 14, color: C.ice_blue },
      { idx: "12", x: 1.2, y: 6.1, w: 4, h: 0.3, fontSize: 11, color: C.ice_blue },
    ];
  }
  // Section layouts
  if (layoutName.startsWith("Section.")) {
    return [
      { idx: "10", x: 1.2, y: 1.1, w: 5, h: 0.4, fontSize: 13, color: C.accent, bold: true },
      { idx: "15", x: 1.2, y: 1.8, w: 10.5, h: 2.2, fontSize: 36, color: C.white, bold: true },
      { idx: "11", x: 1.2, y: 4.5, w: 10, h: 1.5, fontSize: 16, color: C.ice_blue },
    ];
  }
  // Content.1Body.Single
  if (layoutName === "Content.1Body.Single") {
    return [
      { idx: "15", x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 24, color: C.white, bold: true },
      { idx: "16", x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, color: C.ice_blue },
      { idx: "1", x: 0.8, y: 1.45, w: 11.7, h: 5.4, fontSize: 14, color: C.dark_text },
    ];
  }
  // Column.2Body.Equal
  if (layoutName === "Column.2Body.Equal") {
    return [
      { idx: "15", x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 24, color: C.white, bold: true },
      { idx: "16", x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, color: C.ice_blue },
      { idx: "1", x: 0.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 14, color: C.dark_text },
      { idx: "2", x: 6.8, y: 1.45, w: 5.7, h: 5.4, fontSize: 14, color: C.dark_text },
    ];
  }
  // Column.3Body.Equal
  if (layoutName === "Column.3Body.Equal") {
    return [
      { idx: "15", x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 24, color: C.white, bold: true },
      { idx: "16", x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, color: C.ice_blue },
      { idx: "1", x: 0.8, y: 1.45, w: 3.5, h: 5.4, fontSize: 14, color: C.dark_text },
      { idx: "2", x: 4.7, y: 1.45, w: 3.5, h: 5.4, fontSize: 14, color: C.dark_text },
      { idx: "3", x: 8.6, y: 1.45, w: 3.9, h: 5.4, fontSize: 14, color: C.dark_text },
    ];
  }
  // Closing.1Steps.Single+1Notes
  if (layoutName === "Closing.1Steps.Single+1Notes") {
    return [
      { idx: "15", x: 1.2, y: 1.3, w: 6.8, h: 0.7, fontSize: 24, color: C.white, bold: true },
      { idx: "1", x: 1.2, y: 2.2, w: 6.8, h: 4.0, fontSize: 15, color: C.ice_blue },
      { idx: "2", x: 9.1, y: 1.3, w: 3.4, h: 5.0, fontSize: 14, color: C.white },
    ];
  }
  // Default: generic content layout
  return [
    { idx: "15", x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 24, color: C.white, bold: true },
    { idx: "16", x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, color: C.ice_blue },
    { idx: "1", x: 0.8, y: 1.45, w: 11.7, h: 5.4, fontSize: 14, color: C.dark_text },
    { idx: "2", x: 0.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 14, color: C.dark_text },
    { idx: "3", x: 6.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 14, color: C.dark_text },
    { idx: "4", x: 0.8, y: 4.5, w: 11.7, h: 2.0, fontSize: 14, color: C.dark_text },
  ];
}

// ── Render inline segments ──

function renderSegments(segments: InlineSegment[]) {
  return segments.map((seg, i) => {
    const style: React.CSSProperties = {};
    if (seg.bold) style.fontWeight = "bold";
    if (seg.italic) style.fontStyle = "italic";
    return (
      <span key={i} style={style}>
        {seg.text}
      </span>
    );
  });
}

// ── Render a single paragraph ──

function renderParagraph(para: Paragraph, idx: number) {
  return (
    <div key={idx} style={{ marginBottom: "0.15em" }}>
      {para.bullet && <span style={{ marginRight: "0.4em" }}>▸</span>}
      {renderSegments(para.segments)}
    </div>
  );
}

// ── Single slide card ──

interface SlideCardProps {
  slide: SlideIR;
  slideIndex: number;
  totalSlides: number;
  scale: number;
  isActive?: boolean;
  onClick?: () => void;
}

function SlideCard({ slide, slideIndex, totalSlides, scale, isActive, onClick }: SlideCardProps) {
  const layoutName = slide.layout === "auto"
    ? autoSelectLayout(slide, slideIndex, totalSlides)
    : slide.layout;

  const bg = getLayoutBg(layoutName);
  const positions = getPlaceholderPositions(layoutName);
  const contentMap = new Map(slide.placeholders.map((p) => [p.idx, p]));

  const pxW = SLIDE_W * scale;
  const pxH = SLIDE_H * scale;

  return (
    <div
      onClick={onClick}
      style={{
        width: pxW,
        height: pxH,
        backgroundColor: bg.bg,
        position: "relative",
        overflow: "hidden",
        borderRadius: 4,
        border: isActive ? `2px solid ${C.accent}` : "1px solid #333",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {/* Header bar */}
      {bg.headerBar && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: `${(1.15 / SLIDE_H) * 100}%`,
            backgroundColor: C.navy,
          }}
        />
      )}

      {/* Decorative rects */}
      {bg.rects?.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${(r.x / SLIDE_W) * 100}%`,
            top: `${(r.y / SLIDE_H) * 100}%`,
            width: `${(r.w / SLIDE_W) * 100}%`,
            height: `${(r.h / SLIDE_H) * 100}%`,
            backgroundColor: r.color,
          }}
        />
      ))}

      {/* Placeholders */}
      {positions.map((pos) => {
        const content = contentMap.get(pos.idx);
        if (!content) return null;

        return (
          <div
            key={pos.idx}
            style={{
              position: "absolute",
              left: `${(pos.x / SLIDE_W) * 100}%`,
              top: `${(pos.y / SLIDE_H) * 100}%`,
              width: `${(pos.w / SLIDE_W) * 100}%`,
              height: `${(pos.h / SLIDE_H) * 100}%`,
              fontSize: pos.fontSize * (scale / 72),
              color: pos.color,
              fontWeight: pos.bold ? "bold" : "normal",
              fontFamily: pos.bold ? "Georgia, serif" : "Calibri, sans-serif",
              textAlign: (pos.align as React.CSSProperties["textAlign"]) || "left",
              overflow: "hidden",
              lineHeight: 1.3,
            }}
          >
            {content.paragraphs.map((p, i) => renderParagraph(p, i))}
          </div>
        );
      })}

      {/* Slide number badge */}
      <div
        style={{
          position: "absolute",
          right: 6,
          bottom: 4,
          fontSize: 9 * (scale / 72),
          color: C.mid_gray,
        }}
      >
        {slideIndex + 1}
      </div>
    </div>
  );
}

// ── Main preview component ──

interface SlidePreviewProps {
  deck: DeckIR | null;
  error: string | null;
  activeSlide?: number;
  onSlideClick?: (index: number) => void;
}

export default function SlidePreview({ deck, error, activeSlide, onSlideClick }: SlidePreviewProps) {
  const scale = 72; // pixels per inch (adjustable)

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 max-w-md">
          <p className="text-red-400 text-sm font-mono whitespace-pre-wrap">{error}</p>
        </div>
      </div>
    );
  }

  if (!deck || deck.slides.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg mb-2">スライドプレビュー</p>
          <p className="text-sm">Markdown を入力すると</p>
          <p className="text-sm">ここにプレビューが表示されます</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 flex flex-col items-center gap-4">
      {deck.slides.map((slide, i) => (
        <SlideCard
          key={i}
          slide={slide}
          slideIndex={i}
          totalSlides={deck.slides.length}
          scale={scale}
          isActive={activeSlide === i}
          onClick={() => onSlideClick?.(i)}
        />
      ))}
    </div>
  );
}
