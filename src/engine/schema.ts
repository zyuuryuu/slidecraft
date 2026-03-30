/**
 * DiagramSpec v1.0 — Intermediate schema for YAML/JSON → PPTX pipeline.
 *
 * Defines the data structures that bridge diagram descriptions
 * and the PPTX renderer. Validates input before rendering.
 */

import { z } from "zod/v4";

// ── Constants ──

export const VALID_SHAPES = [
  "rect", "rounded_rect", "diamond", "circle", "oval", "hexagon",
] as const;
export type ShapeType = (typeof VALID_SHAPES)[number];

export const VALID_DIRECTIONS = ["TB", "LR", "BT", "RL"] as const;
export type Direction = (typeof VALID_DIRECTIONS)[number];

export const VALID_TYPES = ["flowchart", "network", "orgchart"] as const;
export type DiagramType = (typeof VALID_TYPES)[number];

export const BUILTIN_ICONS = new Set([
  "router", "switch", "server", "database", "cloud",
  "firewall", "client", "internet",
  "load_balancer", "wireless_ap", "storage", "printer",
  "phone", "vpn", "monitor",
]);

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

export const NodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  sublabel: z.string().optional(),
  shape: z.enum(VALID_SHAPES).default("rect"),
  class: z.string().optional(),
  style: NodeStyleSchema.optional(),
  group: z.string().optional(),
  lane: z.string().optional(),
  icon: z.string().optional(),
});
export type Node = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: EdgeStyleSchema.optional(),
  bus_group: z.string().optional(),
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

export const DiagramSpecSchema = z.object({
  type: z.enum(VALID_TYPES),
  direction: z.enum(VALID_DIRECTIONS).default("TB"),
  title: z.string().optional(),
  classDefs: z.record(z.string(), NodeStyleSchema).default({}),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema).default([]),
  groups: z.array(GroupSchema).default([]),
  lanes: z.array(LaneSchema).default([]),
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

// ── Diagnostic system ──

export interface DiagnosticIssue {
  level: "error" | "warning";
  path: string;
  message: string;
  suggestion?: string;
}

function findSimilar(fieldName: string, known: Set<string>, threshold = 0.6): string | undefined {
  let bestMatch: string | undefined;
  let bestRatio = 0;
  const lower = fieldName.toLowerCase();

  for (const knownName of known) {
    const ratio = similarity(lower, knownName.toLowerCase());
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestMatch = knownName;
    }
  }
  return bestRatio >= threshold ? bestMatch : undefined;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

const KNOWN_FIELDS_TOP = new Set([
  "type", "direction", "title", "classDefs", "nodes", "edges",
  "groups", "lanes", "layout",
]);
const REQUIRED_FIELDS_TOP = new Set(["type", "nodes"]);

const KNOWN_FIELDS_NODE = new Set([
  "id", "label", "sublabel", "shape", "class", "style", "group", "lane", "icon",
]);
const REQUIRED_FIELDS_NODE = new Set(["id", "label"]);

const KNOWN_FIELDS_EDGE = new Set([
  "from", "to", "label", "style", "bus_group",
]);
const REQUIRED_FIELDS_EDGE = new Set(["from", "to"]);

const KNOWN_FIELDS_GROUP = new Set(["id", "label", "parent", "style"]);
const REQUIRED_FIELDS_GROUP = new Set(["id", "label"]);

const KNOWN_FIELDS_LANE = new Set(["id", "label", "style"]);
const REQUIRED_FIELDS_LANE = new Set(["id", "label"]);

const KNOWN_FIELDS_LAYOUT = new Set(["node_width", "node_height", "h_gap", "v_gap"]);

const KNOWN_FIELDS_NODE_STYLE = new Set([
  "fill", "border", "border_width", "border_dash",
  "font_color", "font_size", "font_bold",
]);
const KNOWN_FIELDS_EDGE_STYLE = new Set(["color", "width", "arrow", "dash"]);
const KNOWN_FIELDS_GROUP_STYLE = new Set(["border", "border_dash", "fill"]);
const KNOWN_FIELDS_LANE_STYLE = new Set([
  "header_fill", "header_font_color", "band_fill", "border", "border_width",
]);

function checkFields(
  obj: Record<string, unknown>,
  known: Set<string>,
  required: Set<string>,
  path: string,
  issues: DiagnosticIssue[],
): void {
  for (const req of required) {
    if (!(req in obj)) {
      issues.push({ level: "error", path, message: `Required field '${req}' is missing.` });
    }
  }
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      const similar = findSimilar(key, known);
      let msg = `Unknown field '${key}'.`;
      if (similar) msg += ` Did you mean '${similar}'?`;
      issues.push({
        level: "warning",
        path: path ? `${path}.${key}` : key,
        message: msg,
        suggestion: similar,
      });
    }
  }
}

function checkStyleFields(
  styleObj: Record<string, unknown>,
  known: Set<string>,
  path: string,
  issues: DiagnosticIssue[],
): void {
  for (const key of Object.keys(styleObj)) {
    if (!known.has(key)) {
      const similar = findSimilar(key, known);
      let msg = `Unknown style field '${key}'.`;
      if (similar) msg += ` Did you mean '${similar}'?`;
      issues.push({
        level: "warning",
        path: `${path}.${key}`,
        message: msg,
        suggestion: similar,
      });
    }
  }
}

