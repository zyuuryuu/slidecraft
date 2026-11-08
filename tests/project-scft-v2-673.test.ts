/**
 * project-scft-v2-673.test.ts — #673: `figures[]` を含むデッキの `.scft` だけ version 2 にする。
 *
 * 背景: #392 段 3 で `.scft` は v1 据え置きにした（正は単数フィールド）。だが `figures`（2 件目以降の
 * ビジュアル）を含むデッキを旧アプリで開くと、zod が未知フィールドを黙って落として 2 件目以降が消える。
 * そこで `figures` を含むときだけ meta.json.version を 2 にし、旧アプリの version ゲート（#121
 * migrateProjectDeck）に「アプリを更新して」で止めさせる（never-silent）。
 *
 * - `figures` 付き → version 2 で保存・再読込で DeckIR 同一。
 * - `figures` 無し → version 1 のまま、deck.json / meta.json が段 0 の fixture と byte-identical。
 * - version 2 を旧ゲート（PROJECT_VERSION = 1・移行表は空＝#121〜#392 段 3 の出荷状態）で読むと
 *   PROJECT_VERSION_TOO_NEW で開けない（黙って落ちない）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { openProject, bundleProject, migrateProjectDeck, projectVersionFor, PROJECT_VERSION, ProjectVersionError } from "../src/engine/project-io";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { DeckIRSchema } from "../src/engine/slide-schema";
import { slideFigures } from "../src/engine/slide-figures";

const ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(ROOT, "tests/fixtures/projects/visuals-v1.scft");
const DIAG = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id + "\n```";
const META = { templateName: "t", savedAt: "2026-11-08T00:00:00.000Z" };
const TWO_FIGS = `# 表紙\n\n---\n\n# 図 2 つ\n\n${DIAG("one")}\n\n${DIAG("two")}`;
const ONE_FIG = `# 表紙\n\n---\n\n# 図 1 つ\n\n${DIAG("one")}`;
/** The `.scft` gate as shipped from #121 up to #392 段 3: v1 is current and there are no migrations. */
const OLD_BUILD = { current: 1, migrations: {} } as const;

const entry = async (bytes: Uint8Array | Buffer, name: string) => (await JSZip.loadAsync(bytes)).file(name)!.async("string");
const metaVersion = async (bytes: Uint8Array | Buffer) => JSON.parse(await entry(bytes, "meta.json")).version as number;

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(resolve(ROOT, "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx")));
});

describe("#673: which version a deck is saved as", () => {
  it("figures 無し（1 ビジュアル・ビジュアル無し）は 1、figures を持つスライドが 1 枚でもあれば 2", () => {
    expect(projectVersionFor(parseMd("# 表紙\n\n---\n\n# 中身\n\n- a"))).toBe(1);
    expect(projectVersionFor(parseMd(ONE_FIG))).toBe(1);
    const two = parseMd(TWO_FIGS);
    expect(two.slides[1].figures).toHaveLength(2);
    expect(projectVersionFor(two)).toBe(2);
  });
  it("this build reads v2 natively (2 is the newest format it writes)", () => {
    expect(PROJECT_VERSION).toBe(2);
  });
});

describe("#673: figures 付き → version 2・round-trip", () => {
  it("meta.json.version は 2、再読込で DeckIR 同一（figures 保持）", async () => {
    const deck = parseMd(TWO_FIGS);
    const bytes = await bundleProject(deck, tpl, META);
    expect(await metaVersion(bytes)).toBe(2);
    const opened = await openProject(bytes);
    expect(opened.meta).toEqual({ version: 2, ...META });
    expect(opened.deck).toEqual(deck);
    expect(slideFigures(opened.deck.slides[1])).toHaveLength(2);
  });
  it("v2 を開いて figures を消したデッキは v1 に戻る（version は保存のたびにデッキから決まる）", async () => {
    const deck = parseMd(TWO_FIGS);
    const opened = await openProject(await bundleProject(deck, tpl, META));
    const { figures: _drop, ...single } = opened.deck.slides[1];
    void _drop;
    const back = { ...opened.deck, slides: [opened.deck.slides[0], single] };
    expect(await metaVersion(await bundleProject(back, tpl, opened.meta))).toBe(1);
  });
});

describe("#673: figures 無し → version 1 のまま byte-identical", () => {
  it("段 0 の fixture を開いて保存し直すと meta.json / deck.json が fixture と同じバイト列", async () => {
    const fixture = readFileSync(FIXTURE);
    const { deck, template, meta } = await openProject(fixture);
    const again = await bundleProject(deck, template, meta);
    expect(await entry(again, "meta.json")).toBe(await entry(fixture, "meta.json"));
    expect(await entry(again, "deck.json")).toBe(await entry(fixture, "deck.json"));
  });
});

describe("#673: version 2 を旧ゲートで読む → 黙って落ちない", () => {
  it("旧ビルドのゲート（v1・移行表なし）は v2 の deck を PROJECT_VERSION_TOO_NEW で拒否する", async () => {
    const bytes = await bundleProject(parseMd(TWO_FIGS), tpl, META);
    const raw = JSON.parse(await entry(bytes, "deck.json"));
    const v = await metaVersion(bytes);
    expect(() => migrateProjectDeck(raw, v, OLD_BUILD.current, OLD_BUILD.migrations)).toThrow(ProjectVersionError);
    try {
      migrateProjectDeck(raw, v, OLD_BUILD.current, OLD_BUILD.migrations);
    } catch (e) {
      expect(e).toMatchObject({ code: "PROJECT_VERSION_TOO_NEW", fileVersion: 2, supportedVersion: 1 });
      expect((e as Error).message).toMatch(/新しいバージョン.*アプリを更新/);
    }
  });
  it("（拒否が要る理由の固定）ゲートが無ければ旧 schema 相当の zod は figures を黙って落とす", async () => {
    // 旧ビルドの DeckIR schema には figures が無かった。今の schema から figures を外して再現する。
    const deck = parseMd(TWO_FIGS);
    const oldSlide = DeckIRSchema.shape.slides.element.omit({ figures: true });
    const parsed = oldSlide.parse(JSON.parse(JSON.stringify(deck.slides[1])));
    expect("figures" in parsed).toBe(false);
    expect(slideFigures(parsed as typeof deck.slides[1])).toHaveLength(1); // 2 件目が消える
  });
});

describe("#673: this build opens both 1 and 2", () => {
  it("v1 は 1→2 の移行（恒等）で同じ deck のまま開く", async () => {
    const raw = JSON.parse(await entry(readFileSync(FIXTURE), "deck.json"));
    expect(migrateProjectDeck(raw, 1)).toEqual(raw);
    const { deck, meta } = await openProject(readFileSync(FIXTURE));
    expect(meta.version).toBe(1);
    expect(deck).toEqual(raw);
  });
  it("v3 は今のビルドでも開けない（ゲートは不変）", () => {
    expect(() => migrateProjectDeck({ slides: [] }, 3)).toThrow(/アプリを更新/);
  });
});
