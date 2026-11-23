/**
 * mcp-solo-builtin-presets-694.test.ts — #694: 単独モード（GUI 未接続の MCP サーバ。`.mcpb` で入れた直後は
 * 必ずこの状態）の組み込みテンプレに、エンジンの純粋関数（writePresetTemplate）で生成できる 3 プリセット
 * （Pitch・Executive・Campaign）を足す。`.pptx` は同梱しない。
 *
 *  (a) `--root` なしの単独モードで list_templates が midnight ＋ 3 プリセットを返す（id・順序・表示名を固定）。
 *      id と表示名は GUI の BUILTIN_MASTERS と一致（同じ名前で別物にしない・R8 一致テスト）。
 *  (b) R8 一致テスト: 単独モードで use_template(プリセット id) → export_pptx した PPTX と、GUI 経路
 *      （register_templates に public/ の出荷テンプレを登録 → use_template → export_pptx）の PPTX が
 *      byte-identical。zip のエントリ日時だけは生成時刻で変わるので、出荷物の生成と同じ withFixedDates で揃える。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { DocRegistry, MemTemplateStore, type HostContext } from "../src/mcp/host-core";
import { BUILTIN_MASTERS } from "../src/components/useMasterRegistry";
import { PRESET_ARTIFACTS, withFixedDates } from "../scripts/gen-preset-templates";

const ROOT = resolve(__dirname, "..");
const PRESET_IDS = ["builtin-pitch", "builtin-executive", "builtin-campaign"] as const;
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  const text = res.content[0]?.text ?? "null";
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text) as unknown;
}

async function connectServer(server: ReturnType<typeof buildServer>): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

/** 単独モード（--root なし・host 未指定＝stdio と同じ形）。 */
const connectSolo = () => connectServer(buildServer(createSession(null)));

/** GUI 経路: register_templates を受ける協働ホスト（gui ロール）。 */
function connectGui(): Promise<Client> {
  let active: string | undefined;
  const host: HostContext = {
    registry: new DocRegistry(),
    active: () => active,
    setActive: (_e, id) => { active = id; },
    sharedOnly: false,
    templates: new MemTemplateStore(),
    solo: false,
    notifyOpened: () => {},
    notifyClosed: () => {},
  };
  return connectServer(buildServer(createSession(null), { host }));
}

type ListRow = { id: string; name: string; builtin: boolean };

describe("(a) 単独モードの list_templates（#694）", () => {
  it("--root なしで midnight ＋ Pitch・Executive・Campaign を返す（id・順序・表示名を固定）", async () => {
    const list = (await call(await connectSolo(), "list_templates")) as { templates: ListRow[] };
    expect(list.templates).toEqual([
      { id: "midnight", name: "Midnight", builtin: true },
      { id: "builtin-pitch", name: "セールスピッチ Pitch", builtin: true },
      { id: "builtin-executive", name: "エグゼクティブ Executive", builtin: true },
      { id: "builtin-campaign", name: "マーケ Campaign", builtin: true },
    ]);
  });

  it("3 プリセットの id と表示名は GUI の BUILTIN_MASTERS と一致する（R8）", async () => {
    const list = (await call(await connectSolo(), "list_templates")) as { templates: ListRow[] };
    for (const id of PRESET_IDS) {
      const gui = BUILTIN_MASTERS.find((b) => b.id === id);
      expect(gui, id).toBeDefined();
      expect(list.templates.find((t) => t.id === id)?.name, id).toBe(gui!.name);
    }
  });
});

describe("(b) R8 一致テスト: 単独モードの書き出しが GUI 経路と byte-identical（#694）", () => {
  for (const id of PRESET_IDS) {
    it(`${id}: use_template → export_pptx の bytes が GUI 経路と同じ`, async () => {
      const gui = BUILTIN_MASTERS.find((b) => b.id === id)!;
      const shipped = readFileSync(resolve(ROOT, "public", gui.url.replace(/^\//, "")));
      const artifact = PRESET_ARTIFACTS.find((a) => a.templateOnly === `public${gui.url}`)!;
      expect(artifact, `${id} の見本原稿`).toBeDefined();
      const markdown = readFileSync(resolve(ROOT, artifact.showcaseMarkdown), "utf8");

      const exportVia = async (client: Client) => {
        const used = (await call(client, "use_template", { id, markdown })) as { docId: string };
        expect(used.docId).toBeTruthy();
        const info = (await call(client, "get_project_info")) as { templateName: string };
        expect(info.templateName).toBe(gui.name); // タブ名も GUI と同じ
        const out = (await call(client, "export_pptx")) as { dataBase64: string; skipped: number[] };
        expect(out.skipped).toEqual([]);
        return withFixedDates(new Uint8Array(Buffer.from(out.dataBase64, "base64")), FIXED_DATE);
      };

      const solo = await exportVia(await connectSolo());

      const guiClient = await connectGui();
      await call(guiClient, "register_templates", { templates: [{ id: gui.id, name: gui.name, builtin: true, bytesBase64: shipped.toString("base64") }] });
      const viaGui = await exportVia(guiClient);

      expect(Buffer.from(solo).equals(Buffer.from(viaGui))).toBe(true);
    }, 60_000);
  }
});
