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
type Override = { x?: number; y?: number; w?: number; h?: number };

function DiagramSvgOverlay({
  diagramYaml,
  editable = false,
  onChange,
  region,
}: {
  diagramYaml: string;
  editable?: boolean;
  onChange?: (yaml: string) => void;
  region?: { x: number; y: number; w: number; h: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const moveRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const resizeRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const [draft, setDraft] = useState<{ id: string; ov: Override } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const spec = useMemo(() => {
    try {
      const parsed = DiagramSpecSchema.safeParse(yaml.load(diagramYaml));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, [diagramYaml]);

  // Spec with the live draft override applied (preview follows the drag).
  const draftSpec = useMemo(() => {
    if (!spec) return null;
    if (!draft) return spec;
    return {
      ...spec,
      nodes: spec.nodes.map((n) =>
        n.id === draft.id ? { ...n, override: { ...n.override, ...draft.ov } } : n,
      ),
    };
  }, [spec, draft]);

  const svg = useMemo(
    () =>
      draftSpec
        ? renderDiagramToSvg(draftSpec, { transparent: true, omitTitle: true, region })
        : "",
    [draftSpec, region],
  );

  // Live positions (incl. draft) used to place selection handles.
  const positions = useMemo(() => (draftSpec ? computeLayout(draftSpec) : []), [draftSpec]);
  const selectedPos = selected ? positions.find((p) => p.nodeId === selected) : undefined;
  const selectedHasOverride = !!selected && !!spec?.nodes.find((n) => n.id === selected)?.override;

  function toInches(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * DIAGRAM_W,
      y: ((e.clientY - r.top) / r.height) * DIAGRAM_H,
    };
  }

  function writeOverride(id: string, ov: Override) {
    try {
      const raw = yaml.load(diagramYaml) as { nodes?: Array<Record<string, unknown>> };
      const node = raw.nodes?.find((n) => n.id === id);
      if (!node) return;
      const round = (v: number) => Math.round(v * 100) / 100;
      const next: Record<string, number> = { ...(node.override as Record<string, number>) };
      (["x", "y", "w", "h"] as const).forEach((k) => {
        if (ov[k] !== undefined) next[k] = round(ov[k]!);
      });
      node.override = next;
      onChange?.(yaml.dump(raw, { lineWidth: 1000 }));
    } catch {
      /* ignore malformed YAML */
    }
  }

  function clearOverride(id: string) {
    try {
      const raw = yaml.load(diagramYaml) as { nodes?: Array<Record<string, unknown>> };
      const node = raw.nodes?.find((n) => n.id === id);
      if (!node) return;
      delete node.override;
      onChange?.(yaml.dump(raw, { lineWidth: 1000 }));
    } catch {
      /* ignore */
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!spec) return;
    const c = toInches(e);
    const hit = [...computeLayout(spec)]
      .reverse()
      .find((p) => c.x >= p.x && c.x <= p.x + p.w && c.y >= p.y && c.y <= p.y + p.h);
    if (!hit) {
      setSelected(null);
      return;
    }
    setSelected(hit.nodeId);
    moveRef.current = { id: hit.nodeId, offX: c.x - hit.x, offY: c.y - hit.y };
    movedRef.current = false;
    ref.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onResizeDown(e: React.PointerEvent) {
    if (!selectedPos) return;
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { id: selectedPos.nodeId, x: selectedPos.x, y: selectedPos.y };
    movedRef.current = false;
    ref.current!.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const c = toInches(e);
    if (resizeRef.current) {
      movedRef.current = true;
      const r = resizeRef.current;
      setDraft({ id: r.id, ov: { w: Math.max(0.3, c.x - r.x), h: Math.max(0.2, c.y - r.y) } });
    } else if (moveRef.current) {
      movedRef.current = true;
      const m = moveRef.current;
      setDraft({ id: m.id, ov: { x: c.x - m.offX, y: c.y - m.offY } });
    }
  }

  function onPointerUp() {
    const id = resizeRef.current?.id ?? moveRef.current?.id;
    const cur = draft;
    resizeRef.current = null;
    moveRef.current = null;
    setDraft(null);
    if (movedRef.current && id && cur) writeOverride(id, cur.ov);
  }

  if (!svg) return null;

  // Selection box / handle geometry in % of the slide.
  const pct = selectedPos
    ? {
        left: (selectedPos.x / DIAGRAM_W) * 100,
        top: (selectedPos.y / DIAGRAM_H) * 100,
        width: (selectedPos.w / DIAGRAM_W) * 100,
        height: (selectedPos.h / DIAGRAM_H) * 100,
      }
    : null;

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
        cursor: editable ? (draft ? "grabbing" : "default") : "default",
        touchAction: "none",
      }}
    >
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />

      {editable && pct && (
        <>
          {/* selection outline */}
          <div
            style={{
              position: "absolute",
              left: `${pct.left}%`,
              top: `${pct.top}%`,
              width: `${pct.width}%`,
              height: `${pct.height}%`,
              border: "1.5px solid #3B82F6",
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          />
          {/* bottom-right resize handle */}
          <div
            onPointerDown={onResizeDown}
            title="ドラッグでリサイズ"
            style={{
              position: "absolute",
              left: `${pct.left + pct.width}%`,
              top: `${pct.top + pct.height}%`,
              width: 11,
              height: 11,
              transform: "translate(-50%, -50%)",
              background: "#3B82F6",
              border: "1.5px solid #fff",
              borderRadius: 2,
              cursor: "nwse-resize",
              pointerEvents: "auto",
            }}
          />
          {/* reset-to-auto chip (only when the node has an override) */}
          {selectedHasOverride && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => clearOverride(selected!)}
              title="自動配置に戻す"
              style={{
                position: "absolute",
                left: `${pct.left + pct.width}%`,
                top: `${pct.top}%`,
                transform: "translate(4px, -100%)",
                fontSize: 10,
                lineHeight: "14px",
                padding: "1px 5px",
                background: "#1E2761",
                color: "#93C5FD",
                border: "1px solid #3B82F6",
                borderRadius: 3,
                cursor: "pointer",
                pointerEvents: "auto",
                whiteSpace: "nowrap",
              }}
            >
              ⟲ auto
            </button>
          )}
        </>
      )}
    </div>
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
          // Solo diagram (idx 1) = full-slide + drag-editable; beside-text
          // diagram (idx 2) is confined to its placeholder box (drag disabled,
          // since hit-testing is full-slide — edit via the YAML editor instead).
          const isSolo = slide.diagram!.placeholderIdx === "1";
          return (
            <DiagramSvgOverlay
              key={`diagram-${ph.idx}`}
              diagramYaml={slide.diagram!.yaml}
              region={isSolo ? undefined : { x: s.x, y: s.y, w: s.w, h: s.h }}
              editable={isSolo && !!onDiagramChange}
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
