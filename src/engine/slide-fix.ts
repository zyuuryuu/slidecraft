/**
 * slide-fix.ts — the "制約＋診断 ⇄ AI" CONTRACT (feedback packet).
 *
 * Stage C of the harness-directed AI loop (ROADMAP "①③の交点"): turn a slide's
 * diagnostics ([[deck-diagnostics]]) + the template's capacity budget into a
 * structured fix request the upstream AI can act on. Built as a reusable packet —
 * NOT a one-off regenerate button — so the SAME contract serves the in-app loop,
 * batch repair, and a future MCP tool (stage D re-exposes `SlideFix` unchanged).
 *
 * Determinism-first stays the caller's job: try split/visualize deterministically,
 * then hand only the residue (condense/restructure) to the AI via this packet.
 *
 * Pure logic (R2): no DOM / Tauri / AI calls here — just the data + its serialization.
 */

import type { DeckIssue, Lever } from "./deck-diagnostics";
import type { FitBox } from "./distill";

export interface SlideFix {
  /** The slide's current SlideCraft Markdown (text + any figure block). */
  currentMarkdown: string;
  /** Why it needs fixing — straight from diagnoseDeck. */
  issues: Array<{ message: string; levers: Lever[] }>;
  /** The template's capacity for this slide's body, when known. */
  budget?: { maxBullets: number; charsPerBullet: number };
  /** A composed natural-language instruction derived from the issues + budget. */
  instruction: string;
}

/** Compose the human/AI-readable fix instruction from the levers + budget. */
function composeInstruction(levers: Set<Lever>, budget?: SlideFix["budget"]): string {
  const parts: string[] = [];
  if (levers.has("title")) parts.push("内容を表す簡潔なタイトルを付ける。");
  if (levers.has("split")) parts.push("情報量が多すぎます。最重要点に絞り、枝葉は落とす。");
  if (levers.has("condense"))
    parts.push(`各箇条書きは文章でなく短いキーフレーズに（語尾・助詞を削る${budget ? `・各${budget.charsPerBullet}字以内` : ""}）。`);
  if (levers.has("visualize"))
    parts.push("「ラベル: 値」が並ぶ箇所は表（| 項目 | 内容 |）に、手順やフローは ```diagram の flowchart にしてもよい。");
  if (budget) parts.push(`本文は最大${budget.maxBullets}項目に収める。`);
  parts.push("ただし要点は削らず、言い換えは最小限に保ち、元の意味を変えないこと。Markdown のみ返す。");
  return parts.join(" ");
}

/**
 * Build the fix packet for ONE slide. `issues` should already be filtered to this
 * slide (e.g. diagnostics.filter(d => d.slideIndex === i)); `box` is the template's
 * content-body FitBox from contentBodyBox(catalog), when a template is loaded.
 */
export function buildSlideFix(currentMarkdown: string, issues: DeckIssue[], box?: FitBox): SlideFix {
  const levers = new Set<Lever>(issues.flatMap((i) => i.levers));
  const budget = box ? { maxBullets: box.maxLines, charsPerBullet: box.charsPerLine } : undefined;
  return {
    currentMarkdown,
    issues: issues.map((i) => ({ message: i.message, levers: i.levers })),
    budget,
    instruction: composeInstruction(levers, budget),
  };
}

/**
 * Serialize a SlideFix into the `userRequest` for the existing AI "slide" mode
 * (system = slideMarkdownEditPrompt). The AI returns the edited slide's Markdown,
 * applied via the normal per-slide apply path. A future MCP tool serializes the
 * same packet differently — that's why the structured `SlideFix` is the contract.
 */
export function slideFixRequest(fix: SlideFix): string {
  return `Current slide:\n${fix.currentMarkdown}\n\nInstruction: ${fix.instruction}`;
}
