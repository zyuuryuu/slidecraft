/**
 * CollabPanel — stdio-first registration (#297). Locks:
 *  1. the connected panel's PRIMARY line is the stdio snippet (`slidecraft-mcp`), unconditionally —
 *     no url/token required to see it.
 *  2. url / token / the `--transport http` snippet render ONLY inside the collapsed "advanced" block,
 *     and are ABSENT from the default (closed) render — not just visually hidden.
 *  3. the token is masked by default inside the advanced block; a reveal toggle shows the real value.
 *  4. ja/en carry the same collabPanel.* key set (no missing translation falls back to raw key).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init side-effect → useTranslation interpolates (ja default) instead of echoing keys
import CollabPanel, { AdvancedHttp } from "../src/components/CollabPanel";
import { STDIO_SNIPPET, DESKTOP_JSON_SNIPPET, httpSnippet, maskToken } from "../src/components/collab-panel-snippets";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";

const URL = "http://127.0.0.1:54321/mcp";
const TOKEN = "s3cr3t-per-launch-token";

const connectedProps = {
  onClose: () => {},
  available: true,
  status: "connected" as const,
  url: URL,
  token: TOKEN,
  hostJsonPath: "/Users/x/.slidecraft/host.json",
  docCount: 2,
  onStart: () => {},
  onStop: () => {},
};

describe("collabPanel.* i18n key parity", () => {
  it("ja and en expose the exact same set of collabPanel keys", () => {
    expect(Object.keys(ja.collabPanel).sort()).toEqual(Object.keys(en.collabPanel).sort());
  });
});

describe("httpSnippet / maskToken (pure helpers)", () => {
  it("builds the --transport http claude mcp add command from url + token", () => {
    expect(httpSnippet(URL, TOKEN)).toBe(
      `claude mcp add --transport http slidecraft ${URL} --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it("masks a token without leaking its characters", () => {
    const masked = maskToken(TOKEN);
    expect(masked).not.toBe(TOKEN);
    expect(masked).not.toContain(TOKEN);
    expect(masked).not.toContain("s3cr3t");
  });
});

describe("CollabPanel: connected — default render", () => {
  const html = renderToStaticMarkup(<CollabPanel {...connectedProps} />);

  it("shows the stdio snippet as the primary, unconditional registration line", () => {
    expect(html).toContain(STDIO_SNIPPET);
    // SSR HTML-escapes the quotes in the attribute value, so match the escaped form.
    expect(html).toContain(DESKTOP_JSON_SNIPPET.replace(/"/g, "&quot;"));
  });

  it("does NOT render the endpoint url, the raw token, or the HTTP snippet by default", () => {
    expect(html).not.toContain(URL);
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("--transport http");
  });

  it("still renders correctly when url/token are not yet available (stdio line is unconditional)", () => {
    const html2 = renderToStaticMarkup(<CollabPanel {...connectedProps} url={undefined} token={undefined} />);
    expect(html2).toContain(STDIO_SNIPPET);
  });
});

describe("AdvancedHttp: the folded HTTP-direct disclosure", () => {
  it("renders nothing but the toggle when closed", () => {
    const html = renderToStaticMarkup(
      <AdvancedHttp open={false} onToggle={() => {}} url={URL} token={TOKEN} hostJsonPath="/x/host.json" />,
    );
    expect(html).not.toContain(URL);
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("--transport http");
  });

  it("reveals url + masked token + the http snippet when open", () => {
    const html = renderToStaticMarkup(
      <AdvancedHttp open onToggle={() => {}} url={URL} token={TOKEN} hostJsonPath="/x/host.json" />,
    );
    expect(html).toContain(URL);
    expect(html).toContain("--transport http");
    // token itself stays masked until the user clicks reveal — even inside the opened block
    expect(html).not.toContain(TOKEN);
    expect(html).toContain(maskToken(TOKEN));
  });
});
