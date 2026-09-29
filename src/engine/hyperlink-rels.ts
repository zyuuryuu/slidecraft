/**
 * hyperlink-rels.ts — Per-part registry of External hyperlink relationships (#393). A slide or
 * notesSlide part hands `rIdFor` to the run writer (md-to-ooxml LinkResolver) while its XML is
 * built, then appends `relsXml()` to that part's .rels. Same href → same rId (one rel per target).
 * A part with no links gets no rel at all — link-free output stays byte-identical. Pure logic (R2).
 */
import { escXml } from "./md-to-ooxml";

const HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

export interface LinkRegistry {
  rIdFor(href: string): string;
  relsXml(): string;
}

/** `firstRId`: the first number free in the part's .rels (every fixed rel sits below it). */
export function createLinkRegistry(firstRId: number): LinkRegistry {
  const byHref = new Map<string, string>();
  return {
    rIdFor(href) {
      let rId = byHref.get(href);
      if (!rId) {
        rId = `rId${firstRId + byHref.size}`;
        byHref.set(href, rId);
      }
      return rId;
    },
    relsXml() {
      return [...byHref]
        .map(([href, rId]) =>
          `<Relationship Id="${rId}" Type="${HYPERLINK_REL_TYPE}" Target="${escXml(href)}" TargetMode="External"/>`)
        .join("");
    },
  };
}
