/**
 * collab-approval-ui.test.tsx — #727 (ADR-0040 D1/D3) GUI side, rendered with react-dom/server (no DOM):
 *  1. editLocked follows "an allowed AI has started calling" (aiActive), NOT "the host is running" — the
 *     always-on host must not lock the GUI from launch (ADR-0040 D1).
 *  2. noticeSlotPlan: the approval count is a notice of its own, shown first (the AI is waiting on it).
 *  3. The approval dialog names the client + version + ID fingerprint and offers 許可 / 拒否 /
 *     この起動中はすべて拒否; closing it is a denial (default deny).
 *  4. The 協働 panel: "停止" while running, "再開" once stopped (no extra always-visible button), and the
 *     allowed-clients list folded into one line with a revoke per row.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import { collabEditLocked } from "../src/components/collab-lock";
import { noticeSlotPlan } from "../src/components/notice-slot-plan";
import NoticeSlot from "../src/components/NoticeSlot";
import CollabApprovalDialog from "../src/components/CollabApprovalDialog";
import CollabPanel, { ClientGrantList } from "../src/components/CollabPanel";

const noop = () => {};

describe("editLocked: the host running is not collaborating (D1)", () => {
  it("connected host + no allowed AI call yet → the GUI keeps editing", () => {
    expect(collabEditLocked({ status: "connected", aiActive: false })).toBe(false);
  });
  it("an allowed AI has called → locked", () => {
    expect(collabEditLocked({ status: "connected", aiActive: true })).toBe(true);
  });
  it("host stopped / starting / failed → never locked", () => {
    for (const status of ["idle", "connecting", "error"] as const) expect(collabEditLocked({ status, aiActive: true })).toBe(false);
  });
});

describe("noticeSlotPlan: approval waiting is a notice, shown first", () => {
  it("approval outranks adjust / intake / update and the others stay hidden in order", () => {
    expect(noticeSlotPlan({ approval: true, adjusting: true, intake: true, update: true })).toEqual({ shown: "approval", hidden: ["adjust", "intake", "update"] });
  });
  it("without approval the #613 order is unchanged", () => {
    expect(noticeSlotPlan({ approval: false, adjusting: false, intake: true, update: true })).toEqual({ shown: "intake", hidden: ["update"] });
  });
  it("NoticeSlot draws the approval band with the waiting count (agreement with the plan)", () => {
    const html = renderToStaticMarkup(<NoticeSlot approval={{ count: 2 }} update={{ latestVersion: "9.9.9", onDismiss: noop }} intake={{ busy: null, result: null, onDismiss: noop }} adjust={null} />);
    expect(html).toContain('data-notice="approval"');
    expect(html).toContain(ja.collabApproval.bandWaiting.replace("{{count}}", "2"));
    expect(html).toMatch(/data-testid="notice-slot-hidden"[^>]*>\+1</);
  });
  it("count 0 → no approval band", () => {
    const html = renderToStaticMarkup(<NoticeSlot approval={{ count: 0 }} update={null} intake={{ busy: null, result: null, onDismiss: noop }} adjust={null} />);
    expect(html).toBe("");
  });
});

describe("CollabApprovalDialog (D3-2)", () => {
  const req = { requestId: "r1", name: "Claude Desktop", version: "1.0.3", fingerprint: "cid-0123", kind: "adapter" as const };

  it("names the client, its version and the ID fingerprint, with 許可 / 拒否 / この起動中はすべて拒否", () => {
    const html = renderToStaticMarkup(<CollabApprovalDialog request={req} waiting={1} onDecide={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Claude Desktop");
    expect(html).toContain("1.0.3");
    expect(html).toContain("cid-0123");
    for (const k of ["allow", "deny", "denyAll"] as const) expect(html).toContain(ja.collabApproval[k]);
  });

  it("the default (focused) answer is 拒否", () => {
    const html = renderToStaticMarkup(<CollabApprovalDialog request={req} waiting={1} onDecide={noop} />);
    expect(html).toMatch(new RegExp(`<button[^>]*data-default="true"[^>]*>${ja.collabApproval.deny}<`));
  });

  it("renders nothing when no request is waiting", () => {
    expect(renderToStaticMarkup(<CollabApprovalDialog request={null} waiting={0} onDecide={noop} />)).toBe("");
  });

  it("an HTTP-direct request says its fingerprint is the session's", () => {
    const html = renderToStaticMarkup(<CollabApprovalDialog request={{ ...req, kind: "session" }} waiting={1} onDecide={noop} />);
    expect(html).toContain(ja.collabApproval.fingerprintSession.replace("{{fp}}", "cid-0123"));
  });
});

describe("協働 panel: 停止 / 再開 and the allowed-clients list (D1 / D3-5)", () => {
  const base = { onClose: noop, available: true, docCount: 0, onStart: noop, onStop: noop };

  it("running and waiting for an AI: says so, offers 停止 only", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} status="connected" aiActive={false} url="http://127.0.0.1:1/mcp" token="t" />);
    expect(html).toContain(ja.collabPanel.waitingForAi);
    expect(html).toContain(ja.collabPanel.stopButton);
    expect(html).not.toMatch(new RegExp(`>${ja.collabPanel.startButton}</button>`)); // no 再開 button (the intro may mention it)
  });

  it("stopped: offers 再開 (the old 協働を開始 is gone)", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} status="idle" />);
    expect(ja.collabPanel.startButton).toBe("再開");
    expect(html).toMatch(new RegExp(`>${ja.collabPanel.startButton}</button>`));
    expect(html).not.toContain("協働を開始");
  });

  it("the allowed-clients list is one folded line by default (no rows, no revoke buttons)", () => {
    const grants = [{ key: "k1", name: "Cursor", version: "1", fingerprint: "sid-abcd", kind: "session" as const }];
    const html = renderToStaticMarkup(<ClientGrantList open={false} onToggle={noop} grants={grants} onRevoke={noop} />);
    expect(html).toContain(ja.collabPanel.grantsSummary.replace("{{count}}", "1"));
    expect(html).not.toContain(ja.collabPanel.revoke);
  });

  it("opened, each allowed client has its own 取り消し", () => {
    const grants = [
      { key: "k1", name: "Cursor", version: "1", fingerprint: "sid-abcd", kind: "session" as const },
      { key: "k2", name: "Claude Desktop", version: "2", fingerprint: "cid-0123", kind: "adapter" as const },
    ];
    const html = renderToStaticMarkup(<ClientGrantList open onToggle={noop} grants={grants} onRevoke={noop} />);
    expect(html.split(ja.collabPanel.revoke).length - 1).toBe(2);
    expect(html).toContain("cid-0123");
  });

  it("ja / en carry the same collabApproval keys", () => {
    expect(Object.keys(en.collabApproval).sort()).toEqual(Object.keys(ja.collabApproval).sort());
  });
});
