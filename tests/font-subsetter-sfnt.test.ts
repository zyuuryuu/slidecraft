/**
 * font-subsetter-sfnt.test.ts — structural health of the sfnt `subsetFontToTtf` returns (#218).
 *
 * font-subsetter.test.ts checks sizes; this file pins what the bytes actually ARE, so a harfbuzzjs
 * upgrade (0.10.3 → 1.x, #218) can't silently change the output's shape:
 *  - a well-formed TrueType sfnt (table directory parses, every table lies inside the buffer)
 *  - name table intact (family name survives subsetting)
 *  - cmap maps every requested character (and nothing absent from the source sneaks in)
 *  - `wght` pinning yields a STATIC font (no fvar/gvar left over) — the #193 Regular/Bold contract
 *  - OpenType layout features kept (HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = all): `vert` survives for
 *    the CJK punctuation in the text
 *
 * Minimal sfnt readers live here (test-only; production never parses fonts).
 */
import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { subsetFontToTtf } from "../src/components/font-subsetter";

const NOTO_SANS_JP_PATH = resolve(__dirname, "../public/fonts/NotoSansJP-Variable.ttf");
const TEXT = "日本語のスライド資料を作成します。こんにちは、世界！";

async function loadNotoSansJp(): Promise<Uint8Array> {
  const buf = await readFile(NOTO_SANS_JP_PATH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

type Tables = Map<string, DataView>;

function readTables(font: Uint8Array): { version: number; tables: Tables } {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const version = dv.getUint32(0);
  const numTables = dv.getUint16(4);
  const tables: Tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
    const offset = dv.getUint32(rec + 8);
    const length = dv.getUint32(rec + 12);
    if (offset + length > font.byteLength) throw new Error(`table ${tag} overruns the buffer`);
    tables.set(tag, new DataView(font.buffer, font.byteOffset + offset, length));
  }
  return { version, tables };
}

/** nameID → string, from the Windows Unicode BMP (3,1) records. */
function readNames(name: DataView): Map<number, string> {
  const count = name.getUint16(2);
  const strOffset = name.getUint16(4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (name.getUint16(r) !== 3 || name.getUint16(r + 2) !== 1) continue;
    const nameId = name.getUint16(r + 6);
    const len = name.getUint16(r + 8);
    const off = strOffset + name.getUint16(r + 10);
    let s = "";
    for (let j = 0; j < len; j += 2) s += String.fromCharCode(name.getUint16(off + j));
    out.set(nameId, s);
  }
  return out;
}

/** Codepoints mapped to a non-zero glyph, from the cmap's format 4 / 12 subtables. */
function readCmapCodepoints(cmap: DataView): Set<number> {
  const out = new Set<number>();
  const numSub = cmap.getUint16(2);
  for (let i = 0; i < numSub; i++) {
    const off = cmap.getUint32(4 + i * 8 + 4);
    const format = cmap.getUint16(off);
    if (format === 12) {
      const nGroups = cmap.getUint32(off + 12);
      for (let g = 0; g < nGroups; g++) {
        const start = cmap.getUint32(off + 16 + g * 12);
        const end = cmap.getUint32(off + 20 + g * 12);
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 4) {
      const segX2 = cmap.getUint16(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffs = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.getUint16(ends + s * 2);
        const start = cmap.getUint16(starts + s * 2);
        const delta = cmap.getInt16(deltas + s * 2);
        const ro = cmap.getUint16(rangeOffs + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid: number;
          if (ro === 0) gid = (c + delta) & 0xffff;
          else {
            const raw = cmap.getUint16(rangeOffs + s * 2 + ro + (c - start) * 2);
            gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
          }
          if (gid !== 0) out.add(c);
        }
      }
    }
  }
  return out;
}

/** Feature tags listed in a GSUB/GPOS FeatureList. */
function readFeatureTags(layout: DataView): Set<string> {
  const featureList = layout.getUint16(6);
  const count = layout.getUint16(featureList);
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) {
    const r = featureList + 2 + i * 6;
    tags.add(String.fromCharCode(layout.getUint8(r), layout.getUint8(r + 1), layout.getUint8(r + 2), layout.getUint8(r + 3)));
  }
  return tags;
}

describe("subsetFontToTtf — sfnt structural health (#218)", () => {
  it("returns a well-formed TrueType sfnt with the core tables", async () => {
    const subset = await subsetFontToTtf(await loadNotoSansJp(), TEXT, { wght: 400 });
    const { version, tables } = readTables(subset);

    expect(version).toBe(0x00010000);
    for (const tag of ["cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "OS/2", "post"]) {
      expect(tables.has(tag), `missing table ${tag}`).toBe(true);
    }
  });

  it("keeps the name table intact (family name survives)", async () => {
    const subset = await subsetFontToTtf(await loadNotoSansJp(), TEXT, { wght: 400 });
    const names = readNames(readTables(subset).tables.get("name")!);

    // Prefix, not exact: harfbuzz 0.10.3 leaves the variable font's default-instance subfamily in
    // nameID 1 ("Noto Sans JP Thin") after pinning; the HTML export declares its own @font-face
    // family name, so the internal name never reaches rendering. What must hold is a readable name
    // table naming the right family.
    expect(names.get(1)).toMatch(/^Noto Sans JP/);
  });

  it("maps every requested character in cmap and drops unrequested ones", async () => {
    const subset = await subsetFontToTtf(await loadNotoSansJp(), TEXT, { wght: 400 });
    const mapped = readCmapCodepoints(readTables(subset).tables.get("cmap")!);

    for (const ch of TEXT) expect(mapped.has(ch.codePointAt(0)!), `missing ${ch}`).toBe(true);
    expect(mapped.has("A".codePointAt(0)!)).toBe(false);
    expect(mapped.has("漢".codePointAt(0)!)).toBe(false);
  });

  it("pins wght to a static font (no variation tables remain)", async () => {
    for (const wght of [400, 700]) {
      const { tables } = readTables(await subsetFontToTtf(await loadNotoSansJp(), TEXT, { wght }));
      expect(tables.has("fvar"), `fvar at wght ${wght}`).toBe(false);
      expect(tables.has("gvar"), `gvar at wght ${wght}`).toBe(false);
    }
  });

  it("keeps OpenType layout features (vertical forms for CJK punctuation)", async () => {
    const { tables } = readTables(await subsetFontToTtf(await loadNotoSansJp(), TEXT, { wght: 400 }));

    expect(tables.has("GSUB")).toBe(true);
    expect(readFeatureTags(tables.get("GSUB")!).has("vert")).toBe(true);
  });
});
