/**
 * SequenceDragOverlay.tsx — Interactive overlay for ```diagram of type "sequence".
 *
 * Sequence participants are COLUMNS, not free-floating nodes, so the node-edge
 * DiagramSvgOverlay (computeLayout-based handles) can't edit them. Here the
 * meaningful canvas edit is reordering participants left↔right by horizontal
 * drag; messages reference participant ids, so they follow the reorder. Renders
 * via the SAME engine as the exporter (renderDiagramToSvg → paintSequence) for
 * true WYSIWYG, and commits a reordered node list back as YAML/JSON.
 */

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadYaml } from "../engine/yaml-io";
import { dumpDiagramLikeSource } from "../engine/mermaid-to-diagram";
import { renderDiagramToSvg } from "../engine/svg-writer";
import { DiagramSpecSchema } from "../engine/schema";
import { SLIDE_W as DIAGRAM_W, SLIDE_H as DIAGRAM_H } from "../engine/layout-engine";
import { computeSequenceLayout } from "../engine/diagram-sequence";
import { fitTransform } from "../engine/draw-target";
import { seqDropIndex, seqReorder } from "./sequence-reorder";

// Matches paintDiagram's omitTitle path (embedded diagram draws no own title).
const CONTENT_TOP = 0.8;

type Props = {
  diagramYaml: string;
  editable?: boolean;
  onChange?: (yaml: string) => void;
  region?: { x: number; y: number; w: number; h: number };
};

export default function SequenceDragOverlay({ diagramYaml, editable = false, onChange, region }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string } | null>(null);
  const movedRef = useRef(false);
  const [order, setOrder] = useState<string[] | null>(null); // live drag order
  const [selected, setSelected] = useState<string | null>(null);

  const spec = useMemo(() => {
    try {
      const parsed = DiagramSpecSchema.safeParse(loadYaml(diagramYaml));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, [diagramYaml]);

  // Spec with the live drag order applied (preview follows the drag).
  const draftSpec = useMemo(() => {
    if (!spec) return null;
    if (!order) return spec;
    const byId = new Map(spec.nodes.map((n) => [n.id, n]));
    const nodes = order.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
    return nodes.length === spec.nodes.length ? { ...spec, nodes } : spec;
  }, [spec, order]);

  // Region→pixels transform from the COMMITTED spec (stable during a drag).
  const baseTf = useMemo(() => {
    if (!region || !spec) return { scale: 1, offsetX: 0, offsetY: 0 };
    return fitTransform(computeSequenceLayout(spec, CONTENT_TOP).bbox, region);
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

  // Participant layout (in draft order) for hit-testing + the selection box.
  const seq = useMemo(() => (draftSpec ? computeSequenceLayout(draftSpec, CONTENT_TOP) : null), [draftSpec]);

  // Cursor → diagram inches (inverse of the region transform).
  function toInches(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * DIAGRAM_W;
    const sy = ((e.clientY - r.top) / r.height) * DIAGRAM_H;
    return { x: (sx - baseTf.offsetX) / baseTf.scale, y: (sy - baseTf.offsetY) / baseTf.scale };
  }

  function hitParticipant(x: number, y: number) {
    if (!seq) return null;
    return (
      seq.parts.find(
        (p) => x >= p.boxX && x <= p.boxX + p.boxW && y >= seq.boxY && y <= seq.boxY + seq.boxH,
      ) ?? null
    );
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!seq) return;
    const c = toInches(e);
    const hit = hitParticipant(c.x, c.y);
    if (!hit) {
      setSelected(null);
      return;
    }
    setSelected(hit.id);
    dragRef.current = { id: hit.id };
    movedRef.current = false;
    setOrder(seq.parts.map((p) => p.id));
    ref.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !seq) return;
    movedRef.current = true;
    const c = toInches(e);
    const dragged = dragRef.current.id;
    const others = seq.parts.filter((p) => p.id !== dragged);
    const next = seqReorder(
      others.map((p) => p.id),
      dragged,
      seqDropIndex(others.map((p) => p.cx), c.x),
    );
    setOrder((prev) => (prev && prev.join() === next.join() ? prev : next));
  }

  function commitOrder(newOrder: string[]) {
    try {
      const raw = loadYaml(diagramYaml) as { nodes?: Array<{ id: string }> };
      if (!raw.nodes) return;
      const byId = new Map(raw.nodes.map((n) => [n.id, n]));
      const reordered: Array<{ id: string }> = [];
      for (const id of newOrder) {
        const n = byId.get(id);
        if (n) reordered.push(n);
      }
      for (const n of raw.nodes) if (!newOrder.includes(n.id)) reordered.push(n); // safety
      raw.nodes = reordered;
      onChange?.(dumpDiagramLikeSource(raw, diagramYaml));
    } catch {
      /* ignore malformed source */
    }
  }

  function onPointerUp() {
    const dragged = dragRef.current?.id;
    const cur = order;
    dragRef.current = null;
    if (movedRef.current && dragged && cur) commitOrder(cur);
    setOrder(null);
  }

  if (!svg) return null;

  const selPart = selected && seq ? seq.parts.find((p) => p.id === selected) : null;
  const pct =
    selPart && seq
      ? {
          left: ((selPart.boxX * baseTf.scale + baseTf.offsetX) / DIAGRAM_W) * 100,
          top: ((seq.boxY * baseTf.scale + baseTf.offsetY) / DIAGRAM_H) * 100,
          width: ((selPart.boxW * baseTf.scale) / DIAGRAM_W) * 100,
          height: ((seq.boxH * baseTf.scale) / DIAGRAM_H) * 100,
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
        cursor: editable ? (order ? "grabbing" : "default") : "default",
        touchAction: "none",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {editable && pct && (
        <div
          title={t("seqOverlay.reorderHint")}
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
      )}
    </div>
  );
}
