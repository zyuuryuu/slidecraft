/**
 * mermaid-to-diagram.ts — Convert Mermaid graph syntax to DiagramSpec YAML.
 *
 * Supports: graph TD/LR/TB/BT with node definitions and edges.
 * Limitations: subgraphs, styling, click handlers not supported.
 */

import yaml from "js-yaml";
import { DiagramSpecSchema, validateDiagramSpec, type DiagramSpec } from "./schema";
import { parseMermaidClassDiagram, parseMermaidSequence, parseMermaidState } from "./mermaid-uml-parser";

export type DiagramFormat = "yaml" | "json" | "mermaid";

/**
 * Validate diagram source text and return a human-readable error, or null if
 * it's valid (or a format we don't statically check, like mermaid). Lets the
 * editor show *why* a diagram failed instead of silently rendering nothing.
 */
export function validateDiagramSource(text: string, format: DiagramFormat): string | null {
  if (format === "mermaid" || !text.trim()) return null;

  let data: unknown;
  try {
    data = format === "json" ? JSON.parse(text) : yaml.load(text);
  } catch (e) {
    return `Parse error: ${e instanceof Error ? e.message : String(e)}`;
  }

  const result = DiagramSpecSchema.safeParse(data);
  if (!result.success) {
    return (
      "Invalid spec — " +
      result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")
    );
  }

  const errors = validateDiagramSpec(result.data);
  if (errors.length > 0) {
    return errors.slice(0, 3).map((e) => e.message).join("; ");
  }
  return null;
}

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

interface ParsedGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

export function mermaidToDiagramSpec(mermaidSyntax: string): DiagramSpec | null {
  const lines = mermaidSyntax.trim().split("\n").map(l => l.trim());
  if (lines.length === 0) return null;

  if (/^classDiagram\b/i.test(lines[0])) return parseMermaidClassDiagram(lines);
  if (/^sequenceDiagram\b/i.test(lines[0])) return parseMermaidSequence(lines);
  if (/^stateDiagram(-v2)?\b/i.test(lines[0])) return parseMermaidState(lines);

  // Parse direction from first line: graph TD, graph LR, etc.
  const headerMatch = lines[0].match(/^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/i);
  if (!headerMatch) return null;

  const dirMap: Record<string, string> = { TD: "TB", TB: "TB", LR: "LR", RL: "RL", BT: "BT" };
  const direction = dirMap[headerMatch[1].toUpperCase()] || "TB";

  const allNodes = new Map<string, ParsedNode>();
  const allEdges: ParsedEdge[] = [];
  const groups: ParsedGroup[] = [];

  // Track current subgraph context
  const groupStack: ParsedGroup[] = [];
  // Track which group each node belongs to
  const nodeToGroup = new Map<string, string>();

  function addNode(node: ParsedNode) {
    if (!allNodes.has(node.id)) {
      allNodes.set(node.id, node);
    }
    // Assign to current group if inside a subgraph
    if (groupStack.length > 0 && !nodeToGroup.has(node.id)) {
      const currentGroup = groupStack[groupStack.length - 1];
      currentGroup.nodeIds.push(node.id);
      nodeToGroup.set(node.id, currentGroup.id);
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%") || line.startsWith("style") || line.startsWith("classDef") || line.startsWith("class ")) {
      continue;
    }

    // subgraph id["label"] or subgraph id[label] or subgraph label
    const subgraphMatch = line.match(/^subgraph\s+(\w+)\s*\["?(.+?)"?\]/) ||
      line.match(/^subgraph\s+(\w+)\s*$/);
    if (subgraphMatch) {
      const group: ParsedGroup = {
        id: subgraphMatch[1],
        label: subgraphMatch[2] || subgraphMatch[1],
        nodeIds: [],
      };
      groupStack.push(group);
      groups.push(group);
      continue;
    }

    // end (close subgraph)
    if (line === "end") {
      groupStack.pop();
      continue;
    }

    // Try as edge line first
    const result = parseEdgeLine(line);
    if (result && (result.edges.length > 0 || result.nodes.length > 0)) {
      for (const node of result.nodes) {
        addNode(node);
      }
      for (const edge of result.edges) {
        allEdges.push(edge);
      }
      continue;
    }

    // Try as standalone node definition
    const node = parseNodeDef(line);
    if (node) {
      addNode(node);
      continue;
    }

    // Try as bare node id reference inside subgraph
    const bareRef = line.match(/^(\w+)$/);
    if (bareRef && groupStack.length > 0) {
      // Just a node reference inside subgraph, assign to group
      if (!allNodes.has(bareRef[1])) {
        allNodes.set(bareRef[1], { id: bareRef[1], label: bareRef[1], shape: "rect" });
      }
      const currentGroup = groupStack[groupStack.length - 1];
      if (!nodeToGroup.has(bareRef[1])) {
        currentGroup.nodeIds.push(bareRef[1]);
        nodeToGroup.set(bareRef[1], currentGroup.id);
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
      ...(nodeToGroup.has(n.id) ? { group: nodeToGroup.get(n.id) } : {}),
    })),
    edges: allEdges.map(e => ({
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
    })),
    groups: groups.map(g => ({
      id: g.id,
      label: g.label,
    })),
  };

  const result = DiagramSpecSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ── Serializers (DiagramSpec → text): split out for R1, re-exported here ──
export { diagramSpecToMermaid, dumpDiagramLikeSource, diagramSpecToYaml, canSerializeToMermaid } from "./diagram-serialize";
