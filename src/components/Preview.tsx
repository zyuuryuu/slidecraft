import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import type { DiagramSpec } from "../engine/schema";

interface PreviewProps {
  spec: DiagramSpec | null;
  error: string | null;
}

// Diagram-mode preview config. Re-asserted before each render because mermaid is
// a global singleton shared with the markdown preview/export (see ./mermaid).
const DIAGRAM_MERMAID_CONFIG = {
  startOnLoad: false,
  theme: "dark" as const,
  themeVariables: {
    primaryColor: "#1E2761",
    primaryTextColor: "#FFFFFF",
    primaryBorderColor: "#3B82F6",
    lineColor: "#94A3B8",
    secondaryColor: "#2D3A6E",
    tertiaryColor: "#F5F7FA",
  },
};
mermaid.initialize(DIAGRAM_MERMAID_CONFIG);

// Mermaid reserved words that cannot be used as bare node IDs
const MERMAID_RESERVED = new Set(["end", "graph", "subgraph", "direction", "click", "style", "classDef", "class"]);

function safeId(id: string): string {
  return MERMAID_RESERVED.has(id.toLowerCase()) ? `_${id}` : id;
}

function specToMermaid(spec: DiagramSpec): string {
  const dir = spec.direction === "LR" || spec.direction === "RL" ? "LR" : "TD";
  let mmd = `graph ${dir}\n`;

  // Add nodes
  for (const node of spec.nodes) {
    const label = node.label.replace(/"/g, "'");
    const nid = safeId(node.id);
    switch (node.shape) {
      case "diamond":
        mmd += `  ${nid}{{"${label}"}}\n`;
        break;
      case "rounded_rect":
        mmd += `  ${nid}("${label}")\n`;
        break;
      case "circle":
      case "oval":
        mmd += `  ${nid}(("${label}"))\n`;
        break;
      case "hexagon":
        mmd += `  ${nid}{{{"${label}"}}}\n`;
        break;
      default:
        mmd += `  ${nid}["${label}"]\n`;
    }
  }

  // Add edges
  for (const edge of spec.edges) {
    const label = edge.label ? `|${edge.label}|` : "";
    const style = edge.style?.dash ? "-.->" : "-->";
    mmd += `  ${safeId(edge.from)} ${style}${label} ${safeId(edge.to)}\n`;
  }

  // Add subgraphs for groups
  for (const group of spec.groups) {
    if (!group.parent) {
      mmd += `  subgraph ${safeId(group.id)}["${group.label}"]\n`;
      for (const node of spec.nodes) {
        if (node.group === group.id) {
          mmd += `    ${safeId(node.id)}\n`;
        }
      }
      mmd += `  end\n`;
    }
  }

  return mmd;
}

export default function Preview({ spec, error }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>("");
  const renderIdRef = useRef(0);

  // Serialize spec to detect changes even when object reference is same
  const specKey = spec ? JSON.stringify(spec) : "";

  useEffect(() => {
    if (!spec || !containerRef.current) {
      setSvgContent("");
      return;
    }

    const currentId = ++renderIdRef.current;

    async function render() {
      try {
        const mmd = specToMermaid(spec!);
        mermaid.initialize(DIAGRAM_MERMAID_CONFIG);
        const { svg } = await mermaid.render(`mermaid-${currentId}`, mmd);
        if (currentId === renderIdRef.current) {
          setSvgContent(svg);
        }
      } catch {
        if (currentId === renderIdRef.current) {
          setSvgContent("");
        }
      }
    }

    render();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 max-w-md">
          <p className="text-red-400 text-sm font-mono whitespace-pre-wrap">{error}</p>
        </div>
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg mb-2">プレビュー</p>
          <p className="text-sm">左ペインに YAML を入力すると</p>
          <p className="text-sm">ここにプレビューが表示されます</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto flex items-center justify-center p-4"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
