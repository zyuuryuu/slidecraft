/**
 * #642: ```mermaid の描画（ノード配置）を固定する — mermaid の major 更新で配置が変われば差分が見える。
 * mermaid 12 は既定レイアウトが ELK・既定 look が neo に変わり、flowchart / state / class / ER の 4 種が
 * 再配置される。MERMAID_CONFIG で layout:"dagre"・look:"classic" を固定しているので、11 で撮った座標と同一のはず。
 * jsdom には SVG のレイアウト（getBBox）が無く mermaid が動かないので e2e（実ブラウザ）に置く。
 * フォント差で座標が環境依存にならないよう、probe が "trebuchet ms" を同梱の NotoSansJP に差し替える。
 * mermaid 12.2.0 #8409 で円・二重円ノードの大きさが変わったため、flowchart の snapshot は 12 の値で撮り直した
 * （PR #772 の裁定で許容）。state / class / ER は 11 で撮った値のまま一致する。
 */
import { test as base, expect } from "@playwright/test";
import type { LayoutProbe } from "./fixtures/mermaid-layout-probe";

// Text widths size every node, so glyph advances must not depend on the machine's fontconfig. The CI
// runner's Chromium applies full hinting (advances snap to whole pixels: ER x 344.3 → 346.5), while this
// container applies none — reproduced locally with --font-render-hinting=full, which gives the CI numbers
// exactly. Pin "none" for this spec only (other specs keep the default launch args).
const test = base.extend<object, object>({
  launchOptions: [
    async ({ launchOptions }, use) => {
      await use({ ...launchOptions, args: [...(launchOptions.args ?? []), "--font-render-hinting=none"] });
    },
    { scope: "worker" },
  ],
});

const DIAGRAMS: Record<string, string> = {
  flowchart: `flowchart TD
  A[要件定義] --> B{レビュー合格?}
  B -->|Yes| C[実装]
  B -->|No| A
  C --> D[テスト]
  D --> E((リリース))
  C --> F[ドキュメント]
  F --> E`,
  state: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Draft : reject
  Review --> Approved : approve
  Approved --> Published
  Published --> [*]`,
  class: `classDiagram
  class Deck {
    +string title
    +Slide[] slides
    +export() Uint8Array
  }
  class Slide {
    +string layout
    +render()
  }
  class Figure
  Deck "1" *-- "many" Slide
  Slide o-- Figure
  Figure <|-- MermaidFigure
  Figure <|-- TableFigure`,
  er: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "ordered in"
  CUSTOMER {
    string name
    string email
  }
  ORDER {
    int id
    date created
  }`,
};

test.describe("mermaid layout snapshot (#642)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  for (const [name, src] of Object.entries(DIAGRAMS)) {
    test(`${name}: node positions are unchanged`, async ({ page }) => {
      const probe = await page.evaluate(async (s) => {
        const m = await import("/tests/e2e/fixtures/mermaid-layout-probe.ts");
        return m.probeLayout(s);
      }, src) as LayoutProbe;
      expect(probe.nodes.length, "the diagram rendered nodes").toBeGreaterThan(2);
      expect(JSON.stringify(probe, null, 2)).toMatchSnapshot(`${name}.json`);
    });
  }
});
