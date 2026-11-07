/**
 * default-master-startup.test.ts — #117（統括裁定 A-1）: 起動時の既定テンプレの読み込み経路。
 *
 * - 既定は出荷テンプレの先頭（技術報告 スタンダード水色）。Midnight は入力サンプル（samples/templates/）へ移り、
 *   ビルトインではない。
 * - 起動時の読み込みはマスターレジストリ（getBytes）経由の 1 本だけ。テンプレの URL は
 *   useMasterRegistry.ts の BUILTIN_MASTERS にしか書かない（R8：URL の二重定義を置かない）。
 * - 読み込みに失敗したら通知を出す（never-silent。旧経路の `.catch(() => {})` を廃止）。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadDefaultMaster } from "../src/components/default-master";
import { BUILTIN_MASTER, BUILTIN_MASTERS } from "../src/components/useMasterRegistry";

const SRC = resolve(__dirname, "../src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("起動時の既定テンプレはレジストリ経由で読む（#117 A-1）", () => {
  it("既定は 技術報告 スタンダード水色（出荷テンプレの先頭）で、Midnight はビルトインに無い", () => {
    expect(BUILTIN_MASTER).toMatchObject({ id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true });
    expect(BUILTIN_MASTERS.some((b) => /Midnight/i.test(b.name) || /Midnight/i.test(b.url))).toBe(false);
  });

  it("loadDefaultMaster は既定マスターの bytes を getBytes で取り、その名前で適用する", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const getBytes = vi.fn(async () => bytes);
    const apply = vi.fn(async () => ({ ok: true }));
    const notify = vi.fn();
    const r = await loadDefaultMaster({ getBytes, apply, notify });
    expect(r).toEqual({ ok: true, id: BUILTIN_MASTER.id });
    expect(getBytes).toHaveBeenCalledWith(BUILTIN_MASTER.id);
    expect(apply).toHaveBeenCalledWith(bytes, BUILTIN_MASTER.name);
    expect(notify).not.toHaveBeenCalled();
  });

  it("テンプレの URL（/templates/slide/）は useMasterRegistry.ts にしか書かれていない（二重定義なし）", () => {
    const hits = walk(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("/templates/slide/"))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"));
    expect(hits).toEqual(["components/useMasterRegistry.ts"]);
  });
});

describe("既定テンプレの読み込み失敗は通知する（never-silent・#117 A-1）", () => {
  it("getBytes が失敗したら notify を呼び、適用はしない", async () => {
    const getBytes = vi.fn(async () => { throw new Error("HTTP 404"); });
    const apply = vi.fn(async () => ({ ok: true }));
    const notify = vi.fn();
    const r = await loadDefaultMaster({ getBytes, apply, notify });
    expect(r).toMatchObject({ ok: false, stage: "fetch" });
    expect(apply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    const msg = notify.mock.calls[0][0] as string;
    expect(msg).toContain(BUILTIN_MASTER.name);
    expect(msg).toContain("HTTP 404");
  });

  it("適用（受け入れゲート）が拒否したら notify を呼ぶ", async () => {
    const getBytes = vi.fn(async () => new Uint8Array([1]));
    const apply = vi.fn(async () => ({ ok: false }));
    const notify = vi.fn();
    const r = await loadDefaultMaster({ getBytes, apply, notify });
    expect(r).toMatchObject({ ok: false, stage: "apply" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0] as string).toContain(BUILTIN_MASTER.name);
  });
});
