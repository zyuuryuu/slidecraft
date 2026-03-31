/**
 * mermaid-to-diagram.ts — Convert Mermaid graph syntax to DiagramSpec YAML.
 *
 * Supports: graph TD/LR/TB/BT with node definitions and edges.
 * Limitations: subgraphs, styling, click handlers not supported.
 */

import { DiagramSpecSchema, type DiagramSpec } from "./schema";

interface ParsedNode {
  id: string;
  label: string;
  shape: string;
}

interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
}

// ── Node shape detection from Mermaid syntax ──

function parseNodeDef(raw: string): ParsedNode | null {
  const s = raw.trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  // id(("label")) → circle (must be before rounded_rect)
  m = s.match(/^(\w+)\(\("?(.+?)"?\)\)/);
  if (m) return { id: m[1], label: m[2], shape: "circle" };

  // id{{"label"}} → diamond (double brace)
  m = s.match(/^(\w+)\{\{"?(.+?)"?\}\}/);
  if (m) return { id: m[1], label: m[2], shape: "diamond" };

  // id[(label)] → database/cylinder → treat as rect
  m = s.match(/^(\w+)\[\("?(.+?)"?\)\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // id["label"] → rect
  m = s.match(/^(\w+)\["(.+?)"\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // id[label] → rect (no quotes)
  m = s.match(/^(\w+)\[(.+?)\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // id("label") → rounded_rect
  m = s.match(/^(\w+)\("(.+?)"\)/);
  if (m) return { id: m[1], label: m[2], shape: "rounded_rect" };

  // id(label) → rounded_rect (no quotes)
  m = s.match(/^(\w+)\((.+?)\)/);
  if (m) return { id: m[1], label: m[2], shape: "rounded_rect" };

  // id{label} → diamond (single brace, no quotes)
  m = s.match(/^(\w+)\{(.+?)\}/);
  if (m) return { id: m[1], label: m[2], shape: "diamond" };

  // id>label] → asymmetric
  m = s.match(/^(\w+)>(.+?)\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // bare id (no shape syntax)
  m = s.match(/^(\w+)$/);
  if (m) return { id: m[1], label: m[1], shape: "rect" };

  return null;
}

// ── Parse edge line ──
// Handles: A --> B, A -->|label| B, A -.-> B, chained A --> B --> C

function parseEdgeLine(line: string): { nodes: ParsedNode[]; edges: ParsedEdge[] } | null {
  const nodes: ParsedNode[] = [];
  const edges: ParsedEdge[] = [];

  // Regex to match: nodeExpr (arrow with optional label) nodeExpr ...
  // Arrow patterns: -->, -.->, ===>, ---
  // Label patterns: -->|label|, ---|label|
  const arrowRe = /\s+(-->|-.->|===|---)\s*(?:\|([^|]*)\|\s*)?/g;

  // Find all arrows and their positions
  const arrows: { index: number; end: number; label?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = arrowRe.exec(line)) !== null) {
    arrows.push({
      index: m.index,
      end: m.index + m[0].length,
      label: m[2] || undefined,
    });
  }

  if (arrows.length === 0) return null;

  // Extract node expressions between arrows
  const nodeExprs: string[] = [];
  const edgeLabels: (string | undefined)[] = [];

  // First node: from start of line to first arrow
  nodeExprs.push(line.substring(0, arrows[0].index).trim());

  for (let i = 0; i < arrows.length; i++) {
    edgeLabels.push(arrows[i].label);
    const start = arrows[i].end;
    const end = i + 1 < arrows.length ? arrows[i + 1].index : line.length;
    nodeExprs.push(line.substring(start, end).trim());
  }

  // Parse each node expression
  const parsedNodes: (ParsedNode | null)[] = nodeExprs.map(expr => parseNodeDef(expr));

  for (const pn of parsedNodes) {
    if (pn) nodes.push(pn);
  }

  // Create edges
  for (let i = 0; i < parsedNodes.length - 1; i++) {
    const from = parsedNodes[i];
    const to = parsedNodes[i + 1];
    if (from && to) {
      edges.push({ from: from.id, to: to.id, label: edgeLabels[i] });
    }
  }

  return { nodes, edges };
}

// ── Main converter ──

export function mermaidToDiagramSpec(mermaidSyntax: string): DiagramSpec | null {
  const lines = mermaidSyntax.trim().split("\n").map(l => l.trim());
  if (lines.length === 0) return null;

  // Parse direction from first line: graph TD, graph LR, etc.
  const headerMatch = lines[0].match(/^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/i);
  if (!headerMatch) return null;

  const dirMap: Record<string, string> = { TD: "TB", TB: "TB", LR: "LR", RL: "RL", BT: "BT" };
  const direction = dirMap[headerMatch[1].toUpperCase()] || "TB";

  const allNodes = new Map<string, ParsedNode>();
  const allEdges: ParsedEdge[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%") || line.startsWith("style") || line.startsWith("classDef")) {
      continue;
    }

    // Try as edge line first
    const result = parseEdgeLine(line);
    if (result && (result.edges.length > 0 || result.nodes.length > 0)) {
      for (const node of result.nodes) {
        if (!allNodes.has(node.id)) {
          allNodes.set(node.id, node);
        }
      }
      for (const edge of result.edges) {
        allEdges.push(edge);
      }
    } else {
      // Try as standalone node definition
      const node = parseNodeDef(line);
      if (node && !allNodes.has(node.id)) {
        allNodes.set(node.id, node);
      }
    }
  }

  if (allNodes.size === 0) return null;

  const raw = {
    type: "flowchart",
    direction,
    title: "",
    nodes: [...allNodes.values()].map(n => ({
      id: n.id,
      label: n.label,
      shape: n.shape,
    })),
    edges: allEdges.map(e => ({
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
    })),
  };

  const result = DiagramSpecSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ── DiagramSpec → Mermaid (reverse) ──

export function diagramSpecToMermaid(spec: DiagramSpec): string {
  const dir = spec.direction === "LR" || spec.direction === "RL" ? "LR" : "TD";
  let mmd = `graph ${dir}\n`;

  for (const node of spec.nodes) {
    const label = node.label.replace(/"/g, "'");
    switch (node.shape) {
      case "diamond":
        mmd += `  ${node.id}{{"${label}"}}\n`;
        break;
      case "rounded_rect":
        mmd += `  ${node.id}("${label}")\n`;
        break;
      case "circle":
      case "oval":
        mmd += `  ${node.id}(("${label}"))\n`;
        break;
      default:
        mmd += `  ${node.id}["${label}"]\n`;
    }
  }

  for (const edge of spec.edges) {
    const label = edge.label ? `|${edge.label}|` : "";
    mmd += `  ${edge.from} -->${label} ${edge.to}\n`;
  }

  return mmd;
}

// ── DiagramSpec → YAML string ──

export function diagramSpecToYaml(spec: DiagramSpec): string {
  let yaml = `type: ${spec.type}\n`;
  yaml += `direction: ${spec.direction}\n`;
  if (spec.title) yaml += `title: ${spec.title}\n`;
  yaml += `\nnodes:\n`;
  for (const node of spec.nodes) {
    yaml += `  - id: ${node.id}\n`;
    yaml += `    label: ${node.label}\n`;
    if (node.shape && node.shape !== "rect") {
      yaml += `    shape: ${node.shape}\n`;
    }
  }
  yaml += `\nedges:\n`;
  for (const edge of spec.edges) {
    yaml += `  - from: ${edge.from}\n`;
    yaml += `    to: ${edge.to}\n`;
    if (edge.label) yaml += `    label: "${edge.label}"\n`;
  }
  return yaml;
}
