/**
 * SlideImageLayer.tsx — the slide image's preview rendering + drag/resize editing (案B), split out of
 * SlidePreview (R1). Pointer events (not HTML5 DnD — unreliable in the Tauri webview); while a gesture
 * is live the box renders from a LOCAL rect (smooth, no deck churn) and commits ONCE on release (one
 * undo entry) through onImageRectChange — which writes `image.rect` = the Markdown `{x,y,w,h}`.
 *
 * Two placements share ONE gesture path (image-gesture → dragImageRect, R8):
 *   - a BODY-FIGURE image: the editing chrome (outline + corner handles) is inline in the image box;
 *   - a BEHIND (最背面) image (#122): the picture stays in its backmost slot (under the content), and
 *     ONLY the chrome is drawn as a frontmost overlay (renderImageChrome) so it is reachable. The chrome
 *     box lets clicks through; its frame strips move the image, its corners resize it.
 * GUI only — exportMode / non-active cards get no handlers and no chrome (PPTX/HTML unchanged).
 */
import { useRef, useState } from "react";
import type { SlideIR, ImageRect, ImageBlock } from "../engine/slide-schema";
import type { PlaceholderInfo } from "../engine/template-loader";
import { imageObjectFit, slideImagePlaceholder, slideImageEditGeometry } from "../engine/visual-placement";
import { imageCaption } from "../engine/image-caption";
import { startImageGesture, moveImageGesture, endImageGesture, type ImageDragMode, type ImageGesture } from "./image-gesture";

type Corner = Exclude<ImageDragMode, "move">;

const HANDLES: { c: Corner; cursor: string; pos: React.CSSProperties }[] = [
  { c: "nw", cursor: "nwse-resize", pos: { left: -5, top: -5 } },
  { c: "ne", cursor: "nesw-resize", pos: { right: -5, top: -5 } },
  { c: "sw", cursor: "nesw-resize", pos: { left: -5, bottom: -5 } },
  { c: "se", cursor: "nwse-resize", pos: { right: -5, bottom: -5 } },
];
const HANDLE_STYLE: React.CSSProperties = { position: "absolute", width: 9, height: 9, background: "#3B82F6", border: "1px solid #fff", borderRadius: 2 };
const OUTLINE = "1px solid rgba(59,130,246,0.7)";
/** The grabbable frame strips of the behind chrome (6px, centered on the outline). */
const EDGES: { e: string; pos: React.CSSProperties }[] = [
  { e: "top", pos: { left: 0, right: 0, top: -3, height: 6 } },
  { e: "bottom", pos: { left: 0, right: 0, bottom: -3, height: 6 } },
  { e: "left", pos: { top: 0, bottom: 0, left: -3, width: 6 } },
  { e: "right", pos: { top: 0, bottom: 0, right: -3, width: 6 } },
];

interface Args {
  slide: SlideIR;
  layoutPhs: readonly PlaceholderInfo[];
  scale: number;
  isActive?: boolean;
  onImageRectChange?: (rect: ImageRect) => void;
  slideW: number;
  slideH: number;
}

