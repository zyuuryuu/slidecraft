/**
 * host-seed.ts — #727 (ADR-0040 D1): "the host is running" ≠ "collaborating". The always-on host starts empty;
 * the GUI declares it has a deck to load ("pending") and loads it (seed) only when an ALLOWED AI makes its
 * first tool call — that same moment is when the GUI locks its structural edits (editLocked). Until the seed
 * finishes, an allowed AI's call is held briefly; if it does not finish in time the call returns
 * `host-not-ready` (never an empty host the AI would read as "the GUI has no deck"). A FAILED seed lets calls
 * through but says so in `note` (never-silent). A GUI that never declares a seed ("none") gates nothing.
 * Pure (no transport) — tests/host-approval-http.test.ts drives it through the live host.
 */
import { GuardError } from "./guard-errors";

export type SeedState = "none" | "pending" | "done" | "failed";

export class SeedGate {
  private state: SeedState = "none";
  private error: string | undefined;
  private active = false;
  private waiters: (() => void)[] = [];
  private readonly onActivate: (seedRequested: boolean) => void;

  /** `onActivate(seedRequested)` fires once, at the first allowed AI call — the host tells the GUI. */
  constructor(onActivate: (seedRequested: boolean) => void) {
    this.onActivate = onActivate;
  }

  /** The GUI's report: "pending" (I have a deck to load on demand), then "done" or "failed". */
  report(state: SeedState, error?: string): void {
    this.state = state;
    this.error = state === "failed" ? error : undefined;
    if (state === "done" || state === "failed") for (const w of this.waiters.splice(0)) w();
  }

  /** An allowed AI has made a tool call (= the GUI should be collaborating / edit-locked). */
  get aiActive(): boolean {
    return this.active;
  }

  /** Admit an allowed AI's call: undefined = go, a string = go with this note, throw = host-not-ready. */
  async admit(waitMs: number): Promise<string | undefined> {
    if (!this.active) {
      this.active = true;
      this.onActivate(this.state === "pending");
    }
    if (this.state === "pending") await this.waitSettled(waitMs);
    if (this.state === "pending") {
      throw new GuardError("SlideCraft の GUI が deck をホストに載せている途中です。数秒待ってから同じ呼び出しをやり直してください。", "host-not-ready");
    }
    if (this.state === "failed") {
      return `GUI の deck をホストに載せられませんでした${this.error ? `（${this.error}）` : ""}。GUI で開いている deck はこの接続からは見えません。`;
    }
    return undefined;
  }

  private waitSettled(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve();
      }, ms);
      this.waiters.push(done);
    });
  }
}
