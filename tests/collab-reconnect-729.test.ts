/**
 * collab-reconnect-729.test.ts — #729 (ADR-0040 D1–D3, #688 の受け入れ基準): 起動の順序を入れ替えても、AI アプリ
 * （ここでは stdio のクライアント）を起動し直さずに GUI の協働ホストへつながることを、本物の部品だけで固定する。
 *  - アダプタ: ビルドした `dist/mcp/cli.js`（`slidecraft mcp`）を子プロセスとして起動し、SDK の stdio クライアントで駆動。
 *  - ホスト: `createCollabHost`（GUI のサイドカーと同じ Node 実装）をテストの中で起動・停止する。`host.json` と
 *    資格情報ファイルは一時ディレクトリに置き、`SLIDECRAFT_HOST_JSON` で差し替える（本物の利用者の物に触れない）。
 *  - GUI: 本物は起動しない。GUI 専用トークンでホストにつなぎ、承認ツール（#727）で［許可］／［拒否］／［取り消し］を
 *    送り、keychain 相当の許可は `load_client_grants` で渡す役を演じる。
 * 時間に依存しないよう、ポートは 0（OS が割り当てる）、待ちは上限付きのポーリング（`until`）。
 * 既知の制限（PR #735）: 転送中にホストが落ちた「その呼び出し」には答えないことがある。ここでは落ちた後の
 * 「次の呼び出しで単独に戻る」だけを固定し、ホストが落ちている最中の呼び出しは行わない（ホストを止め終えてから呼ぶ）。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import type { ApprovalView } from "../src/mcp/host-approval";
import { credentialPath } from "../src/mcp/client-credentials";
import { readHostJson } from "../src/mcp/host-json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = join(root, "dist/mcp/cli.js");
const templateB64 = readFileSync(join(root, "tests/fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
/** 単独モードの組み込み一覧（#694: midnight ＋ 3 プリセット）。 */
const BUILTIN_IDS = ["midnight", "builtin-pitch", "builtin-executive", "builtin-campaign"];
/** GUI 役がホストへ載せる（seed する）テンプレ。単独の組み込みと区別できる id にする。 */
const GUI_TEMPLATE = { id: "gui-company-1", name: "GUI の社内テンプレ", builtin: false, bytesBase64: templateB64 };
const AI_INFO = { name: "Claude Desktop", version: "0.9.0" };
const IT = { timeout: 60_000 } as const;

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: root, stdio: "pipe" });
  expect(existsSync(cliJs)).toBe(true);
}, 60_000);

let dir = "";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const freshDir = (): string => (dir = mkdtempSync(join(tmpdir(), "slidecraft-729-")));
const hostJsonOf = (d: string): string => join(d, "host.json");

type Result = Record<string, unknown> & { note?: string; code?: string };
const parse = (r: unknown): Result => JSON.parse((r as { content: { text: string }[] }).content[0].text) as Result;
const callOn = async (c: Client, name: string, args: Record<string, unknown> = {}): Promise<Result> => parse(await c.callTool({ name, arguments: args }));
const templateIds = (r: Result): string[] => ((r.templates ?? []) as { id: string }[]).map((t) => t.id);

/** 上限付きのポーリング（固定の sleep に頼らない）。 */
async function until<T>(what: string, probe: () => Promise<T | undefined> | T | undefined, limitMs = 10_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() - t0 > limitMs) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** AI アプリの代わり: 本物のアダプタ（dist/mcp/cli.js）を stdio で起動する。テストの途中で起動し直さない。 */
async function startAdapter(d: string): Promise<{ ai: Client; listChanged: () => number }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliJs],
    env: { ...(process.env as Record<string, string>), SLIDECRAFT_HOST_JSON: hostJsonOf(d) },
    stderr: "pipe",
  });
  const ai = new Client(AI_INFO, { capabilities: {} });
  let changed = 0;
  ai.fallbackNotificationHandler = async (n) => void (n.method === "notifications/tools/list_changed" && changed++);
  await ai.connect(transport);
  cleanups.push(() => ai.close());
  return { ai, listChanged: () => changed };
}

