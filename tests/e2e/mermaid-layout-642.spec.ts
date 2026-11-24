/**
 * #642: ```mermaid の描画（ノード配置）を固定する — mermaid の major 更新で配置が変われば差分が見える。
 * mermaid 12 は既定レイアウトが ELK・既定 look が neo に変わり、flowchart / state / class / ER の 4 種が
 * 再配置される。MERMAID_CONFIG で layout:"dagre"・look:"classic" を固定しているので、11 で撮った座標と同一のはず。
 * jsdom には SVG のレイアウト（getBBox）が無く mermaid が動かないので e2e（実ブラウザ）に置く。
 * フォント差で座標が環境依存にならないよう、probe が "trebuchet ms" を同梱の NotoSansJP に差し替える。
 */
import { test, expect } from "@playwright/test";
import type { LayoutProbe } from "./fixtures/mermaid-layout-probe";

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
