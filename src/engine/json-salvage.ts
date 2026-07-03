/**
 * json-salvage.ts — Tolerant JSON parsing for imperfect LLM output.
 *
 * Small / local models (e.g. an 8B via Ollama) routinely emit JSON with subtle
 * faults. The one that bit per-slide AI edits is a MALFORMED \uXXXX escape while
 * escaping Japanese — a single bad escape makes strict JSON.parse reject the
 * ENTIRE response. Adversarial red-teaming surfaced a wider family of small-model
 * faults; this module repairs the well-understood ones and retries. Valid JSON is
 * NEVER altered (the strict parse is tried first), and no unpaired UTF-16
 * surrogate is ever returned (those would later break OOXML/PPTX serialization).
 *
 * Pure logic (R2): no DOM / Tauri.
 */

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

// ── String-aware helper: transform only the text OUTSIDE double-quoted strings ──

/** Apply `fn` to runs of text that are outside JSON string literals (escapes respected). */
function mapOutsideStrings(s: string, fn: (chunk: string) => string): string {
  let out = "";
  let buf = "";
  let inStr = false;
  let esc = false;
  const flush = () => {
    if (buf) {
      out += fn(buf);
      buf = "";
    }
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      flush();
      out += ch;
      inStr = true;
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

// ── Individual repairs (each leaves valid JSON unchanged) ──

// Ordered alternation (JS regex takes the FIRST matching alt at each position):
//  1. a COMPLETE \uXXXX  2. a TRUNCATED/malformed \u (0–3 hex)  3. another valid escape  4. a lone backslash.
const ESCAPE_OR_STRAY = /\\u[0-9a-fA-F]{4}|\\u[0-9a-fA-F]{0,3}|\\["\\/bfnrt]|\\/g;

/**
 * Repair backslash faults so the string parses. A truncated `\uXXXX` (e.g. `\u30c`) names a character
 * the model never finished emitting — it is UNRECOVERABLE, so it becomes U+FFFD (`�`), the same marker
 * used for lone surrogates, instead of the literal "u30c" garbage it used to leave in slides (#12-5).
 * Valid escapes are untouched; a lone stray backslash is doubled so it survives as literal.
 */
export function repairEscapes(s: string): string {
  return s.replace(ESCAPE_OR_STRAY, (m) => {
    if (/^\\u[0-9a-fA-F]{4}$/.test(m)) return m; // complete \uXXXX — keep
    if (m.startsWith("\\u")) return "�"; // truncated/malformed \u — unrecoverable
    if (m.length > 1) return m; // \" \\ \/ \b\f\n\r\t — keep
    return "\\\\"; // lone backslash — double it
  });
}

/** Drop trailing commas before a closing } or ] (outside strings). */
export function removeTrailingCommas(s: string): string {
  return mapOutsideStrings(s, (c) => c.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Insert MISSING commas between adjacent values (a frequent small-model fault:
 * `"a": "x" "b": "y"` or `} {`). String-aware: a comma is inserted only when a
 * complete value just ended (closing `"`, `}`, `]`, number, true/false/null) and a
 * NEW value/key/container begins with no separator. Valid JSON is left untouched
 * (after a value the only legal next tokens are `,` / `}` / `]`, none of which trigger it).
 */
export function insertMissingCommas(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  let afterValue = false; // a complete value just ended → a following value/key needs a comma
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') { inStr = false; afterValue = true; }
      i++; continue;
    }
    if (ch === '"') { if (afterValue) out += ","; out += ch; inStr = true; afterValue = false; i++; continue; }
    if (ch === "{" || ch === "[") { if (afterValue) out += ","; out += ch; afterValue = false; i++; continue; }
    if (ch === "}" || ch === "]") { out += ch; afterValue = true; i++; continue; }
    if (ch === "," || ch === ":") { out += ch; afterValue = false; i++; continue; }
    if (/\s/.test(ch)) { out += ch; i++; continue; }
    const lit = s.slice(i).match(/^(-?\d[\d.eE+-]*|true|false|null)/);
    if (lit) { if (afterValue) out += ","; out += lit[0]; i += lit[0].length; afterValue = true; continue; }
    out += ch; afterValue = false; i++;
  }
  return out;
}

// Unicode whitespace a model may leak between tokens — NBSP, ZWSP, the Japanese
// IME full-width space U+3000, line/para separators, BOM. JSON.parse rejects all
// of these between tokens, so normalize them to ASCII space OUTSIDE strings only
// (inside strings they're legitimate content).
const UNICODE_WS = /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085]/g;
export function normalizeWhitespace(s: string): string {
  return mapOutsideStrings(s, (c) => c.replace(UNICODE_WS, " "));
}

/** Convert single-quoted strings/keys to double-quoted (outside existing strings). */
export function convertSingleQuotes(s: string): string {
  return mapOutsideStrings(s, (c) =>
    c.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner: string) => '"' + inner.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'),
  );
}

/** Quote bare identifier object keys: {kind: → {"kind": (outside strings). */
export function quoteBareKeys(s: string): string {
  return mapOutsideStrings(s, (c) =>
    c.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3'),
  );
}

/** Python literals → JSON (whole words, outside strings). */
export function pythonLiterals(s: string): string {
  return mapOutsideStrings(s, (c) =>
    c.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null"),
  );
}

/** Strip // line and block comments (outside strings). */
export function stripComments(s: string): string {
  return mapOutsideStrings(s, (c) => c.replace(/\/\/[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""));
}

/** Escape raw control characters that appear INSIDE string literals. */
export function escapeControlChars(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (inStr && code < 0x20) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

// ── Lone-surrogate sanitization (protect downstream XML) ──

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function sanitizeStrings(v: unknown): unknown {
  if (typeof v === "string") return v.replace(LONE_SURROGATE, "�");
  if (Array.isArray(v)) return v.map(sanitizeStrings);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    // sanitize KEYS too — a lone surrogate in a key would also break XML output.
    for (const [k, val] of Object.entries(v)) o[k.replace(LONE_SURROGATE, "�")] = sanitizeStrings(val);
    return o;
  }
  return v;
}

// ── Tolerant parse (strict first, then progressive repair) ──

const REPAIRS: Array<(s: string) => string> = [
  repairEscapes,
  normalizeWhitespace,
  convertSingleQuotes,
  quoteBareKeys,
  pythonLiterals,
  stripComments,
  removeTrailingCommas,
  insertMissingCommas,
  escapeControlChars,
];

/**
 * Parse JSON, repairing common small-model faults on failure. Tries the strict
 * parse first (good output untouched), then applies repairs cumulatively, parsing
 * after each. Any unpaired UTF-16 surrogate in the result is replaced with U+FFFD.
 */
export function tolerantJsonParse(raw: string): JsonParseResult {
  let lastErr = "Invalid JSON";
  const tryParse = (s: string): JsonParseResult | null => {
    try {
      return { ok: true, value: sanitizeStrings(JSON.parse(s)) };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      return null;
    }
  };
  let cur = raw;
  let hit = tryParse(cur);
  if (hit) return hit;
  for (const fix of REPAIRS) {
    try {
      cur = fix(cur);
    } catch {
      continue;
    }
    hit = tryParse(cur);
    if (hit) return hit;
  }
  return { ok: false, error: lastErr };
}

// ── Extraction: find the JSON inside fences / prose, tolerate two-blocks/truncation ──

/** Balanced {…} or […] span starting at `start`, respecting strings; null if unbalanced. */
function balancedSpan(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Last comma OUTSIDE a string literal (for trimming a dangling truncated token). */
function lastStructuralComma(s: string): number {
  let inStr = false;
  let esc = false;
  let idx = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === ",") idx = i;
  }
  return idx;
}

/**
 * Recover a truncated tail: bracket-complete it; if that still won't parse (e.g.
 * cut mid-key / mid-value), trim back to the previous structural comma and retry,
 * dropping just the unfinished trailing item. Returns null if nothing parses.
 */
function completeTruncated(tail: string): JsonParseResult | null {
  let cur = tail;
  for (let i = 0; i < 64 && cur.length > 0; i++) {
    const r = tolerantJsonParse(completeBrackets(cur));
    if (r.ok) return r;
    const cut = lastStructuralComma(cur);
    if (cut < 0) break;
    cur = cur.slice(0, cut);
  }
  return null;
}

/** Best-effort close of a truncated span: terminate an open string, drop a dangling comma, close brackets. */
function completeBrackets(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

/**
 * Extract and parse the JSON value from raw model text — tolerating code fences,
 * prose before/after, a stray `{placeholder}` in the prose, two JSON blocks
 * (returns the first that parses), and token-limit truncation (bracket completion).
 */
export function parseJsonLoose(text: string): JsonParseResult {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;

  const starts: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{" || body[i] === "[") starts.push(i);
  }
  if (starts.length === 0) return { ok: false, error: "No JSON object found in the response." };

  let lastErr = "Invalid JSON";
  // 1. Outermost-first: a balanced span at the EARLIEST opener (a complete object,
  //    or the first of two blocks). If that opener is truncated (no balanced span),
  //    complete it — so a deck cut after a few complete bullet arrays recovers the
  //    whole deck, not just an inner array.
  const s0 = starts[0];
  const span0 = balancedSpan(body, s0);
  if (span0) {
    const r = tolerantJsonParse(span0);
    if (r.ok) return r;
    lastErr = r.error;
  } else {
    const r = completeTruncated(body.slice(s0));
    if (r) return r;
  }
  // 2. The earliest opener was junk (e.g. a prose "{placeholder}") — take the first
  //    LATER balanced span that parses.
  for (const start of starts.slice(1)) {
    const span = balancedSpan(body, start);
    if (!span) continue;
    const r = tolerantJsonParse(span);
    if (r.ok) return r;
    lastErr = r.error;
  }
  // 3. Last resort: complete from the earliest opener (prose-brace + truncation combos).
  const r = completeTruncated(body.slice(s0));
  if (r) return r;
  return { ok: false, error: lastErr };
}
