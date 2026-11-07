/**
 * release-workflow.test.ts — pins the single-draft structure of .github/workflows/release.yml
 * (Issue #501).
 *
 * The bug: the 3-OS `release` matrix ran tauri-action with `releaseDraft: true` in every leg, and
 * tauri-action's find-or-create-by-tag is not atomic, so parallel legs each created their own
 * draft for the same tag (v0.5.0: macOS assets on one draft, Linux on another; SHA256SUMS/SBOM on
 * neither). The fix: one serial `create-release` job creates (or reuses) exactly one draft and
 * hands its id to the matrix, which only uploads to that id. The release workflow can't run in
 * CI, so this test is the guard against the race being reintroduced by a later edit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string | string[];
  strategy?: { matrix?: { include?: Array<Record<string, string>> } };
  outputs?: Record<string, string>;
  steps: Step[];
}

const raw = readFileSync(fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)), "utf8");
const wf = yaml.load(raw) as { jobs: Record<string, Job> };
const jobs = wf.jobs;
const needsOf = (j: Job): string[] => (j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs : [j.needs]);
const jobText = (j: Job): string => yaml.dump(j, { lineWidth: -1 }); // no folding: match whole lines
const tauriStep = (j: Job): Step | undefined => j.steps.find((s) => s.uses?.startsWith("tauri-apps/tauri-action@"));

// A job "creates a release" if it hits the create-release REST endpoint or `gh release create`,
// or lets tauri-action find-or-create one (tagName without releaseId / releaseDraft).
function createsRelease(j: Job): boolean {
  const text = jobText(j);
  if (/gh release create/.test(text)) return true;
  if (/-X POST[^\n]*\/releases\b|--method POST[^\n]*\/releases\b/.test(text)) return true;
  const t = tauriStep(j);
  if (t?.with && (("tagName" in t.with && !("releaseId" in t.with)) || "releaseDraft" in t.with)) return true;
  return false;
}

describe("release.yml — single draft per run (Issue #501)", () => {
  it("exactly one job creates the release, and it is a serial (non-matrix) job named create-release", () => {
    const creators = Object.entries(jobs).filter(([, j]) => createsRelease(j)).map(([k]) => k);
    expect(creators).toEqual(["create-release"]);
    expect(jobs["create-release"].strategy).toBeUndefined();
    expect(jobs["create-release"].outputs?.release_id).toMatch(/steps\.[\w-]+\.outputs\.release_id/);
  });

  it("the release matrix uploads to the pre-created release id and never asks tauri-action to create one", () => {
    const rel = jobs["release"];
    expect(needsOf(rel)).toContain("create-release");
    const t = tauriStep(rel);
    expect(t).toBeDefined();
    expect(t?.with?.releaseId).toBe("${{ needs.create-release.outputs.release_id }}");
    for (const k of ["tagName", "releaseName", "releaseBody", "releaseDraft", "prerelease"]) {
      expect(t?.with ?? {}).not.toHaveProperty(k);
    }
  });

  it("the matrix still builds all three OS targets (invariant)", () => {
    const triples = (jobs["release"].strategy?.matrix?.include ?? []).map((e) => e.triple).sort();
    expect(triples).toEqual(["aarch64-apple-darwin", "x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]);
  });

  it("checksums-and-sbom waits for both the single draft and every matrix leg", () => {
    const needs = needsOf(jobs["checksums-and-sbom"]);
    expect(needs).toContain("create-release");
    expect(needs).toContain("release");
  });

  it("create-release keeps the CHANGELOG-derived notes with the never-silent empty-body check", () => {
    const text = jobText(jobs["create-release"]);
    expect(text).toContain("node scripts/extract-changelog-section.mjs");
    expect(text).toMatch(/if \[ -z "\$body" \]; then[\s\S]*?exit 1/);
    expect(text).toContain("SHA256SUMS, SBOM, and build provenance attestations are attached below.");
    // Title keeps tauri-action's former "SlideCraft v__VERSION__" (version from tauri.conf.json).
    expect(text).toContain("SlideCraft v${version}");
    expect(text).toContain("src-tauri/tauri.conf.json");
  });

  it("create-release reuses an existing draft for the tag (re-run safe) and refuses ambiguity", () => {
    const text = jobText(jobs["create-release"]);
    // Looks up drafts for this tag before creating…
    expect(text).toMatch(/select\(\.draft and \.tag_name == env\.TAG\)/);
    // …fails loudly if more than one already exists, or if the tag is already published.
    expect(text).toMatch(/more than one draft/i);
    expect(text).toMatch(/already published/i);
  });
});
