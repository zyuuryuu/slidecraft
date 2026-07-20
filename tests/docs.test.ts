/**
 * docs.test.ts — Help/? → docs site (issue #114). Dual-mode IPC (ADR-0001): desktop uses the
 * Tauri opener plugin (scoped to the docs host — ADR-0010), browser/dev falls back to
 * window.open. Never-silent: when neither path can actually open the URL, the caller must
 * still learn the docs URL to show the user (never returns success without truly opening).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock("../src/ipc/commands", () => ({ runningInTauri: vi.fn() }));

import { runningInTauri } from "../src/ipc/commands";
import { openDocs, DOCS_URL } from "../src/ipc/docs";

const onDesktop = (yes: boolean) => vi.mocked(runningInTauri).mockReturnValue(yes);

beforeEach(() => {
  openUrl.mockReset();
  vi.mocked(runningInTauri).mockReset();
});

describe("openDocs — desktop", () => {
  it("opens the docs URL via the Tauri opener plugin", async () => {
    onDesktop(true);
    openUrl.mockResolvedValue(undefined);
    const result = await openDocs();
    expect(openUrl).toHaveBeenCalledWith(DOCS_URL);
    expect(result).toEqual({ opened: true, url: DOCS_URL });
  });

  it("never-silent: opener rejection still reports the URL instead of throwing", async () => {
    onDesktop(true);
    openUrl.mockRejectedValue(new Error("opener unavailable"));
    const result = await openDocs();
    expect(result).toEqual({ opened: false, url: DOCS_URL });
  });
});

describe("openDocs — browser/dev fallback", () => {
  it("opens the docs URL via window.open", async () => {
    onDesktop(false);
    const windowOpen = vi.fn().mockReturnValue({});
    vi.stubGlobal("window", { open: windowOpen });
    const result = await openDocs();
    expect(windowOpen).toHaveBeenCalledWith(DOCS_URL, "_blank", "noopener,noreferrer");
    expect(result).toEqual({ opened: true, url: DOCS_URL });
    vi.unstubAllGlobals();
  });

  it("never-silent: a blocked popup (window.open returns null) still reports the URL", async () => {
    onDesktop(false);
    vi.stubGlobal("window", { open: vi.fn().mockReturnValue(null) });
    const result = await openDocs();
    expect(result).toEqual({ opened: false, url: DOCS_URL });
    vi.unstubAllGlobals();
  });

  it("never-silent: no window at all (headless) still reports the URL", async () => {
    onDesktop(false);
    const result = await openDocs();
    expect(result).toEqual({ opened: false, url: DOCS_URL });
  });
});
