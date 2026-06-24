/**
 * SlidePreview.tsx — WYSIWYG-style slide preview driven by template data.
 *
 * Renders slides using actual placeholder positions, colors, and decorative
 * shapes extracted from the template PPTX, ensuring preview matches output.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import type { DeckIR, SlideIR, Paragraph, InlineSegment } from "../engine/slide-schema";
import type { TemplateData, LayoutInfo } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { MERMAID_CONFIG } from "./mermaid";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "../engine/mermaid-to-diagram";
import DiagramSvgOverlay from "./DiagramSvgOverlay";

// ── Mermaid initialization (shared with the PPTX export for WYSIWYG parity) ──
mermaid.initialize(MERMAID_CONFIG);

// ── Global counter for unique Mermaid render IDs ──
let mermaidIdCounter = 0;


// ── Direct Mermaid syntax renderer (for ```mermaid blocks) ──
function MermaidDirect({ mermaidSyntax, width, height, instanceId }: { mermaidSyntax: string; width: string; height: string; instanceId?: string }) {
  const [svg, setSvg] = useState("");
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    if (!mermaidSyntax.trim()) { setSvg(""); return; }
    const id = instanceId ? `mmd-direct-${instanceId}-${++mermaidIdCounter}` : `mmd-direct-${++mermaidIdCounter}`;
    mermaid.render(id, mermaidSyntax).then(({ svg: rendered }) => {
      if (!cancelRef.current) setSvg(rendered);
    }).catch(() => {
      if (!cancelRef.current) setSvg("");
    });
    return () => { cancelRef.current = true; };
  }, [mermaidSyntax, instanceId]);

  const fittedSvg = svg.replace(
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

function renderParagraph(para: Paragraph, idx: number, bulletChar: string) {
  return (
    <div key={idx} style={{ marginBottom: "0.15em" }}>
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
  scale: number;
  isActive?: boolean;
  /** In the multi-selection set (highlighted) but not necessarily the focused slide. */
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** When set, the embedded diagram is drag-editable and reports new YAML. */
  onDiagramChange?: (yaml: string) => void;
}

function SlideCard({ slide, slideIndex, layout, masterBgColor, scale, isActive, selected, onClick, onDiagramChange }: SlideCardProps) {
  const contentMap = new Map(slide.placeholders.map((p) => [p.idx, p]));
  const pxW = SLIDE_W * scale;
  const pxH = SLIDE_H * scale;

  // Background = master bg color. Decorative shapes are painted on top.
  const bgColor = `#${masterBgColor}`;

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
        border: isActive ? "2px solid #3B82F6" : selected ? "2px solid rgba(59,130,246,0.55)" : "1px solid #333",
        boxShadow: selected && !isActive ? "0 0 0 2px rgba(59,130,246,0.2)" : undefined,
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
        const s = ph.style;

        // If this placeholder is replaced by a diagram or mermaid, render it
        const isDiagramPh = slide.diagram && ph.idx === slide.diagram.placeholderIdx;
        const isMermaidPh = slide.mermaidBlock && ph.idx === slide.mermaidBlock.placeholderIdx;

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
              />
            </div>
          );
        }

        // Native table → an HTML <table> at the placeholder box (matches the export).
        if (slide.table && ph.idx === slide.table.placeholderIdx) {
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

        const content = contentMap.get(ph.idx);
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

// ── Exported for reuse as thumbnail ──
export { SlideCard };

// ── Main preview component ──

interface SlidePreviewProps {
  deck: DeckIR | null;
  template: TemplateData | null;
  error: string | null;
  activeSlide?: number;
  onSlideClick?: (index: number) => void;
  singleSlide?: boolean; // show only the active slide
  scale?: number;
  /** Enables drag-to-move on the active slide's diagram (Edit mode). */
  onDiagramChange?: (yaml: string) => void;
}

export default function SlidePreview({
  deck,
  template,
  error,
  activeSlide,
  onSlideClick,
  singleSlide = false,
  scale: scaleProp,
  onDiagramChange,
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
    const layoutName = slide.layout === "auto" ? autoSelectLayout(slide, i, deck!.slides.length, catalog) : slide.layout;
    const layout = template ? findLayout(template, layoutName) : undefined;
    return (
      <SlideCard
        key={i}
        slide={slide}
        slideIndex={i}
        totalSlides={deck!.slides.length}
        layout={layout}
        masterBgColor={template?.masterBgColor ?? "FFFFFF"}
        scale={scale}
        isActive={active}
        onClick={singleSlide ? undefined : () => onSlideClick?.(i)}
        onDiagramChange={singleSlide ? onDiagramChange : undefined}
      />
    );
  };

  return (
    <div ref={containerRef} className="h-full w-full relative overflow-hidden">
      {error ? (
        <div className="h-full flex items-center justify-center p-4">
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 max-w-md">
            <p className="text-red-400 text-sm font-mono whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      ) : !hasSlides ? (
        <div className="h-full flex items-center justify-center text-gray-500">
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
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 bg-[#0a0e1a]/90 border border-[#2D3A6E] rounded text-[11px] text-gray-300 select-none shadow">
          <button onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))} title="縮小" className="px-1.5 py-0.5 hover:bg-[#2D3A6E] rounded-l">−</button>
          <button onClick={() => setZoom(1)} title="フィットに戻す" className="px-1.5 py-0.5 hover:bg-[#2D3A6E] tabular-nums text-center" style={{ minWidth: 40 }}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} title="拡大" className="px-1.5 py-0.5 hover:bg-[#2D3A6E] rounded-r">＋</button>
        </div>
      )}
    </div>
  );
}
