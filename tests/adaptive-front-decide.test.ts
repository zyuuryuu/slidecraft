/**
 * adaptive-front-decide.test.ts — #728 (ADR-0040 D2): the adapter's state transitions as PURE decisions, and the
 * host.json watch that pings only when the file's content (url + startedAt) changed.
 *
 * The four transitions of the Issue's acceptance criteria:
 *  1. solo, no deck + a live host       → attach (then forward that call)
 *  2. solo, deck open + a live host     → stay solo, with the "close your deck" note
 *  3. forward + the host vanished       → solo (no deck), with the "host lost" note
 *  4. forward + another host took over  → attach to the NEW host
 */
import { describe, it, expect } from "vitest";
import { decideSoloCall, decideHostLost, hostKey, HostWatch, frontNoteText } from "../src/mcp/front-decide";
import type { HostHandshake } from "../src/mcp/host-json";

const H1: HostHandshake = { url: "http://127.0.0.1:5001/mcp", token: "t1", pid: 1, startedAt: "2026-11-23T00:00:00.000Z" };
const H2: HostHandshake = { url: "http://127.0.0.1:5002/mcp", token: "t2", pid: 2, startedAt: "2026-11-23T01:00:00.000Z" };

describe("state transitions (ADR-0040 D2 table)", () => {
  it("1. solo without a deck + a live host → attach to it", () => {
    expect(decideSoloCall({ soloHasDeck: false, live: H1 })).toEqual({ kind: "attach", host: H1 });
  });

  it("2. solo with a deck + a live host → stay solo, note tells how to connect (never carries the deck over)", () => {
    expect(decideSoloCall({ soloHasDeck: true, live: H1 })).toEqual({ kind: "solo", note: "host-found-deck-open" });
  });

  it("3. forward + the host is gone (host.json missing, or still the dead one) → solo, note", () => {
    expect(decideHostLost(null, H1)).toEqual({ kind: "solo", note: "host-lost" });
    expect(decideHostLost(H1, H1)).toEqual({ kind: "solo", note: "host-lost" });
  });

  it("4. forward + a new host replaced the old one → attach to the new one", () => {
    expect(decideHostLost(H2, H1)).toEqual({ kind: "attach", host: H2 });
  });

  it("solo with no host → solo, no note (the no-host behaviour stays as it was)", () => {
    expect(decideSoloCall({ soloHasDeck: false, live: null })).toEqual({ kind: "solo" });
    expect(decideSoloCall({ soloHasDeck: true, live: null })).toEqual({ kind: "solo" });
  });

  it("a host launch that denied this adapter is not asked again (D3-3: keep working solo)", () => {
    expect(decideSoloCall({ soloHasDeck: false, live: H1, deniedKey: hostKey(H1) })).toEqual({ kind: "solo" });
    // a NEW launch of the GUI forgets the denial (the host remembers it only for its own launch)
    expect(decideSoloCall({ soloHasDeck: false, live: H2, deniedKey: hostKey(H1) })).toEqual({ kind: "attach", host: H2 });
  });

  it("hostKey is the launch identity: url + startedAt (the token is not part of it)", () => {
    expect(hostKey(H1)).toBe(hostKey({ ...H1, token: "other", pid: 99 }));
    expect(hostKey(H1)).not.toBe(hostKey({ ...H1, startedAt: "2026-11-23T02:00:00.000Z" }));
  });
});

describe("HostWatch — ping only when host.json's content changed", () => {
  const watch = (files: (HostHandshake | null)[], alive: (h: HostHandshake) => boolean) => {
    let i = 0;
    const pings: string[] = [];
    const w = new HostWatch(
      () => files[Math.min(i++, files.length - 1)],
      async (h) => {
        pings.push(h.url);
        return alive(h);
      },
    );
    return { w, pings };
  };

  it("an unchanged stale host.json is pinged once, not on every call", async () => {
    const { w, pings } = watch([H1], () => false);
    for (let k = 0; k < 5; k++) expect(await w.live()).toBeNull();
    expect(pings).toEqual([H1.url]);
  });

  it("an unchanged live host.json is pinged once and stays live", async () => {
    const { w, pings } = watch([H1], () => true);
    for (let k = 0; k < 3; k++) expect(await w.live()).toEqual(H1);
    expect(pings).toHaveLength(1);
  });

  it("a changed content (new launch) is pinged again", async () => {
    const { w, pings } = watch([H1, H1, H2, H2], (h) => h === H2);
    expect(await w.live()).toBeNull();
    expect(await w.live()).toBeNull();
    expect(await w.live()).toEqual(H2);
    expect(await w.live()).toEqual(H2);
    expect(pings).toEqual([H1.url, H2.url]);
  });

  it("no host.json → null without a ping; the same file reappearing is pinged again", async () => {
    const { w, pings } = watch([H1, null, H1], () => true);
    expect(await w.live()).toEqual(H1);
    expect(await w.live()).toBeNull();
    expect(await w.live()).toEqual(H1);
    expect(pings).toHaveLength(2);
  });

  it("markDead: a host that stopped answering is not reported live again until host.json changes", async () => {
    const { w, pings } = watch([H1, H1, H1, H2], () => true);
    expect(await w.live()).toEqual(H1);
    w.markDead(H1);
    expect(await w.live()).toBeNull();
    expect(await w.live()).toBeNull();
    expect(await w.live()).toEqual(H2);
    expect(pings).toEqual([H1.url, H2.url]);
  });
});

describe("note texts (what the AI reads)", () => {
  it("deck open: names close_document and the docId to pass", () => {
    const t = frontNoteText("host-found-deck-open", { docId: "doc-123" });
    expect(t).toContain("GUI の協働ホストが見つかりました");
    expect(t).toContain("close_document");
    expect(t).toContain("doc-123");
  });
  it("host lost: says the adapter is solo again and the GUI deck is not here", () => {
    expect(frontNoteText("host-lost", {})).toContain("単独");
  });
});
