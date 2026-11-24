/**
 * mcp-doctor.test.ts — `slidecraft-mcp --doctor` (#517 子 4): the server spawns ITSELF over stdio and
 * reports, on one screen, how a client sees it — the `server/discover` probe (#518 / PR #525), the legacy
 * `initialize` (name + version), the tools/list count, and the mode/`--root` the child actually started in.
 * The GUI's 接続テスト button runs the same `--doctor` (R8: the diagnosis lives only in src/mcp/doctor.ts).
 *
 * Layers: probeServer over an in-process server (fast, exact), the banner format↔parse agreement (R8: the
 * mode line cli.ts prints is the one doctor reads), and the real CLI end to end.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/server";
import { createSession } from "../src/mcp/session";
import { createProbeAwareStdio } from "../src/mcp/discover-probe";
import { createLineChannel, probeServer, doctorChildArgs, formatDoctorReport, checkCollabHost, type DoctorReport } from "../src/mcp/doctor";
import { HostWatch, isHandshake } from "../src/mcp/front-decide";
import { soloReadyBanner, forwardBanner, parseModeBanner } from "../src/mcp/cli-banner";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** client→server and server→client pipes, as a spawned child's stdin/stdout would be. */
function pipes() {
  return { toServer: new PassThrough(), fromServer: new PassThrough() };
}

async function independentToolCount(): Promise<number> {
  const server = buildServer(createSession(null), { registerResources: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "vitest", version: "0" });
  await client.connect(ct);
  const { tools } = await client.listTools();
  await client.close();
  return tools.length;
}

describe("probeServer — discover, initialize, tools/list over one stdio channel", () => {
  it("a healthy server: discover answered -32601 (legacy-only, as designed), initialize OK, every tool counted", async () => {
    const p = pipes();
    const server = buildServer(createSession(null), { registerResources: true });
    await server.connect(createProbeAwareStdio(p.toServer, p.fromServer));
    const r = await probeServer(createLineChannel(p.toServer, p.fromServer), { timeoutMs: 3000 });
    await server.close();

    expect(r.discover).toMatchObject({ ok: true, value: { kind: "legacy-only" } });
    expect(r.initialize).toMatchObject({ ok: true, value: { name: "slidecraft" } });
    expect(r.initialize.ok && r.initialize.value.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.initialize.ok && r.initialize.value.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.tools).toEqual({ ok: true, ms: expect.any(Number), value: { count: await independentToolCount() } });
  });

  it("the pre-#518 front (no probe filter): discover gets NO reply → reported as a failure, the rest still runs", async () => {
    const p = pipes();
    const server = buildServer(createSession(null), { registerResources: true });
    await server.connect(new StdioServerTransport(p.toServer, p.fromServer));
    const r = await probeServer(createLineChannel(p.toServer, p.fromServer), { timeoutMs: 400 });
    await server.close();

    expect(r.discover).toMatchObject({ ok: false, error: expect.stringMatching(/400ms/) });
    expect(r.initialize.ok).toBe(true);
    expect(r.tools.ok).toBe(true);
  });

  it("a silent peer: every step times out, nothing hangs", async () => {
    const p = pipes();
    const r = await probeServer(createLineChannel(p.toServer, p.fromServer), { timeoutMs: 100 });
    expect(r.discover.ok).toBe(false);
    expect(r.initialize).toMatchObject({ ok: false, error: expect.stringMatching(/100ms/) });
    expect(r.tools).toMatchObject({ ok: false, error: expect.stringMatching(/initialize/) }); // not attempted, and says why
  });
});

