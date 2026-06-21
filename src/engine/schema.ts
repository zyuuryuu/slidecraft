/**
 * DiagramSpec v1.0 — Intermediate schema for YAML/JSON → PPTX pipeline.
 *
 * Defines the data structures that bridge diagram descriptions
 * and the PPTX renderer. Validates input before rendering.
 */

import { z } from "zod/v4";
import { ICON_NAMES } from "./icon-catalog";

// ── Constants ──

export const VALID_SHAPES = [
  "rect", "rounded_rect", "diamond", "circle", "oval", "hexagon", "class",
  // state-diagram pseudo-states (●/◉) + ER entity box (name + attributes)
  "start", "end", "entity",
] as const;
export type ShapeType = (typeof VALID_SHAPES)[number];

// ER relationship cardinality (crow's-foot) at an edge end.
export const VALID_CARDINALITIES = ["one", "zero_one", "zero_many", "one_many"] as const;
export type Cardinality = (typeof VALID_CARDINALITIES)[number];

// UML relationship kinds for class diagrams — drive the edge's line + arrowhead.
export const VALID_RELATIONS = [
  "association", "inheritance", "composition", "aggregation", "dependency", "realization",
] as const;
export type RelationType = (typeof VALID_RELATIONS)[number];

export const VALID_DIRECTIONS = ["TB", "LR", "BT", "RL"] as const;
export type Direction = (typeof VALID_DIRECTIONS)[number];

export const VALID_TYPES = ["flowchart", "network", "orgchart", "sequence", "timeline", "quadrant", "pie", "gantt", "journey"] as const;
export type DiagramType = (typeof VALID_TYPES)[number];

// Canonical built-in icon names — derived from the single ICON_CATALOG so the
// name set, the glyphs, the prompt and the validator can never drift apart.
export const BUILTIN_ICONS = new Set(ICON_NAMES);

export const MAX_NEST_DEPTH = 3;

// ── Zod Schemas ──

export const NodeStyleSchema = z.object({
  fill: z.string().optional(),
  border: z.string().optional(),
  border_width: z.number().default(1.5),
  border_dash: z.boolean().default(false),
  font_color: z.string().default("#FFFFFF"),
  font_size: z.number().default(11),
  font_bold: z.boolean().default(true),
});
export type NodeStyle = z.infer<typeof NodeStyleSchema>;

export const EdgeStyleSchema = z.object({
  color: z.string().default("#94A3B8"),
  width: z.number().default(2),
  arrow: z.boolean().default(true),
  dash: z.boolean().default(false),
  // Manual start/end port: shift the connection point along the node edge as a
  // fraction (-0.5..0.5, 0 = centre). Overrides the auto port spread when set.
  srcPort: z.number().optional(),
  tgtPort: z.number().optional(),
  // sequence messages: an async (open) arrowhead instead of the filled triangle
  // (Mermaid `-)` / `--)`). Flowchart edges ignore it.
  async: z.boolean().optional(),
});
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;

export const GroupStyleSchema = z.object({
  border: z.string().default("#94A3B8"),
  border_dash: z.boolean().default(true),
  fill: z.string().optional(),
});
export type GroupStyle = z.infer<typeof GroupStyleSchema>;

export const LaneStyleSchema = z.object({
  header_fill: z.string().default("#1E2761"),
  header_font_color: z.string().default("#FFFFFF"),
  band_fill: z.string().optional(),
  border: z.string().default("#CBD5E1"),
  border_width: z.number().default(1.0),
});
export type LaneStyle = z.infer<typeof LaneStyleSchema>;

export const LaneSchema = z.object({
  id: z.string(),
  label: z.string(),
  style: LaneStyleSchema.optional(),
});
export type Lane = z.infer<typeof LaneSchema>;

/**
 * Manual position/size override (inches, absolute slide coords). When present,
 * layout-engine uses these instead of the auto-computed value for that field.
 * Written by drag/resize in the preview; all sub-fields optional.
 */
export const NodeOverrideSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});
export type NodeOverride = z.infer<typeof NodeOverrideSchema>;

