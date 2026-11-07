/**
 * #530 — the confirm dialog and the result block of the one-click "Claude Code に登録" (static render; the
 * decisions themselves are unit-tested in claude-register.test.ts). Locks:
 *  1. the confirm dialog shows the FULL command verbatim, says it writes the user-scope config, and offers
 *     run + cancel (no write without that explicit OK).
 *  2. ok → status with the exit code and the raw stdout; no copy notice.
 *  3. failure → alert with the exit code + stderr, AND the copy-fallback notice (or the copy-failed notice).
 *  4. claude missing → alert listing the searched dirs + the copy notice.
 *  5. browser → only the existing copy notice (the #520 e2e relies on exactly one status).
 *  6. ja/en carry every new key with matching placeholders.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n";
import { RegisterConfirm, RegisterResult } from "../src/components/ClaudeRegisterFlow";
import { outcomeView } from "../src/components/claude-register-view";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";

const noop = () => {};
const cmd = '"C:\\Users\\a b\\AppData\\Roaming\\npm\\claude.cmd" mcp add --scope user slidecraft -- slidecraft-mcp';
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const count = (html: string, s: string) => html.split(s).length - 1;

describe("RegisterConfirm", () => {
  const html = renderToStaticMarkup(<RegisterConfirm command={cmd} onRun={noop} onCancel={noop} busy={false} />);

  it("shows the full command verbatim inside an alertdialog", () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(esc(cmd));
    expect(html).toContain(ja.collabPanel.registerConfirmTitle);
  });

  it("offers run and cancel", () => {
    expect(html).toContain(ja.collabPanel.registerConfirmRun);
    expect(html).toContain(ja.collabPanel.registerConfirmCancel);
  });

  it("while running, the run button says so and both buttons are disabled", () => {
    const busy = renderToStaticMarkup(<RegisterConfirm command={cmd} onRun={noop} onCancel={noop} busy />);
    expect(busy).toContain(ja.collabPanel.registerRunning);
    expect(count(busy, 'disabled=""')).toBe(2);
    expect(count(html, 'disabled=""')).toBe(0);
  });
});

describe("RegisterResult", () => {
  const ran = { kind: "ran" as const, program: "/usr/bin/claude", args: [], timedOut: false };

  it("ok → status with exit code 0 and the raw stdout, no copy notice", () => {
    const html = renderToStaticMarkup(
      <RegisterResult view={outcomeView({ ...ran, exitCode: 0, stdout: "Added stdio MCP server slidecraft", stderr: "" })} copy={null} />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Added stdio MCP server slidecraft");
    expect(html).not.toContain(ja.collabPanel.registerCopiedNotice);
  });

  it("failure → alert with exit code + stderr, plus the copy-fallback notice", () => {
    const html = renderToStaticMarkup(
      <RegisterResult view={outcomeView({ ...ran, exitCode: 1, stdout: "", stderr: "MCP server slidecraft already exists" })} copy="copied" />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("MCP server slidecraft already exists");
    expect(html).toContain("stderr");
    expect(html).toContain(ja.collabPanel.registerCopiedNotice);
  });

  it("failure + clipboard blocked → the copy-failed notice instead", () => {
    const html = renderToStaticMarkup(<RegisterResult view={outcomeView({ ...ran, exitCode: 2, stdout: "", stderr: "x" })} copy="failed" />);
    expect(html).toContain(ja.collabPanel.copyFailedNotice);
    expect(html).not.toContain(ja.collabPanel.registerCopiedNotice);
  });

  it("claude missing → alert listing the searched dirs + copy notice", () => {
    const html = renderToStaticMarkup(
      <RegisterResult view={outcomeView({ kind: "claudeNotFound", searched: ["/usr/bin", "/opt/homebrew/bin"] })} copy="copied" />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("/usr/bin, /opt/homebrew/bin");
    expect(html).toContain(ja.collabPanel.registerCopiedNotice);
  });

  it("browser → exactly one status (the copy notice) and no alert", () => {
    const html = renderToStaticMarkup(<RegisterResult view={outcomeView({ kind: "browser" })} copy="copied" />);
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(ja.collabPanel.registerCopiedNotice);
  });
});

describe("i18n: the #530 keys exist in both locales with matching placeholders", () => {
  const keys = [
    "registerClaudeCodeRun", "registerConfirmTitle", "registerConfirmRun", "registerConfirmCancel", "registerRunning",
    "registerRanOk", "registerRanFailed", "registerTimedOut", "registerClaudeNotFound", "registerSpawnFailed",
    "registerIpcError", "registerExitCodeLabel",
  ] as const;
  const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
  it.each(keys)("%s", (k) => {
    expect(ja.collabPanel[k].length).toBeGreaterThan(0);
    expect(en.collabPanel[k].length).toBeGreaterThan(0);
    expect(ph(en.collabPanel[k])).toEqual(ph(ja.collabPanel[k]));
  });
});