describe("mode banner — the line cli.ts prints is the line doctor reads (R8)", () => {
  it("round-trips solo --no-fs, solo --root and forward", () => {
    expect(parseModeBanner(soloReadyBanner(null, undefined))).toEqual({ kind: "solo", root: null });
    expect(parseModeBanner(`noise\n${soloReadyBanner("/tmp/scope dir", "/tmp/m.jsonl")}`)).toEqual({ kind: "solo", root: "/tmp/scope dir" });
    expect(parseModeBanner(forwardBanner("http://127.0.0.1:4321/mcp"))).toEqual({ kind: "forward", url: "http://127.0.0.1:4321/mcp" });
    expect(parseModeBanner("")).toEqual({ kind: "unknown" });
  });
  it("the solo banner text is unchanged (byte-identical to the pre-#517 cli.ts line)", () => {
    expect(soloReadyBanner(null, undefined)).toBe("slidecraft mcp: ready (solo stdio, --no-fs / base64)\n");
    expect(soloReadyBanner("/r", "/m")).toBe("slidecraft mcp: ready (solo stdio, scoped fs — root=/r, metrics → /m)\n");
    expect(forwardBanner("http://h")).toBe("slidecraft mcp: forwarding to live host at http://h\n");
  });
});

describe("doctorChildArgs — what the self-spawned server is started with", () => {
  it("drops --doctor, keeps --root, and drops --metrics (the probe must not land in the user's call log) — saying so", () => {
    expect(doctorChildArgs(["--doctor", "--root", "/s", "--metrics", "m.jsonl"])).toEqual({ args: ["--root", "/s"], dropped: ["--metrics m.jsonl"] });
    expect(doctorChildArgs(["--doctor"])).toEqual({ args: [], dropped: [] });
  });
});

describe("formatDoctorReport — one screen, verdict last", () => {
  const base: DoctorReport = {
    launch: { node: "/n/node", nodeVersion: "v20.0.0", script: "/c/cli.cjs", args: [], dropped: [] },
    mode: { kind: "solo", root: null },
    discover: { ok: true, ms: 3, value: { kind: "legacy-only" } },
    initialize: { ok: true, ms: 40, value: { name: "slidecraft", version: "0.5.0", protocolVersion: "2025-06-18" } },
    tools: { ok: true, ms: 5, value: { count: 35 } },
    host: { path: "/d/host.json", file: "none" },
    exit: null,
    stderr: "",
    ok: true,
  };
  it("OK report names every fact the Issue asks for", () => {
    const t = formatDoctorReport(base);
    expect(t).toMatch(/server\/discover.*-32601/);
    expect(t).toMatch(/initialize.*slidecraft 0\.5\.0.*2025-06-18/);
    expect(t).toMatch(/tools\/list.*35/);
    expect(t).toMatch(/--root.*未指定/);
    expect(t).toMatch(/\/c\/cli\.cjs/);
    expect(t.trimEnd().split("\n").at(-1)).toMatch(/^結果: OK/);
    expect(t.split("\n").length).toBeLessThanOrEqual(20);
  });
  it("NG report gives the failing step's reason and the child's stderr", () => {
    const t = formatDoctorReport({
      ...base, ok: false, mode: { kind: "unknown" },
      initialize: { ok: false, ms: 0, error: "サーバが終了しました（exit 2）" },
      tools: { ok: false, ms: 0, error: "initialize が失敗したため未実行" },
      exit: { code: 2, signal: null },
      stderr: "slidecraft serve: --root のディレクトリが存在しません\n",
    });
    expect(t).toMatch(/initialize.*exit 2/);
    expect(t).toMatch(/--root のディレクトリが存在しません/);
    expect(t.trimEnd().split("\n").at(-1)).toMatch(/^結果: NG/);
  });
  it("forward mode and dropped flags are stated, not hidden", () => {
    const t = formatDoctorReport({ ...base, mode: { kind: "forward", url: "http://127.0.0.1:9/mcp" }, launch: { ...base.launch, args: ["--root", "/s"], dropped: ["--metrics m"] } });
    expect(t).toMatch(/forward.*http:\/\/127\.0\.0\.1:9\/mcp/);
    expect(t).toMatch(/--metrics m/);
  });
  it("the collab host line: live / stale / none / unreadable, each with what it saw (#736)", () => {
    const live = formatDoctorReport({ ...base, host: { path: "/d/host.json", file: "present", url: "http://127.0.0.1:9/mcp", startedAt: "2026-11-24T00:00:00.000Z", alive: true } });
    expect(live).toMatch(/協働ホスト.*host\.json あり・ping 応答あり（http:\/\/127\.0\.0\.1:9\/mcp・startedAt 2026-11-24T00:00:00\.000Z）/);
    const stale = formatDoctorReport({ ...base, host: { path: "/d/host.json", file: "present", url: "http://127.0.0.1:9/mcp", startedAt: "s", alive: false } });
    expect(stale).toMatch(/協働ホスト.*host\.json あり・ping 応答なし（http:\/\/127\.0\.0\.1:9\/mcp・startedAt s）/);
    expect(formatDoctorReport(base)).toMatch(/協働ホスト.*なし（host\.json なし — \/d\/host\.json）/);
    expect(formatDoctorReport({ ...base, host: { path: "/d/host.json", file: "invalid" } })).toMatch(/協働ホスト.*なし（host\.json を読めません — \/d\/host\.json）/);
    expect(live.trimEnd().split("\n").at(-1)).toMatch(/^結果: OK/); // informational: the verdict is unchanged
    expect(live.split("\n").length).toBeLessThanOrEqual(20);
  });
});

