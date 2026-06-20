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
 * Whether diagramSpecToMermaid can FAITHFULLY round-trip this spec (serialize →
 * parse with no data loss). The editor uses this to gate its MERMAID toggle so a
 * round-trip can never silently corrupt the diagram.
 *   - sequence: faithful (sequenceDiagram covers participants/messages/fragments/
 *     dividers/activations/async).
 *   - class diagram (class shapes / UML relations): faithful only when nothing
 *     would be dropped — classDiagram uses the class name as id+label and carries
 *     no node styles/groups.
 *   - plain flowchart: allowed (lossy for styles/lanes, but never type-breaking).
 */
export function canSerializeToMermaid(spec: DiagramSpec): boolean {
  if (spec.type === "sequence") return true;
  if (spec.type === "timeline") return true; // periods/events/sections/title all round-trip
  // state diagram (has start/end pseudo-states) — faithful (custom labels via
  // `state "x" as id`); only block when node styles/groups/lanes would be lost.
  if (spec.nodes.some((n) => n.shape === "start" || n.shape === "end")) {
    return spec.groups.length === 0 && spec.lanes.length === 0 && spec.nodes.every((n) => !n.style);
  }
  // ER diagram (entity boxes / crow's-foot cardinality) — faithful.
  if (spec.nodes.some((n) => n.shape === "entity") || spec.edges.some((e) => e.srcCard || e.tgtCard)) {
    return spec.groups.length === 0 && spec.lanes.length === 0;
  }
  const isClass = spec.nodes.some((n) => n.shape === "class") || spec.edges.some((e) => !!e.relation);
  if (isClass) {
    return (
      spec.groups.length === 0 &&
      spec.lanes.length === 0 &&
      spec.nodes.every((n) => n.label === n.id && !n.style && !n.sublabel)
    );
  }
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

// ── Sequence → Mermaid (sequenceDiagram) ──

/** Mermaid message operator for a message's dash (return) + async flags. */
function seqArrow(dash: boolean | undefined, async: boolean | undefined): string {
  if (async) return dash ? "--)" : "-)";
  return dash ? "-->>" : "->>";
}

function sequenceSpecToMermaid(spec: DiagramSpec): string {
  let s = "sequenceDiagram\n";
  for (const n of spec.nodes) {
    s += n.label && n.label !== n.id ? `  participant ${n.id} as ${n.label}\n` : `  participant ${n.id}\n`;
  }
  // Walk messages in order, interleaving fragment open/divider/close and
  // activate/deactivate so the parser reconstructs the same indices.
  let depth = 1;
  const pad = () => "  ".repeat(depth);
  for (let i = 0; i < spec.edges.length; i++) {
    // opens at i (outermost = widest span first)
    for (const f of spec.fragments.filter((f) => f.from === i).sort((a, b) => (b.to - b.from) - (a.to - a.from))) {
      s += `${pad()}${f.kind}${f.label ? " " + f.label : ""}\n`;
      depth++;
    }
    // branch dividers at i (`else` for alt/opt/loop, `and` for par)
    for (const f of spec.fragments) {
      for (const d of f.dividers ?? []) {
        if (d.at === i) {
          const kw = f.kind === "par" ? "and" : "else";
          s += `${"  ".repeat(Math.max(1, depth - 1))}${kw}${d.label ? " " + d.label : ""}\n`;
        }
      }
    }
    for (const a of spec.activations) if (a.from === i) s += `${pad()}activate ${a.participant}\n`;
    const e = spec.edges[i];
    s += `${pad()}${e.from}${seqArrow(e.style?.dash, e.style?.async)}${e.to}: ${e.label ?? ""}\n`;
    for (const a of spec.activations) if (a.to === i) s += `${pad()}deactivate ${a.participant}\n`;
    // closes at i — every fragment ending here emits an `end` (all identical, so
    // only the count matters); each one closes a nesting level.
    const closes = spec.fragments.filter((f) => f.to === i).length;
    for (let c = 0; c < closes; c++) {
      depth = Math.max(1, depth - 1);
      s += `${pad()}end\n`;
    }
  }
  return s;
}

// ── Class → Mermaid (classDiagram) ──

/** UML relation → Mermaid class operator (parent/`from` written first). */
function relationToClassOp(relation: string | undefined): string {
  switch (relation) {
    case "inheritance": return "<|--";
    case "realization": return "<|..";
    case "composition": return "*--";
    case "aggregation": return "o--";
    case "dependency": return "..>";
    default: return "-->"; // association
  }
}

function classSpecToMermaid(spec: DiagramSpec): string {
  let s = "classDiagram\n";
  for (const n of spec.nodes) {
    const members = [...(n.attributes ?? []), ...(n.methods ?? [])];
    if (members.length) {
      s += `  class ${n.id} {\n`;
      for (const m of members) s += `    ${m}\n`;
      s += `  }\n`;
    } else {
      s += `  class ${n.id}\n`;
    }
  }
  for (const e of spec.edges) {
    s += `  ${e.from} ${relationToClassOp(e.relation)} ${e.to}${e.label ? ` : ${e.label}` : ""}\n`;
  }
  return s;
}

// ── State → Mermaid (stateDiagram-v2) ──

function stateSpecToMermaid(spec: DiagramSpec): string {
  let s = "stateDiagram-v2\n";
  // a custom label (≠ id) needs an explicit `state "Label" as id` declaration
  for (const n of spec.nodes) {
    if (n.shape === "start" || n.shape === "end") continue; // pseudo-states are implicit ([*])
    if (n.label && n.label !== n.id) s += `  state "${n.label}" as ${n.id}\n`;
  }
  const ref = (id: string): string => {
    const n = spec.nodes.find((x) => x.id === id);
    return n && (n.shape === "start" || n.shape === "end") ? "[*]" : id;
  };
  for (const e of spec.edges) {
    s += `  ${ref(e.from)} --> ${ref(e.to)}${e.label ? ` : ${e.label}` : ""}\n`;
  }
  return s;
}

// ── ER → Mermaid (erDiagram) ──

// Cardinality → crow's-foot symbol (left token mirrored, right token normal).
const ER_LEFT_SYM: Record<string, string> = { one: "||", zero_one: "|o", zero_many: "}o", one_many: "}|" };
const ER_RIGHT_SYM: Record<string, string> = { one: "||", zero_one: "o|", zero_many: "o{", one_many: "|{" };

function erSpecToMermaid(spec: DiagramSpec): string {
  let s = "erDiagram\n";
  for (const e of spec.edges) {
    const lc = ER_LEFT_SYM[e.srcCard ?? "one"];
    const rc = ER_RIGHT_SYM[e.tgtCard ?? "one"];
    const conn = e.style?.dash ? ".." : "--";
    s += `  ${e.from} ${lc}${conn}${rc} ${e.to}${e.label ? ` : ${e.label}` : ""}\n`;
  }
  for (const n of spec.nodes) {
    if (n.attributes?.length) {
      s += `  ${n.id} {\n`;
      for (const a of n.attributes) s += `    ${a}\n`;
      s += `  }\n`;
    }
  }
  return s;
}

// ── Timeline → Mermaid (timeline) ──

function timelineSpecToMermaid(spec: DiagramSpec): string {
  let s = "timeline\n";
  if (spec.title) s += `  title ${spec.title}\n`;
  let section: string | undefined;
  for (const n of spec.nodes) {
    if (n.group !== section) {
      section = n.group;
      if (section) s += `  section ${section}\n`;
    }
    s += `  ${n.label} : ${(n.attributes ?? []).join(" : ")}\n`;
  }
  return s;
}

export function diagramSpecToMermaid(spec: DiagramSpec): string {
  // Dispatch by diagram kind so sequence/timeline/state/ER/class round-trip
  // faithfully (the parser already reads each dialect back).
  if (spec.type === "timeline") return timelineSpecToMermaid(spec);
  if (spec.type === "sequence") return sequenceSpecToMermaid(spec);
  if (spec.nodes.some((n) => n.shape === "start" || n.shape === "end")) return stateSpecToMermaid(spec);
  if (spec.nodes.some((n) => n.shape === "entity") || spec.edges.some((e) => e.srcCard || e.tgtCard)) {
    return erSpecToMermaid(spec);
  }
  if (spec.nodes.some((n) => n.shape === "class") || spec.edges.some((e) => !!e.relation)) {
    return classSpecToMermaid(spec);
  }
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
    yaml += `    label: ${q(node.label)}\n`; // quote: an empty label (start/end dots) would otherwise be YAML null
    if (node.shape && node.shape !== "rect") yaml += `    shape: ${node.shape}\n`;
    if (node.group) yaml += `    group: ${q(node.group)}\n`; // timeline sections (+ flowchart subgraph membership)
    if (node.attributes?.length) yaml += `    attributes:\n${node.attributes.map((a) => `      - ${q(a)}`).join("\n")}\n`;
    if (node.methods?.length) yaml += `    methods:\n${node.methods.map((m) => `      - ${q(m)}`).join("\n")}\n`;
    if (node.override) {
      const ov = (["x", "y", "w", "h"] as const).filter((k) => node.override![k] !== undefined);
      if (ov.length) yaml += `    override:\n${ov.map((k) => `      ${k}: ${node.override![k]}`).join("\n")}\n`;
    }
  }
  if (spec.groups.length) {
    // declared so node.group references resolve (timeline sections / subgraphs)
    yaml += `\ngroups:\n`;
    for (const g of spec.groups) yaml += `  - id: ${q(g.id)}\n    label: ${q(g.label)}\n`;
  }
  yaml += spec.edges.length ? `\nedges:\n` : `\nedges: []\n`; // empty block would parse as YAML null
  for (const edge of spec.edges) {
    yaml += `  - from: ${edge.from}\n`;
    yaml += `    to: ${edge.to}\n`;
    if (edge.label) yaml += `    label: ${q(edge.label)}\n`;
    if (edge.relation) yaml += `    relation: ${edge.relation}\n`;
    if (edge.srcCard) yaml += `    srcCard: ${edge.srcCard}\n`;
    if (edge.tgtCard) yaml += `    tgtCard: ${edge.tgtCard}\n`;
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
