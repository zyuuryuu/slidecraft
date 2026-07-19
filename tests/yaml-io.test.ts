/**
 * yaml-io.test.ts — js-yaml v5 移行ラッパーの v4 互換セマンティクス（空 → undefined・throw しない）。
 * v5 の `load("")` は YAMLException を投げるため、この互換層が全 load 経路の単一の盾になる（R8）。
 */
import { describe, it, expect } from "vitest";
import { loadYaml } from "../src/engine/yaml-io";

describe("loadYaml — v4 互換の空入力セマンティクス", () => {
  it("空文字は undefined（v5 素の load は throw する入力）", () => {
    expect(loadYaml("")).toBeUndefined();
  });
  it("空白・改行のみも undefined", () => {
    expect(loadYaml("  \n\t\n")).toBeUndefined();
  });
  it("通常の YAML はそのまま parse される", () => {
    expect(loadYaml("a: 1\nb: [x, y]")).toEqual({ a: 1, b: ["x", "y"] });
  });
});
