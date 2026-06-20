/**
 * diagram-serialize.ts — DiagramSpec → text serializers.
 *
 * Split out of mermaid-to-diagram.ts to keep that file within the 400-line rule
 * (R1). Pure logic (R2): no DOM / Tauri.
 *   - diagramSpecToMermaid: reverse conversion to Mermaid graph syntax.
 *   - dumpDiagramLikeSource: re-serialize in the SAME format as the source.
 *   - diagramSpecToYaml: hand-rolled clean YAML (preserves class/sequence fields).
 */

import yaml from "js-yaml";
import type { DiagramSpec } from "./schema";

// ── DiagramSpec → Mermaid (reverse) ──

/**
 * Whether diagramSpecToMermaid can FAITHFULLY represent this spec. Mermaid graph
 * syntax can't express sequence diagrams or UML class diagrams, so serializing
 * them yields a plain flowchart — and converting back silently flattens
 * `type: sequence`/class into `type: flowchart`. The editor uses this to disable
 * its MERMAID toggle for those (Mermaid is input-only; YAML/JSON is canonical).
 */
export function canSerializeToMermaid(spec: DiagramSpec): boolean {
  if (spec.type === "sequence") return false;
  if (spec.nodes.some((n) => n.shape === "class")) return false;
  if (spec.edges.some((e) => !!e.relation)) return false;
  return true;
}

function nodeToMermaid(id: string, label: string, shape?: string): string {
  const safeLabel = label.replace(/"/g, "'").replace(/\n/g, "<br>");
  switch (shape) {
    case "diamond":
      return `${id}{{"${safeLabel}"}}`;
    case "rounded_rect":
      return `${id}("${safeLabel}")`;
    case "circle":
    case "oval":
      return `${id}(("${safeLabel}"))`;
    default:
      return `${id}["${safeLabel}"]`;
  }
}

export function diagramSpecToMermaid(spec: DiagramSpec): string {
  const dir = spec.direction === "LR" || spec.direction === "RL" ? "LR" : "TD";
  let mmd = `graph ${dir}\n`;

  // Build group membership map
  const nodeGroupMap = new Map<string, string>();
  for (const node of spec.nodes) {
    if (node.group) nodeGroupMap.set(node.id, node.group);
  }

  // Nodes not in any group
  const ungroupedNodes = spec.nodes.filter(n => !n.group);
  for (const node of ungroupedNodes) {
    mmd += `  ${nodeToMermaid(node.id, node.label, node.shape)}\n`;
  }

  // Subgraphs
  for (const group of spec.groups) {
    const groupNodes = spec.nodes.filter(n => n.group === group.id);
    if (groupNodes.length === 0) continue;
    mmd += `  subgraph ${group.id}["${group.label}"]\n`;
    for (const node of groupNodes) {
      mmd += `    ${nodeToMermaid(node.id, node.label, node.shape)}\n`;
    }
    mmd += `  end\n`;
  }

  // Edges
  for (const edge of spec.edges) {
    const label = edge.label ? `|${edge.label}|` : "";
    const arrow = edge.style?.dash ? "-.->" : "-->";
    mmd += `  ${edge.from} ${arrow}${label} ${edge.to}\n`;
  }

  return mmd;
}

// ── DiagramSpec → YAML string ──

/**
 * Re-serialize a (loaded + modified) diagram object in the SAME format as its
 * source text — JSON stays JSON, YAML stays YAML. Drag/resize and design edits
 * must not silently flip a JSON diagram to YAML (which breaks the JSON editor view).
 */
export function dumpDiagramLikeSource(obj: unknown, source: string): string {
  const t = source.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return JSON.stringify(obj, null, 2);
    } catch {
      /* not actually JSON → fall through to YAML */
    }
  }
  return yaml.dump(obj, { lineWidth: 1000 });
}

export function diagramSpecToYaml(spec: DiagramSpec): string {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  let yaml = `type: ${spec.type}\n`;
  yaml += `direction: ${spec.direction}\n`;
  if (spec.title) yaml += `title: ${spec.title}\n`;
  yaml += `\nnodes:\n`;
  for (const node of spec.nodes) {
    yaml += `  - id: ${node.id}\n`;
    yaml += `    label: ${node.label}\n`;
    if (node.shape && node.shape !== "rect") yaml += `    shape: ${node.shape}\n`;
    if (node.attributes?.length) yaml += `    attributes:\n${node.attributes.map((a) => `      - ${q(a)}`).join("\n")}\n`;
    if (node.methods?.length) yaml += `    methods:\n${node.methods.map((m) => `      - ${q(m)}`).join("\n")}\n`;
    if (node.override) {
      const ov = (["x", "y", "w", "h"] as const).filter((k) => node.override![k] !== undefined);
      if (ov.length) yaml += `    override:\n${ov.map((k) => `      ${k}: ${node.override![k]}`).join("\n")}\n`;
    }
  }
  yaml += `\nedges:\n`;
  for (const edge of spec.edges) {
    yaml += `  - from: ${edge.from}\n`;
    yaml += `    to: ${edge.to}\n`;
    if (edge.label) yaml += `    label: ${q(edge.label)}\n`;
    if (edge.relation) yaml += `    relation: ${edge.relation}\n`;
    if (edge.style?.dash || edge.style?.async) {
      yaml += `    style:\n`;
      if (edge.style.dash) yaml += `      dash: true\n`;
      if (edge.style.async) yaml += `      async: true\n`;
    }
  }
  if (spec.fragments?.length) {
    yaml += `\nfragments:\n`;
    for (const f of spec.fragments) {
      yaml += `  - kind: ${f.kind}\n    label: ${q(f.label)}\n    from: ${f.from}\n    to: ${f.to}\n`;
      if (f.dividers?.length) {
        yaml += `    dividers:\n`;
        for (const d of f.dividers) yaml += `      - at: ${d.at}\n        label: ${q(d.label)}\n`;
      }
    }
  }
  if (spec.activations?.length) {
    yaml += `\nactivations:\n`;
    for (const a of spec.activations) {
      yaml += `  - participant: ${a.participant}\n    from: ${a.from}\n    to: ${a.to}\n`;
    }
  }
  return yaml;
}