// ── the collab host check (#736): HostWatch once, never an approval application ────────────────────────
const hostJsonDir = mkdtempSync(join(tmpdir(), "slidecraft-doctor-host-"));
let collab: CollabHost | undefined;
afterEach(async () => {
  await collab?.close();
  collab = undefined;
});
afterAll(() => rmSync(hostJsonDir, { recursive: true, force: true }));

/** How many AI applications wait for [許可] on the host — read through the GUI's own tool. */
async function pendingApprovals(h: CollabHost): Promise<number> {
  const gui = new Client({ name: "gui", version: "1" });
  await gui.connect(new StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers: { Authorization: `Bearer ${h.guiToken}` } } }));
  const r = (await gui.callTool({ name: "list_client_approvals", arguments: {} })) as { content: { text: string }[] };
  await gui.close();
  return (JSON.parse(r.content[0].text) as { pending: unknown[] }).pending.length;
}

describe("checkCollabHost — what --doctor says about the GUI's collab host", () => {
  it("host.json + a live host → ping answered, url and startedAt reported, NO approval application on the host", async () => {
    const path = join(hostJsonDir, "live.json");
    collab = await createCollabHost({ port: 0, hostJsonPath: path });
    const r = await checkCollabHost(path);
    expect(r).toEqual({ path, file: "present", url: collab.url, startedAt: expect.any(String), alive: true });
    expect(await pendingApprovals(collab)).toBe(0);
  });
  it("no host.json → none", async () => {
    const path = join(hostJsonDir, "absent.json");
    expect(await checkCollabHost(path)).toEqual({ path, file: "none" });
  });
  it("host.json left by a host that is gone → present, ping not answered", async () => {
    const path = join(hostJsonDir, "stale.json");
    writeFileSync(path, JSON.stringify({ url: "http://127.0.0.1:9/mcp", token: "t", pid: 1, startedAt: "s" }));
    expect(await checkCollabHost(path, async () => false)).toEqual({ path, file: "present", url: "http://127.0.0.1:9/mcp", startedAt: "s", alive: false });
  });
  it("host.json that is not a handshake (no url/token) → invalid, never pinged", async () => {
    const path = join(hostJsonDir, "bad.json");
    writeFileSync(path, "{\"pid\":1}");
    let pinged = 0;
    expect(await checkCollabHost(path, async () => (pinged++, true))).toEqual({ path, file: "invalid" });
    expect(pinged).toBe(0);
  });
  it("isHandshake is the ONE validity rule: HostWatch.live() and checkCollabHost agree with it on every shape, and never ping an invalid one (R8)", async () => {
    const shapes: Record<string, string> = {
      valid: '{"url":"http://127.0.0.1:9/mcp","token":"t","pid":1,"startedAt":"s"}',
      noUrl: '{"token":"t","pid":1,"startedAt":"s"}',
      noToken: '{"url":"http://127.0.0.1:9/mcp","pid":1,"startedAt":"s"}',
      urlNotString: '{"url":1,"token":"t","startedAt":"s"}',
      tokenNotString: '{"url":"http://127.0.0.1:9/mcp","token":null,"startedAt":"s"}',
      number: "42",
      string: '"http://127.0.0.1:9/mcp"',
      array: "[]",
    };
    for (const [name, text] of Object.entries(shapes)) {
      const path = join(hostJsonDir, `shape-${name}.json`);
      writeFileSync(path, text);
      const valid = isHandshake(JSON.parse(text));
      expect(valid, name).toBe(name === "valid");
      let pinged = 0;
      const ping = async () => (pinged++, true);
      const live = await new HostWatch(() => JSON.parse(text), ping).live();
      expect(live !== null, `${name}: HostWatch.live`).toBe(valid);
      const r = await checkCollabHost(path, ping);
      expect(r.file, `${name}: checkCollabHost`).toBe(valid ? "present" : "invalid");
      expect(pinged, `${name}: pings`).toBe(valid ? 2 : 0);
    }
  });
});

