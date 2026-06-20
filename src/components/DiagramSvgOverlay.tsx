/**
 * DiagramSvgOverlay.tsx — Interactive ```diagram renderer for the preview.
 * Renders the DiagramSpec via the SAME engine as the exporter (svg-writer →
 * paintDiagram) for true WYSIWYG, and overlays drag/resize handles to edit
 * node positions (and edge ports) directly on the canvas.
 */

import { useMemo, useRef, useState } from "react";
import yaml from "js-yaml";
import { dumpDiagramLikeSource } from "../engine/mermaid-to-diagram";
import { renderDiagramToSvg } from "../engine/svg-writer";
import { DiagramSpecSchema } from "../engine/schema";
import { computeLayout, SLIDE_W as DIAGRAM_W, SLIDE_H as DIAGRAM_H } from "../engine/layout-engine";
import { fitTransform } from "../engine/draw-target";

// ── Diagram (```diagram) renderer — shares the PPTX painter for true WYSIWYG ──
// Renders the DiagramSpec via the SAME engine as the exporter (svg-writer →
// paintDiagram) and overlays the shapes (transparent, full-slide) exactly like
// the export embeds them. No more divergent Mermaid layout for diagrams.
type Override = { x?: number; y?: number; w?: number; h?: number };

export default function DiagramSvgOverlay({
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

  // Region→pixels transform, computed from the COMMITTED spec so it stays fixed
  // while a node is dragged (no rescale jank). Identity when there's no region.
  const baseTf = useMemo(() => {
    if (!region || !spec) return { scale: 1, offsetX: 0, offsetY: 0 };
    const ps = computeLayout(spec);
    if (ps.length === 0) return { scale: 1, offsetX: 0, offsetY: 0 };
    const bbox = {
      minX: Math.min(...ps.map((p) => p.x)),
      minY: Math.min(...ps.map((p) => p.y)),
      maxX: Math.max(...ps.map((p) => p.x + p.w)),
      maxY: Math.max(...ps.map((p) => p.y + p.h)),
    };
    return fitTransform(bbox, region);
  }, [spec, region]);

  const svg = useMemo(
    () =>
      draftSpec
        ? renderDiagramToSvg(draftSpec, {
            transparent: true,
            omitTitle: true,
            transform: region ? baseTf : undefined,
          })
        : "",
    [draftSpec, region, baseTf],
  );

  // Live positions (incl. draft) used to place selection handles.
  const positions = useMemo(() => (draftSpec ? computeLayout(draftSpec) : []), [draftSpec]);
  const selectedPos = selected ? positions.find((p) => p.nodeId === selected) : undefined;
  const selectedHasOverride = !!selected && !!spec?.nodes.find((n) => n.id === selected)?.override;

  // Cursor → diagram LAYOUT inches (inverse of the region transform), so drag math
  // and overrides stay in the diagram's own coordinate space (region or full-slide).
  function toInches(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * DIAGRAM_W;
    const sy = ((e.clientY - r.top) / r.height) * DIAGRAM_H;
    return { x: (sx - baseTf.offsetX) / baseTf.scale, y: (sy - baseTf.offsetY) / baseTf.scale };
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
      onChange?.(dumpDiagramLikeSource(raw, diagramYaml));
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
      onChange?.(dumpDiagramLikeSource(raw, diagramYaml));
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
  // Handles sit on the RENDERED node box (layout → region via the transform).
  const pct = selectedPos
    ? {
        left: ((selectedPos.x * baseTf.scale + baseTf.offsetX) / DIAGRAM_W) * 100,
        top: ((selectedPos.y * baseTf.scale + baseTf.offsetY) / DIAGRAM_H) * 100,
        width: ((selectedPos.w * baseTf.scale) / DIAGRAM_W) * 100,
        height: ((selectedPos.h * baseTf.scale) / DIAGRAM_H) * 100,
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
