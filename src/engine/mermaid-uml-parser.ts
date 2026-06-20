/**
 * mermaid-uml-parser.ts — Mermaid classDiagram + sequenceDiagram parsers.
 *
 * Split out of mermaid-to-diagram.ts to keep that file within the 400-line rule
 * (R1). Pure logic (R2): no DOM / Tauri. Used by mermaidToDiagramSpec's dispatch.
 */

import { DiagramSpecSchema, type DiagramSpec, type RelationType, type Cardinality } from "./schema";

// ER crow's-foot cardinality: the left token reads mirrored, the right token normal.
const ER_LEFT_CARD: Record<string, Cardinality> = { "||": "one", "|o": "zero_one", "}o": "zero_many", "}|": "one_many" };
const ER_RIGHT_CARD: Record<string, Cardinality> = { "||": "one", "o|": "zero_one", "o{": "zero_many", "|{": "one_many" };

/** Map a Mermaid class-relation operator to {from→to, UML relation}. Inheritance/
 *  realization keep the PARENT as `from` (parent-on-top in the layered layout). */
function classRelation(a: string, op: string, b: string): { from: string; to: string; relation: RelationType } {
  if (op === "<|--") return { from: a, to: b, relation: "inheritance" }; // A is the parent
  if (op === "--|>") return { from: b, to: a, relation: "inheritance" };
  if (op === "<|.." ) return { from: a, to: b, relation: "realization" };
  if (op === "..|>") return { from: b, to: a, relation: "realization" };
  let relation: RelationType = "association";
  if (op.includes("*")) relation = "composition";
  else if (op.includes("o")) relation = "aggregation";
  else if (op.includes("..")) relation = "dependency";
  return { from: a, to: b, relation };
}

/** Parse a Mermaid `classDiagram` into a DiagramSpec of class nodes + UML relations. */
export function parseMermaidClassDiagram(lines: string[]): DiagramSpec | null {
  const nodes = new Map<string, { id: string; attributes: string[]; methods: string[] }>();
  const edges: Array<{ from: string; to: string; relation: RelationType; label?: string }> = [];
  const ensure = (id: string) => {
    let n = nodes.get(id);
    if (!n) { n = { id, attributes: [], methods: [] }; nodes.set(id, n); }
    return n;
  };

  let current: { id: string; attributes: string[]; methods: string[] } | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;

    if (current) {
      if (line === "}") { current = null; continue; }
      (line.includes("(") ? current.methods : current.attributes).push(line);
      continue;
    }

    const open = line.match(/^class\s+([A-Za-z_]\w*)\s*\{$/);
    if (open) { current = ensure(open[1]); continue; }
    const decl = line.match(/^class\s+([A-Za-z_]\w*)\s*$/);
    if (decl) { ensure(decl[1]); continue; }

    // A <relation> B  [: label]
    const rel = line.match(/^([A-Za-z_]\w*)\s*(<\|\.\.|\.\.\|>|<\|--|--\|>|\*--|--\*|o--|--o|<\.\.|\.\.>|-->|<--|--|\.\.)\s*([A-Za-z_]\w*)\s*(?::\s*(.+))?$/);
    if (rel) {
      const [, a, op, b, label] = rel;
      const { from, to, relation } = classRelation(a, op, b);
      ensure(from); ensure(to);
      edges.push({ from, to, relation, label: label?.trim() || undefined });
    }
  }

  if (nodes.size === 0) return null;
  const r = DiagramSpecSchema.safeParse({
    type: "flowchart",
    direction: "TB",
    nodes: [...nodes.values()].map((n) => ({
      id: n.id, label: n.id, shape: "class", attributes: n.attributes, methods: n.methods,
    })),
    edges,
  });
  return r.success ? r.data : null;
}

/** Parse a Mermaid `timeline` into a DiagramSpec (type "timeline"): each
 *  `period : event : event` line → a node (label=period, attributes=events),
 *  `section X` groups periods, `title X` sets the diagram title. */
