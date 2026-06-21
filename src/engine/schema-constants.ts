/**
 * schema-constants.ts — Enum-like constant arrays + their derived literal types
 * for DiagramSpec. Split out of schema.ts to keep it within the 400-line rule
 * (R1); schema.ts re-exports everything here (`export *`) so all existing
 * `from "./schema"` imports keep working. Pure data (R2): no DOM / Tauri.
 */

import { ICON_NAMES } from "./icon-catalog";

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

export const VALID_TYPES = ["flowchart", "network", "orgchart", "sequence", "timeline", "quadrant", "pie", "gantt", "journey", "xychart", "radar", "kpi"] as const;
export type DiagramType = (typeof VALID_TYPES)[number];

// Canonical built-in icon names — derived from the single ICON_CATALOG so the
// name set, the glyphs, the prompt and the validator can never drift apart.
export const BUILTIN_ICONS = new Set(ICON_NAMES);

export const MAX_NEST_DEPTH = 3;
