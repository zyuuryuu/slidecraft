/**
 * BeforeAfterOverlay.tsx — the preview half of the #402 Before/After overlay: draws the direction arrow
 * and the role labels at the rects engine/before-after.ts computed — the SAME geometry the PPTX export
 * writes (R8), in the theme's resolved accent1 / lt1. Renders nothing for any other slide.
 */
import type { SlideIR } from "../engine/slide-schema";
import type { LayoutInfo } from "../engine/template-loader";
import { beforeAfterOverlay, arrowPolygon, overlayColors, BA_LABEL_FONT_PT } from "../engine/before-after";

interface Props {
  slide: SlideIR;
  layout: LayoutInfo | undefined;
  themeColors?: Record<string, string>;
  scale: number; // px per inch
  slideW: number; // inches
  slideH: number;
}

export default function BeforeAfterOverlay({ slide, layout, themeColors, scale, slideW, slideH }: Props) {
  const o = layout ? beforeAfterOverlay(slide, layout) : undefined;
  if (!o) return null;
  const { accent, onAccent } = overlayColors(themeColors);
  const box = (r: { x: number; y: number; w: number; h: number }) => ({
    position: "absolute" as const,
    left: `${(r.x / slideW) * 100}%`,
    top: `${(r.y / slideH) * 100}%`,
    width: `${(r.w / slideW) * 100}%`,
    height: `${(r.h / slideH) * 100}%`,
  });
  return (
    <>
      {o.arrow && (
        <svg
          data-before-after="arrow"
          style={{ ...box(o.arrow.rect), pointerEvents: "none" }}
          viewBox={`0 0 ${o.arrow.rect.w} ${o.arrow.rect.h}`}
          preserveAspectRatio="none"
        >
          <polygon points={arrowPolygon(o.arrow).map(([x, y]) => `${x},${y}`).join(" ")} fill={`#${accent}`} />
        </svg>
      )}
      {o.labels.map((l, i) => (
        <div
          key={`ba-label-${i}`}
          data-before-after="label"
          style={{
            ...box(l.rect),
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid #${l.filled ? onAccent : accent}`,
            borderRadius: Math.min(l.rect.w, l.rect.h) * 0.1667 * scale,
            backgroundColor: `#${l.filled ? accent : onAccent}`,
            color: `#${l.filled ? onAccent : accent}`,
            fontSize: BA_LABEL_FONT_PT * (scale / 72),
            fontWeight: "bold",
            lineHeight: 1,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {l.text}
        </div>
      ))}
    </>
  );
}