interface Gui { host: CollabHost; gui: Client }

/** GUI を起動したことの代わり: ホストを起動して host.json を書き、GUI 専用トークンで GUI 役がつなぐ。 */
async function startGuiHost(d: string, opts: { seed?: boolean; seedWaitMs?: number } = {}): Promise<Gui> {
  const host = await createCollabHost({ port: 0, hostJsonPath: hostJsonOf(d), approvalWaitMs: 100, seedWaitMs: opts.seedWaitMs ?? 100 });
  let closed = false;
  const stop = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await gui.close().catch(() => {});
    await host.close();
  };
  const gui = new Client({ name: "slidecraft-gui", version: "1" });
  await gui.connect(new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers: { Authorization: `Bearer ${host.guiToken}` } } }));
  cleanups.push(stop);
  if (opts.seed !== false) expect(await callOn(gui, "register_templates", { templates: [GUI_TEMPLATE] })).toMatchObject({ ok: true, count: 1 });
  return Object.assign({ host, gui }, { stop }) as Gui & { stop: () => Promise<void> };
}
const stopGui = (g: Gui): Promise<void> => (g as Gui & { stop: () => Promise<void> }).stop();

const approvals = async (g: Gui): Promise<ApprovalView> => (await callOn(g.gui, "list_client_approvals")) as unknown as ApprovalView;
/** GUI のダイアログで答える。許可ならアダプタ用の grant（GUI が keychain に保存する物）を返す。 */
async function answer(g: Gui, decision: "allow" | "deny"): Promise<Record<string, string> | undefined> {
  const [req] = await until("an approval request in the GUI", async () => ((await approvals(g)).pending.length ? (await approvals(g)).pending : undefined));
  expect(req).toMatchObject({ kind: "adapter", name: AI_INFO.name, version: AI_INFO.version });
  const r = await callOn(g.gui, "decide_client_approval", { requestId: req.requestId, decision });
  return r.grant as Record<string, string> | undefined;
}
const credentialOf = (d: string): { clientId?: string; secret?: string } => {
  try {
    return JSON.parse(readFileSync(credentialPath(hostJsonOf(d), AI_INFO.name), "utf8")) as { clientId?: string; secret?: string };
  } catch {
    return {};
  }
};
/** 許可の後、アダプタが claim を秘密と引き換えて資格情報ファイルに保存するのを待つ（非同期に行われる）。 */
const secretSaved = (d: string): Promise<string> => until("the secret in the credential file", () => credentialOf(d).secret);

describe("#688 受け入れ基準 1: AI アプリが先・GUI が後でも、起動し直さずにつながる", () => {
  it("単独で組み込み一覧 → GUI を起動 → authorization-pending → ［許可］→ 次の list_templates で GUI のテンプレ", IT, async () => {
    const d = freshDir();
    const { ai, listChanged } = await startAdapter(d);
    const solo = await callOn(ai, "list_templates");
    expect(templateIds(solo)).toEqual(BUILTIN_IDS);
    expect(String(solo.note)).not.toContain("協働ホスト"); // 単独の常設の案内だけ（乗り換えの note ではない）

    const g = await startGuiHost(d);
    expect(await callOn(ai, "list_templates")).toMatchObject({ ok: false, code: "authorization-pending" });
    expect(listChanged()).toBeGreaterThanOrEqual(1); // solo → forward は tools/list_changed で知らされる
    await answer(g, "allow");
    const fwd = await callOn(ai, "list_templates");
    expect(fwd.templates).toEqual([{ id: GUI_TEMPLATE.id, name: GUI_TEMPLATE.name, builtin: false }]);
    expect(await secretSaved(d)).toBeTruthy();
  });
});

