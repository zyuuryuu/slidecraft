/**
 * SlidePreview.tsx — WYSIWYG-style slide preview driven by template data.
 *
 * Renders slides using actual placeholder positions, colors, and decorative
 * shapes extracted from the template PPTX, ensuring preview matches output.
 */

import type { DeckIR, SlideIR, Paragraph, InlineSegment } from "../engine/slide-schema";
import type { TemplateData, LayoutInfo } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";

// ── Slide dimensions (inches) ──
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

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
  layout: LayoutInfo | undefined;
  scale: number;
  isActive?: boolean;
  onClick?: () => void;
}

function SlideCard({ slide, slideIndex, layout, scale, isActive, onClick }: SlideCardProps) {
  const contentMap = new Map(slide.placeholders.map((p) => [p.idx, p]));
  const pxW = SLIDE_W * scale;
  const pxH = SLIDE_H * scale;

  // Fallback background: derive from decorations
  // Largest decoration by area = slide background
  const sortedDecos = [...(layout?.decorations || [])].sort(
    (a, b) => b.w * b.h - a.w * a.h,
  );
  const bgColor = sortedDecos.length > 0 ? `#${sortedDecos[0].color}` : "#F5F7FA";

  return (
    <div
      onClick={onClick}
      style={{
        width: pxW,
        height: pxH,
        backgroundColor: bgColor,
        position: "relative",
        overflow: "hidden",
        borderRadius: 4,
        border: isActive ? "2px solid #3B82F6" : "1px solid #333",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {/* Decorative shapes from template */}
      {layout?.decorations.map((d, i) => (
        <div
          key={`deco-${i}`}
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

      {/* Placeholders from template with user content */}
      {layout?.placeholders.map((ph) => {
        const content = contentMap.get(ph.idx);
        if (!content) return null;
        const s = ph.style;

        return (
          <div
            key={ph.idx}
            style={{
              position: "absolute",
              left: `${(s.x / SLIDE_W) * 100}%`,
              top: `${(s.y / SLIDE_H) * 100}%`,
              width: `${(s.w / SLIDE_W) * 100}%`,
              height: `${(s.h / SLIDE_H) * 100}%`,
              fontSize: s.fontSize * (scale / 72),
              color: `#${s.fontColor}`,
              fontWeight: s.bold ? "bold" : "normal",
              fontFamily: s.fontName.includes("Georgia")
                ? "Georgia, serif"
                : `${s.fontName}, sans-serif`,
              textAlign: s.align === "ctr"
                ? "center"
                : s.align === "r"
                  ? "right"
                  : "left",
              overflow: "hidden",
              lineHeight: 1.3,
            }}
          >
            {content.paragraphs.map((p, i) => renderParagraph(p, i))}
          </div>
        );
      })}

      {/* Slide number */}
      <div
        style={{
          position: "absolute",
          right: 6,
          bottom: 4,
          fontSize: 9 * (scale / 72),
          color: "#94A3B8",
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
  template: TemplateData | null;
  error: string | null;
  activeSlide?: number;
  onSlideClick?: (index: number) => void;
}

export default function SlidePreview({
  deck,
  template,
  error,
  activeSlide,
  onSlideClick,
}: SlidePreviewProps) {
  const scale = 72;

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
      {deck.slides.map((slide, i) => {
        const layoutName =
          slide.layout === "auto"
            ? autoSelectLayout(slide, i, deck.slides.length)
            : slide.layout;
        const layout = template ? findLayout(template, layoutName) : undefined;

        return (
          <SlideCard
            key={i}
            slide={slide}
            slideIndex={i}
            totalSlides={deck.slides.length}
            layout={layout}
            scale={scale}
            isActive={activeSlide === i}
            onClick={() => onSlideClick?.(i)}
          />
        );
      })}
    </div>
  );
}