export function parseMermaidTimeline(lines: string[]): DiagramSpec | null {
  let title: string | undefined;
  let section: string | undefined;
  const nodes: Array<{ id: string; label: string; attributes: string[]; group?: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;
    const t = line.match(/^title\s+(.+)$/i);
    if (t) { title = t[1].trim(); continue; }
    const sec = line.match(/^section\s+(.+)$/i);
    if (sec) { section = sec[1].trim(); continue; }
    if (!line.includes(":")) continue; // a period needs at least one event
    const parts = line.split(":").map((s) => s.trim());
    nodes.push({
      id: `t${nodes.length}`,
      label: parts[0],
      attributes: parts.slice(1).filter(Boolean),
      ...(section ? { group: section } : {}),
    });
  }
  if (nodes.length === 0) return null;
  // Declare each section as a group so node.group references resolve (validation).
  const sectionNames = [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))];
  const r = DiagramSpecSchema.safeParse({
    type: "timeline",
    direction: "LR",
    title,
    nodes: nodes.map((n) => ({ id: n.id, label: n.label, attributes: n.attributes, ...(n.group ? { group: n.group } : {}) })),
    groups: sectionNames.map((s) => ({ id: s, label: s })),
    edges: [],
  });
  return r.success ? r.data : null;
}

/** Parse a Mermaid `erDiagram` into a DiagramSpec: entities → entity boxes
 *  (name + attribute list), relationships → edges with crow's-foot cardinality
 *  at each end (`..` = dashed/non-identifying). */
export function parseMermaidER(lines: string[]): DiagramSpec | null {
  const nodes = new Map<string, { id: string; attributes: string[] }>();
  const edges: Array<{ from: string; to: string; label?: string; srcCard: Cardinality; tgtCard: Cardinality; dash: boolean }> = [];
  const ensure = (id: string) => {
    let n = nodes.get(id);
    if (!n) { n = { id, attributes: [] }; nodes.set(id, n); }
    return n;
  };
  let current: { id: string; attributes: string[] } | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;
    if (current) {
      if (line === "}") { current = null; continue; }
      current.attributes.push(line); // "type name" (+ optional PK/FK/comment)
      continue;
    }
    // entity attribute block: `CUSTOMER {`
    const open = line.match(/^([\w-]+)\s*\{$/);
    if (open) { current = ensure(open[1]); continue; }
    // relationship: ENTITY1 <leftCard><--|..><rightCard> ENTITY2 [: label]
    const rel = line.match(/^([\w-]+)\s+([|}o]{2})(--|\.\.)([|o{]{2})\s+([\w-]+)\s*(?::\s*(.+))?$/);
    if (rel) {
      const [, e1, lc, conn, rc, e2, label] = rel;
      ensure(e1); ensure(e2);
      edges.push({
        from: e1, to: e2, label: label?.trim() || undefined,
        srcCard: ER_LEFT_CARD[lc] ?? "one", tgtCard: ER_RIGHT_CARD[rc] ?? "one",
        dash: conn === "..",
      });
    }
  }
  if (nodes.size === 0) return null;
  const r = DiagramSpecSchema.safeParse({
    type: "flowchart",
    direction: "TB",
    nodes: [...nodes.values()].map((n) => ({ id: n.id, label: n.id, shape: "entity", attributes: n.attributes })),
    edges: edges.map((e) => ({
      from: e.from, to: e.to, label: e.label, srcCard: e.srcCard, tgtCard: e.tgtCard,
      ...(e.dash ? { style: { dash: true } } : {}),
    })),
  });
  return r.success ? r.data : null;
}

/** Parse a Mermaid `stateDiagram`/`stateDiagram-v2` into a DiagramSpec: states →
 *  rounded-rect nodes, `[*]` → start/end pseudo-state dots, transitions → edges.
 *  Composite (nested) states are flattened for now. */
export function parseMermaidState(lines: string[]): DiagramSpec | null {
  const nodes = new Map<string, { id: string; label: string; shape: string }>();
  const edges: Array<{ from: string; to: string; label?: string }> = [];
  // `[*]` means the initial state as a source, the final state as a target.
  const ensure = (raw: string, asTarget: boolean): string => {
    if (raw === "[*]") {
      const id = asTarget ? "__end" : "__start";
      if (!nodes.has(id)) nodes.set(id, { id, label: "", shape: asTarget ? "end" : "start" });
      return id;
    }
    if (!nodes.has(raw)) nodes.set(raw, { id: raw, label: raw, shape: "rounded_rect" });
    return raw;
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%") || line === "}" || /^direction\s/i.test(line)) continue;
    // state declaration: `state "Label" as X` (custom label) or `state X`
    const named = line.match(/^state\s+"([^"]+)"\s+as\s+(\w+)/);
    if (named) { nodes.set(named[2], { id: named[2], label: named[1], shape: "rounded_rect" }); continue; }
    const decl = line.match(/^state\s+(\w+)/);
    if (decl) { if (!nodes.has(decl[1])) nodes.set(decl[1], { id: decl[1], label: decl[1], shape: "rounded_rect" }); continue; }
    // transition: A --> B [: label]   (A or B may be [*])
    const t = line.match(/^(\[\*\]|\w+)\s*-->\s*(\[\*\]|\w+)\s*(?::\s*(.+))?$/);
    if (t) {
      edges.push({ from: ensure(t[1], false), to: ensure(t[2], true), label: t[3]?.trim() || undefined });
    }
  }
  if (nodes.size === 0) return null;
  const r = DiagramSpecSchema.safeParse({ type: "flowchart", direction: "TB", nodes: [...nodes.values()], edges });
  return r.success ? r.data : null;
}

