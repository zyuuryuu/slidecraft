/**
 * mirror-cask.test.ts — Issue #288: 正典 cask（packaging/homebrew/Casks/slidecraft.rb）を
 * tap リポ `zyuuryuu/homebrew-slidecraft` の `Casks/slidecraft.rb` へミラーする差分生成。
 *
 * push 自体は CI（.github/workflows/cask-mirror.yml）の実走でしか確認できないので、ここでは
 * 「tap に何を書くか」を決める純関数 `planTapUpdate` と、その CLI の dry-run（書かない）／
 * 実書込み（正典と byte-identical）を固定する。壊れた cask・ダウングレードはミラーしない
 * （never-silent: ok=false と理由を返し、CLI は exit 1）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planTapUpdate } from "../scripts/mirror-cask.mjs";
import { compareVersions } from "../scripts/update-cask.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/mirror-cask.mjs", import.meta.url));
const CANONICAL = fileURLToPath(new URL("../packaging/homebrew/Casks/slidecraft.rb", import.meta.url));

const OLD_SHA = "6f3ddbc0f2a1e8c9d7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4";
const NEW_SHA = "a5a2d4ffee85b67975c3a93dce537e202203d19d9d1a6d8be5db11715aef3113";

const cask = (version: string, sha: string) => `cask "slidecraft" do
  version "${version}"
  sha256 "${sha}"

  url "https://github.com/zyuuryuu/slidecraft/releases/download/v#{version}/SlideCraft_#{version}_aarch64.dmg"
  app "SlideCraft.app"
end
`;

describe("compareVersions (shared with update-cask's launcher guard — R8)", () => {
  it("orders semver components numerically, tolerating a leading v and missing parts", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.5.0", "0.5.0")).toBe(0);
    expect(compareVersions("0.5", "0.5.0")).toBe(0);
    expect(compareVersions("0.4.9", "0.5.0")).toBeLessThan(0);
  });

  it("returns NaN for a non-numeric version so callers can fail closed", () => {
    expect(compareVersions("abc", "0.5.0")).toBeNaN();
  });
});

describe("planTapUpdate — what the tap's Casks/slidecraft.rb becomes", () => {
  it("a tap with no cask yet → changed, content is the canonical cask byte-for-byte", () => {
    const canonical = cask("0.5.0", NEW_SHA);
    const plan = planTapUpdate(canonical, null);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed).toBe(true);
    expect(plan.content).toBe(canonical);
    expect(plan.from).toBeNull();
    expect(plan.to).toEqual({ version: "0.5.0", shas: [NEW_SHA] });
    expect(plan.commitMessage).toBe("slidecraft 0.5.0");
  });

  it("a stale tap cask → changed, and the summary names the version and sha transitions", () => {
    const plan = planTapUpdate(cask("0.5.0", NEW_SHA), cask("0.4.0", OLD_SHA));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed).toBe(true);
    expect(plan.from).toEqual({ version: "0.4.0", shas: [OLD_SHA] });
    expect(plan.summary).toContain("version 0.4.0 → 0.5.0");
    expect(plan.summary).toContain(`sha256[0] ${OLD_SHA} → ${NEW_SHA}`);
  });

  it("an identical tap cask → not changed (nothing to push)", () => {
    const c = cask("0.5.0", NEW_SHA);
    const plan = planTapUpdate(c, c);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed).toBe(false);
    expect(plan.summary).toMatch(/already up to date/);
  });

  it("refuses to downgrade the tap (canonical older than what the tap already serves)", () => {
    const plan = planTapUpdate(cask("0.4.0", OLD_SHA), cask("0.5.0", NEW_SHA));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/downgrade/i);
  });

  it("refuses a canonical cask without a version line or with a malformed sha256 count", () => {
    const noVersion = planTapUpdate(`cask "slidecraft" do\n  sha256 "${NEW_SHA}"\nend\n`, null);
    expect(noVersion.ok).toBe(false);
    const noSha = planTapUpdate(`cask "slidecraft" do\n  version "0.5.0"\nend\n`, null);
    expect(noSha.ok).toBe(false);
    if (noSha.ok) return;
    expect(noSha.reason).toMatch(/sha256/);
  });

  it("refuses a non-numeric canonical version (fail closed, never guess the order)", () => {
    const plan = planTapUpdate(cask("latest", NEW_SHA), cask("0.5.0", NEW_SHA));
    expect(plan.ok).toBe(false);
  });
});

describe("mirror-cask CLI (dry-run vs write)", () => {
  const freshTap = (existing: string | null) => {
    const dir = mkdtempSync(join(tmpdir(), "tap-"));
    if (existing !== null) {
      mkdirSync(join(dir, "Casks"));
      writeFileSync(join(dir, "Casks", "slidecraft.rb"), existing);
    }
    return dir;
  };
  const canonical = readFileSync(CANONICAL, "utf8");

  it("--dry-run prints the planned change and writes nothing", () => {
    const dir = freshTap(cask("0.0.1", OLD_SHA));
    const r = spawnSync("node", [SCRIPT, dir, "--dry-run"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dry-run");
    expect(r.stdout).toContain("version 0.0.1 →");
    expect(readFileSync(join(dir, "Casks", "slidecraft.rb"), "utf8")).toBe(cask("0.0.1", OLD_SHA));
  });

  it("without --dry-run writes the canonical cask byte-identically (creating Casks/ if needed)", () => {
    const dir = freshTap(null);
    const r = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, "Casks", "slidecraft.rb"), "utf8")).toBe(canonical);
  });

  it("a refused plan (downgrade) exits 1 with the reason and leaves the tap untouched", () => {
    const newer = cask("999.0.0", NEW_SHA);
    const dir = freshTap(newer);
    const r = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/downgrade/i);
    expect(readFileSync(join(dir, "Casks", "slidecraft.rb"), "utf8")).toBe(newer);
  });

  it("no tap dir argument → usage on stderr, exit 1", () => {
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage:");
    expect(existsSync(SCRIPT)).toBe(true);
  });
});
