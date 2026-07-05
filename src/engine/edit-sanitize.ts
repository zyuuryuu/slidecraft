/**
 * edit-sanitize.ts — deterministic cleanup of a weak model's slide-EDIT output (the offline floor
 * of [[product_philosophy_harness]]).
 *
 * A small offline model (phi-3.5) reliably leaks meta-chatter into a slide edit even though the
 * prompt forbids it (reproduced via Ollama): the dual-mode "(A)/(B)" format-choice LABEL at the
 * top, an echoed "Instruction: …" line copied from the user turn, and a trailing parenthetical
 * PROSE note ("(Note: …)"). None of that is slide content — strip it BEFORE the reconcile/diff so
 * the harness (ai-validate / ai-reconcile) sees the slide, not the chatter. Prompt hardening can't
 * fix this on a 3.8B model; the harness must.
 */
export function sanitizeSlideEditOutput(md: string): string {
  let s = md.trim();
  // 1) Leading dual-mode format-choice label on the FIRST line: "A)" / "B)" / "(A) CONTENT change — …".
  //    The <!-- slide --> header starts with "<", so it is never matched.
  s = s.replace(/^\(?[AB]\)(?:[ \t][^\n]*)?\n+/, "");
  // 2) Echoed "Instruction: …" line(s) the model copies from the user turn (plain or as a heading).
  s = s.replace(/^[ \t]*#{0,6}[ \t]*Instruction[ \t]*[:：][^\n]*\n?/gim, "");
  // 3) Trailing prose note (EN/JA) — a parenthetical or "Note:" block running to end-of-output.
  s = s.replace(/\n+\(\s*(?:Note|注記?|The |As |I['’]|Since |This )[\s\S]*$/i, "");
  s = s.replace(/\n+(?:Note|注記?)[ \t]*[:：][\s\S]*$/i, "");
  return s.trim();
}
