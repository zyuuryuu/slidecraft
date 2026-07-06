/**
 * SlidePreview.tsx — WYSIWYG-style slide preview driven by template data.
 *
 * Renders slides using actual placeholder positions, colors, and decorative
 * shapes extracted from the template PPTX, ensuring preview matches output.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import type { DeckIR, SlideIR, Paragraph, InlineSegment, ImageRect } from "../engine/slide-schema";
import type { TemplateData, LayoutInfo, DecoRect, StaticText } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { bindContentByRole, bodyPlaceholders, nthBody, imagePlaceholder, imageRect, imageAspectRatio, dragImageRect } from "../engine/placeholder-binding";
import { isGroupedLayout, expandGroups } from "../engine/group-binding";
import { MERMAID_CONFIG } from "./mermaid";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "../engine/mermaid-to-diagram";
import DiagramSvgOverlay from "./DiagramSvgOverlay";

// ── Mermaid initialization (shared with the PPTX export for WYSIWYG parity) ──
mermaid.initialize(MERMAID_CONFIG);

// ── Global counter for unique Mermaid render IDs ──
let mermaidIdCounter = 0;


// ── Direct Mermaid syntax renderer (for ```mermaid blocks) ──
function MermaidDirect({ mermaidSyntax, width, height, instanceId, svgCache }: { mermaidSyntax: string; width: string; height: string; instanceId?: string; svgCache?: string }) {
  // svgCache = an export-time pre-rendered SVG (deck-html-export). Seeding it as the initial
  // state makes the SVG present SYNCHRONOUSLY, so SSR (react-dom/server, no effects) captures it
  // instead of an empty box. In the live preview svgCache is absent and the effect renders it.
  const [svg, setSvg] = useState(svgCache ?? "");
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    if (!mermaidSyntax.trim()) return;
    const id = instanceId ? `mmd-direct-${instanceId}-${++mermaidIdCounter}` : `mmd-direct-${++mermaidIdCounter}`;
    mermaid.render(id, mermaidSyntax).then(({ svg: rendered }) => {
      if (!cancelRef.current) setSvg(rendered);
    }).catch(() => {
      if (!cancelRef.current) setSvg("");
    });
    return () => { cancelRef.current = true; };
  }, [mermaidSyntax, instanceId]);

  // Empty input renders nothing without a synchronous setState — the (possibly stale) svg is
  // simply not shown, and the next non-empty render replaces it.
  const shownSvg = mermaidSyntax.trim() ? svg : "";
  const fittedSvg = shownSvg.replace(
    /<svg([^>]*)>/,
    (_match, attrs) => {
      const wMatch = attrs.match(/width="([\d.]+)/);
      const hMatch = attrs.match(/height="([\d.]+)/);
      const origW = wMatch ? wMatch[1] : "400";
      const origH = hMatch ? hMatch[1] : "300";
      const cleaned = attrs
        .replace(/width="[^"]*"/g, "")
        .replace(/height="[^"]*"/g, "")
        .replace(/style="[^"]*"/g, "");
      return `<svg${cleaned} viewBox="0 0 ${origW} ${origH}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;">`;
    },
  );

  return (
    <div
      style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: fittedSvg }}
    />
  );
}

// ── Slide dimensions (inches) — exported so the HTML exporter sizes its stage to the
//    EXACT px the card renders at (SLIDE_W × scale), keeping the stage flush with the slide. ──
export const SLIDE_W = 13.33;
export const SLIDE_H = 7.5;

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

function renderParagraph(para: Paragraph, idx: number, bulletChar: string) {
  return (
    <div key={idx} style={{ marginBottom: "0.15em", ...(para.heading ? { fontWeight: "bold" } : {}) }}>
      {para.bullet && bulletChar && <span style={{ marginRight: "0.4em" }}>{bulletChar}</span>}
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
  masterBgColor: string; // hex without #
  masterDecorations?: DecoRect[]; // the master's own shapes — painted under the layout's
  masterStaticTexts?: StaticText[]; // the master's own static text labels
  scale: number;
  isActive?: boolean;
  /** In the multi-selection set (highlighted) but not necessarily the focused slide. */
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** When set, the embedded diagram is drag-editable and reports new YAML. */
  onDiagramChange?: (yaml: string) => void;
  /** When set, the embedded image is drag/resize-editable and reports the new rect (inches). */
  onImageRectChange?: (rect: ImageRect) => void;
  /** Static export mode (standalone HTML / SSR): strip all editor chrome — selection
   *  border, hover cursor, click handler, and the synthetic slide-number — so the card
   *  renders as a clean presentation slide. See docs/design/html-output.md (S1). */
  exportMode?: boolean;
}

