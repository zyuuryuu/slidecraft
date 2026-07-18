/**
 * arch-conformance.test.ts — 実行可能な構造規約（ADR-0031 G1）。
 *
 * BindingPlan 事件（ADR-0030: 束縛写像が 7 箇所で独立再計算され #124/#135/#144 を生んだ）の再発防止。
 * 欠陥はファイル単体の行数/複雑度でなく**ファイル間の関係**（権威の迂回・責務の漏れ）に宿るため、
 * 規約を散文でなく import グラフ上のテストとして固定する。検査は import 文の解析ベース
 * （文字列 grep は html-shell の埋め込み viewer JS 等で偽陽性になることを実測済み — ADR-0031）。
 *
 * ratchet 運用: FREEZE/ALLOW リストは「現状の凍結」であり、増やす変更は原則 NG（増やすなら PR で
 * 理由を明示）。分割・統合が進んだらリストから**消す**。リストの縮小が保守性改善の実測値になる。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";

const SRC = resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** import/export-from/dynamic-import の specifier を列挙（コメント・文字列リテラル内は対象外になるよう
 *  行頭形のみ拾う。エッジを増やす方向の漏れは規約を緩める側なので、ここは保守的でよい）。
 *  typeOnly: `import type` / `export type ... from` はコンパイル時に消える＝実行時循環にならない。 */
function importSpecifiers(file: string): Array<{ spec: string; typeOnly: boolean }> {
  const text = readFileSync(file, "utf8");
  const out: Array<{ spec: string; typeOnly: boolean }> = [];
  const re = /^\s*((?:import|export)\s+(?:type\s+)?)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ spec: m[2] ?? m[3] ?? m[4], typeOnly: /\btype\s$/.test(m[1] ?? "") });
  }
  return out;
}

/** 相対 specifier をリポジトリ相対のモジュールパス（拡張子なし）へ解決。 */
function resolveRel(fromFile: string, spec: string): string {
  return resolve(dirname(fromFile), spec).replace(/\\/g, "/");
}

const rel = (p: string) => p.replace(/\\/g, "/").split("/src/")[1] ?? p;

const files = walk(SRC);
const engineFiles = files.filter((f) => rel(f).startsWith("engine/"));

