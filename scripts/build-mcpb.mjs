#!/usr/bin/env node
// build-mcpb.mjs — stage the Claude Desktop bundle directory for one target (#517 子 3):
//
//   node scripts/build-mcpb.mjs <darwin-arm64|win32-x64> [--root <repo>]
//
// Writes dist/mcpb/<target>/{manifest.json, icon.png, server/cli.cjs, server/node[.exe]} from the pure
// definitions in mcpb-manifest.mjs and prints that directory. Packing (zip + schema validation) is the
// official packer's job: `npx --no-install mcpb pack dist/mcpb/<target> dist/mcpb/slidecraft-<target>.mcpb`
// (release.yml). Inputs must already exist — `npm run build:mcp:bundled` (cli.cjs) and
// `node scripts/stage-node.mjs <triple>` (node). A missing input fails with its path; nothing is half-staged.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, chmodSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMcpbManifest, mcpbFiles } from "./mcpb-manifest.mjs";

function fail(msg) {
  process.stderr.write(`build-mcpb: ${msg}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const target = argv[0];
if (!target || target.startsWith("--")) fail("usage: node scripts/build-mcpb.mjs <darwin-arm64|win32-x64> [--root <repo>]");
const rootIdx = argv.indexOf("--root");
const root = rootIdx === -1 ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(argv[rootIdx + 1] ?? "");

let files;
let manifest;
try {
  files = mcpbFiles(target);
  const version = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
  manifest = buildMcpbManifest(target, version);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

const missing = files.filter((f) => !existsSync(join(root, f.from))).map((f) => f.from);
if (missing.length) fail(`missing input(s): ${missing.join(", ")} — build cli.cjs (npm run build:mcp:bundled) and stage node (scripts/stage-node.mjs) first`);

const stage = join(root, "dist", "mcpb", target);
rmSync(stage, { recursive: true, force: true });
for (const f of files) {
  const dest = join(stage, f.to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, f.from), dest);
  chmodSync(dest, statSync(join(root, f.from)).mode & 0o777); // node must stay executable inside the zip
}
writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${stage}\n`);