export function diagnoseJson(jsonStr: string): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    issues.push({
      level: "error",
      path: "(root)",
      message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    });
    return issues;
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    issues.push({
      level: "error",
      path: "(root)",
      message: `Expected a JSON object at root, got ${Array.isArray(data) ? "array" : typeof data}.`,
    });
    return issues;
  }

  const d = data as Record<string, unknown>;

  // Top-level fields
  checkFields(d, KNOWN_FIELDS_TOP, REQUIRED_FIELDS_TOP, "(root)", issues);

  // type & direction enums
  if ("type" in d && !(VALID_TYPES as readonly string[]).includes(d.type as string)) {
    issues.push({
      level: "error",
      path: "(root).type",
      message: `Invalid type '${d.type}'. Must be one of ${JSON.stringify([...VALID_TYPES])}.`,
    });
  }
  if ("direction" in d && !(VALID_DIRECTIONS as readonly string[]).includes(d.direction as string)) {
    issues.push({
      level: "error",
      path: "(root).direction",
      message: `Invalid direction '${d.direction}'. Must be one of ${JSON.stringify([...VALID_DIRECTIONS])}.`,
    });
  }

  // Nodes
  const nodes = d.nodes;
  if (nodes !== undefined && !Array.isArray(nodes)) {
    issues.push({ level: "error", path: "nodes", message: "Expected 'nodes' to be an array." });
  } else if (Array.isArray(nodes)) {
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (typeof nd !== "object" || nd === null || Array.isArray(nd)) {
        issues.push({ level: "error", path: `nodes[${i}]`, message: "Expected object." });
        continue;
      }
      const n = nd as Record<string, unknown>;
      checkFields(n, KNOWN_FIELDS_NODE, REQUIRED_FIELDS_NODE, `nodes[${i}]`, issues);
      if ("shape" in n && !(VALID_SHAPES as readonly string[]).includes(n.shape as string)) {
        issues.push({
          level: "error",
          path: `nodes[${i}].shape`,
          message: `Invalid shape '${n.shape}'. Must be one of ${JSON.stringify([...VALID_SHAPES])}.`,
        });
      }
      if ("style" in n && typeof n.style === "object" && n.style !== null) {
        checkStyleFields(n.style as Record<string, unknown>, KNOWN_FIELDS_NODE_STYLE, `nodes[${i}].style`, issues);
      }
    }
  }

  // Edges
  const edges = d.edges;
  if (edges !== undefined && !Array.isArray(edges)) {
    issues.push({ level: "error", path: "edges", message: "Expected 'edges' to be an array." });
  } else if (Array.isArray(edges)) {
    for (let i = 0; i < edges.length; i++) {
      const ed = edges[i];
      if (typeof ed !== "object" || ed === null || Array.isArray(ed)) {
        issues.push({ level: "error", path: `edges[${i}]`, message: "Expected object." });
        continue;
      }
      const e = ed as Record<string, unknown>;
      checkFields(e, KNOWN_FIELDS_EDGE, REQUIRED_FIELDS_EDGE, `edges[${i}]`, issues);
      if ("style" in e && typeof e.style === "object" && e.style !== null) {
        checkStyleFields(e.style as Record<string, unknown>, KNOWN_FIELDS_EDGE_STYLE, `edges[${i}].style`, issues);
      }
    }
  }

  // Groups
  const groups = d.groups;
  if (Array.isArray(groups)) {
    for (let i = 0; i < groups.length; i++) {
      const gd = groups[i];
      if (typeof gd !== "object" || gd === null) continue;
      const g = gd as Record<string, unknown>;
      checkFields(g, KNOWN_FIELDS_GROUP, REQUIRED_FIELDS_GROUP, `groups[${i}]`, issues);
      if ("style" in g && typeof g.style === "object" && g.style !== null) {
        checkStyleFields(g.style as Record<string, unknown>, KNOWN_FIELDS_GROUP_STYLE, `groups[${i}].style`, issues);
      }
    }
  }

  // Lanes
  const lanes = d.lanes;
  if (Array.isArray(lanes)) {
    for (let i = 0; i < lanes.length; i++) {
      const ld = lanes[i];
      if (typeof ld !== "object" || ld === null) continue;
      const l = ld as Record<string, unknown>;
      checkFields(l, KNOWN_FIELDS_LANE, REQUIRED_FIELDS_LANE, `lanes[${i}]`, issues);
      if ("style" in l && typeof l.style === "object" && l.style !== null) {
        checkStyleFields(l.style as Record<string, unknown>, KNOWN_FIELDS_LANE_STYLE, `lanes[${i}].style`, issues);
      }
    }
  }

  // Layout
  const layout = d.layout;
  if (typeof layout === "object" && layout !== null && !Array.isArray(layout)) {
    checkStyleFields(layout as Record<string, unknown>, KNOWN_FIELDS_LAYOUT, "layout", issues);
  }

  // classDefs
  const classDefs = d.classDefs;
  if (typeof classDefs === "object" && classDefs !== null && !Array.isArray(classDefs)) {
    for (const [clsName, styleDict] of Object.entries(classDefs as Record<string, unknown>)) {
      if (typeof styleDict === "object" && styleDict !== null) {
        checkStyleFields(styleDict as Record<string, unknown>, KNOWN_FIELDS_NODE_STYLE, `classDefs.${clsName}`, issues);
      }
    }
  }

  return issues;
}

// ── Parse function ──

export function parseDiagramJson(jsonStr: string): DiagramSpec {
  const data = JSON.parse(jsonStr);
  const result = DiagramSpecSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`DiagramSpec schema validation failed:\n${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const spec = result.data;
  const errors = validateDiagramSpec(spec);
  if (errors.length > 0) {
    throw new Error(
      `DiagramSpec validation failed:\n${errors.map((e) => "  - " + e.message).join("\n")}`
    );
  }
  return spec;
}
