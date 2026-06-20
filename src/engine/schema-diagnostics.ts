/**
 * schema-diagnostics.ts — Human-friendly JSON diagnostics + the strict parse
 * entry point for DiagramSpec. Split out of schema.ts to keep that file within
 * the 400-line rule (R1). Pure logic (R2): no DOM / Tauri.
 *
 * Imports the schema/validation core one-way from ./schema; schema.ts re-exports
 * these symbols so existing `from "./schema"` imports keep working.
 */

import {
  VALID_TYPES,
  VALID_DIRECTIONS,
  VALID_SHAPES,
  DiagramSpecSchema,
  validateDiagramSpec,
  type DiagramSpec,
} from "./schema";

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
  "from", "to", "label", "style", "bus_group", "relation", "srcCard", "tgtCard",
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
