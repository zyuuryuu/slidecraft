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
import { DiagramSpecSchema, EdgeStyleSchema } from "../engine/schema";
import { computeLayout, detectCp, cpCoords, SLIDE_W as DIAGRAM_W, SLIDE_H as DIAGRAM_H, type NodePosition } from "../engine/layout-engine";
import { fitTransform } from "../engine/draw-target";
import SequenceDragOverlay from "./SequenceDragOverlay";

type OverlayProps = {
  diagramYaml: string;
  editable?: boolean;
  onChange?: (yaml: string) => void;
  region?: { x: number; y: number; w: number; h: number };
};

/**
 * Dispatch by diagram engine: sequence diagrams are temporal columns (edited by
 * reordering participants) so they get SequenceDragOverlay; everything else uses
 * the node-edge FlowDiagramOverlay below. One useMemo here keeps hook order stable.
 */
export default function DiagramSvgOverlay(props: OverlayProps) {
  const type = useMemo(() => {
    try {
      return DiagramSpecSchema.safeParse(yaml.load(props.diagramYaml)).data?.type;
    } catch {
      return undefined;
    }
  }, [props.diagramYaml]);
  if (type === "sequence") return <SequenceDragOverlay {...props} />;
  return <FlowDiagramOverlay {...props} />;
}

// ── Diagram (```diagram) renderer — shares the PPTX painter for true WYSIWYG ──
// Renders the DiagramSpec via the SAME engine as the exporter (svg-writer →
// paintDiagram) and overlays the shapes (transparent, full-slide) exactly like
// the export embeds them. No more divergent Mermaid layout for diagrams.
type Override = { x?: number; y?: number; w?: number; h?: number };

function FlowDiagramOverlay({ diagramYaml, editable = false, onChange, region }: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const moveRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const resizeRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const edgePortRef = useRef<{ idx: number; side: number; node: NodePosition } | null>(null);
  const [draft, setDraft] = useState<{ id: string; ov: Override } | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<{ idx: number; srcPort: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const spec = useMemo(() => {
    try {
      const parsed = DiagramSpecSchema.safeParse(yaml.load(diagramYaml));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, [diagramYaml]);

  // Spec with the live draft applied (preview follows the drag) — node override
  // AND an edge's start-port while it is being dragged.
  const draftSpec = useMemo(() => {
    if (!spec) return null;
    let s = spec;
    if (draft) {
      s = {
        ...s,
        nodes: s.nodes.map((n) =>
          n.id === draft.id ? { ...n, override: { ...n.override, ...draft.ov } } : n,
        ),
      };
    }
    if (edgeDraft) {
      s = {
        ...s,
        edges: s.edges.map((e, i) =>
          i === edgeDraft.idx
            ? { ...e, style: EdgeStyleSchema.parse({ ...e.style, srcPort: edgeDraft.srcPort }) }
            : e,
        ),
      };
    }
    return s;
  }, [spec, draft, edgeDraft]);

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

  // A drag handle at the START of each edge leaving the selected node. Dragging it
  // along the node's edge sets that edge's srcPort (move where the arrow attaches).
  const edgeHandles = useMemo(() => {
    if (!spec || !selected) return [];
    const selNode = spec.nodes.find((n) => n.id === selected);
    if (!selNode || selNode.shape === "diamond") return []; // diamonds ignore the port offset
    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const srcPos = posMap.get(selected);
    if (!srcPos) return [];
    const out: Array<{ idx: number; side: number; x: number; y: number; node: NodePosition }> = [];
    spec.edges.forEach((e, i) => {
      if (e.from !== selected) return;
      const tgtPos = posMap.get(e.to);
      if (!tgtPos) return;
      const side = detectCp(srcPos, tgtPos, spec.direction)[0];
      const port = edgeDraft?.idx === i ? edgeDraft.srcPort : e.style?.srcPort ?? 0;
      const cp = cpCoords(srcPos, side, selNode.shape ?? "rect", port);
      out.push({ idx: i, side, x: cp.x, y: cp.y, node: srcPos });
    });
    return out;
  }, [spec, selected, positions, edgeDraft]);

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

  function writeEdgePort(idx: number, srcPort: number) {
    try {
      const raw = yaml.load(diagramYaml) as { edges?: Array<Record<string, unknown>> };
      const edge = raw.edges?.[idx];
      if (!edge) return;
      const style = { ...((edge.style as Record<string, unknown>) ?? {}) };
      if (Math.abs(srcPort) < 0.03) delete style.srcPort; // snap-to-centre clears it
      else style.srcPort = Math.round(srcPort * 100) / 100;
      edge.style = style;
      onChange?.(dumpDiagramLikeSource(raw, diagramYaml));
    } catch {
      /* ignore */
    }
  }

  function onEdgePortDown(e: React.PointerEvent, idx: number, side: number, node: NodePosition) {
    e.stopPropagation();
    e.preventDefault();
    edgePortRef.current = { idx, side, node };
    movedRef.current = false;
    ref.current!.setPointerCapture(e.pointerId);
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
    if (edgePortRef.current) {
      movedRef.current = true;
      const ep = edgePortRef.current;
      const cx = ep.node.x + ep.node.w / 2;
      const cy = ep.node.y + ep.node.h / 2;
      const horizontal = ep.side === 0 || ep.side === 2; // top/bottom edge → slide along x
      const frac = horizontal ? (c.x - cx) / ep.node.w : (c.y - cy) / ep.node.h;
      setEdgeDraft({ idx: ep.idx, srcPort: Math.max(-0.45, Math.min(0.45, frac)) });
      return;
    }
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
    if (edgePortRef.current) {
      const cur = edgeDraft;
      edgePortRef.current = null;
      setEdgeDraft(null);
      if (movedRef.current && cur) writeEdgePort(cur.idx, cur.srcPort);
      return;
    }
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

      {/* edge start-port handles: drag to move where each outgoing arrow attaches */}
      {editable &&
        edgeHandles.map((h) => (
          <div
            key={`ep-${h.idx}`}
            onPointerDown={(e) => onEdgePortDown(e, h.idx, h.side, h.node)}
            title="ドラッグで矢印の始点を移動"
            style={{
              position: "absolute",
              left: `${((h.x * baseTf.scale + baseTf.offsetX) / DIAGRAM_W) * 100}%`,
              top: `${((h.y * baseTf.scale + baseTf.offsetY) / DIAGRAM_H) * 100}%`,
              width: 9,
              height: 9,
              transform: "translate(-50%, -50%)",
              background: "#06B6D4",
              border: "1.5px solid #fff",
              borderRadius: "50%",
              cursor: "grab",
              pointerEvents: "auto",
            }}
          />
        ))}
    </div>
  );
}
