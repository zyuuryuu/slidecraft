/**
 * verify-cask.test.ts — Issue #287: Homebrew cask の「version だけ進んで sha256 が据え置き」
 * という不整合（v0.4.0 で実際に踏んだ）を CI で捕まえる照合のユニットテスト。
 *
 * 照合の中身は純関数 `caskMatchesSums`（scripts/update-cask.mjs — cask を「書く」側と同じ
 * sha256 の読み方・同じ dmg ファイル名規約を共有。R8: 同じ計算を 2 経路に増やさない）。
 * `scripts/verify-cask.mjs` はこれを cask の version 字段 → その版の公開 release の
 * SHA256SUMS アセット fetch に配線する（Issue #287 コメントの訂正方針 — release.yml への
 * 配線はタグ時点で sha が構造的に前サイクル値のため毎回 false red になる）。fetch は注入
 * できるので、ここでは mock で「一致 → ok / stale → fail / 未公開 version（404 等）→ fail」
 * の 3 経路を固定する（never-silent: 失敗は必ず exit 1 側に落ちる）。
 */
import { describe, it, expect } from "vitest";
import { caskMatchesSums, parseCaskShas, parseCaskVersion } from "../scripts/update-cask.mjs";
import { verifyCask } from "../scripts/verify-cask.mjs";

const ARM_SHA = "e2d27919ad59b26660636a4c34f56b995b2c9d18164b750f1cbc480f5f3e43fe";
const INTEL_SHA = "df4522762b96222e4735d2ad15738139f07ed0072b8cce6d29454b65d2e2825b";
const OTHER_SHA = "0e882e65251a22d6b9b1825e3f2fea2600c9f9a4d218f12541f8dd2ff18764e8";

const armOnlyCask = (sha: string, version = "0.4.0") => `
cask "slidecraft" do
  version "${version}"
  sha256 "${sha}"

  url "https://github.com/zyuuryuu/slidecraft/releases/download/v#{version}/SlideCraft_#{version}_aarch64.dmg"
end
`;

const armIntelCask = (arm: string, intel: string) => `
cask "slidecraft" do
  version "0.4.0"

  on_arm do
    sha256 "${arm}"
  end
  on_intel do
    sha256 "${intel}"
  end
end
`;

const sums = (...lines: [string, string][]) => lines.map(([sha, name]) => `${sha}  ${name}`).join("\n") + "\n";

describe("parseCaskShas / parseCaskVersion", () => {
  it("extracts sha256 hex strings in file order", () => {
    expect(parseCaskShas(armOnlyCask(ARM_SHA))).toEqual([ARM_SHA]);
    expect(parseCaskShas(armIntelCask(ARM_SHA, INTEL_SHA))).toEqual([ARM_SHA, INTEL_SHA]);
  });

  it("returns an empty array when there are no sha256 lines", () => {
    expect(parseCaskShas('cask "slidecraft" do\n  version "0.4.0"\nend\n')).toEqual([]);
  });

  it("reads the version field the same way update-cask writes it", () => {
    expect(parseCaskVersion(armOnlyCask(ARM_SHA, "0.4.1"))).toBe("0.4.1");
    expect(parseCaskVersion('cask "slidecraft" do\nend\n')).toBeNull();
  });
});

describe("caskMatchesSums", () => {
  it("matches when the cask's sha256 equals the SHA256SUMS entry for that version (arm64-only)", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    expect(caskMatchesSums(armOnlyCask(ARM_SHA), s, "0.4.0")).toBe(true);
  });

  it("does NOT match when the cask's sha256 is stale (version bumped, sha256 left behind — the #287 bug)", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    expect(caskMatchesSums(armOnlyCask(OTHER_SHA), s, "0.4.0")).toBe(false);
  });

  it("does NOT match when SHA256SUMS has no entry for the requested version", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.3.0_aarch64.dmg"]);
    expect(caskMatchesSums(armOnlyCask(ARM_SHA), s, "0.4.0")).toBe(false);
  });

  it("matches an arm+intel cask only when BOTH sha256 lines agree with SHA256SUMS", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"], [INTEL_SHA, "SlideCraft_0.4.0_x64.dmg"]);
    expect(caskMatchesSums(armIntelCask(ARM_SHA, INTEL_SHA), s, "0.4.0")).toBe(true);
  });

  it("does NOT match an arm+intel cask when only one arch's sha256 is stale", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"], [INTEL_SHA, "SlideCraft_0.4.0_x64.dmg"]);
    expect(caskMatchesSums(armIntelCask(ARM_SHA, OTHER_SHA), s, "0.4.0")).toBe(false);
  });

  it("does NOT match a malformed cask with zero sha256 lines (never silently pass)", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    expect(caskMatchesSums('cask "slidecraft" do\n  version "0.4.0"\nend\n', s, "0.4.0")).toBe(false);
  });
});

describe("verifyCask — cask の version 字段 → 公開 SHA256SUMS fetch → 照合（fetch 注入 mock）", () => {
  const okFetch = (body: string) => async () => new Response(body, { status: 200 });
  const notFound = async () => new Response("Not Found", { status: 404 });

  it("公開 SHA256SUMS と一致 → ok（CLI は exit 0）", async () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    const r = await verifyCask(armOnlyCask(ARM_SHA), okFetch(s));
    expect(r.ok).toBe(true);
  });

  it("stale（cask の sha256 が公開物と不一致）→ fail（CLI は exit 1）", async () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    const r = await verifyCask(armOnlyCask(OTHER_SHA), okFetch(s));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("update-cask");
  });

  it("未公開 version（SHA256SUMS が 404）→ fail（never-silent / CLI は exit 1）", async () => {
    const r = await verifyCask(armOnlyCask(ARM_SHA, "9.9.9"), notFound);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("404");
  });

  it("fetch 自体の失敗（ネットワーク例外）→ fail（throw ではなく exit 1 に落ちる）", async () => {
    const r = await verifyCask(armOnlyCask(ARM_SHA), async () => {
      throw new Error("network down");
    });
    expect(r.ok).toBe(false);
  });

  it("照合 URL は cask の version から組み立てる（その版の公開 release の SHA256SUMS）", async () => {
    const urls: string[] = [];
    const s = sums([ARM_SHA, "SlideCraft_0.4.1_aarch64.dmg"]);
    await verifyCask(armOnlyCask(ARM_SHA, "0.4.1"), async (url: string) => {
      urls.push(url);
      return new Response(s, { status: 200 });
    });
    expect(urls).toEqual(["https://github.com/zyuuryuu/slidecraft/releases/download/v0.4.1/SHA256SUMS"]);
  });
});
