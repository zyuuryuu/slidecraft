/**
 * guides.ts — the SELF-DESCRIBING authoring contract exposed to the upstream AI (Theme 3, S1).
 *
 * The engine ALREADY holds the authoring knowledge: `slideSystemPrompt` (L1 slide format) and the
 * two-stage diagram prompts (`diagramRoutePrompt` menu + `diagramSystemPrompt(type)` per-type). This
 * MCP-layer module EXPOSES that knowledge over tools — it invents no new guidance and calls no model
 * (harness-over-model). It lives in src/mcp (not src/engine) because its manifest pointers reference
 * MCP TOOL NAMES; keeping those out of src/engine preserves engine purity (R2). See
 * docs/design/mcp-brushup.md §F.
 */
import type { Session } from "./session";
import * as S from "./session";
import { slideSystemPrompt } from "../engine/llm-prompts";
import { diagramSystemPrompt, DIAGRAM_TYPES, parseDiagramType } from "../engine/diagram-type-prompts";
import { VALID_TYPES } from "../engine/schema-constants";

/** L1 + manifest — the slide-Markdown authoring contract for THIS template (catalog-resolved layout
 *  names + selection rules = alien-safe), the body budget to author WITHIN, and pointers to the
 *  diagram / template-spec guides. This is the single ENTRY the AI reads before authoring; it requires
 *  an open project (never-silent via requireLoaded) so the layout names are the real template's. */
export function getAuthoringGuide(s: Session) {
  const { entries, budget } = S.entriesAndBudget(s); // requireLoaded inside → never-silent if no project open
  return {
    format: slideSystemPrompt(entries),
    budget, // this template's body capacity (maxBullets/charsPerBullet) — keep each content slide within it
    capacity:
      "容量は get_slide(i) / get_deck_issues で実測できる：capacity.usedLines/maxLines（全角換算の保守的推定）・overBudget・predictedSplit（split_overflowing_slides の dry-run、実行せず何枚に割れるか）",
    seeAlso: {
      figures: "図を入れるなら get_diagram_types で種類を選び、get_diagram_guide(type) で構文を得る",
      templateSpec: "新しいテンプレを作るなら get_template_spec_guide（→ create_template）",
    },
  };
}

/** The contract DIGEST that rides EVERY session-entry return (open/new/select_document) — the
 *  unskippable push channel (§F ②). Anchor-type: only what the AI can't guess (this template's real
 *  layout NAMES + the region-separator placement) + the body budget + pointers to the full guide and
 *  the figure vocabulary. Kept lean because it ships on every entry; depth is PULLED via
 *  get_authoring_guide / get_diagram_types. */
export function contractDigest(s: Session) {
  const { entries, budget } = S.entriesAndBudget(s);
  return {
    layouts: entries.map((e) => e.name),
    budget,
    capacity: "容量は get_slide(i) で実測できる（capacity.usedLines/maxLines・overBudget・predictedSplit）",
    separators:
      "多領域レイアウト（columns/kpi/process）は各リージョンの前に `<!-- col -->` / `<!-- kpi -->` / `<!-- step -->` を1つずつ置く（先頭より前の内容は無視される）",
    notes:
      "スピーカーノートは `<!-- note -->` を単独行で置き、以降スライド末尾（次の `---`）までが素の Markdown のノート本文（#150）。スライドは疎に・詳細はノートへ",
    sections:
      "章は著者が書く章扉スライドに `<!-- section -->` タグ（章名は `#` 見出しのまま）。`<!-- toc -->` のみのブロックは目次の派生スライドで、内容は常に章一覧から自動導出（手書き不可・#151）",
    seeAlso: { format: "get_authoring_guide", figures: "get_diagram_types" },
  };
}

/** L2 stage-1 — the diagram TYPE menu (label + one-line routing hint) so the AI knows the full
 *  vocabulary exists (not just flowchart), then pulls one type's shape via getDiagramGuide. Only the
 *  12 authorable DiagramSpec types; class/state/ER/mindmap are reachable via ```mermaid, not as types. */
export function getDiagramTypes() {
  return { types: VALID_TYPES.map((type) => ({ type, label: DIAGRAM_TYPES[type].label, hint: DIAGRAM_TYPES[type].hint })) };
}

/** L2 stage-2 — the fields + a concrete example for ONE chosen type (shared base + that type's shape
 *  fragment). An unknown type is rejected never-silently with the way to discover valid ones. */
export function getDiagramGuide(typeRaw: string) {
  const type = parseDiagramType(typeRaw);
  if (!type) {
    return { ok: false as const, error: `未知の図タイプです: ${typeRaw}。get_diagram_types の type を使ってください。` };
  }
  return { type, guide: diagramSystemPrompt(type) };
}