export const NodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  sublabel: z.string().optional(),
  shape: z.enum(VALID_SHAPES).default("rect"),
  // Class-diagram compartments (rendered as a 3-section box when present / shape "class").
  attributes: z.array(z.string()).optional(),
  methods: z.array(z.string()).optional(),
  class: z.string().optional(),
  // Numeric value for chart-type diagrams (pie slice magnitude; reusable for bar/gantt).
  value: z.number().optional(),
  style: NodeStyleSchema.optional(),
  group: z.string().optional(),
  lane: z.string().optional(),
  icon: z.string().optional(),
  override: NodeOverrideSchema.optional(),
});
export type Node = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: EdgeStyleSchema.optional(),
  bus_group: z.string().optional(),
  // UML relationship for class diagrams (inheritance/composition/…) — selects the
  // line dash + the end arrowheads (hollow triangle, filled/hollow diamond, …).
  relation: z.enum(VALID_RELATIONS).optional(),
  // ER cardinality (crow's-foot) at the source / target end of a relationship.
  srcCard: z.enum(VALID_CARDINALITIES).optional(),
  tgtCard: z.enum(VALID_CARDINALITIES).optional(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  parent: z.string().optional(),
  style: GroupStyleSchema.optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const LayoutConfigSchema = z.object({
  node_width: z.number().default(2.0),
  node_height: z.number().default(0.7),
  h_gap: z.number().default(0.5),
  v_gap: z.number().default(0.8),
});
export type LayoutConfig = z.infer<typeof LayoutConfigSchema>;

// Sequence-diagram combined fragment (alt/loop/opt/par) — a labelled box drawn over
// a contiguous range of messages [from, to] (message indices, inclusive).
export const FragmentSchema = z.object({
  kind: z.enum(["alt", "loop", "opt", "par"]),
  label: z.string().default(""),
  from: z.number(),
  to: z.number(),
  // alt/par branch splits (`else`/`and`): a divider line at message index `at`,
  // with the branch's label. Empty for opt/loop or a single-branch alt.
  dividers: z.array(z.object({ at: z.number(), label: z.string().default("") })).default([]),
});
export type Fragment = z.infer<typeof FragmentSchema>;

// A participant's lifeline being "active" (processing) over a message-index span.
export const ActivationSchema = z.object({
  participant: z.string(),
  from: z.number(),
  to: z.number(),
});
export type Activation = z.infer<typeof ActivationSchema>;

// Quadrant chart (2x2 matrix): axis labels, 4 quadrant labels, plotted points.
// q1=top-right, q2=top-left, q3=bottom-left, q4=bottom-right; point x/y in [0,1].
export const QuadrantSchema = z.object({
  xLow: z.string().default(""),
  xHigh: z.string().default(""),
  yLow: z.string().default(""),
  yHigh: z.string().default(""),
  q1: z.string().default(""),
  q2: z.string().default(""),
  q3: z.string().default(""),
  q4: z.string().default(""),
  points: z.array(z.object({ label: z.string(), x: z.number(), y: z.number() })).default([]),
});
export type Quadrant = z.infer<typeof QuadrantSchema>;

// Gantt chart: tasks with start/end as DAY OFFSETS from `startDate` (the parser
// resolves dates/durations/`after` deps into offsets); status ∈ done/active/crit/milestone.
export const GanttSchema = z.object({
  startDate: z.string().default(""),
  tasks: z.array(z.object({
    name: z.string(),
    section: z.string().default(""),
    start: z.number(),
    end: z.number(),
    status: z.string().default(""),
  })).default([]),
});
export type Gantt = z.infer<typeof GanttSchema>;

export const DiagramSpecSchema = z.object({
  type: z.enum(VALID_TYPES),
  direction: z.enum(VALID_DIRECTIONS).default("TB"),
  title: z.string().optional(),
  classDefs: z.record(z.string(), NodeStyleSchema).default({}),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema).default([]),
  groups: z.array(GroupSchema).default([]),
  lanes: z.array(LaneSchema).default([]),
  fragments: z.array(FragmentSchema).default([]),
  activations: z.array(ActivationSchema).default([]),
  quadrant: QuadrantSchema.optional(),
  gantt: GanttSchema.optional(),
  layout: LayoutConfigSchema.default({ node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 }),
});
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

// ── NodeStyle merge ──

const NODE_STYLE_DEFAULTS: NodeStyle = {
  border_width: 1.5,
  border_dash: false,
  font_color: "#FFFFFF",
  font_size: 11,
  font_bold: true,
};

export function mergeNodeStyle(base: NodeStyle, override: NodeStyle): NodeStyle {
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(NODE_STYLE_DEFAULTS) as (keyof NodeStyle)[]) {
    const overVal = override[key];
    const defaultVal = NODE_STYLE_DEFAULTS[key];
    if (overVal !== undefined && overVal !== defaultVal) {
      merged[key] = overVal;
    } else {
      merged[key] = base[key];
    }
  }
  // Handle optional fields (fill, border) — override takes precedence if defined
  if (override.fill !== undefined) merged.fill = override.fill;
  else if (base.fill !== undefined) merged.fill = base.fill;
  if (override.border !== undefined) merged.border = override.border;
  else if (base.border !== undefined) merged.border = base.border;

  return merged as NodeStyle;
}

// ── Validation ──

export interface ValidationError {
  message: string;
}