// ── G1-a: R2 純度 — engine は純粋ロジック（DOM/Tauri/React/components/ipc/mcp に依存しない）──
describe("R2: src/engine は純粋ロジック", () => {
  const FORBIDDEN_PKG = [/^react(-dom)?(\/|$)/, /^@tauri-apps\//, /^@codemirror\//, /^i18next/, /^react-i18next/];
  it("engine から components/ipc/mcp/禁止パッケージへの import が無い", () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { spec } of importSpecifiers(f)) {
        if (spec.startsWith(".")) {
          const target = rel(resolveRel(f, spec));
          if (/^(components|ipc|mcp)\//.test(target)) violations.push(`${rel(f)} → ${spec}`);
        } else if (FORBIDDEN_PKG.some((re) => re.test(spec))) {
          violations.push(`${rel(f)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── G1-b: 束縛の権威（ADR-0030）— ルーティング関数の消費者は許可リストのみ ──
describe("ADR-0030: 束縛ルーティングの権威は迂回しない", () => {
  // bindContentByRole / expandGroups を named-import してよいファイル（src 内・tests は自由）。
  // 段階E（group-binding 統合）完了時に SlidePreview / placeholder-filler は slideBindingPlan 消費へ
  // 移行し、このリストから消す（ratchet）。リストに**足す**変更は ADR-0030 への挑戦なので要議論。
  const ALLOW = new Set([
    "engine/group-binding.ts", // slideBindingPlan の実装（dispatch の持ち上げ）
    "engine/placeholder-filler.ts", // export の dispatch（ADR-0030 Context #1）
    "components/SlidePreview.tsx", // preview の dispatch（ADR-0030 Context #2）
  ]);
  it("bindContentByRole / expandGroups の import 元が許可リスト内", () => {
    const violations: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const re = /^\s*import\s+(?:type\s+)?{([^}]*)}\s*from\s+["']([^"']+)["']/gm;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const names = m[1];
        if (!/\b(bindContentByRole|expandGroups)\b/.test(names)) continue;
        if (rel(f) === "engine/placeholder-binding.ts") continue; // 定義元
        if (!ALLOW.has(rel(f))) violations.push(`${rel(f)} が {${names.trim()}} を import`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── G1-c: R1 行数 — 400 行以下（既存超過は凍結。分割したらリストから消す）──
describe("R1: 1 ファイル 400 行以下", () => {
  // 2026-07-18 時点の凍結リスト（当時の行数）。layout-engine は CLAUDE.md の公認例外。
  // それ以外は分割候補（#129 の先例）。ここへ**追加**する PR は R1 違反の新規発生＝原則差し戻し。
  const FREEZE = new Set([
    "engine/layout-engine.ts", // 1601 — 公認例外（これ以上の肥大化は禁止）
    "engine/template-loader.ts", // 860
    "components/SlidePreview.tsx", // 734
    "components/useDeckController.ts", // 674
    "engine/template-catalog.ts", // 649（#129 補足で認知済み）
    "App.tsx", // 611
    "components/AiPanel.tsx", // 517
    "engine/deck-plan.ts", // 479
    "components/SlideEditor.tsx", // 450
    "engine/placeholder-filler.ts", // 449
    "components/useAiGeneration.ts", // 444
    "components/LlmAssist.tsx", // 401
    "engine/md-slide-parser.ts", // 419
    "engine/diagram-serialize.ts", // 409
    "mcp/session.ts", // 403
  ]);
  it("凍結リスト外の src ファイルは 400 行以下", () => {
    const violations: string[] = [];
    for (const f of files) {
      if (FREEZE.has(rel(f))) continue;
      const lines = readFileSync(f, "utf8").split("\n").length;
      if (lines > 400) violations.push(`${rel(f)}: ${lines} 行`);
    }
    expect(violations).toEqual([]);
  });
  it("凍結リストのファイルが 400 行以下に痩せたらリストから外す（棚卸し）", () => {
    const stale: string[] = [];
    for (const name of FREEZE) {
      const p = join(SRC, name);
      try {
        if (readFileSync(p, "utf8").split("\n").length <= 400) stale.push(name);
      } catch {
        stale.push(`${name}（ファイルが存在しない）`);
      }
    }
    expect(stale).toEqual([]);
  });
});

// ── G1-d: engine 内の循環 import 禁止 ──
describe("engine 内に循環 import が無い", () => {
  it("DFS で循環を検出しない", () => {
    const graph = new Map<string, string[]>();
    for (const f of engineFiles) {
      const deps = importSpecifiers(f)
        .filter((e) => e.spec.startsWith(".") && !e.typeOnly) // type-only は実行時に存在しないエッジ
        .map((e) => rel(resolveRel(f, e.spec)))
        .filter((t) => t.startsWith("engine/"));
      graph.set(rel(f).replace(/\.tsx?$/, ""), deps.map((d) => d.replace(/\.tsx?$/, "")));
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const cycles: string[] = [];
    const dfs = (node: string, path: string[]): void => {
      color.set(node, GRAY);
      for (const dep of graph.get(node) ?? []) {
        if (!graph.has(dep)) continue;
        const c = color.get(dep) ?? WHITE;
        if (c === GRAY) cycles.push([...path, node, dep].slice(path.indexOf(dep)).join(" → "));
        else if (c === WHITE) dfs(dep, [...path, node]);
      }
      color.set(node, BLACK);
    };
    for (const node of graph.keys()) if ((color.get(node) ?? WHITE) === WHITE) dfs(node, []);
    // 既知の意図的循環（凍結）: schema ⇄ schema-diagnostics は R1 分割時の後方互換 re-export
    // （schema.ts:375）による。解消したらここから消す。**追加**は原則 NG。
    const KNOWN = new Set(["engine/schema → engine/schema-diagnostics → engine/schema"]);
    expect(cycles.filter((c) => !KNOWN.has(c))).toEqual([]);
    expect([...KNOWN].filter((c) => !cycles.includes(c))).toEqual([]); // 解消済みなら棚卸し
  });
});
