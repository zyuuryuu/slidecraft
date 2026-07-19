/**
 * arch-census.ts — G3（ADR-0031）: hotspot（churn×行数）＋コピペ率の傾向観測センサス。
 * 病理センサス（scripts/pathology-census.ts）と同型の on-demand スクリプト。
 *
 * fail ゲートではない（ADR-0031「やらないこと」）。閾値判定・process.exit(1) は行わない。
 * CI には載せない。定期的に手で眺めて次の分割/統合候補（#129 型）を決める材料にする。
 *
 * hotspot = 直近 --since 以降の touch 回数（`git log --name-only`）× 現在の行数。
 * Date.now() には直接依存せず、期間は --since で明示する（census 文化: 決定論を保つ）。
 *
 * Usage:
 *   npx tsx scripts/arch-census.ts --since 2026-01-01 [--top 20]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = "src";

function parseArgs(argv: string[]) {
  let since = "";
  let top = 20;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") since = argv[++i] ?? "";
    else if (argv[i] === "--top") top = Number(argv[++i] ?? top);
  }
  if (!since) {
    console.error("Usage: npx tsx scripts/arch-census.ts --since YYYY-MM-DD [--top N]");
    process.exit(1);
  }
  return { since, top };
}

type Hotspot = { file: string; touches: number; lines: number; score: number };

function gitChurn(since: string): Map<string, number> {
  const out = execFileSync(
    "git",
    ["log", `--since=${since}`, "--format=", "--name-only", "--", SRC],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const churn = new Map<string, number>();
  for (const line of out.split("\n")) {
    const f = line.trim();
    if (!f || !f.startsWith(`${SRC}/`)) continue;
    churn.set(f, (churn.get(f) ?? 0) + 1);
  }
  return churn;
}

function lineCount(file: string): number {
  if (!existsSync(file)) return 0; // since 期間中に削除されたファイル
  return readFileSync(file, "utf8").split("\n").length;
}

function computeHotspots(since: string): Hotspot[] {
  const churn = gitChurn(since);
  const rows: Hotspot[] = [];
  for (const [file, touches] of churn) {
    const lines = lineCount(file);
    if (lines === 0) continue;
    rows.push({ file, touches, lines, score: touches * lines });
  }
  return rows.sort((a, b) => b.score - a.score);
}

type JscpdClone = { firstFile: string; secondFile: string; tokens: number; lines: number };

function runJscpd(): JscpdClone[] {
  const outDir = mkdtempSync(join(tmpdir(), "arch-census-jscpd-"));
  try {
    execFileSync(
      "npx",
      [
        "--yes",
        "jscpd",
        SRC,
        "--min-tokens",
        "70",
        "--reporters",
        "json",
        "--output",
        outDir,
        "--silent",
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
    );
  } catch {
    // jscpd はクローンを見つけた場合 exit code != 0 を返すことがある（設定次第）。
    // json レポートの有無で成否を判定するので、ここでは無視して続行する。
  }
  const reportPath = join(outDir, "jscpd-report.json");
  if (!existsSync(reportPath)) return [];
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      duplicates?: Array<{
        firstFile: { name: string };
        secondFile: { name: string };
        tokens: number;
        lines: number;
      }>;
    };
    return (report.duplicates ?? []).map((d) => ({
      firstFile: d.firstFile.name,
      secondFile: d.secondFile.name,
      tokens: d.tokens,
      lines: d.lines,
    }));
  } catch {
    return [];
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// tests/arch-conformance.test.ts の R1 FREEZE リストと同期して手保守する。
// (相対パスは "engine/..." 等 SRC 相対。ズレたら arch-conformance.test.ts 側を正とする。)
const FREEZE = new Set([
  "engine/layout-engine.ts",
  "engine/template-loader.ts",
  "components/SlidePreview.tsx",
  "components/useDeckController.ts",
  "engine/template-catalog.ts",
  "App.tsx",
  "components/AiPanel.tsx",
  "engine/deck-plan.ts",
  "components/SlideEditor.tsx",
  "engine/placeholder-filler.ts",
  "components/useAiGeneration.ts",
  "components/LlmAssist.tsx",
  "engine/md-slide-parser.ts",
  "engine/diagram-serialize.ts",
  "mcp/session.ts",
]);

function relSrc(file: string): string {
  return file.startsWith(`${SRC}/`) ? file.slice(SRC.length + 1) : file;
}

async function main() {
  const { since, top } = parseArgs(process.argv.slice(2));

  console.log(`\x1b[1m===== arch-census（${since} 以降）=====\x1b[0m`);

  console.log(`\n\x1b[1m--- hotspot（touch × 行数）上位 ${top} ---\x1b[0m`);
  const hotspots = computeHotspots(since);
  for (const h of hotspots.slice(0, top)) {
    const frozen = FREEZE.has(relSrc(h.file)) ? " \x1b[33m[FREEZE]\x1b[0m" : "";
    console.log(`  ${String(h.score).padStart(6)}  touches=${String(h.touches).padStart(3)}  lines=${String(h.lines).padStart(4)}  ${h.file}${frozen}`);
  }
  if (hotspots.length === 0) console.log("  (該当なし — --since を確認)");

  console.log(`\n\x1b[1m--- コピペ率（jscpd --min-tokens 70）上位 ${top} ---\x1b[0m`);
  const clones = runJscpd().sort((a, b) => b.tokens - a.tokens);
  for (const c of clones.slice(0, top)) {
    console.log(`  tokens=${String(c.tokens).padStart(4)}  lines=${String(c.lines).padStart(3)}  ${c.firstFile}  <->  ${c.secondFile}`);
  }
  if (clones.length === 0) console.log("  (クローン検出なし、または jscpd 実行不可)");

  // G1 凍結リスト（FREEZE）との突き合わせ — 分割優先度がひと目で決まる
  console.log(`\n\x1b[1m--- 凍結リスト（tests/arch-conformance.test.ts の FREEZE）中の hotspot 上位 ---\x1b[0m`);
  const frozenHotspots = hotspots.filter((h) => FREEZE.has(relSrc(h.file)));
  if (frozenHotspots.length === 0) {
    console.log("  凍結リスト内ファイルに hotspot なし（--since 期間中の touch がゼロ）");
  } else {
    for (const h of frozenHotspots.slice(0, top)) {
      console.log(`  ${String(h.score).padStart(6)}  touches=${String(h.touches).padStart(3)}  lines=${String(h.lines).padStart(4)}  ${h.file}`);
    }
  }
}

void main();