export function validateDiagramSpec(spec: DiagramSpec): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set(spec.nodes.map((n) => n.id));
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const laneIds = new Set(spec.lanes.map((l) => l.id));

  // Check edge references
  for (const e of spec.edges) {
    if (!nodeIds.has(e.from)) {
      errors.push({ message: `Edge references unknown node '${e.from}'` });
    }
    if (!nodeIds.has(e.to)) {
      errors.push({ message: `Edge references unknown node '${e.to}'` });
    }
  }

  // Check node group references
  for (const n of spec.nodes) {
    if (n.group && !groupIds.has(n.group)) {
      errors.push({ message: `Node '${n.id}' references unknown group '${n.group}'` });
    }
  }

  // Check node lane references
  for (const n of spec.nodes) {
    if (n.lane && !laneIds.has(n.lane)) {
      errors.push({ message: `Node '${n.id}' references unknown lane '${n.lane}'` });
    }
  }

  // Check group parent references
  const groupMap = new Map(spec.groups.map((g) => [g.id, g]));
  for (const g of spec.groups) {
    if (g.parent !== undefined) {
      if (!groupIds.has(g.parent)) {
        errors.push({ message: `Group '${g.id}' references unknown parent '${g.parent}'` });
      }
      if (g.parent === g.id) {
        errors.push({ message: `Group '${g.id}' references itself as parent` });
      }
    }
  }

  // Check for circular group nesting + depth
  let hasCycle = false;
  for (const g of spec.groups) {
    const visited = new Set<string>();
    let cur: string | undefined = g.id;
    while (cur !== undefined) {
      if (visited.has(cur)) {
        errors.push({ message: `Circular group nesting detected involving '${g.id}'` });
        hasCycle = true;
        break;
      }
      visited.add(cur);
      const parentGrp = groupMap.get(cur);
      cur = parentGrp?.parent;
    }
  }

  // Check nesting depth (only if no cycles)
  if (!hasCycle) {
    for (const g of spec.groups) {
      let depth = 0;
      let cur: string | undefined = g.parent;
      while (cur !== undefined) {
        depth++;
        const parentGrp = groupMap.get(cur);
        cur = parentGrp?.parent;
      }
      if (depth >= MAX_NEST_DEPTH) {
        errors.push({
          message: `Group '${g.id}' exceeds max nesting depth ${MAX_NEST_DEPTH} (depth=${depth + 1})`,
        });
      }
    }
  }

  // Check classDef references
  for (const n of spec.nodes) {
    if (n.class && !spec.classDefs[n.class]) {
      errors.push({ message: `Node '${n.id}' references unknown class '${n.class}'` });
    }
  }

  // Check for duplicate node IDs
  const seen = new Set<string>();
  for (const n of spec.nodes) {
    if (seen.has(n.id)) {
      errors.push({ message: `Duplicate node id '${n.id}'` });
    }
    seen.add(n.id);
  }

  return errors;
}

// ── Helper functions ──

export function resolveNodeStyle(spec: DiagramSpec, node: Node): NodeStyle {
  let base: NodeStyle = { ...NODE_STYLE_DEFAULTS };
  if (node.class && spec.classDefs[node.class]) {
    base = spec.classDefs[node.class];
  }
  if (node.style) {
    return mergeNodeStyle(base, node.style);
  }
  return base;
}

export function groupDepth(spec: DiagramSpec, groupId: string): number {
  const groupMap = new Map(spec.groups.map((g) => [g.id, g]));
  let depth = 0;
  let cur = groupMap.get(groupId);
  while (cur?.parent) {
    depth++;
    cur = groupMap.get(cur.parent);
  }
  return depth;
}

export function groupChildren(spec: DiagramSpec, groupId: string): string[] {
  return spec.groups.filter((g) => g.parent === groupId).map((g) => g.id);
}

export function groupAncestors(spec: DiagramSpec, groupId: string): string[] {
  const groupMap = new Map(spec.groups.map((g) => [g.id, g]));
  const ancestors: string[] = [];
  let cur = groupMap.get(groupId);
  while (cur?.parent) {
    ancestors.push(cur.parent);
    cur = groupMap.get(cur.parent);
  }
  return ancestors;
}

export function topLevelGroups(spec: DiagramSpec): Group[] {
  return spec.groups.filter((g) => g.parent === undefined);
}

export function groupAllNodes(spec: DiagramSpec, groupId: string): string[] {
  const direct = spec.nodes.filter((n) => n.group === groupId).map((n) => n.id);
  for (const childId of groupChildren(spec, groupId)) {
    direct.push(...groupAllNodes(spec, childId));
  }
  return direct;
}

// ── Diagnostics + strict JSON parse ──
// Split into schema-diagnostics.ts to keep this file within the 400-line rule
// (R1); re-exported here so existing `from "./schema"` imports keep working.
export { diagnoseJson, parseDiagramJson, type DiagnosticIssue } from "./schema-diagnostics";