/** Parse a Mermaid `sequenceDiagram` into a DiagramSpec (type "sequence"):
 *  participants → ordered nodes, messages → ordered edges (dashed for `-->>`). */
export function parseMermaidSequence(lines: string[]): DiagramSpec | null {
  const labels = new Map<string, string>();
  const order: string[] = [];
  const ensure = (id: string, label?: string) => {
    if (!labels.has(id)) { labels.set(id, label ?? id); order.push(id); }
    else if (label) labels.set(id, label);
  };
  const edges: Array<{ from: string; to: string; label?: string; dash: boolean; async: boolean }> = [];
  const fragments: Array<{ kind: string; label: string; from: number; to: number; dividers: Array<{ at: number; label: string }> }> = [];
  const fragStack: Array<{ kind: string; label: string; from: number; dividers: Array<{ at: number; label: string }> }> = [];
  // Activation tracking: one open span per participant (start = message index).
  const activations: Array<{ participant: string; from: number; to: number }> = [];
  const openAct = new Map<string, number>();
  const open = (id: string, at: number) => { if (!openAct.has(id)) openAct.set(id, at); };
  const close = (id: string, at: number) => {
    const from = openAct.get(id);
    if (from !== undefined) { activations.push({ participant: id, from, to: Math.max(at, from) }); openAct.delete(id); }
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;
    const p = line.match(/^(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/);
    if (p) { ensure(p[1], p[2]?.trim()); continue; }

    // explicit activate/deactivate (start at next message, end at last message)
    const act = line.match(/^(activate|deactivate)\s+(\w+)$/i);
    if (act) {
      ensure(act[2]);
      if (act[1].toLowerCase() === "activate") open(act[2], edges.length);
      else close(act[2], edges.length - 1);
      continue;
    }

    // combined fragment open / close; `else`/`and` records a branch divider
    const fr = line.match(/^(alt|loop|opt|par)\b\s*(.*)$/i);
    if (fr) { fragStack.push({ kind: fr[1].toLowerCase(), label: fr[2].trim(), from: edges.length, dividers: [] }); continue; }
    if (/^end\b/i.test(line)) {
      const f = fragStack.pop();
      if (f && edges.length > f.from) fragments.push({ ...f, to: edges.length - 1 });
      continue;
    }
    const el = line.match(/^(?:else|and)\b\s*(.*)$/i);
    if (el) {
      const top = fragStack[fragStack.length - 1];
      if (top && edges.length > top.from) top.dividers.push({ at: edges.length, label: el[1].trim() });
      continue;
    }

    // A ->> B : message — arrow run is -,>,x,); leading "--" = dashed/return, trailing ")" = async
    // an optional +/- before the target activates the target / deactivates the source.
    const m = line.match(/^(\w+)\s*(--?(?:>>?|x|\)))\s*([+-]?)\s*(\w+)\s*:\s*(.*)$/);
    if (m) {
      const [, a, op, actMark, b, label] = m;
      ensure(a); ensure(b);
      edges.push({ from: a, to: b, label: label.trim() || undefined, dash: op.startsWith("--"), async: op.endsWith(")") });
      const here = edges.length - 1;
      if (actMark === "+") open(b, here);
      else if (actMark === "-") close(a, here);
    }
  }
  // close any activations left open at the final message
  for (const id of [...openAct.keys()]) close(id, edges.length - 1);
  if (order.length === 0) return null;
  const r = DiagramSpecSchema.safeParse({
    type: "sequence",
    direction: "TB",
    nodes: order.map((id) => ({ id, label: labels.get(id) ?? id })),
    edges: edges.map((e) => {
      const style: Record<string, boolean> = {};
      if (e.dash) style.dash = true;
      if (e.async) style.async = true;
      return { from: e.from, to: e.to, label: e.label, ...(Object.keys(style).length ? { style } : {}) };
    }),
    fragments,
    activations,
  });
  return r.success ? r.data : null;
}
