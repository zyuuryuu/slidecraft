/**
 * master-store.test.ts — マスターレジストリ永続化（テーマ2 S6 / Slice 1b）の純粋部分。
 * index.json のパースは信頼できない入力（手編集・部分破損）に対して安全に縮退すること:
 * 壊れた JSON / 配列でない / 型不正エントリは黙って捨て、正しいエントリだけ残す。
 * （Tauri fs への実書込はデスクトップ実機の領域 — ここでは純粋ロジックのみを担保する。）
 */
import { describe, it, expect } from "vitest";
import { parseMasterIndex, serializeMasterIndex } from "../src/ipc/master-store";

describe("parseMasterIndex（防御的パース）", () => {
  it("round-trip: serialize → parse で同一", () => {
    const entries = [
      { id: "m1", name: "Corporate" },
      { id: "m2", name: "Forest Report" },
    ];
    expect(parseMasterIndex(serializeMasterIndex(entries))).toEqual(entries);
  });

  it("壊れた JSON → []", () => {
    expect(parseMasterIndex("{oops")).toEqual([]);
    expect(parseMasterIndex("")).toEqual([]);
  });

  it("配列でない JSON → []", () => {
    expect(parseMasterIndex(`{"id":"m1"}`)).toEqual([]);
    expect(parseMasterIndex("42")).toEqual([]);
  });

  it("型不正エントリは捨て、正しいものだけ残す", () => {
    const dirty = JSON.stringify([
      { id: "m1", name: "OK" },
      { id: "builtin", name: "偽内蔵" }, // 内蔵 id の偽装は拒否
      { id: "x9", name: "bad id" }, // m<number> 形式のみ
      { id: "m2" }, // name 欠落
      "garbage",
      null,
      { id: "m3", name: "OK2" },
    ]);
    expect(parseMasterIndex(dirty)).toEqual([
      { id: "m1", name: "OK" },
      { id: "m3", name: "OK2" },
    ]);
  });
});
