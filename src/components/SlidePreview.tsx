/**
 * SlidePreview.tsx — WYSIWYG-style slide preview driven by template data.
 *
 * Renders slides using actual placeholder positions, colors, and decorative
 * shapes extracted from the template PPTX, ensuring preview matches output.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import yaml from "js-yaml";
import type { DeckIR, SlideIR, Paragraph, InlineSegment } from "../engine/slide-schema";
import type { TemplateData, LayoutInfo } from "../engine/template-loader";
import { autoSelectLayout, findLayout } from "../engine/template-loader";
import { MERMAID_CONFIG } from "./mermaid";
import { renderDiagramToSvg } from "../engine/svg-writer";
import { DiagramSpecSchema } from "../engine/schema";
import { computeLayout, SLIDE_W as DIAGRAM_W, SLIDE_H as DIAGRAM_H } from "../engine/layout-engine";

// ── Mermaid initialization (shared with the PPTX export for WYSIWYG parity) ──
mermaid.initialize(MERMAID_CONFIG);

// ── Global counter for unique Mermaid render IDs ──
let mermaidIdCounter = 0;

// ── Diagram (```diagram) renderer — shares the PPTX painter for true WYSIWYG ──
// Renders the DiagramSpec via the SAME engine as the exporter (svg-writer →
// paintDiagram) and overlays the shapes (transparent, full-slide) exactly like
// the export embeds them. No more divergent Mermaid layout for diagrams.
function DiagramSvgOverlay({
  diagramYaml,
  editable = false,
  onChange,
}: {
  diagramYaml: string;
  editable?: boolean;
  onChange?: (yaml: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);

  const spec = useMemo(() => {
    try {
      const parsed = DiagramSpecSchema.safeParse(yaml.load(diagramYaml));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, [diagramYaml]);

  // While dragging, apply the draft override so the preview follows live.
  const svg = useMemo(() => {
    if (!spec) return "";
    const s = draft
      ? {
          ...spec,
          nodes: spec.nodes.map((n) =>
            n.id === draft.id ? { ...n, override: { ...n.override, x: draft.x, y: draft.y } } : n,
          ),
        }
      : spec;
    // Embedded in a titled slide → omit the diagram's own title (matches export).
    return renderDiagramToSvg(s, { transparent: true, omitTitle: true });
  }, [spec, draft]);

  function toInches(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * DIAGRAM_W,
      y: ((e.clientY - r.top) / r.height) * DIAGRAM_H,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!spec) return;
    const c = toInches(e);
    // Topmost node under the cursor (positions are drawn in order; reverse).
    const hit = [...computeLayout(spec)]
      .reverse()
      .find((p) => c.x >= p.x && c.x <= p.x + p.w && c.y >= p.y && c.y <= p.y + p.h);
    if (!hit) return;
    dragRef.current = { id: hit.nodeId, offX: c.x - hit.x, offY: c.y - hit.y };
    setDraft({ id: hit.nodeId, x: hit.x, y: hit.y });
    ref.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const c = toInches(e);
    setDraft({ id: dragRef.current.id, x: c.x - dragRef.current.offX, y: c.y - dragRef.current.offY });
  }

  function onPointerUp() {
    const d = dragRef.current;
    const cur = draft;
    dragRef.current = null;
    setDraft(null);
    if (!d || !cur || !onChange) return;
    try {
      // Write into the raw YAML object (no schema defaults injected) to keep it tidy.
      const raw = yaml.load(diagramYaml) as { nodes?: Array<Record<string, unknown>> };
      const node = raw.nodes?.find((n) => n.id === d.id);
      if (!node) return;
      const round = (v: number) => Math.round(v * 100) / 100;
      node.override = { ...(node.override as object), x: round(cur.x), y: round(cur.y) };
      onChange(yaml.dump(raw, { lineWidth: 1000 }));
    } catch {
      /* ignore malformed YAML */
    }
  }

  if (!svg) return null;
  return (
    <div
      ref={ref}
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? onPointerUp : undefined}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: editable ? "auto" : "none",
        cursor: editable ? (draft ? "grabbing" : "grab") : "default",
        touchAction: "none",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

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
  masterBgColor: string; // hex without #
  scale: number;
  isActive?: boolean;
  onClick?: () => void;
  /** When set, the embedded diagram is drag-editable and reports new YAML. */
  onDiagramChange?: (yaml: string) => void;
}

function SlideCard({ slide, slideIndex, layout, masterBgColor, scale, isActive, onClick, onDiagramChange }: SlideCardProps) {
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
        const s = ph.style;

        // If this placeholder is replaced by a diagram or mermaid, render it
        const isDiagramPh = slide.diagram && ph.idx === slide.diagram.placeholderIdx;
        const isMermaidPh = slide.mermaidBlock && ph.idx === slide.mermaidBlock.placeholderIdx;

        // Diagram: full-slide transparent SVG overlay (matches how the export
        // embeds diagram shapes at absolute slide coordinates).
        if (isDiagramPh) {
          return (
            <DiagramSvgOverlay
              key={`diagram-${ph.idx}`}
              diagramYaml={slide.diagram!.yaml}
              editable={!!onDiagramChange}
              onChange={onDiagramChange}
            />
          );
        }

        // Mermaid (```mermaid): an image confined to the placeholder box.
        if (isMermaidPh) {
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
  const scale = scaleProp ?? 72;

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

  if (singleSlide) {
    const idx = activeSlide ?? 0;
    const slide = deck.slides[idx];
    if (!slide) return null;
    const layoutName = slide.layout === "auto"
      ? autoSelectLayout(slide, idx, deck.slides.length)
      : slide.layout;
    const layout = template ? findLayout(template, layoutName) : undefined;

    return (
      <div className="h-full overflow-auto p-4 flex items-start justify-center">
        <SlideCard
          slide={slide}
          slideIndex={idx}
          totalSlides={deck.slides.length}
          layout={layout}
          masterBgColor={template?.masterBgColor ?? "FFFFFF"}
          scale={scale}
          isActive={true}
          onDiagramChange={onDiagramChange}
        />
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
            masterBgColor={template?.masterBgColor ?? "FFFFFF"}
            scale={scale}
            isActive={activeSlide === i}
            onClick={() => onSlideClick?.(i)}
          />
        );
      })}
    </div>
  );
}
