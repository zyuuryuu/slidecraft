/**
 * mcp-result-contract.test.ts — client-side success判定 helper（isOk）。契約は
 * docs/mcp-server.md「エラー契約」節：成功 = {ok:false} でも isError:true でもない。
 * read 系ツールは payload をそのまま返し ok キーを持たない＝isOk は true を返す
 * （tool↔resource のミラー等価を壊さないための設計、Issue #246）。
 */
import { describe, it, expect } from "vitest";
import { isOk } from "../src/mcp/result-contract";

describe("isOk", () => {
  it("rejects a domain/guard-rejected envelope", () => {
    expect(isOk({ ok: false, error: "index out of range", code: "index-out-of-range" })).toBe(false);
  });

  it("accepts a raw read payload with no ok key (deck://current mirror)", () => {
    expect(isOk({ slides: [], meta: { title: "x" } })).toBe(true);
  });

  it("accepts a mutation envelope with ok:true", () => {
    expect(isOk({ ok: true, changed: true, diagnostics: [] })).toBe(true);
  });

  it("rejects a CallToolResult wrapper with isError:true (unmodeled crash)", () => {
    expect(isOk({ isError: true, content: [{ type: "text", text: "boom" }] })).toBe(false);
  });

  it("rejects a CallToolResult wrapper whose JSON payload carries ok:false", () => {
    expect(
      isOk({
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: "not opened", code: "project-not-opened" }) }],
      })
    ).toBe(false);
  });

  it("accepts a CallToolResult wrapper whose JSON payload is a plain read mirror", () => {
    expect(
      isOk({
        content: [{ type: "text", text: JSON.stringify({ slides: [] }) }],
      })
    ).toBe(true);
  });

  it("accepts non-object / null results (defensive default)", () => {
    expect(isOk(null)).toBe(true);
    expect(isOk(undefined)).toBe(true);
  });
});
