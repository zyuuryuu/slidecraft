/**
 * cask-mirror-workflow.test.ts — pins .github/workflows/cask-mirror.yml (Issue #288).
 *
 * The workflow only runs on a real release publish, so CI can never exercise it before it matters.
 * These assertions pin the safety-relevant shape instead (same approach as release-workflow.test.ts):
 * it fires AFTER publish, verify-cask gates the mirror (a broken cask is never pushed), a missing
 * HOMEBREW_TAP_TOKEN skips loudly without failing, the canonical cask goes to main via a PR (never a
 * direct push — main is protected), and release.yml is left alone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  permissions?: Record<string, string>;
  steps: Step[];
}

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const raw = read("../.github/workflows/cask-mirror.yml");
const wf = yaml.load(raw) as { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };
const job = wf.jobs["mirror"];
const steps = job?.steps ?? [];
const stepIndex = (re: RegExp) => steps.findIndex((s) => re.test(s.run ?? ""));

describe("cask-mirror.yml — post-publish Homebrew tap mirror (Issue #288)", () => {
  it("fires on release published (and manual dispatch with a version), never on tag push", () => {
    expect(wf.on.release).toEqual({ types: ["published"] });
    const dispatch = wf.on.workflow_dispatch as { inputs?: Record<string, { required?: boolean }> };
    expect(dispatch?.inputs?.version?.required).toBe(true);
    expect(wf.on).not.toHaveProperty("push");
  });

  it("checks out the default branch (the PR base), not the release tag", () => {
    const co = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(co?.with?.ref).toBe("${{ github.event.repository.default_branch }}");
  });

  it("order: update-cask → verify-cask → mirror to tap → canonical-cask PR", () => {
    const update = stepIndex(/node scripts\/update-cask\.mjs "\$VERSION"/);
    const verify = stepIndex(/node scripts\/verify-cask\.mjs/);
    const mirror = stepIndex(/node scripts\/mirror-cask\.mjs/);
    const pr = stepIndex(/gh pr create/);
    expect(update).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(update);
    expect(mirror).toBeGreaterThan(verify);
    expect(pr).toBeGreaterThan(verify);
  });

  it("verify-cask is a hard gate: not continue-on-error, no `|| true`", () => {
    const verify = steps[stepIndex(/node scripts\/verify-cask\.mjs/)];
    expect(verify).not.toHaveProperty("continue-on-error");
    expect(verify.run).not.toMatch(/\|\|\s*true/);
  });

  it("a missing HOMEBREW_TAP_TOKEN skips the tap push loudly (warning + summary) and exits 0", () => {
    const tap = steps[stepIndex(/node scripts\/mirror-cask\.mjs/)];
    expect(tap.env?.HOMEBREW_TAP_TOKEN).toBe("${{ secrets.HOMEBREW_TAP_TOKEN }}");
    expect(tap.run).toMatch(/if \[ -z "\$HOMEBREW_TAP_TOKEN" \]; then[\s\S]*?::warning::[\s\S]*?GITHUB_STEP_SUMMARY[\s\S]*?exit 0/);
    expect(tap.run).toContain("zyuuryuu/homebrew-slidecraft");
  });

  it("never pushes to main directly; the canonical cask goes through a PR based on the default branch", () => {
    expect(raw).not.toMatch(/git push[^\n]*\b(main|HEAD:main)\b/);
    const pr = steps[stepIndex(/gh pr create/)];
    expect(pr.run).toMatch(/--base "\$BASE"/);
    expect(pr.env?.BASE).toBe("${{ github.event.repository.default_branch }}");
  });

  it("least privilege: contents + pull-requests write only", () => {
    expect(wf.permissions).toEqual({ contents: "write", "pull-requests": "write" });
  });

  it("every third-party action is pinned to a full commit sha", () => {
    for (const s of steps.filter((x) => x.uses)) expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
  });

  it("release.yml stays untouched by the mirror (no tap / mirror wiring there)", () => {
    const rel = read("../.github/workflows/release.yml");
    expect(rel).not.toMatch(/homebrew-slidecraft|mirror-cask|HOMEBREW_TAP_TOKEN/);
  });
});
