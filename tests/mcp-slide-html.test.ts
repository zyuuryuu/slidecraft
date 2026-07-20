/**
 * mcp-slide-html.test.ts — #242: `get_slide_html` returns ONE slide's current drawing as a
 * self-contained HTML string — the SAME shared rendering (`assembleSlidePage`) that
 * `get_slide_image` (#109) screenshots, exposed directly so a caller without a local Chrome/Edge
 * can rasterize with any means of its own (R8: no second render path — `renderSlideHtml` is
 * reused as-is from src/mcp/slide-raster.tsx, already unit-tested by mcp-slide-image.test.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

const TEMPLATE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const CJK_MD = "# 四半期経営レビュー\n> 経営企画部\n\n---\n\n# 現状分析\n\n- 売上高は前年比120%で推移\n- 新規顧客が32社増加";

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(TEMPLATE).toString("base64");
});

async function connect(): Promise<Client> {
  const server = buildServer(createSession(null));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

describe("MCP tool get_slide_html (end to end over the protocol)", () => {
  it("returns a non-empty self-contained HTML string with the slide's own CJK text and no <script>", async () => {
    const client = await connect();
    await client.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: CJK_MD } });

    const res = (await client.callTool({ name: "get_slide_html", arguments: { index: 1 } })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    const html = JSON.parse(res.content[0]!.text!) as string;
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("売上高は前年比120%で推移"); // the target slide's own text, not tofu
    expect(html).toContain("<style>");
    expect(html).toContain("@font-face"); // CJK font embedded — no external font dependency
    expect(html).not.toContain("<script");
    expect(html).toContain("script-src 'none'");
  });

  it("out-of-range index → the modeled { ok:false, code:'index-out-of-range' } envelope, not a crash", async () => {
    const client = await connect();
    await client.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: CJK_MD } });

    const bad = (await client.callTool({ name: "get_slide_html", arguments: { index: 99 } })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    expect(bad.isError).toBeFalsy(); // a modeled guard, not a transport-level error
    const parsed = JSON.parse(bad.content[0]!.text!) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("index-out-of-range");
  });
});
