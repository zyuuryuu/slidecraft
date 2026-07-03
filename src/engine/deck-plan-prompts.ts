/**
 * deck-plan-prompts.ts — The LLM system prompts for deck / single-slide generation
 * + edit. Split from deck-plan.ts (R1); re-exported from it so importers are
 * unchanged. Pure strings (R2): no DOM / Tauri, no deck-plan internals.
 */
// ── System prompt the model fills (tiny vocabulary — no Markdown DSL) ──

export function deckPlanSystemPrompt(today?: string): string {
  return `You generate a slide deck as a JSON "DeckPlan". Output ONLY the JSON object — no prose, no code fence.

Shape:
{ "slides": [ Slide, ... ] }

Each Slide is exactly one of:
- {"kind":"title","title":"...","subtitle":"...","category":"...","date":"...","footer":"..."}  // opening slide; all but title optional
- {"kind":"section","title":"..."}                                                                // a section divider
- {"kind":"content","title":"...","subtitle":"...","bullets":["...","..."]}                       // a normal slide; subtitle optional
- {"kind":"columns","title":"...","subtitle":"...","columns":[{"heading":"...","bullets":["..."]}, ...]}  // 2 or 3 columns for comparison; subtitle/heading optional
- {"kind":"table","title":"...","subtitle":"...","headers":["列A","列B"],"rows":[["a1","b1"],["a2","b2"]]}  // a DATA TABLE: pricing, metric comparisons, schedules
- {"kind":"diagram","title":"...","subtitle":"...","mermaid":"flowchart LR\\n  A[開始] --> B[次] --> C[完了]"}  // a FIGURE: emit a small Mermaid diagram
- {"kind":"closing","title":"...","subtitle":"...","bullets":["..."]}                             // closing slide; subtitle + bullets optional

Rules:
- Write EVERY field in the SAME language as the user's request, and keep that ONE
  language for the WHOLE deck — never switch or drift into another language mid-way.
- Typically 6-10 slides. Start with a "title" slide and end with a "closing" slide.
- The request may begin with a TEMPLATE CAPABILITIES note listing the slide kinds THIS
  template actually supports. If present, it is AUTHORITATIVE: use ONLY the kinds it lists
  and NEVER emit a kind it excludes (e.g. don't make a "table" or "columns" slide if the
  note omits it — present that content as "content" bullets instead).
- When the template offers them, PREFER a "table" over bullets for structured data (prices, metric comparisons, schedules), and a "diagram" for a PROCESS / flow / architecture / roadmap / sequence. Include at least one "table" or "diagram" when the topic warrants it AND the template provides that layout — don't make every slide bullets.
- A "diagram"'s "mermaid" is a SMALL Mermaid diagram (≤ ~8 nodes), using a real newline (JSON \\n) between lines. Pick the fitting type: \`flowchart LR\`/\`flowchart TD\` (process/architecture), \`sequenceDiagram\` (interactions), \`timeline\` (history/roadmap), \`gantt\` (schedule), \`pie\` (proportions). Keep node labels short.
- A "table" has a short "headers" row + concise cells (a few words each); 2-5 columns, 2-6 rows.
- Each bullet is a SHORT key phrase, not a full sentence: aim for ≤ ~20 full-width
  characters (~6-8 words). Drop filler words and any trailing "。"/".". 3-5 bullets per slide.
  Bad: "情報共有の遅れによるプロジェクトの遅延が発生しています。"  Good: "情報共有の遅れ→遅延"
- Headings/labels stay short too (a few words), so they fit the placeholder.
- Use "columns" for comparisons or two/three-sided content.
- "section" is JUST a divider (title only, no body). Only use it to separate major
  parts. If a topic has actual content, use "content" with bullets — never an empty "section".
- The "closing" title is a CONCISE takeaway in ONE short line (not a single word like
  "Summary"/"まとめ", and not a long sentence that overflows).${today ? `\n- Use ${today} (or a future date) for any "date" field — never a past year.` : ""}
- Do NOT add any field not listed above, and do NOT invent other "kind" values.
- Write non-ASCII text (Japanese, etc.) DIRECTLY as UTF-8 characters. NEVER use \\uXXXX escape sequences.
- Output valid JSON only.`;
}

// ── Whole-slide Markdown edit (stage ①: content) ──
// The per-slide edit operates on the slide's Markdown — which natively holds text
// AND a diagram block — so one edit can revise the text, the diagram, or REBALANCE
// between them (the visualize lever). This is the coexistence the SlidePlan JSON
// (text-only) could not express. Round-trips via parseMd on apply.

