import type { DiagramSpec } from "../engine/schema";

interface StatusBarProps {
  spec: DiagramSpec | null;
  error: string | null;
  filePath: string | null;
}

export default function StatusBar({ spec, error, filePath }: StatusBarProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-1 bg-[#141B41] text-xs text-gray-400 border-t border-[#2D3A6E]">
      <span>
        {error ? (
          <span className="text-red-400">Error</span>
        ) : spec ? (
          <span className="text-green-400">Ready</span>
        ) : (
          "No input"
        )}
      </span>

      {spec && (
        <>
          <span>Nodes: {spec.nodes.length}</span>
          <span>Edges: {spec.edges.length}</span>
          {spec.groups.length > 0 && <span>Groups: {spec.groups.length}</span>}
          {spec.lanes.length > 0 && <span>Lanes: {spec.lanes.length}</span>}
          <span>Type: {spec.type}</span>
          <span>Direction: {spec.direction}</span>
        </>
      )}

      <div className="flex-1" />
      {filePath && <span className="text-gray-500 truncate max-w-xs">{filePath}</span>}
    </div>
  );
}
