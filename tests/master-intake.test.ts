/**
 * master-intake.test.ts — slide-master Initialize robustness (the level-up).
 * Mutates the canonical + alien templates the way the pathological-master probe did, and
 * asserts: (P1) role RECOVERY when type is stripped, (P3) the acceptance GATE, while the
 * untouched Baseline stays byte-for-byte identical. Lessons baked in from the probe +
 * adversarial review: canonical uniquely has full per-placeholder geometry; the alien
 * template inherits xfrm (w=0,h=0) on many placeholders incl. the title — so geometry
 * recovery is a BONUS, not the general rescue.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, placeholderRole, assessTemplateHealth, classifyLayout } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";

const dir = "../public/templates/slide/";
const bytesOf = (f: string) => readFileSync(resolve(__dirname, dir + f));
const CANON = "Midnight_Executive_30_TemplateOnly.pptx";
const ALIEN = "lrk-slides-velis_CC0.pptx";

// ── Mutators (mirror the probe): operate on slideLayout/slideMaster XML inside the pptx ──
const scrambleNames = (xml: string) => xml.replace(/name="[^"]*"/g, (m) => `name="X${m.length}z"`);
const breakTypes = (xml: string) =>
  xml
    .replace(/(<p:ph\b)([^>]*?)\s*type="[^"]*"/g, "$1$2") // strip semantic type
    .replace(/(<p:ph\b[^>]*?\bidx=")(\d+)(")/g, (_m, p, n, s) => `${p}${Number(n) + 30}${s}`); // idx → non-conventional
const stripGeometry = (xml: string) => xml.replace(/<(\w+:)?xfrm[\s\S]*?<\/(\w+:)?xfrm>/g, ""); // remove position/size
const breakEverything = (xml: string) => scrambleNames(stripGeometry(breakTypes(xml))); // no type, no idx, no geometry, no name

async function mutate(srcBytes: Uint8Array, transform: (x: string) => string): Promise<TemplateData> {
  const zip = await JSZip.loadAsync(srcBytes);
  const targets = Object.keys(zip.files).filter((n) => /ppt\/slide(Layouts|Masters)\/.*\.xml$/.test(n));
  for (const n of targets) zip.file(n, transform(await zip.files[n].async("string")));
  return loadTemplate(await zip.generateAsync({ type: "uint8array" }));
}

const isPptx = (b: Uint8Array) => b.length > 1000 && b[0] === 0x50 && b[1] === 0x4b;
const SAMPLE = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n\n---\n\n# まとめ\n\n- ありがとう";

function rolesOf(tpl: TemplateData): Set<string> {
  const s = new Set<string>();
  for (const lyt of tpl.layouts) for (const ph of lyt.placeholders) s.add(placeholderRole(ph));
  return s;
}
async function contentSurvives(tpl: TemplateData): Promise<boolean> {
  const catalog = buildCatalog(tpl);
  const bytes = await generatePptx(distillDeck(parseMd(SAMPLE), catalog), tpl);
  if (!isPptx(bytes)) return false;
  const z = await JSZip.loadAsync(bytes);
  const names = Object.keys(z.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n));
  const text = (await Promise.all(names.map((n) => z.files[n].async("string")))).join("");
  return ["表紙", "中身", "速度", "まとめ"].every((t) => text.includes(t));
}

let canon: TemplateData;
beforeAll(async () => {
  canon = await loadTemplate(bytesOf(CANON));
});

describe("master intake — Baseline preserved", () => {
  it("canonical roles are correct + content survives (status quo unchanged)", async () => {
    const roles = rolesOf(canon);
    expect(roles.has("title")).toBe(true);
    expect(roles.has("body")).toBe(true);
    expect(roles.has("subtitle")).toBe(true);
    expect(await contentSurvives(canon)).toBe(true);
  });
});

describe("P1 role recovery — typeless placeholders don't collapse to body", () => {
  it("loader: a type-stripped placeholder carries type '' (not fabricated 'body')", async () => {
    const broken = await mutate(bytesOf(CANON), breakTypes);
    const allPh = broken.layouts.flatMap((l) => l.placeholders);
    expect(allPh.length).toBeGreaterThan(0);
    expect(allPh.some((p) => p.type === "")).toBe(true); // sentinel, not "body"
    expect(allPh.every((p) => p.type !== "body" || p.type === "")).toBe(true);
  });

  it("VARIANT B canonical (type stripped, geometry intact): title+body RECOVER, content survives", async () => {
    const broken = await mutate(bytesOf(CANON), breakTypes);
    const roles = rolesOf(broken);
    expect(roles.has("title")).toBe(true); // recovered via geometry (canonical has xfrm)
    expect(roles.has("body")).toBe(true); // recovered via area fallback
    expect(await contentSurvives(broken)).toBe(true);
  });

  it("VARIANT A canonical (names garbage, type/idx intact): roles UNCHANGED (names are noise)", async () => {
    const renamed = await mutate(bytesOf(CANON), scrambleNames);
    const roles = rolesOf(renamed);
    expect(roles.has("title")).toBe(true);
    expect(roles.has("body")).toBe(true);
    expect(await contentSurvives(renamed)).toBe(true);
  });

  it("ALIEN template still binds (title/body from TYPE; many placeholders inherit xfrm)", async () => {
    const alien = await loadTemplate(bytesOf(ALIEN));
    expect(rolesOf(alien).has("title")).toBe(true);
    expect(await contentSurvives(alien)).toBe(true);
  });
});

describe("P3 acceptance gate — lenient: reject ONLY structural impossibility", () => {
  it("canonical Baseline → ok", () => {
    expect(assessTemplateHealth(buildCatalog(canon)).status).toBe("ok");
  });

  it("ALIEN template is NOT rejected (false-reject guard — title/body from TYPE)", async () => {
    const alien = await loadTemplate(bytesOf(ALIEN));
    expect(assessTemplateHealth(buildCatalog(alien)).status).not.toBe("rejected");
  });

  it("garbage NAMES alone never reject (names are not a structural signal)", async () => {
    const renamed = await mutate(bytesOf(CANON), scrambleNames);
    expect(assessTemplateHealth(buildCatalog(renamed)).status).not.toBe("rejected");
  });

  it("a truly broken master (no type, no idx, no geometry, no name) → REJECTED with a reason", async () => {
    const dead = await mutate(bytesOf(CANON), breakEverything);
    const health = assessTemplateHealth(buildCatalog(dead));
    expect(health.status).toBe("rejected");
    expect(health.findings.some((f) => f.level === "block" && /TITLE|BODY/.test(f.code))).toBe(true);
  });

  it("usableKinds advertises only what the master offers", () => {
    const kinds = assessTemplateHealth(buildCatalog(canon)).usableKinds;
    expect(kinds).toContain("title");
    expect(kinds).toContain("content");
  });
});

describe("P2 classification — geometric peers, not bare body count (name-less path)", () => {
  const info = { hasTitle: true, hasSubtitle: false, bodyCount: 2 };
  // two equal side-by-side boxes → genuine columns
  const twoEqual = [{ x: 0.5, y: 2, w: 5.5, h: 4 }, { x: 6.5, y: 2, w: 5.5, h: 4 }];
  // a primary body + a narrow sidebar (width ratio ~0.36) → NOT columns
  const primarySidebar = [{ x: 0.5, y: 2, w: 8.2, h: 4 }, { x: 9, y: 2, w: 3.0, h: 4 }];
  // two stacked boxes → NOT columns
  const stacked = [{ x: 0.5, y: 1.5, w: 11, h: 2 }, { x: 0.5, y: 4, w: 11, h: 2 }];

  it("garbage-named layout with 2 EQUAL side-by-side bodies → columns", () => {
    expect(classifyLayout("X9z", { ...info, bodyBoxes: twoEqual })).toBe("columns");
  });
  it("garbage-named layout with primary+sidebar bodies → content (NOT columns)", () => {
    expect(classifyLayout("X9z", { ...info, bodyBoxes: primarySidebar })).toBe("content");
  });
  it("garbage-named layout with STACKED bodies → content (NOT columns)", () => {
    expect(classifyLayout("X9z", { ...info, bodyBoxes: stacked })).toBe("content");
  });
  it("back-compat: NO geometry → legacy bodyCount≥2 rule still yields columns", () => {
    expect(classifyLayout("X9z", info)).toBe("columns");
  });
  it("a real layout NAME still wins before structure (canonical unaffected)", () => {
    expect(classifyLayout("Content.1Body.Single", { ...info, bodyBoxes: twoEqual })).toBe("content");
  });
});