export function slideMarkdownEditPrompt(): string {
  return `You revise ONE slide. You are given the current slide's Markdown and an instruction. Reply in the ONE format that matches the kind of change — no prose, never both formats.

Choose the format:
- Does the instruction change WHAT the slide says — text, bullets, title, or ADD / REMOVE / REBALANCE a figure? → (A) Markdown.
- Does it only change HOW an EXISTING figure is arranged — move/place it, emphasize a node, change its flow direction? → (B) a JSON array of ops.
- When in doubt, choose (A).

(A) CONTENT change — return the FULL revised slide as MARKDOWN:
- Keep the first line \`<!-- slide: LayoutName -->\` EXACTLY as given (do not delete, rename, or reorder it). If the input has none, do not add one.
- "# Title" first body line; "## Subtitle" / "> Subtitle" optional.
- An optional figure as a fenced block — keep the fence EXACTLY: a \`\`\`diagram block (YAML) or a \`\`\`mermaid block. Edit its contents only when the instruction is about the figure's CONTENT.
- "Category: …" / "Date: …" / "Footer: …" are metadata — keep them.
- Bullets are SHORT key phrases (≤ ~20 full-width chars), no trailing "。"/".".

(B) DESIGN change — return ONLY a JSON array of ops:
[ {"op":"regionSplit","arrangement":"text-left"|"text-right"|"diagram-only"},
  {"op":"emphasize","nodeId":"<an id from the figure's nodes>","level":"high"|"medium"},
  {"op":"relayout","direction":"TB"|"LR"|"RL"|"BT"} ]
- "text-left" = figure on the right, text on the left; "text-right" = figure on the left.
- Use node ids EXACTLY as they appear in the \`\`\`diagram block. Emit only the ops the instruction needs.

## 保持する不変条件（指示が明示的に変更を求めない限り厳守）
- 先頭の \`<!-- slide: LayoutName -->\` 行、\`# 見出し\`（タイトル）、\`Category:\` / \`Date:\` / \`Footer:\` のメタ行、\`<!-- card/step/kpi -->\` セパレータ、\`\`\`diagram / \`\`\`mermaid / \`\`\`（コード）フェンス・GFM 表を、指示外では**落とさない・改名しない**。スライドの骨格（見出し・セクション構造）を壊さない。
- 数値・固有名詞・％・金額・日付は**逐語**で残し、増減の向きを変えない。
- 入力の言語を保つ（翻訳指示がない限り、日本語は日本語・英語は英語のまま）。

Example (A) — instruction "本文を簡潔に":
Input:
<!-- slide: Content.1Body.Single -->
# 課題
- 情報共有の遅れによってプロジェクト全体が遅延している
Output:
<!-- slide: Content.1Body.Single -->
# 課題
- 情報共有の遅れ→全体遅延

Rules:
- Apply ONLY what the instruction asks; keep everything else as-is.
- Reply with EITHER the Markdown (A) OR the JSON array (B) — nothing else.`;
}

/**
 * Markdown-ONLY system prompt for the harness refine/condense RESIDUE (roadmap #2 P1,
 * [[inapp_ai_design]]). The dual-mode slideMarkdownEditPrompt lets the model CHOOSE
 * Markdown-or-JSON, and a small in-app model mis-picks the JSON-ops branch (Phase-0).
 * The refine loop only ever rewrites text, so this drops the (B) ops branch entirely and
 * forbids non-Markdown output. Pairs with validateCondense (the deterministic guardrail).
 */
export function slideCondensePrompt(): string {
  return `あなたはスライド整形アシスタントです。与えられた1枚のスライドの Markdown を、指示の制約に収まるよう短く整形します。

厳守事項:
- 出力は本文の Markdown のみ（"# 見出し" と "- 箇条書き"）。JSON・op・説明文・注釈は一切禁止。
- 先頭の \`<!-- slide: ... -->\` 行と "# 見出し"（タイトル）はそのまま残す（構造・骨格を壊さない）。
- 各箇条書きは指定文字数以内の短いキーフレーズに（語尾・助詞・冗長表現を削る）。
- 数値・固有名詞・パーセント・金額は絶対に削除も改変もしない（増減の向きも変えない）。
- 入力が既に制約内ならそのまま返す。
- 入力の言語を保つ（英語入力は英語のまま、日本語入力は日本語のまま。他言語へ翻訳しない）。
- 図（\`\`\`diagram / \`\`\`mermaid ブロック）・GFM 表・コードフェンスがあればそのまま残す。`;
}

/** Strip an OUTER ```markdown wrapper a model may add, preserving inner ```diagram fences. */
export function stripMarkdownFence(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:markdown|md)\s*\n([\s\S]*)\n```$/i);
  return (m ? m[1] : t).trim();
}
