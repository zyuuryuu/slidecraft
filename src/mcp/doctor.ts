/**
 * doctor.ts — `slidecraft-mcp --doctor` (#517 子 4): spawn THIS server over stdio, exactly as an MCP client
 * would, and report on one screen what that client sees:
 *  - `server/discover` (the 2026-07-28 version probe Claude Code sends first): answered with -32601 by the
 *    probe filter (#518 / PR #525, discover-probe.ts) — silence here is the bug that filter fixed;
 *  - the legacy `initialize`: server name + version + negotiated protocol;
 *  - `tools/list`: how many tools a client gets (all pages);
 *  - the mode and `--root` scope the child ANNOUNCED on stderr (cli-banner.ts — format and parse in one place).
 *
 * The GUI's 接続テスト button runs this same entry (Rust `mcp_doctor` spawns the bundled node + cli.cjs with
 * `--doctor`), so the diagnosis exists once (R8). It reads no deck state and is not a control plane: the child
 * is a normal server process that the doctor talks to and then closes.
 */
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { DISCOVER_METHOD } from "./discover-probe";
import { parseModeBanner, type ModeBanner } from "./cli-banner";

export type Step<T> = { ok: true; ms: number; value: T } | { ok: false; ms: number; error: string };

export type DiscoverOutcome = { kind: "legacy-only" } | { kind: "modern" };

export interface DoctorReport {
  launch: { node: string; nodeVersion: string; script: string; args: string[]; dropped: string[] };
  mode: ModeBanner;
  discover: Step<DiscoverOutcome>;
  initialize: Step<{ name: string; version: string; protocolVersion: string }>;
  tools: Step<{ count: number }>;
  /** Set when the server exited WHILE being probed (a normal close after the probe is not reported). */
  exit: { code: number | null; signal: string | null } | null;
  stderr: string;
  ok: boolean;
}

type Reply = { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };

/** NDJSON over a peer's stdin/stdout: send requests, await the reply carrying a given id. */
export interface LineChannel {
  send(msg: Record<string, unknown>): void;
  reply(id: string | number, timeoutMs: number): Promise<Reply>;
  /** The peer is gone: every pending and future `reply` rejects with `reason`. */
  fail(reason: string): void;
}

export function createLineChannel(input: Writable, output: Readable): LineChannel {
  const replies = new Map<string | number, Reply>();
  const waiters = new Map<string | number, (r: Reply) => void>();
  const failWaiters = new Set<(reason: string) => void>();
  let failed: string | null = null;
  let buf = "";
  output.on("data", (chunk: Buffer | string) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let msg: Reply;
      try {
        msg = JSON.parse(line) as Reply;
      } catch {
        continue; // not a JSON-RPC line — the server writes only those to stdout, so just skip
      }
      if (typeof msg?.id !== "string" && typeof msg?.id !== "number") continue;
      const w = waiters.get(msg.id);
      if (w) w(msg);
      else replies.set(msg.id, msg);
    }
  });
  return {
    send(msg) {
      if (failed === null) input.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
    },
    reply(id, timeoutMs) {
      const ready = replies.get(id);
      if (ready) return Promise.resolve(ready);
      if (failed !== null) return Promise.reject(new Error(failed));
      return new Promise<Reply>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(id);
          failWaiters.delete(onFail);
        };
        const onFail = (reason: string) => {
          done();
          reject(new Error(reason));
        };
        const timer = setTimeout(() => onFail(`${timeoutMs}ms 以内に応答がありません`), timeoutMs);
        waiters.set(id, (r) => {
          done();
          resolve(r);
        });
        failWaiters.add(onFail);
      });
    },
    fail(reason) {
      if (failed !== null) return;
      failed = reason;
      for (const f of [...failWaiters]) f(reason);
    },
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rpcError = (r: Reply) => `JSON-RPC エラー ${String(r.error?.code)}: ${String(r.error?.message)}`;

async function timed<T>(fn: () => Promise<T>): Promise<Step<T>> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t0, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: errText(e) };
  }
}

/** The client side of a handshake, in Claude Code's order: discover probe → initialize → initialized → tools/list. */
export async function probeServer(ch: LineChannel, opts: { timeoutMs: number }): Promise<Pick<DoctorReport, "discover" | "initialize" | "tools">> {
  const { timeoutMs } = opts;
  const discover = await timed<DiscoverOutcome>(async () => {
    // Shaped like Claude Code's real probe (top-level _meta — the shape #518 was about).
    ch.send({ id: "doctor-discover", method: DISCOVER_METHOD, params: {}, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } });
    const r = await ch.reply("doctor-discover", timeoutMs);
    if (r.error?.code === -32601) return { kind: "legacy-only" };
    if (r.error) throw new Error(rpcError(r));
    return { kind: "modern" };
  });

  const initialize = await timed(async () => {
    ch.send({ id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "slidecraft-doctor", version: "1" } } });
    const r = await ch.reply(1, timeoutMs);
    if (r.error) throw new Error(rpcError(r));
    const res = r.result as { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown } } | undefined;
    return { name: String(res?.serverInfo?.name ?? "?"), version: String(res?.serverInfo?.version ?? "?"), protocolVersion: String(res?.protocolVersion ?? "?") };
  });

  if (!initialize.ok) return { discover, initialize, tools: { ok: false, ms: 0, error: "initialize が失敗したため未実行" } };

  ch.send({ method: "notifications/initialized" });
  const tools = await timed(async () => {
    let count = 0;
    let cursor: string | undefined;
    for (let page = 0, id = 2; page < 50; page++, id++) {
      ch.send({ id, method: "tools/list", params: cursor ? { cursor } : {} });
      const r = await ch.reply(id, timeoutMs);
      if (r.error) throw new Error(rpcError(r));
      const res = r.result as { tools?: unknown[]; nextCursor?: unknown } | undefined;
      count += res?.tools?.length ?? 0;
      cursor = typeof res?.nextCursor === "string" ? res.nextCursor : undefined;
      if (!cursor) return { count };
    }
    throw new Error("tools/list のページが 50 を超えました");
  });
  return { discover, initialize, tools };
}

