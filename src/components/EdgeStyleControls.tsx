/**
 * EdgeStyleControls.tsx — A compact panel to tweak one diagram edge's style:
 * line width, solid/dashed, colour, and the start/end port (move where the arrow
 * attaches). Writes back into the diagram YAML/JSON (format-preserving), so it
 * shares the single source of truth with the text editor and the canvas.
 */

import { useState } from "react";
import * as yaml from "js-yaml";
import { dumpDiagramLikeSource } from "../engine/mermaid-to-diagram";

interface RawEdge {
  from: string;
  to: string;
  style?: Record<string, unknown>;
}
interface RawDiagram {
  edges?: RawEdge[];
  [k: string]: unknown;
}

export default function EdgeStyleControls({
  diagramYaml,
  onChange,
}: {
  diagramYaml: string;
  onChange: (yaml: string) => void;
}) {
  const [sel, setSel] = useState(0);

  let edges: RawEdge[];
  try {
    edges = ((yaml.load(diagramYaml) ?? {}) as RawDiagram).edges ?? [];
  } catch {
    return null;
  }
  if (edges.length === 0) return null;

  const idx = Math.min(sel, edges.length - 1);
  const style = (edges[idx].style ?? {}) as {
    width?: number;
    dash?: boolean;
    color?: string;
    srcPort?: number;
  };

  const patch = (p: Record<string, unknown>) => {
    try {
      const obj = (yaml.load(diagramYaml) ?? {}) as RawDiagram;
      const edge = obj.edges?.[idx];
      if (!edge) return;
      const next: Record<string, unknown> = { ...(edge.style ?? {}), ...p };
      // drop keys set back to their default to keep the YAML tidy
      if (next.dash === false) delete next.dash;
      if (next.srcPort === 0) delete next.srcPort;
      edge.style = next;
      onChange(dumpDiagramLikeSource(obj, diagramYaml));
    } catch {
      /* ignore malformed YAML */
    }
  };

  const lbl = "text-[10px] text-gray-500";
  return (
    <div className="mt-2 border-t border-[#2D3A6E] pt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">矢印スタイル</span>
        <select
          value={idx}
          onChange={(e) => setSel(Number(e.target.value))}
          className="flex-1 px-1.5 py-0.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-[11px] text-white"
        >
          {edges.map((e, i) => (
            <option key={i} value={i}>
              {e.from} → {e.to}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-300">
        <label className="flex items-center gap-1">
          <span className={lbl}>太さ</span>
          <input
            type="number"
            min={1}
            max={8}
            step={0.5}
            value={style.width ?? 2}
            onChange={(e) => patch({ width: Number(e.target.value) })}
            className="w-12 px-1 py-0.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-white"
          />
        </label>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!style.dash}
            onChange={(e) => patch({ dash: e.target.checked })}
          />
          <span>点線</span>
        </label>

        <label className="flex items-center gap-1">
          <span className={lbl}>色</span>
          <input
            type="color"
            value={style.color ?? "#94A3B8"}
            onChange={(e) => patch({ color: e.target.value })}
            className="w-6 h-5 bg-transparent border border-[#2D3A6E] rounded p-0"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-gray-300">
        <span className={lbl}>始点位置</span>
        <input
          type="range"
          min={-0.45}
          max={0.45}
          step={0.05}
          value={style.srcPort ?? 0}
          onChange={(e) => patch({ srcPort: Number(e.target.value) })}
          className="flex-1"
        />
        <button
          onClick={() => patch({ srcPort: 0 })}
          className="text-[10px] text-gray-400 hover:text-white px-1"
          title="始点位置をリセット"
        >
          ⟲
        </button>
      </label>
    </div>
  );
}
