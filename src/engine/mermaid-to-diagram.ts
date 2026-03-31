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
  // id["label"]  → rect
  let m = raw.match(/^(\w+)\["(.+?)"\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // id("label")  → rounded_rect
  m = raw.match(/^(\w+)\("(.+?)"\)/);
  if (m) return { id: m[1], label: m[2], shape: "rounded_rect" };

  // id(("label")) → circle
  m = raw.match(/^(\w+)\(\("(.+?)"\)\)/);
  if (m) return { id: m[1], label: m[2], shape: "circle" };

  // id{{"label"}} → diamond
  m = raw.match(/^(\w+)\{\{"(.+?)"\}\}/);
  if (m) return { id: m[1], label: m[2], shape: "diamond" };

  // id{label} → diamond (no quotes)
  m = raw.match(/^(\w+)\{(.+?)\}/);
  if (m) return { id: m[1], label: m[2], shape: "diamond" };

  // id[(label)] → database (cylinder)
  m = raw.match(/^(\w+)\[\((.+?)\)\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // id>label] → asymmetric (flag)
  m = raw.match(/^(\w+)>(.+?)\]/);
  if (m) return { id: m[1], label: m[2], shape: "rect" };

  // bare id (no shape syntax)
  m = raw.match(/^(\w+)$/);
  if (m) return { id: m[1], label: m[1], shape: "rect" };

  return null;
}

// ── Parse edge line ──

function parseEdgeLine(line: string): { nodes: ParsedNode[]; edges: ParsedEdge[] } | null {
  const nodes: ParsedNode[] = [];
  const edges: ParsedEdge[] = [];

  // Split by arrow patterns: -->, --->, -.->, ---|label|, -->|label|
  const parts = line.split(/(-->|---->|-.->|===|---)/);
  if (parts.length < 3) return null;

  const segments: { nodeStr: string; label?: string }[] = [];
  let pendingLabel: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    if (/^(-->|---->|-\.->|===|---)$/.test(part)) {
      // Arrow - check if next part has a label
      continue;
    }

    // Check for label syntax: |label| at start
    const labelMatch = part.match(/^\|(.+?)\|\s*(.*)/);
    if (labelMatch) {
      pendingLabel = labelMatch[1];
      if (labelMatch[2]) {
        segments.push({ nodeStr: labelMatch[2], label: pendingLabel });
        pendingLabel = undefined;
      }
    } else {
      segments.push({ nodeStr: part, label: pendingLabel });
      pendingLabel = undefined;
    }
  }

  for (const seg of segments) {
    const node = parseNodeDef(seg.nodeStr);
    if (node) nodes.push(node);
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const fromNode = parseNodeDef(segments[i].nodeStr);
    const toNode = parseNodeDef(segments[i + 1].nodeStr);
    if (fromNode && toNode) {
      edges.push({
        from: fromNode.id,
        to: toNode.id,
        label: segments[i + 1].label,
      });
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