/** Arguments for the self-spawned server: everything but --doctor, minus --metrics <path> (the probe must not
 *  be written into the user's call log). Dropped flags are returned so the report can say so. */
export function doctorChildArgs(argv: string[]): { args: string[]; dropped: string[] } {
  const args: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--doctor") continue;
    if (argv[i] === "--metrics") {
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : undefined;
      dropped.push(v === undefined ? "--metrics" : `--metrics ${v}`);
      continue;
    }
    args.push(argv[i]);
  }
  return { args, dropped };
}

function modeLine(m: ModeBanner): string {
  if (m.kind === "forward") return `forward → ${m.url}（起動中の GUI ホストへ転送）`;
  if (m.kind === "solo") return m.root ? `solo（scoped fs — root=${m.root}）` : "solo（--no-fs / base64）";
  return "不明（起動行がありません — 下の stderr を参照）";
}

function rootLine(r: DoctorReport): string {
  const i = r.launch.args.indexOf("--root");
  const asked = i === -1 ? undefined : r.launch.args[i + 1];
  if (r.mode.kind === "solo") return r.mode.root ?? "未指定（--no-fs: .scft / .pptx は base64 で受け渡し）";
  if (r.mode.kind === "forward") return asked ? `${asked}（forward 中は無視 — デッキは GUI ホスト側）` : "未指定";
  return asked ? `${asked}（指定あり・起動を確認できず）` : "未指定";
}

const stepLine = <T>(label: string, s: Step<T>, describe: (v: T) => string, msNote = "") =>
  `  ${label.padEnd(16)}: ${s.ok ? `OK  ${describe(s.value)}  ${s.ms}ms${msNote}` : `NG  ${s.error}`}`;

/** The one-screen text (≤ ~20 lines). The verdict is the last line. */
export function formatDoctorReport(r: DoctorReport): string {
  const l = r.launch;
  const lines = [
    "SlideCraft MCP 接続診断（--doctor）",
    `  起動            : ${l.node}（${l.nodeVersion}） ${l.script}${l.args.length ? ` ${l.args.join(" ")}` : ""}`,
    `  モード          : ${modeLine(r.mode)}`,
    `  --root          : ${rootLine(r)}`,
  ];
  if (l.dropped.length) lines.push(`  診断では無効    : ${l.dropped.join(", ")}（診断の呼び出しを記録しないため）`);
  lines.push(
    stepLine("server/discover", r.discover, (v) => (v.kind === "legacy-only" ? "-32601（legacy 版のみ — 期待どおり・#518）" : "DiscoverResult（modern）"), "（起動を含む）"),
    stepLine("initialize", r.initialize, (v) => `${v.name} ${v.version} / protocol ${v.protocolVersion}`),
    stepLine("tools/list", r.tools, (v) => `${v.count} 本`),
  );
  if (r.exit) lines.push(`  終了            : exit ${r.exit.code ?? "-"}${r.exit.signal ? `（${r.exit.signal}）` : ""}`);
  if (!r.ok && r.stderr.trim()) {
    lines.push("  stderr:");
    for (const s of r.stderr.trimEnd().split(/\r?\n/).slice(-8)) lines.push(`    ${s}`);
  }
  const firstNg = [["server/discover", r.discover], ["initialize", r.initialize], ["tools/list", r.tools]].find(([, s]) => !(s as Step<unknown>).ok)?.[0];
  lines.push(
    r.ok ? "結果: OK — MCP クライアントはこのサーバに接続できます"
    : r.exit ? `結果: NG — サーバが応答前に終了しました（exit ${r.exit.code ?? "-"}）。上の stderr を確認してください`
    : `結果: NG — ${firstNg ?? "tools/list（0 本）"} を確認してください`,
  );
  return `${lines.join("\n")}\n`;
}

/** Spawn this very server (same node, same script, same flags but --doctor) and probe it. Never throws. */
export async function runDoctor(argv: string[], opts: { timeoutMs?: number } = {}): Promise<{ report: DoctorReport; text: string }> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const { args, dropped } = doctorChildArgs(argv);
  const script = process.argv[1] ?? "";
  const child = spawn(process.execPath, [...process.execArgv, script, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const ch = createLineChannel(child.stdin, child.stdout);
  let stderr = "";
  let probing = true;
  let exit: DoctorReport["exit"] = null;
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  child.stdin.on("error", () => {}); // EPIPE after an early exit — reported via the exit below, not thrown
  const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  child.on("error", (e) => ch.fail(`サーバを起動できません: ${e.message}`));
  child.on("exit", (code, signal) => {
    if (probing) exit = { code, signal };
    ch.fail(`サーバが終了しました（exit ${code ?? "-"}${signal ? `, ${signal}` : ""}）`);
  });

  const steps = await probeServer(ch, { timeoutMs });
  probing = false;
  child.stdin.end();
  const backstop = setTimeout(() => child.kill(), 3000);
  await closed;
  clearTimeout(backstop);

  const report: DoctorReport = {
    launch: { node: process.execPath, nodeVersion: process.version, script, args, dropped },
    mode: parseModeBanner(stderr),
    ...steps,
    exit,
    stderr,
    ok: steps.discover.ok && steps.initialize.ok && steps.tools.ok && steps.tools.value.count > 0,
  };
  return { report, text: formatDoctorReport(report) };
}