// ── the real CLI, end to end ────────────────────────────────────────────────────────────────────────
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = join(root, "dist/mcp/cli.js");

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: root, stdio: "pipe" });
  expect(existsSync(cliJs)).toBe(true);
}, 60_000);

function runDoctorCli(args: string[], hostJson = join(tmpdir(), `slidecraft-doctor-none-${process.pid}.json`)): Promise<{ code: number | null; stdout: string; stderr: string }> {
  // By default a fresh host.json location: no live GUI host can be discovered, so the child runs solo.
  const env = { ...process.env, SLIDECRAFT_HOST_JSON: hostJson };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliJs, "--doctor", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const backstop = setTimeout(() => child.kill(), 25_000);
    child.on("close", (code) => {
      clearTimeout(backstop);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("slidecraft-mcp --doctor (real CLI)", () => {
  const IT = { timeout: 30_000, retry: 1 } as const;

  it("healthy solo server: exit 0, one screen with discover / initialize / tools and the --no-fs mode", IT, async () => {
    const { code, stdout } = await runDoctorCli([]);
    expect(stdout).toMatch(/server\/discover.*-32601/);
    expect(stdout).toMatch(/initialize.*slidecraft \d+\.\d+\.\d+/);
    expect(stdout).toMatch(new RegExp(`tools/list.*${await independentToolCount()} 本`));
    expect(stdout).toMatch(/モード.*solo/);
    expect(stdout).toMatch(/--root.*未指定/);
    expect(stdout.trimEnd().split("\n").at(-1)).toMatch(/^結果: OK/);
    expect(code).toBe(0);
  });

  it("--root is passed to the child and the scope it started with is shown", IT, async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-doctor-root-"));
    try {
      const { code, stdout } = await runDoctorCli(["--root", dir]);
      expect(stdout).toContain(dir);
      expect(stdout).toMatch(/scoped fs/);
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a bad --root: exit 1, the child's own error is on the report", IT, async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-doctor-file-"));
    const file = join(dir, "not-a-dir.txt");
    writeFileSync(file, "x");
    try {
      const { code, stdout } = await runDoctorCli(["--root", file]);
      expect(stdout).toMatch(/exit 2/);
      expect(stdout).toMatch(/slidecraft serve:/);
      expect(stdout.trimEnd().split("\n").at(-1)).toMatch(/^結果: NG/);
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("slidecraft-mcp --doctor (real CLI) — the collab host line (#736)", () => {
  const IT = { timeout: 30_000, retry: 1 } as const;

  it("no GUI host: the line says none, the verdict is still OK", IT, async () => {
    const { code, stdout } = await runDoctorCli([]);
    expect(stdout).toMatch(/協働ホスト.*なし（host\.json なし/);
    expect(code).toBe(0);
  });

  it("a live GUI host with host.json: ping answered with its URL — and no approval dialog was asked for", IT, async () => {
    const path = join(hostJsonDir, "cli-live.json");
    collab = await createCollabHost({ port: 0, hostJsonPath: path });
    const { code, stdout } = await runDoctorCli([], path);
    expect(stdout).toMatch(/協働ホスト.*host\.json あり・ping 応答あり/);
    expect(stdout).toContain(collab.url);
    expect(await pendingApprovals(collab)).toBe(0);
    expect(code).toBe(0);
  });
});