describe("#688 受け入れ基準 2: GUI を終了して起動し直しても、起動し直さずにつながり直る", () => {
  it("転送中にホストを止める → 次は単独（host-lost の note）→ 再起動（keychain の許可）→ ダイアログ無しで転送へ", IT, async () => {
    const d = freshDir();
    const { ai } = await startAdapter(d);
    const g1 = await startGuiHost(d);
    expect(await callOn(ai, "list_templates")).toMatchObject({ code: "authorization-pending" });
    const grant = await answer(g1, "allow");
    expect(grant).toMatchObject({ name: AI_INFO.name, version: AI_INFO.version });
    expect(templateIds(await callOn(ai, "list_templates"))).toEqual([GUI_TEMPLATE.id]);
    await secretSaved(d);
    const firstUrl = g1.host.url;

    await stopGui(g1); // GUI を終了（host.json も消える）
    expect(existsSync(hostJsonOf(d))).toBe(false);
    const back = await callOn(ai, "list_templates");
    expect(templateIds(back)).toEqual(BUILTIN_IDS);
    expect(back.note).toContain("単独モードに戻りました");
    expect(String((await callOn(ai, "list_templates")).note)).not.toContain("単独モードに戻りました"); // 告げるのは 1 回だけ

    const g2 = await startGuiHost(d); // 新しい port・token
    expect(g2.host.url).not.toBe(firstUrl);
    expect(await callOn(g2.gui, "load_client_grants", { grants: [grant] })).toMatchObject({ ok: true, count: 1 });
    const again = await callOn(ai, "list_templates");
    expect(templateIds(again)).toEqual([GUI_TEMPLATE.id]); // HMAC で通る（承認待ちにならない）
    const view = await approvals(g2);
    expect(view.pending).toHaveLength(0); // ダイアログは出ていない
    expect(view.grants).toHaveLength(1);
  });
});

describe("単独の deck は捨てない（ADR-0040 D2）", () => {
  it("new_project の後に GUI を起動 → 乗り換えず note で close_document を案内 → 閉じた後の呼び出しで転送", IT, async () => {
    const d = freshDir();
    const { ai } = await startAdapter(d);
    const made = await callOn(ai, "new_project", { templateBase64: templateB64, markdown: "# 単独の deck\n\n## 1 枚目\n- 本文" });
    const docId = made.docId as string;
    expect(docId).toBeTruthy();

    const g = await startGuiHost(d);
    const stay = await callOn(ai, "get_project_info");
    expect(stay.note).toContain("close_document");
    expect(stay.note).toContain(docId);
    expect((await approvals(g)).pending).toHaveLength(0); // 乗り換えていない＝申し込みもしていない

    const closed = await callOn(ai, "close_document", { docId, force: true });
    expect(closed).not.toMatchObject({ ok: false });
    expect(await callOn(ai, "list_templates")).toMatchObject({ code: "authorization-pending" });
    await answer(g, "allow");
    expect(templateIds(await callOn(ai, "list_templates"))).toEqual([GUI_TEMPLATE.id]);
  });
});

