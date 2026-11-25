/**
 * #642: browser-side probe for tests/e2e/mermaid-layout-642.spec.ts. Served by the Vite dev server
 * (imported via page.evaluate), so it uses the APP's own mermaid + MERMAID_CONFIG — the exact
 * initialize() the preview and both exports run.
 *
 * Text width drives every node size, and the system fonts differ between this container and the CI
 * runner. To make the coordinates depend only on mermaid's layout (the thing #642 guards), the page
 * maps mermaid's default first font family ("trebuchet ms") to the committed NotoSansJP via @font-face
 * — an author-defined face shadows a system font of the same name.
 */
import mermaid from "mermaid";
import { MERMAID_CONFIG } from "../../../src/components/mermaid";

export interface NodePos { id: string; transform: string }
export interface LayoutProbe { viewBox: string; nodes: NodePos[] }

const round = (s: string) => s.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g, (n) => {
  const v = Math.round(parseFloat(n) * 10) / 10;
  return String(Object.is(v, -0) ? 0 : v);
});

async function pinFont(): Promise<void> {
  if (!document.getElementById("mmd-probe-font")) {
    const style = document.createElement("style");
    style.id = "mmd-probe-font";
    style.textContent = `@font-face { font-family: "trebuchet ms"; src: url("/fonts/NotoSansJP-Variable.ttf"); }`;
    document.head.appendChild(style);
  }
  await document.fonts.load('16px "trebuchet ms"', "Aあ");
}

let counter = 0;

/** Render `src` with the app config and return every node's translate + the viewBox (rounded to 0.1px). */
export async function probeLayout(src: string): Promise<LayoutProbe> {
  await pinFont();
  mermaid.initialize(MERMAID_CONFIG);
  const id = `probe${++counter}`;
  const { svg } = await mermaid.render(id, src);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const nodes = [...doc.querySelectorAll("g.node[transform]")].map((g) => ({
    // Ids carry the render id as a prefix (e.g. "probe1-flowchart-A-0"); drop it so they are stable.
    id: (g.getAttribute("id") ?? "").replace(`${id}-`, ""),
    transform: round(g.getAttribute("transform") ?? ""),
  }));
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return { viewBox: round(root.getAttribute("viewBox") ?? ""), nodes };
}
