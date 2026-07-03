/**
 * diagram-type-prompts.ts — Two-stage diagram generation.
 *
 * The DiagramSpec supports 12 types with different shapes (node-edge graphs, plus chart-field types
 * like gantt/xychart/radar/kpi/quadrant). Cramming all of them into one prompt is slow (tokens) and
 * unmaintainable (every new type bloats it). Instead:
 *   Stage 1 — decide the TYPE (a UI pick, or an AI route call via `diagramRoutePrompt`).
 *   Stage 2 — send `diagramSystemPrompt(type)` = a small shared BASE + ONLY that type's shape fragment.
 * Adding a diagram type = one `DIAGRAM_TYPES` entry (it then appears in the router menu, the UI dropdown,
 * and gets its own focused prompt). Pure strings (R2): no DOM / Tauri.
 */

import { VALID_TYPES, type DiagramType } from "./schema-constants";
import { iconCatalogPromptList } from "./icon-catalog";

/** One diagram type: its human label (UI dropdown), a one-line routing hint (Stage 1), and the SHAPE
 *  fragment — the fields + a tiny example the model needs to emit THIS type (Stage 2). */
export interface DiagramTypeInfo {
  label: string;
  hint: string;
  shape: string;
}

// Node-based types share the id/label/shape/icon/class/group vocabulary; chart types use `nodes: []`
// plus a single top-level field. Each `shape` is self-contained so only ONE reaches the model.
export const DIAGRAM_TYPES: Record<DiagramType, DiagramTypeInfo> = {
  flowchart: {
    label: "フローチャート",
    hint: "process / flow / decision logic — boxes & arrows",
    shape: `Use "nodes" (id, label, shape ∈ rect|rounded_rect|diamond|circle|oval|hexagon, optional class/group) and "edges" (from, to, optional label, optional "style":{"dash":true}). "classDefs" + "groups" are optional.
Example: {"type":"flowchart","direction":"LR","nodes":[{"id":"a","label":"開始","shape":"rounded_rect"},{"id":"b","label":"判定","shape":"diamond"},{"id":"c","label":"完了"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c","label":"OK"}]}`,
  },
  network: {
    label: "ネットワーク図",
    hint: "systems / infrastructure / architecture — nodes with icons",
    shape: `Like flowchart, but give EACH node an "icon" from the icon list above (server, database, cloud, …). Group related nodes with "groups".
Example: {"type":"network","nodes":[{"id":"web","label":"Web","icon":"server"},{"id":"db","label":"DB","icon":"database"}],"edges":[{"from":"web","to":"db"}]}`,
  },
  orgchart: {
    label: "組織図",
    hint: "hierarchy / reporting lines / breakdown",
    shape: `Use "direction":"TB" and "nodes" + "edges" where each edge is a parent→child reporting line.
Example: {"type":"orgchart","direction":"TB","nodes":[{"id":"ceo","label":"CEO"},{"id":"cto","label":"CTO"},{"id":"cfo","label":"CFO"}],"edges":[{"from":"ceo","to":"cto"},{"from":"ceo","to":"cfo"}]}`,
  },
  sequence: {
    label: "シーケンス図",
    hint: "interactions / message exchange between participants over time",
    shape: `"nodes" = participants (id, label). "edges" = messages IN ORDER (from, to, label); their position in the array is the message index. Optional "fragments":[{"kind":"alt|loop|opt|par","label":"...","from":<msgIdx>,"to":<msgIdx>}] draw a box over a message range; "activations":[{"participant":"id","from":<msgIdx>,"to":<msgIdx>}] show a busy lifeline.
Example: {"type":"sequence","nodes":[{"id":"u","label":"User"},{"id":"s","label":"Server"}],"edges":[{"from":"u","to":"s","label":"request"},{"from":"s","to":"u","label":"response"}],"fragments":[{"kind":"opt","label":"if cached","from":1,"to":1}]}`,
  },
  timeline: {
    label: "タイムライン",
    hint: "history / roadmap / chronological periods",
    shape: `"nodes" = periods in chronological order (id, label). Optionally group consecutive periods into a phase with "group":"<section name>". No edges needed.
Example: {"type":"timeline","nodes":[{"id":"p1","label":"2023 企画","group":"Phase 1"},{"id":"p2","label":"2024 開発","group":"Phase 1"},{"id":"p3","label":"2025 公開","group":"Phase 2"}]}`,
  },
  quadrant: {
    label: "四象限マトリクス",
    hint: "2×2 positioning — e.g. impact vs effort, priority matrix",
    shape: `Set "nodes":[] and a "quadrant" object: axis ends xLow/xHigh/yLow/yHigh, quadrant labels q1(top-right)/q2(top-left)/q3(bottom-left)/q4(bottom-right), and "points":[{"label":"...","x":0..1,"y":0..1}].
Example: {"type":"quadrant","nodes":[],"quadrant":{"xLow":"低コスト","xHigh":"高コスト","yLow":"低効果","yHigh":"高効果","q1":"最優先","q2":"要検討","q3":"見送り","q4":"次点","points":[{"label":"施策A","x":0.2,"y":0.8}]}}`,
  },
  pie: {
    label: "円グラフ",
    hint: "proportions / share of a whole",
    shape: `"nodes" = slices, each with a positive numeric "value": {"id":"...","label":"...","value":<number>}. No edges.
Example: {"type":"pie","title":"構成比","nodes":[{"id":"a","label":"国内","value":60},{"id":"b","label":"海外","value":40}]}`,
  },
  gantt: {
    label: "ガントチャート",
    hint: "schedule / project plan with tasks over time",
    shape: `Set "nodes":[] and a "gantt" object: "startDate" and "tasks":[{"name":"...","section":"...","start":<dayOffset>,"end":<dayOffset>,"status":"done|active|crit|milestone"}] (start/end are day offsets from startDate).
Example: {"type":"gantt","nodes":[],"gantt":{"startDate":"2025-01-01","tasks":[{"name":"要件定義","section":"設計","start":0,"end":10,"status":"done"},{"name":"実装","section":"開発","start":10,"end":30,"status":"active"}]}}`,
  },
  journey: {
    label: "カスタマージャーニー",
    hint: "user experience steps with a satisfaction score",
    shape: `"nodes" = steps, each with "value" = satisfaction 1..5, "group" = section, "attributes" = actors: {"id":"...","label":"...","value":4,"group":"...","attributes":["ユーザー"]}.
Example: {"type":"journey","nodes":[{"id":"s1","label":"検索","value":3,"group":"発見","attributes":["ユーザー"]},{"id":"s2","label":"購入","value":5,"group":"転換","attributes":["ユーザー"]}]}`,
  },
  xychart: {
    label: "折れ線 / 棒グラフ",
    hint: "numeric series over categories (bar or line chart)",
    shape: `Set "nodes":[] and an "xychart" object: xlabel/ylabel, "categories":["..."], and "series":[{"kind":"bar|line","name":"...","values":[<number>,...]}] (one value per category).
Example: {"type":"xychart","nodes":[],"xychart":{"xlabel":"四半期","ylabel":"売上","categories":["Q1","Q2","Q3","Q4"],"series":[{"kind":"bar","name":"2024","values":[10,14,13,18]}]}}`,
  },
  radar: {
    label: "レーダーチャート",
    hint: "multi-axis comparison (spider chart)",
    shape: `Set "nodes":[] and a "radar" object: "axes":["..."], "max":<number>, and "series":[{"name":"...","values":[<number per axis>]}].
Example: {"type":"radar","nodes":[],"radar":{"axes":["速度","品質","価格","対応"],"max":5,"series":[{"name":"自社","values":[4,5,3,4]},{"name":"競合","values":[3,3,5,2]}]}}`,
  },
  kpi: {
    label: "KPIカード",
    hint: "big-number metric tiles",
    shape: `Set "nodes":[] and a "kpi" object: "cards":[{"value":"...","label":"...","delta":"...","trend":"up|down"}] (value/delta are strings, units OK).
Example: {"type":"kpi","nodes":[],"kpi":{"cards":[{"value":"¥1.2M","label":"月間売上","delta":"+12%","trend":"up"},{"value":"98%","label":"稼働率","delta":"-1%","trend":"down"}]}}`,
  },
};

