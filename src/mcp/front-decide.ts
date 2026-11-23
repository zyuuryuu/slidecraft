/**
 * front-decide.ts — #728 (ADR-0040 D2): the adapter's state transitions as PURE decisions, plus the host.json
 * watch that pings only when the file's content changed. The router (adaptive-front.ts) asks these in front of
 * each tool call; nothing here touches a transport, so every transition is unit-testable
 * (tests/adaptive-front-decide.test.ts).
 *
 *  | state          | a tool call arrives                                        | next          |
 *  |----------------|------------------------------------------------------------|---------------|
 *  | solo, no deck  | a live host → attach, then forward this very call          | forward       |
 *  | solo, deck     | stay solo; `note`: save the deck, then close_document      | solo          |
 *  | forward        | forward; if the host stopped answering, re-read host.json: | forward/solo  |
 *  |                | a NEW live host → attach to it; none → solo, `note`        |               |
 *
 * ONE control plane at any time (ADR-0033): while forwarding, the solo server is idle and holds no deck (the
 * adapter only switches when solo has none), so the deck can never be in two places — and never dropped.
 */
import type { HostHandshake } from "./host-json";

export type FrontNote = "host-found-deck-open" | "host-lost" | "denied-stay-solo" | "reapplied";

export type FrontStep = { kind: "solo"; note?: FrontNote } | { kind: "attach"; host: HostHandshake };

/** A host LAUNCH: url + startedAt. The token rotates with each launch, so it adds nothing here. */
export const hostKey = (h: Pick<HostHandshake, "url" | "startedAt">): string => `${h.url}\n${h.startedAt}`;

export interface SoloCallObservation {
  /** solo holds a deck (host-core.openDeckDocId — the same rule the control plane uses, R8) */
  soloHasDeck: boolean;
  /** the live host per host.json (HostWatch.live), or null */
  live: HostHandshake | null;
  /** the host launch (hostKey) that denied this adapter — the adapter keeps working solo against it (D3-3) */
  deniedKey?: string;
}

/** A tool call arrives while SOLO. */
export function decideSoloCall(obs: SoloCallObservation): FrontStep {
  if (!obs.live || obs.deniedKey === hostKey(obs.live)) return { kind: "solo" };
  if (obs.soloHasDeck) return { kind: "solo", note: "host-found-deck-open" }; // never carry a deck over
  return { kind: "attach", host: obs.live };
}

/** Forwarding to `lost` failed; `live` is what host.json says NOW. Only a different launch is worth attaching to. */
export function decideHostLost(live: HostHandshake | null, lost: HostHandshake): FrontStep {
  if (live && hostKey(live) !== hostKey(lost)) return { kind: "attach", host: live };
  return { kind: "solo", note: "host-lost" };
}

/** Reads host.json on every call, but pings only when its content (url + startedAt) differs from the last read —
 *  a stale file whose content never changes must not cost a ping timeout on every call (ADR-0040 D2). */
export class HostWatch {
  private lastKey: string | undefined;
  private lastAlive = false;

  private readonly read: () => HostHandshake | null;
  private readonly ping: (h: HostHandshake) => Promise<boolean>;

  constructor(read: () => HostHandshake | null, ping: (h: HostHandshake) => Promise<boolean>) {
    this.read = read;
    this.ping = ping;
  }

  async live(): Promise<HostHandshake | null> {
    const hs = this.read();
    if (!hs || typeof hs.url !== "string" || typeof hs.token !== "string") {
      this.lastKey = undefined;
      return null;
    }
    const key = hostKey(hs);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastAlive = await this.ping(hs);
    }
    return this.lastAlive ? hs : null;
  }

  /** The host stopped answering (or refused the attach): not live again until host.json's content changes. */
  markDead(h: HostHandshake): void {
    this.lastKey = hostKey(h);
    this.lastAlive = false;
  }
}

/** What the AI reads in the result's `note` (the only UX change of #728 — MCP return text). */
export function frontNoteText(note: FrontNote, ctx: { docId?: string }): string {
  switch (note) {
    case "host-found-deck-open":
      return `GUI の協働ホストが見つかりました。つなぐには、今の deck を保存してから close_document で閉じてください（docId: ${ctx.docId ?? "?"}。未保存のまま閉じるには force: true）。閉じた後の呼び出しから GUI につながります。`;
    case "host-lost":
      return "GUI の協働ホストとの接続が切れたため、この AI アプリの中の単独モードに戻りました（deck なし）。GUI で開いていた deck はここにはありません。GUI を起動し直すと、次の呼び出しで自動的につながります。";
    case "denied-stay-solo":
      return "この AI アプリの中の単独モードで動き続けます（GUI の deck とはつながっていません）。GUI を起動し直すと、もう一度接続を申し込みます。";
    case "reapplied":
      return "接続の許可を申し込み直しました。SlideCraft の GUI で許可してから、呼び出しをやり直してください。";
  }
}
