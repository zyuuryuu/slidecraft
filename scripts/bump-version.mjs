/**
 * bump-version.mjs — the ONE place the app version is propagated (M0: version single-sourcing).
 *
 * The version lives in seven places that MUST agree: package.json, src-tauri/tauri.conf.json (drives the
 * installer metadata — the de-facto canonical), src-tauri/Cargo.toml, three hardcoded server/client
 * version strings (mcp/server.ts, collab-client.ts, app-version.ts), and the Homebrew cask. This script
 * reads/writes all seven via targeted regex (so file formatting is preserved) and is imported by
 * tests/version-sync.test.ts as the CI drift gate.
 *
 * Usage:
 *   node scripts/bump-version.mjs 0.2.0   # set ALL to 0.2.0
 *   node scripts/bump-version.mjs         # SYNC all to tauri.conf.json's version (fix drift)
 *   node scripts/bump-version.mjs --check # verify all agree; exit 1 on mismatch (no writes)
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Each target knows how to READ its current version and WRITE a new one, preserving formatting. */
export const TARGETS = [
  { label: "package.json", path: "package.json", re: /("version":\s*")([^"]*)(")/ },
  { label: "tauri.conf.json", path: "src-tauri/tauri.conf.json", re: /("version":\s*")([^"]*)(")/ },
  // Cargo.toml: the [package] version only (NOT the many `version = "2"` under [dependencies]).
  { label: "Cargo.toml", path: "src-tauri/Cargo.toml", re: /(\[package\][\s\S]*?\nversion = ")([^"]*)(")/ },
  { label: "mcp/server.ts", path: "src/mcp/server.ts", re: /(new McpServer\(\{[^)]*?version:\s*")([^"]*)(")/ },
  { label: "collab-client.ts", path: "src/ipc/collab-client.ts", re: /(new Client\(\{[^)]*?version:\s*")([^"]*)(")/ },
  { label: "app-version.ts", path: "src/ipc/app-version.ts", re: /(export const APP_VERSION = ")([^"]*)(")/ },
  { label: "homebrew cask", path: "packaging/homebrew/Casks/slidecraft.rb", re: /(\n\s*version ")([^"]*)(")/ },
];

const abs = (p) => join(ROOT, p);

/** Read the current version from each target → [{label, path, version|null}]. */
export function readAllVersions() {
  return TARGETS.map((t) => {
    const m = readFileSync(abs(t.path), "utf8").match(t.re);
    return { label: t.label, path: t.path, version: m ? m[2] : null };
  });
}

/** Write `version` into every target (idempotent). Returns the labels actually changed. */
export function setAllVersions(version) {
  const changed = [];
  for (const t of TARGETS) {
    const text = readFileSync(abs(t.path), "utf8");
    const next = text.replace(t.re, (_all, pre, _old, post) => `${pre}${version}${post}`);
    if (next !== text) {
      writeFileSync(abs(t.path), next);
      changed.push(t.label);
    }
  }
  return changed;
}

function main() {
  const arg = process.argv[2];
  const versions = readAllVersions();
  const missing = versions.filter((v) => v.version === null);
  if (missing.length) {
    console.error(`version marker not found in: ${missing.map((m) => m.path).join(", ")}`);
    process.exit(2);
  }

  if (arg === "--check") {
    const set = new Set(versions.map((v) => v.version));
    if (set.size === 1) {
      console.log(`✓ version in sync: ${[...set][0]}`);
      process.exit(0);
    }
    console.error("✗ version DRIFT:");
    for (const v of versions) console.error(`  ${v.version}  ${v.path}`);
    process.exit(1);
  }

  // canonical = the explicit arg, else tauri.conf.json (installer source of truth)
  const target = arg ?? versions.find((v) => v.path === "src-tauri/tauri.conf.json").version;
  const changed = setAllVersions(target);
  console.log(changed.length ? `set version → ${target}\n  updated: ${changed.join(", ")}` : `already at ${target}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
