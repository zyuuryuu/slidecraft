/**
 * CollabRegistration / CollabPanel (#520). Locks:
 *  1. the registration block renders in EVERY panel state — browser (unavailable), desktop idle, connected —
 *     because registering is independent of the connection (ADR-0033); the e2e reaches it in the browser.
 *  2. the primary "Claude Code に登録" action exists and the command it copies is the one shown in the field
 *     (never-silent: nothing is hidden, nothing is executed).
 *  3. before the install lookup resolves (SSR / first paint) the launcher form is shown — never a half path.
 *  4. the browser-mode lookup reports `browser` (no fake paths), so the panel can say why it is generic.
 *  5. ja/en both carry the new collabPanel keys (parity is locked in collab-panel-stdio-front.test.tsx).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n";
import CollabPanel from "../src/components/CollabPanel";
import CollabRegistration from "../src/components/CollabRegistration";
import { STDIO_SNIPPET, DESKTOP_JSON_SNIPPET } from "../src/components/collab-panel-snippets";
import { lookupMcpInstall } from "../src/ipc/mcp-install";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";

const base = {
  onClose: () => {},
  available: true,
  status: "idle" as const,
  docCount: 0,
  onStart: () => {},
  onStop: () => {},
};

const esc = (s: string) => s.replace(/"/g, "&quot;");

describe("CollabPanel: the registration block is reachable in every state", () => {
  it("browser / unavailable: still shows the registration command + register button", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} available={false} />);
    expect(html).toContain(STDIO_SNIPPET);
    expect(html).toContain(esc(DESKTOP_JSON_SNIPPET));
    expect(html).toContain(ja.collabPanel.registerClaudeCode);
  });

  it("desktop idle (before 開始): shows the registration block next to the start button", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} />);
    expect(html).toContain(ja.collabPanel.startButton);
    expect(html).toContain(STDIO_SNIPPET);
    expect(html).toContain(ja.collabPanel.registerClaudeCode);
  });

  it("connected: registration block + the stop button, and the HTTP block stays folded", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} status="connected" url="http://127.0.0.1:1/mcp" token="tok" />);
    expect(html).toContain(STDIO_SNIPPET);
    expect(html).toContain(ja.collabPanel.stopButton);
    expect(html).not.toContain("--transport http");
  });
});

describe("CollabRegistration: first paint (lookup unresolved)", () => {
  const html = renderToStaticMarkup(<CollabRegistration />);

  it("shows the launcher form — never a partially-built path — and no source hint yet", () => {
    expect(html).toContain(STDIO_SNIPPET);
    expect(html).toContain(esc(DESKTOP_JSON_SNIPPET));
    expect(html).not.toContain(ja.collabPanel.pathsBrowserHint);
    expect(html).not.toContain("node.exe");
  });

  it("the mcp.json fragment is folded by default and labelled", () => {
    expect(html).toContain(ja.collabPanel.mcpJsonLabel);
    expect(html).not.toContain("mcpServers");
  });

  it("no copied/failed notice before the user acts", () => {
    expect(html).not.toContain(ja.collabPanel.registerCopiedNotice);
    expect(html).not.toContain(ja.collabPanel.copyFailedNotice);
  });
});

describe("lookupMcpInstall (ipc, dual-mode)", () => {
  it("reports `browser` outside Tauri instead of inventing paths", async () => {
    expect(await lookupMcpInstall()).toEqual({ kind: "browser" });
  });
});

describe("i18n: the #520 keys exist in both locales with their placeholders", () => {
  const keys = ["registerClaudeCode", "registerCopiedNotice", "copyFailedNotice", "mcpJsonLabel", "pathsLauncherHint", "pathsRealHint", "pathsBrowserHint", "pathsErrorHint"] as const;
  it.each(keys)("%s is a non-empty string in ja and en", (k) => {
    expect(typeof ja.collabPanel[k]).toBe("string");
    expect(ja.collabPanel[k].length).toBeGreaterThan(0);
    expect(typeof en.collabPanel[k]).toBe("string");
    expect(en.collabPanel[k].length).toBeGreaterThan(0);
  });
  it("interpolation placeholders match across locales", () => {
    for (const k of ["pathsLauncherHint", "pathsRealHint", "pathsErrorHint"] as const) {
      const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
      expect(ph(en.collabPanel[k])).toEqual(ph(ja.collabPanel[k]));
      expect(ph(ja.collabPanel[k]).length).toBeGreaterThan(0);
    }
  });
});
