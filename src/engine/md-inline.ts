/**
 * md-inline.ts — The ONE inline-markdown ⇄ InlineSegment[] mapping (R8): `**bold**`, `*italic*`,
 * `` `code` `` / `[text](url)` / `~~strike~~` (#393). Body/title/notes (md-slide-parser), table
 * cells at render time (table-ooxml / preview — #395), the serializer and the GUI field editor all
 * go through here, so no second inline parser exists. Pure logic (R2).
 *
 * Flat (non-nesting) by design, like the pre-#393 parser: each token yields one segment, a code
 * span's / link label's content is literal. Compatibility: a string with no complete new token
 * parses EXACTLY as before (bold/italic regex unchanged) — except that a `*` which pairs with
 * nothing is now kept as literal text instead of being silently dropped (no-silent-drop).
 */
import type { InlineSegment } from "./slide-schema";

/** Link targets that become a real hyperlink. Anything else keeps its `[t](x)` source literally
 *  (never a `javascript:`/relative target in the exported deck). */
const SAFE_HREF = /^(?:https?:|mailto:)/i;

/** The same scheme gate at render time (md-to-ooxml), for an `href` that reached the IR without
 *  this parser (deck JSON / MCP input). */
export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href);
}

// One alternative per token; tokens start with distinct characters, so only bold-vs-italic order
// matters (as before). `plain` excludes every token-start char; `lone` catches a token-start char
// that formed no token — it is literal text, merged into the neighbouring plain run.
const TOKEN_RE =
  /`([^`]+)`|\[([^\]]+)\]\(([^()\s]+)\)|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|([^*`[~]+)|([*`[~])/;

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let plain = "";
  const flush = () => {
    if (plain) segments.push({ text: plain });
    plain = "";
  };
  const re = new RegExp(TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [whole, code, label, href, bold, strike, italic] = m;
    if (code !== undefined) {
      flush();
      segments.push({ text: code, code: true });
    } else if (label !== undefined) {
      if (!isSafeHref(href) || text[m.index - 1] === "!") {
        // Not a link we export — or `![alt](src)` IMAGE syntax that fell through to text, which must
        // stay literal so the #148 leftover-image diagnostic still sees it: the `[` is literal,
        // rescan from the next char.
        plain += "[";
        re.lastIndex = m.index + 1;
        continue;
      }
      flush();
      segments.push({ text: label, href });
    } else if (bold !== undefined) {
      flush();
      segments.push({ text: bold, bold: true });
    } else if (strike !== undefined) {
      flush();
      segments.push({ text: strike, strike: true });
    } else if (italic !== undefined) {
      flush();
      segments.push({ text: italic, italic: true });
    } else {
      plain += whole;
    }
  }
  flush();
  return segments.length > 0 ? segments : [{ text }];
}

/** InlineSegment[] → markdown, the inverse of parseInline (round-trip: parse∘serialize∘parse =
 *  parse). Wrapping order (inner → outer): code, link, strike, bold, italic — bold-then-italic is
 *  the pre-#393 order, so existing output is unchanged. */
export function serializeInline(segments: InlineSegment[]): string {
  return segments
    .map((seg) => {
      let text = seg.text;
      if (seg.code) text = `\`${text}\``;
      if (seg.href) text = `[${text}](${seg.href})`;
      if (seg.strike) text = `~~${text}~~`;
      if (seg.bold) text = `**${text}**`;
      if (seg.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

/** The visible text of an inline-markdown string (markers removed) — what a table cell displays,
 *  used for its width / numeric-column measurement (#395). */
export function inlinePlainText(text: string): string {
  return parseInline(text).map((s) => s.text).join("");
}