function SlideCard({ slide, slideIndex, layout, masterBgColor, masterDecorations, masterStaticTexts, scale, isActive, selected, onClick, onDiagramChange, onImageRectChange, exportMode }: SlideCardProps) {
  // Bind content to the layout's placeholders BY ROLE via the SAME shared function the PPTX export
  // uses (placeholder-binding), so the preview matches the output even on an ALIEN master (whose
  // idxs differ). A figure/table rides the Nth BODY placeholder, resolved the same way.
  const layoutPhs = layout?.placeholders ?? [];
  // WYSIWYG: share the SAME contentFor as the export — a grouped slide fills via expandGroups.
  const contentFor = slide.groupKind && layout && isGroupedLayout(layout)
    ? expandGroups(slide, layout)
    : bindContentByRole(slide, layoutPhs);
  const bodyPhs = bodyPlaceholders(layoutPhs);
  const diagBodyIdx = slide.diagram ? nthBody(bodyPhs, slide.diagram.placeholderIdx)?.idx : undefined;
  const mermBodyIdx = slide.mermaidBlock ? nthBody(bodyPhs, slide.mermaidBlock.placeholderIdx)?.idx : undefined;
  const tableBodyIdx = slide.table ? nthBody(bodyPhs, slide.table.placeholderIdx)?.idx : undefined;
  const codeBodyIdx = slide.code ? nthBody(bodyPhs, slide.code.placeholderIdx)?.idx : undefined;
  // An image prefers a PICTURE frame (else the Nth body). A BEHIND image binds to NO placeholder
  // (it's a backmost layer) → undefined, so it doesn't suppress any placeholder's content.
  const imageBodyIdx = slide.image && !slide.image.behind ? imagePlaceholder(layoutPhs, slide.image.placeholderIdx)?.idx : undefined;
  const pxW = SLIDE_W * scale;
  const pxH = SLIDE_H * scale;

  // Image drag/resize (案B, 段階2): while a gesture is live, render from a LOCAL rect (smooth, no deck
  // churn); commit ONCE on release (one undo entry). Pointer events (not HTML5 DnD — unreliable in the
  // Tauri webview). Only on the active, editable card (onImageRectChange set = single-slide edit view).
  const [dragRect, setDragRect] = useState<ImageRect | null>(null);
  const dragRef = useRef<{ mode: "move" | "nw" | "ne" | "sw" | "se"; sx: number; sy: number; base: ImageRect; latest: ImageRect; moved: boolean } | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);
  // Preview drag/resize handles are for a BODY-FIGURE image. A BEHIND backdrop's handles would sit
  // UNDER the content (unreachable), so it is fine-tuned via the form's numeric X/Y/W/H instead.
  const imgEditable = !!(isActive && onImageRectChange && slide.image && imageBodyIdx);
  // Aspect to preserve on resize — the SHARED helper (imageAspectRatio) so preview drag and the form
  // lock to the identical ratio (WYSIWYG on resize too). Uses the bound placeholder box as the fallback.
  const imgAspect = slide.image
    ? imageAspectRatio(slide.image, imageRect(slide.image, layoutPhs.find((p) => p.idx === imageBodyIdx)))
    : 1;
  const beginImageDrag = (mode: "move" | "nw" | "ne" | "sw" | "se", base: ImageRect) => (e: React.PointerEvent) => {
    if (!imgEditable) return;
    e.stopPropagation(); e.preventDefault();
    imgWrapRef.current?.setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, base, latest: base, moved: false };
  };
  const onImagePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return; // click threshold
    d.moved = true;
    d.latest = dragImageRect(d.mode, d.base, (e.clientX - d.sx) / scale, (e.clientY - d.sy) / scale, imgAspect, SLIDE_W, SLIDE_H);
    setDragRect(d.latest);
  };
  const endImageDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d.moved) onImageRectChange!(d.latest);
    setDragRect(null);
  };
  // The image box (drag-move + corner-resize when editable). Shared by the inline body-figure render and
  // the behind (backmost) layer so both look/behave identically. `resolved` = the committed rect (live
  // drag overrides it). object-fit mirrors the PPTX aspect math (fitImageInBox) so preview == export.
  const renderImageBox = (resolved: ImageRect) => {
    const img = slide.image!;
    const box = dragRect ?? resolved;
    const HANDLES: { c: "nw" | "ne" | "sw" | "se"; cursor: string; pos: React.CSSProperties }[] = [
      { c: "nw", cursor: "nwse-resize", pos: { left: -5, top: -5 } },
      { c: "ne", cursor: "nesw-resize", pos: { right: -5, top: -5 } },
      { c: "sw", cursor: "nesw-resize", pos: { left: -5, bottom: -5 } },
      { c: "se", cursor: "nwse-resize", pos: { right: -5, bottom: -5 } },
    ];
    return (
      <div
        key="image-layer"
        ref={imgWrapRef}
        onPointerDown={imgEditable ? beginImageDrag("move", resolved) : undefined}
        onPointerMove={imgEditable ? onImagePointerMove : undefined}
        onPointerUp={imgEditable ? endImageDrag : undefined}
        style={{
          position: "absolute",
          left: `${(box.x / SLIDE_W) * 100}%`,
          top: `${(box.y / SLIDE_H) * 100}%`,
          width: `${(box.w / SLIDE_W) * 100}%`,
          height: `${(box.h / SLIDE_H) * 100}%`,
          cursor: imgEditable ? "move" : undefined,
          touchAction: imgEditable ? "none" : undefined,
          outline: imgEditable ? "1px solid rgba(59,130,246,0.7)" : undefined,
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <img src={img.src} alt={img.alt} draggable={false} style={{ width: "100%", height: "100%", objectFit: img.fit === "cover" ? "cover" : "contain", pointerEvents: "none" }} />
        </div>
        {imgEditable && HANDLES.map((h) => (
          <div
            key={h.c}
            data-image-handle={h.c}
            onPointerDown={beginImageDrag(h.c, resolved)}
            style={{ position: "absolute", width: 9, height: 9, background: "#3B82F6", border: "1px solid #fff", borderRadius: 2, cursor: h.cursor, ...h.pos }}
          />
        ))}
      </div>
    );
  };

  // Background = the LAYOUT's own <p:bg> fill if it has one (e.g. a full-bleed cover panel),
  // else the master bg color. Decorative shapes are painted on top.
  const bgColor = `#${layout?.background ?? masterBgColor}`;

  return (
    <div
      onClick={exportMode ? undefined : onClick}
      style={{
        width: pxW,
        height: pxH,
        backgroundColor: bgColor,
        position: "relative",
        overflow: "hidden",
        // Export = a clean full-bleed slide: no rounded corners, no editor border/selection chrome.
        borderRadius: exportMode ? 0 : 4,
        border: exportMode
          ? "none"
          : isActive ? "2px solid #3B82F6" : selected ? "2px solid rgba(59,130,246,0.55)" : "1px solid #333",
        boxShadow: !exportMode && selected && !isActive ? "0 0 0 2px rgba(59,130,246,0.2)" : undefined,
        cursor: exportMode ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      {/* Decorative shapes: the MASTER's own shapes first (a base layer under every layout), then the
          layout's — fill + optional rounded corners + outline. */}
      {[...(masterDecorations ?? []).map((d) => ["m", d] as const), ...(layout?.decorations ?? []).map((d) => ["l", d] as const)].map(([src, d], i) => (
        <div
          key={`deco-${src}-${i}`}
          style={{
            position: "absolute",
            left: `${(d.x / SLIDE_W) * 100}%`,
            top: `${(d.y / SLIDE_H) * 100}%`,
            width: `${(d.w / SLIDE_W) * 100}%`,
            height: `${(d.h / SLIDE_H) * 100}%`,
            backgroundColor: `#${d.color}`,
            ...(d.radius ? { borderRadius: d.radius * scale } : {}),
            ...(d.border ? { border: `${Math.max(1, 0.014 * scale)}px solid #${d.border}` } : {}),
          }}
        />
      ))}

      {/* Static (non-placeholder) text labels from the master, then the layout — e.g. a cover's
          "日付 / 部署 / 作成者". PowerPoint renders these; they aren't placeholders or filled decos. */}
      {[...(masterStaticTexts ?? []), ...(layout?.staticTexts ?? [])].map((st, i) => {
        const s = st.style;
        return (
          <div
            key={`static-${i}`}
            style={{
              position: "absolute",
              left: `${(s.x / SLIDE_W) * 100}%`,
              top: `${(s.y / SLIDE_H) * 100}%`,
              width: `${(s.w / SLIDE_W) * 100}%`,
              height: `${(s.h / SLIDE_H) * 100}%`,
              fontSize: s.fontSize * (scale / 72),
              color: `#${s.fontColor}`,
              fontWeight: s.bold ? "bold" : "normal",
              textAlign: s.align === "ctr" ? "center" : s.align === "r" ? "right" : "left",
              overflow: "hidden",
              lineHeight: 1.2,
              whiteSpace: "pre-wrap",
            }}
          >
            {st.text}
          </div>
        );
      })}

      {/* BEHIND (最背面) image: a normal-sized figure painted AFTER the master/layout decorations but
          BEFORE the placeholder shapes, so existing title/body/figures stay on top (never the slide bg,
          never full-bleed — it rides its placeholder box). */}
      {slide.image?.behind && renderImageBox(imageRect(slide.image, imagePlaceholder(layoutPhs, slide.image.placeholderIdx))!)}

      {/* Placeholders from template with user content */}
      {layout?.placeholders.map((ph) => {
        const s = ph.style;

        // If this placeholder is replaced by a diagram or mermaid, render it (role-resolved body idx)
        const isDiagramPh = slide.diagram && ph.idx === diagBodyIdx;
        const isMermaidPh = slide.mermaidBlock && ph.idx === mermBodyIdx;

        // Diagram: full-slide transparent SVG overlay (matches how the export
        // embeds diagram shapes at absolute slide coordinates).
        if (isDiagramPh) {
          // Solo diagram (idx 1) = full-slide; beside-text diagram (idx 2) is
          // confined to its placeholder box. Both are drag-editable (the overlay
          // inverse-maps the region transform for hit-testing).
          const isSolo = slide.diagram!.placeholderIdx === "1";
          return (
            <DiagramSvgOverlay
              key={`diagram-${ph.idx}`}
              diagramYaml={slide.diagram!.yaml}
              region={isSolo ? undefined : { x: s.x, y: s.y, w: s.w, h: s.h }}
              editable={!!onDiagramChange}
              onChange={onDiagramChange}
            />
          );
        }

        // Mermaid (```mermaid): if it's a NATIVE diagram type, render it natively
        // (same engine as .diagram / the export) — never a blank mermaid.js image.
        // Only genuinely non-native Mermaid (pie/gantt/…) falls back to an image.
        if (isMermaidPh) {
          const nativeSpec = mermaidToDiagramSpec(slide.mermaidBlock!.mermaid);
          if (nativeSpec) {
            const isSolo = slide.mermaidBlock!.placeholderIdx === "1";
            return (
              <DiagramSvgOverlay
                key={`mmd-native-${ph.idx}`}
                diagramYaml={diagramSpecToYaml(nativeSpec)}
                region={isSolo ? undefined : { x: s.x, y: s.y, w: s.w, h: s.h }}
                editable={false}
              />
            );
          }
          return (
            <div
              key={`visual-${ph.idx}`}
              style={{
                position: "absolute",
                left: `${(s.x / SLIDE_W) * 100}%`,
                top: `${(s.y / SLIDE_H) * 100}%`,
                width: `${(s.w / SLIDE_W) * 100}%`,
                height: `${(s.h / SLIDE_H) * 100}%`,
                overflow: "hidden",
              }}
            >
              <MermaidDirect
                mermaidSyntax={slide.mermaidBlock!.mermaid}
                width="100%"
                height="100%"
                instanceId={`mmd-${slideIndex}-${scale}`}
                svgCache={slide.mermaidBlock!.svgCache}
              />
            </div>
          );
        }

        // Native table → an HTML <table> at the placeholder box (matches the export).
        if (slide.table && ph.idx === tableBodyIdx) {
          const t = slide.table;
          return (
            <div
              key={`table-${ph.idx}`}
              style={{
                position: "absolute",
                left: `${(s.x / SLIDE_W) * 100}%`,
                top: `${(s.y / SLIDE_H) * 100}%`,
                width: `${(s.w / SLIDE_W) * 100}%`,
                height: `${(s.h / SLIDE_H) * 100}%`,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 * (scale / 72), tableLayout: "fixed" }}>
                <tbody>
                  {t.rows.map((row, ri) => {
                    const isHeader = t.header && ri === 0;
                    const band = !isHeader && ri % 2 === 0;
                    return (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            style={{
                              border: "1px solid #C8D0DC",
                              padding: "1px 6px",
                              background: isHeader ? "#1E2761" : band ? "#F1F4F9" : "#FFFFFF",
                              color: isHeader ? "#FFFFFF" : "#1E293B",
                              fontWeight: isHeader ? 700 : 400,
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }

        // Code/log → monospace text at the code body box (matches the export's code-body fill).
        if (slide.code && ph.idx === codeBodyIdx) {
          return (
            <div
              key={`code-${ph.idx}`}
              style={{
                position: "absolute",
                left: `${(s.x / SLIDE_W) * 100}%`,
                top: `${(s.y / SLIDE_H) * 100}%`,
                width: `${(s.w / SLIDE_W) * 100}%`,
                height: `${(s.h / SLIDE_H) * 100}%`,
                overflow: "hidden",
                fontFamily: "ui-monospace, monospace",
                fontSize: s.fontSize * (scale / 72),
                color: `#${s.fontColor}`,
                whiteSpace: "pre-wrap",
                lineHeight: 1.35,
              }}
            >
              {slide.code.content}
            </div>
          );
        }

        // Image (![alt](data URI)) as a BODY figure → rendered in its (dragged/manual/placeholder) box.
        // A BEHIND image is NOT rendered here (imageBodyIdx is undefined for it) — it's drawn as a
        // backmost layer BEFORE this map so existing content stays on top.
        if (slide.image && ph.idx === imageBodyIdx) {
          return renderImageBox(imageRect(slide.image, ph) ?? s);
        }

        const content = contentFor.get(ph.idx);
        if (!content) return null;

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
            {content.paragraphs.map((p, i) => renderParagraph(p, i, s.bulletChar))}
          </div>
        );
      })}

      {/* Slide number — preview only; the standalone-HTML shell provides its own counter */}
      {!exportMode && (
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
      )}
    </div>
  );
}

// ── Exported for reuse as thumbnail ──
export { SlideCard };

// ── Main preview component ──

interface SlidePreviewProps {
  deck: DeckIR | null;
  template: TemplateData | null;
  error: string | null;
  /** NON-blocking advisory (e.g. an AI edit changed numbers) — a banner over a STILL-rendered slide. */
  notice?: string | null;
  onNoticeDismiss?: () => void;
  activeSlide?: number;
  onSlideClick?: (index: number) => void;
  singleSlide?: boolean; // show only the active slide
  scale?: number;
  /** Enables drag-to-move on the active slide's diagram (Edit mode). */
  onDiagramChange?: (yaml: string) => void;
  /** Enables drag/resize of the active slide's image, reporting the new rect (Edit mode). */
  onImageRectChange?: (rect: ImageRect) => void;
}

export default function SlidePreview({
  deck,
  template,
  error,
  notice,
  onNoticeDismiss,
  activeSlide,
  onSlideClick,
  singleSlide = false,
  scale: scaleProp,
  onDiagramChange,
  onImageRectChange,
}: SlidePreviewProps) {
  // Catalog → layout selection adapts to the template (canonical = unchanged).
  const catalog = useMemo(() => (template ? buildCatalog(template) : undefined), [template]);

  // Fit the slide to the available pane by default (the fixed 72-dpi render overflowed
  // narrow panes); a small zoom control lets the user scale it down/up by %.
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const PAD = 40; // p-4 padding + scrollbar/zoom-control headroom
  const fitW = Math.max(1, box.w - PAD) / SLIDE_W;
  const fitH = Math.max(1, box.h - PAD) / SLIDE_H;
  // single slide → fit BOTH dims (whole slide visible); multi → fit width (scroll vertically)
  const fitScale = singleSlide ? Math.min(fitW, fitH) : fitW;
  const base = scaleProp ?? (box.w > 0 ? fitScale : 72);
  const scale = Math.max(8, base * zoom);

  const hasSlides = !!deck && deck.slides.length > 0;

  const slideCard = (slide: SlideIR, i: number, active: boolean) => {
    // ALWAYS resolve through autoSelectLayout: it honors a valid pinned name but DEGRADES a name this
    // template lacks (e.g. a canonical "Title.1Title.Single" pin on an alien master) to a real layout
    // — matching the export path. Using slide.layout directly left the cover with no layout = blank.
    const layoutName = autoSelectLayout(slide, i, deck!.slides.length, catalog);
    const layout = template ? findLayout(template, layoutName) : undefined;
    return (
      <SlideCard
        key={i}
        slide={slide}
        slideIndex={i}
        totalSlides={deck!.slides.length}
        layout={layout}
        masterBgColor={template?.masterBgColor ?? "FFFFFF"}
        masterDecorations={template?.masterDecorations}
        masterStaticTexts={template?.masterStaticTexts}
        scale={scale}
        isActive={active}
        onClick={singleSlide ? undefined : () => onSlideClick?.(i)}
        onDiagramChange={singleSlide ? onDiagramChange : undefined}
        onImageRectChange={singleSlide && active ? onImageRectChange : undefined}
      />
    );
  };

  return (
    <div ref={containerRef} className="h-full w-full relative overflow-hidden">
      {/* Non-blocking advisory (AI edit changed numbers / restored structure) — the slide below
          still renders; this is a dismissable banner, NOT the fatal error state. */}
      {notice && !error && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-start gap-2 max-w-[92%] rounded-md border border-amber-500/50 bg-amber-950/80 px-3 py-1.5 text-[11px] text-amber-200 shadow-lg shadow-black/40">
          <span className="whitespace-pre-wrap">{notice}</span>
          {onNoticeDismiss && (
            <button onClick={onNoticeDismiss} className="shrink-0 text-amber-400 hover:text-amber-200 leading-none" title="閉じる">×</button>
          )}
        </div>
      )}
      {error ? (
        <div className="h-full flex items-center justify-center p-4">
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 max-w-md">
            <p className="text-red-400 text-sm font-mono whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      ) : !hasSlides ? (
        <div className="h-full flex items-center justify-center text-faint">
          <div className="text-center">
            <p className="text-lg mb-2">スライドプレビュー</p>
            <p className="text-sm">Markdown を入力すると</p>
            <p className="text-sm">ここにプレビューが表示されます</p>
          </div>
        </div>
      ) : singleSlide ? (
        <div className="h-full overflow-auto p-4 flex items-start justify-center">
          {(() => {
            const idx = activeSlide ?? 0;
            const slide = deck!.slides[idx];
            return slide ? slideCard(slide, idx, true) : null;
          })()}
        </div>
      ) : (
        <div className="h-full overflow-auto p-4 flex flex-col items-center gap-4">
          {deck!.slides.map((slide, i) => slideCard(slide, i, activeSlide === i))}
        </div>
      )}

      {hasSlides && (
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 bg-void/90 border border-edge rounded text-[11px] text-fg2 select-none shadow">
          <button onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))} title="縮小" className="px-1.5 py-0.5 hover:bg-edge rounded-l">−</button>
          <button onClick={() => setZoom(1)} title="フィットに戻す" className="px-1.5 py-0.5 hover:bg-edge tabular-nums text-center" style={{ minWidth: 40 }}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} title="拡大" className="px-1.5 py-0.5 hover:bg-edge rounded-r">＋</button>
        </div>
      )}
    </div>
  );
}