// ── Base prompt (shared by every type) ──

const COLOR_PALETTE = `- Navy #1E2761 · Dark Navy #141B41 · Accent Blue #3B82F6 · Teal #06B6D4 · Amber #F59E0B
- White #FFFFFF · Light Gray #F5F7FA · Mid Gray #94A3B8 · Dark Text #1E293B`;

function baseDiagramPrompt(): string {
  return `You are a technical diagram assistant. Generate a DiagramSpec JSON for SlideCraft.

## Output
Return a SINGLE JSON object — no prose, no code fence. Common fields:
- "type": the diagram type (fixed below — do NOT change it)
- "title": a short title (optional)
- "direction": "TB" | "LR" | "BT" | "RL" (node-based diagrams; default "TB")
- "nodes": REQUIRED array — use [] for pure chart types (gantt / xychart / radar / kpi / quadrant)
- plus the type-specific field(s) shown for your type below.

## Color palette (Midnight Executive) — for styles where a type takes them
${COLOR_PALETTE}

## Available Icons (node-based diagrams; omit "icon" if none fits)
${iconCatalogPromptList()}

## Rules
- Short lowercase ids; labels may contain \\n. Keep the diagram focused (typically 4-12 items).
- Write all text in the SAME language as the user's request.
- Return ONLY the JSON object, no explanation.`;
}

// ── Stage 2: the system prompt for ONE chosen type ──

/** base + ONLY the chosen type's shape fragment. Defaults to flowchart (back-compat for callers that
 *  haven't picked a type yet). */
export function diagramSystemPrompt(type: DiagramType = "flowchart"): string {
  const info = DIAGRAM_TYPES[type];
  return `${baseDiagramPrompt()}

## Your diagram type: ${type} — ${info.label}
${info.hint}

Fields + example for THIS type:
${info.shape}`;
}

/** Edit an EXISTING diagram of a known type: same shape guidance, but change only what's asked. */
export function diagramEditSystemPrompt(type: DiagramType = "flowchart"): string {
  return `${diagramSystemPrompt(type)}

## Editing mode
You are given the CURRENT diagram (as YAML) and an instruction. Apply ONLY what the instruction asks,
keep everything else (ids, labels, styles, layout) intact, and return the FULL updated DiagramSpec as a
single JSON object.`;
}

// ── Stage 1: route a request to ONE type ──

/** A tiny prompt that asks the model to pick the single best diagram type. The reply is parsed by
 *  `parseDiagramType`; on failure the caller falls back (e.g. flowchart, or asks the user). */
export function diagramRoutePrompt(request: string): string {
  const menu = VALID_TYPES.map((t) => `- ${t}: ${DIAGRAM_TYPES[t].hint}`).join("\n");
  return `Choose the SINGLE best diagram type for the request below. Reply with ONLY the type name (one word), nothing else.

Types:
${menu}

Request: ${request}`;
}

/** Parse a router reply into a valid DiagramType, tolerating surrounding whitespace / quotes / a
 *  trailing period. Returns null if the reply isn't a bare, known type word. */
export function parseDiagramType(raw: string): DiagramType | null {
  const t = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return (VALID_TYPES as readonly string[]).includes(t) ? (t as DiagramType) : null;
}