export function useSlideImageLayer({ slide, layoutPhs, scale, isActive, onImageRectChange, slideW, slideH }: Args) {
  const [dragRect, setDragRect] = useState<ImageRect | null>(null);
  const gestureRef = useRef<ImageGesture | null>(null);
  const img = slide.image;
  const behind = !!img?.behind;
  // A body figure is editable only when it resolved to a placeholder; a behind image always has a box.
  // #392 段 3: resolved as the export places it (slideImagePlaceholder), not by the stored placeholderIdx.
  const placed = !!img && (behind || !!slideImagePlaceholder(slide, layoutPhs));
  const imgEditable = !!(isActive && onImageRectChange && img && placed);
  // The SAME edit geometry as the form's numeric X/Y/W/H (aspect locked identically on resize).
  const aspect = slideImageEditGeometry(slide, layoutPhs)?.aspect ?? 1;

  const pct = (box: ImageRect): React.CSSProperties => ({
    left: `${(box.x / slideW) * 100}%`,
    top: `${(box.y / slideH) * 100}%`,
    width: `${(box.w / slideW) * 100}%`,
    height: `${(box.h / slideH) * 100}%`,
  });
  const begin = (mode: ImageDragMode, base: ImageRect) => (e: React.PointerEvent) => {
    if (!imgEditable) return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    gestureRef.current = startImageGesture(mode, base, e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const live = moveImageGesture(g, e.clientX, e.clientY, scale, aspect, slideW, slideH);
    if (live) setDragRect(live);
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    const t = e.target as HTMLElement;
    if (t.hasPointerCapture?.(e.pointerId)) t.releasePointerCapture(e.pointerId);
    const rect = endImageGesture(g);
    if (rect) onImageRectChange!(rect);
    setDragRect(null);
  };
  const handles = (resolved: ImageRect, extra?: React.CSSProperties) => HANDLES.map((h) => (
    <div
      key={h.c}
      data-image-handle={h.c}
      onPointerDown={begin(h.c, resolved)}
      style={{ ...HANDLE_STYLE, cursor: h.cursor, ...h.pos, ...extra }}
    />
  ));

  /** The picture box. A body figure carries its chrome inline; a behind picture carries none (its
   *  chrome is renderImageChrome) but still moves when grabbed where it is not covered. `resolved` =
   *  the committed rect (a live drag overrides it). object-fit = the SAME aspect resolver as the PPTX
   *  math (imageObjectFit ↔ drawnImage) so preview == export (#417). */
  const renderImageBox = (resolved: ImageRect) => {
    const box = dragRect ?? resolved;
    const chromeInline = imgEditable && !behind;
    return (
      <div
        key="image-layer"
        onPointerDown={imgEditable ? begin("move", resolved) : undefined}
        onPointerMove={imgEditable ? onMove : undefined}
        onPointerUp={imgEditable ? onUp : undefined}
        style={{
          position: "absolute",
          ...pct(box),
          cursor: imgEditable ? "move" : undefined,
          touchAction: imgEditable ? "none" : undefined,
          outline: chromeInline ? OUTLINE : undefined,
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <img src={img!.src} alt={img!.alt} draggable={false} style={{ width: "100%", height: "100%", objectFit: imageObjectFit(img!), pointerEvents: "none" }} />
        </div>
        {chromeInline && handles(resolved)}
      </div>
    );
  };

  /** #122: the BEHIND image's editing chrome, drawn frontmost (after the content). The box itself is
   *  click-through; only the frame strips (move) and corner handles (resize) take the pointer. */
  const renderImageChrome = (resolved: ImageRect) => {
    if (!imgEditable || !behind) return null;
    const box = dragRect ?? resolved;
    return (
      <div
        key="image-chrome"
        data-image-chrome="true"
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ position: "absolute", ...pct(box), outline: OUTLINE, pointerEvents: "none" }}
      >
        {EDGES.map((s) => (
          <div
            key={s.e}
            data-image-edge={s.e}
            onPointerDown={begin("move", resolved)}
            style={{ position: "absolute", ...s.pos, cursor: "move", touchAction: "none", pointerEvents: "auto" }}
          />
        ))}
        {handles(resolved, { touchAction: "none", pointerEvents: "auto" })}
      </div>
    );
  };

  /** The alt caption under a BODY-FIGURE image (#399) — the SAME imageCaption geometry the PPTX export
   *  uses (R8), following the live drag box so it stays under the image while it moves. */
  const renderImageCaption = (resolved: ImageRect, textColor: string) => captionOf(img!, dragRect ?? resolved, textColor, "image-caption");

  /** #392 段 2: a 2nd+ body image of the slide — drawn exactly like the primary one (object-fit, caption)
   *  but not draggable: the drag edits `slide.image`, the primary (editing the 2nd+ visual is 段 3). */
  const renderStaticImage = (image: ImageBlock, resolved: ImageRect, textColor: string, key: string) => [
    <div key={key} style={{ position: "absolute", ...pct(resolved) }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <img src={image.src} alt={image.alt} draggable={false} style={{ width: "100%", height: "100%", objectFit: imageObjectFit(image), pointerEvents: "none" }} />
      </div>
    </div>,
    captionOf(image, resolved, textColor, `${key}-caption`),
  ];

  const captionOf = (image: ImageBlock, box: ImageRect, textColor: string, key: string) => {
    const cap = imageCaption(image, box, textColor);
    if (!cap) return null;
    return (
      <div
        key={key}
        data-image-caption="true"
        style={{
          position: "absolute",
          ...pct(cap.rect),
          fontSize: cap.fontPt * (scale / 72),
          color: `#${cap.color}`,
          textAlign: "center",
          lineHeight: 1.2,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {cap.text}
      </div>
    );
  };

  return { renderImageBox, renderImageChrome, renderImageCaption, renderStaticImage };
}
