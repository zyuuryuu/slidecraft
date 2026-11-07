/**
 * Issue #118 — Re-make picks the logo VARIANT per background (dark / light) instead of the single
 * most-referenced image. Corporate masters often carry a dark-ink logo for light slides and a white
 * knock-out logo for dark slides; the dark-family layouts (cover/section/closing) must get the white one.
 *
 * CI-covered: the source master is synthesized (writeTemplate → inject <p:pic>s), no gitignored fixture.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { masterToTemplateSpec, extractLogo, logoForDarkLayouts } from "../src/engine/master-remake";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { isDark } from "../src/engine/ooxml-resolve";

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// Two distinct valid 1×1 RGB PNGs: a white knock-out logo and a dark-ink (navy) logo.
const WHITE_LOGO = b64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC");
const DARK_LOGO = b64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkbMBAAC4AG8CTG4CAAAAAElFTkSuQmCC");

const pic = (rId: string, cx: number) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="900" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  `<p:spPr><a:xfrm><a:off x="457200" y="411480"/><a:ext cx="${cx}" cy="700000"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

/** Synthesize a source master: `light` light-background layouts carry media/`lightImg`, `dark`
 *  dark-background layouts carry media/`darkImg` (same name ⇒ one image shared by both). Light pics are
 *  drawn at aspect 2, dark pics at aspect 4 — so the test can tell which occurrence an aspect came from. */
async function sourceMaster(opts: { light: number; dark: number; lightImg: string; darkImg: string; bytes: Record<string, Uint8Array> }) {
  const base = await writeTemplate({ name: "Src", fonts: { major: "Arial", minor: "Arial" }, palette: MIDNIGHT_PALETTE });
  const loaded = await loadTemplate(base);
  const zip = await JSZip.loadAsync(base);
  for (const [name, bytes] of Object.entries(opts.bytes)) zip.file(`ppt/media/${name}`, bytes);
  const lightIdx = loaded.layouts.filter((l) => l.background && !isDark(l.background)).slice(0, opts.light);
  const darkIdx = loaded.layouts.filter((l) => l.background && isDark(l.background)).slice(0, opts.dark);
  expect(lightIdx).toHaveLength(opts.light);
  expect(darkIdx).toHaveLength(opts.dark);
  const inject = async (index: number, img: string, cx: number) => {
    const x = `ppt/slideLayouts/slideLayout${index}.xml`;
    const r = `ppt/slideLayouts/_rels/slideLayout${index}.xml.rels`;
    zip.file(x, (await zip.file(x)!.async("string")).replace("</p:spTree>", `${pic("rIdSrcLogo", cx)}</p:spTree>`));
    zip.file(r, (await zip.file(r)!.async("string")).replace(
      "</Relationships>",
      `<Relationship Id="rIdSrcLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${img}"/></Relationships>`,
    ));
  };
  for (const l of lightIdx) await inject(l.index, opts.lightImg, 1400000);
  for (const l of darkIdx) await inject(l.index, opts.darkImg, 2800000);
  const ct = "[Content_Types].xml";
  const ctXml = await zip.file(ct)!.async("string");
  if (!/Extension="png"/.test(ctXml)) zip.file(ct, ctXml.replace("<Default ", `<Default Extension="png" ContentType="image/png"/><Default `));
  return loadTemplate(await zip.generateAsync({ type: "uint8array" }));
}

/** The image bytes embedded on the Re-make output's cover layout (Title.1Title.Single). */
async function coverLogoBytes(out: Uint8Array): Promise<Uint8Array | undefined> {
  const zip = await JSZip.loadAsync(out);
  for (const f of Object.keys(zip.files).filter((n) => /slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    if (!/name="Title\.1Title\.Single"/.test(await zip.file(f)!.async("string"))) continue;
    const rels = await zip.file(f.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels")!.async("string");
    const target = rels.match(/Id="rIdLogo"[^>]*Target="\.\.\/([^"]+)"/)?.[1];
    return target ? zip.file(`ppt/${target}`)!.async("uint8array") : undefined;
  }
  return undefined;
}

const remake = async (src: Awaited<ReturnType<typeof loadTemplate>>) => {
  const logo = logoForDarkLayouts(await extractLogo(src));
  return writeTemplate({ ...masterToTemplateSpec(src), ...(logo ? { logo } : {}) });
};

describe("Re-make logo variants per background (#118)", () => {
  it("dark-ink logo on 3 light layouts + white logo on 2 dark layouts → dark=white, light=dark-ink", async () => {
    const src = await sourceMaster({
      light: 3, dark: 2, lightImg: "ink.png", darkImg: "white.png", bytes: { "ink.png": DARK_LOGO, "white.png": WHITE_LOGO },
    });
    const v = await extractLogo(src);
    expect(v?.dark?.bytes).toEqual(WHITE_LOGO);
    expect(v?.light?.bytes).toEqual(DARK_LOGO);
  });

  it("the Re-make output's cover (dark) embeds the WHITE logo, not the more frequent dark-ink one", async () => {
    const src = await sourceMaster({
      light: 3, dark: 2, lightImg: "ink.png", darkImg: "white.png", bytes: { "ink.png": DARK_LOGO, "white.png": WHITE_LOGO },
    });
    expect(await coverLogoBytes(await remake(src))).toEqual(WHITE_LOGO);
  });

  it("one image used on both backgrounds fills BOTH variants with the pre-#118 LogoSpec (byte-identical)", async () => {
    const src = await sourceMaster({ light: 3, dark: 2, lightImg: "one.png", darkImg: "one.png", bytes: { "one.png": DARK_LOGO } });
    const v = await extractLogo(src);
    // writeTemplate is unchanged, so an identical LogoSpec ⇒ an identical Re-make output. The aspect is
    // the image's FIRST occurrence in layout order (layout 1 = the dark cover → 4), as before #118.
    const expected = { bytes: DARK_LOGO, ext: "png", aspect: 4 };
    expect(v?.dark).toEqual(expected);
    expect(v?.light).toEqual(expected);
    expect(logoForDarkLayouts(v)).toEqual(expected);
  });

  it("single variant only on light layouts: dark layouts still get it (unchanged behavior)", async () => {
    const src = await sourceMaster({ light: 3, dark: 0, lightImg: "one.png", darkImg: "one.png", bytes: { "one.png": DARK_LOGO } });
    const v = await extractLogo(src);
    expect(v?.dark).toBeUndefined();
    expect(v?.light?.bytes).toEqual(DARK_LOGO);
    expect(logoForDarkLayouts(v)).toEqual({ bytes: DARK_LOGO, ext: "png", aspect: 2 });
    expect(await coverLogoBytes(await remake(src))).toEqual(DARK_LOGO);
  });

  it("no raster logo → undefined (no logo injected)", async () => {
    const src = await sourceMaster({ light: 0, dark: 0, lightImg: "x.png", darkImg: "x.png", bytes: {} });
    expect(await extractLogo(src)).toBeUndefined();
    expect(logoForDarkLayouts(undefined)).toBeUndefined();
  });
});