describe("承認の拒否・取り消し（ADR-0040 D3）", () => {
  it("［拒否］→ 単独のまま動き、そのホストの起動中は申し込み直さない", IT, async () => {
    const d = freshDir();
    const { ai } = await startAdapter(d);
    const g = await startGuiHost(d);
    expect(await callOn(ai, "list_templates")).toMatchObject({ code: "authorization-pending" });
    await answer(g, "deny");
    const denied = await callOn(ai, "list_templates");
    expect(denied).toMatchObject({ ok: false, code: "authorization-denied" });
    expect(denied.note).toContain("単独モード");

    const solo = await callOn(ai, "list_templates");
    expect(templateIds(solo)).toEqual(BUILTIN_IDS);
    expect(await callOn(ai, "list_templates")).not.toHaveProperty("code");
    expect((await approvals(g)).pending).toHaveLength(0); // 2 度目のダイアログは出ない
  });

  it("［取り消し］→ authorization-revoked → 秘密を消して申し込み直す（承認待ちに戻る）", IT, async () => {
    const d = freshDir();
    const { ai } = await startAdapter(d);
    const g = await startGuiHost(d);
    expect(await callOn(ai, "list_templates")).toMatchObject({ code: "authorization-pending" });
    await answer(g, "allow");
    expect(templateIds(await callOn(ai, "list_templates"))).toEqual([GUI_TEMPLATE.id]);
    const { clientId } = credentialOf(d);
    await secretSaved(d);

    const [grantRow] = (await approvals(g)).grants;
    expect(await callOn(g.gui, "revoke_client_approval", { key: grantRow.key })).toMatchObject({ ok: true });
    const revoked = await callOn(ai, "list_templates");
    expect(revoked).toMatchObject({ ok: false, code: "authorization-revoked" });
    expect(revoked.note).toContain("申し込み直しました");
    expect(credentialOf(d)).toEqual({ clientId }); // 秘密だけを消し、client ID は残す（PR #735 の判断 2）

    await until("the re-application in the GUI", async () => ((await approvals(g)).pending.length ? true : undefined));
    expect(await callOn(ai, "list_templates")).toMatchObject({ code: "authorization-pending" });
    await answer(g, "allow");
    expect(templateIds(await callOn(ai, "list_templates"))).toEqual([GUI_TEMPLATE.id]);
  });
});

describe("seed 前の呼び出し（ADR-0040 D1）", () => {
  it("GUI の seed が終わる前は host-not-ready → seed が終わった後の呼び出しは通る", IT, async () => {
    const d = freshDir();
    const { ai } = await startAdapter(d);
    const g = await startGuiHost(d, { seed: false });
    expect(await callOn(g.gui, "report_seed", { state: "pending" })).toMatchObject({ ok: true });
    expect(await callOn(ai, "list_templates")).toMatchObject({ code: "authorization-pending" });
    await answer(g, "allow");
    expect(await callOn(ai, "list_templates")).toMatchObject({ ok: false, code: "host-not-ready" });
    expect((await approvals(g) as ApprovalView & { aiActive: boolean }).aiActive).toBe(true); // GUI に seed を頼んだ

    await callOn(g.gui, "register_templates", { templates: [GUI_TEMPLATE] });
    await callOn(g.gui, "report_seed", { state: "done" });
    expect(templateIds(await callOn(ai, "list_templates"))).toEqual([GUI_TEMPLATE.id]);
  });
});

describe("古い host.json と loopback", () => {
  it("プロセスの死んだホストの host.json が残っていても、単独で答え、呼び出しのたびに長く待たない", IT, async () => {
    const d = freshDir();
    const dead = await createCollabHost({ port: 0, hostJsonPath: null });
    const stale = { url: dead.url, token: dead.token, pid: 999_999, startedAt: "2026-11-24T00:00:00.000Z" };
    await dead.close(); // そのポートではもう誰も待ち受けていない
    writeFileSync(hostJsonOf(d), JSON.stringify(stale), { mode: 0o600 });

    const { ai } = await startAdapter(d);
    // 上限は ping の打ち切り（1.5 秒）を 1 回分含めた余裕。閉じたポートは接続拒否がすぐ返るので、ここで固定するのは
    // 「固まらずに単独で答える」ことまで（同じ中身へ 2 度 ping しないことは adaptive-front-decide.test.ts の HostWatch が固定済み）。
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) {
      const r = await callOn(ai, "list_templates");
      expect(templateIds(r)).toEqual(BUILTIN_IDS);
      expect(String(r.note)).not.toContain("協働ホスト"); // 死んだホストを「見つかった」と扱わない
    }
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("ホストの待ち受けは 127.0.0.1（host.json の URL）", IT, async () => {
    const d = freshDir();
    const g = await startGuiHost(d, { seed: false });
    const hs = readHostJson(hostJsonOf(d));
    expect(hs?.url).toBe(g.host.url);
    expect(new URL(hs!.url).hostname).toBe("127.0.0.1");
  });
});
