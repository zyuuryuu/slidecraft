/**
 * collab-release.test.ts — #733 review: when the deck projection fails (onStatus "error"), useCollab must release
 * the approval channel TOGETHER with the projection. Before the fix only projRef was cleared, so the next start()
 * (it only checks projRef) made a new channel and the old one kept polling list_client_approvals forever.
 * `releaseCollab` is the one teardown useCollab uses on error / stop / unmount (no DOM here: node environment).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabApprovals } from "../src/ipc/collab-approvals";
import { releaseCollab } from "../src/components/collab-release";

let host: CollabHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("releaseCollab", () => {
  it("clears BOTH refs and stops both (a failing stop is swallowed)", async () => {
    const stopped: string[] = [];
    const proj = { current: { stop: async () => { stopped.push("proj"); throw new Error("already closed"); } } };
    const chan = { current: { stop: async () => { stopped.push("chan"); } } };
    await releaseCollab(proj, chan);
    expect(proj.current).toBeNull();
    expect(chan.current).toBeNull();
    expect(stopped.sort()).toEqual(["chan", "proj"]);
  });

  it("with the projection already gone (it tore itself down on error), the channel is still released", async () => {
    let chanStops = 0;
    const proj = { current: null };
    const chan = { current: { stop: async () => { chanStops++; } } };
    await releaseCollab(proj, chan);
    expect(chan.current).toBeNull();
    expect(chanStops).toBe(1);
  });

  it("a released approval channel stops polling the host (no zombie poll across a re-start)", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null });
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      if (typeof init?.body === "string" && init.body.includes("list_client_approvals")) calls++;
      return fetch(input, init);
    };
    const old = new CollabApprovals({ url: host.url, guiToken: host.guiToken, fetch: counting, pollMs: 15, onView: () => {}, onAiActive: () => {} });
    await old.start();
    await sleep(60);
    expect(calls).toBeGreaterThan(1); // it polls while alive
    const proj = { current: null }; // the projection failed and cleared itself
    const chan: { current: CollabApprovals | null } = { current: old };
    await releaseCollab(proj, chan);
    // the hook's re-start now sees an empty chanRef and makes a fresh channel; the old one must be silent
    const fresh = new CollabApprovals({ url: host.url, guiToken: host.guiToken, pollMs: 0, onView: () => {}, onAiActive: () => {} });
    chan.current = fresh;
    await fresh.start();
    await sleep(30);
    const after = calls;
    await sleep(80);
    expect(calls).toBe(after);
    await fresh.stop();
  });
});
