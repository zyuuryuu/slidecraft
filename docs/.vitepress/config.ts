import { defineConfig } from "vitepress";

// SlideCraft documentation site (VitePress → GitHub Pages). The dev/internal docs (ADRs, design
// notes, ROADMAP, shipped log, RELEASING, the raw user-guide/mcp-server sources) stay in the repo
// for contributors but are excluded from the public site — the site is the curated end-user guide.
export default defineConfig({
  lang: "ja-JP",
  title: "SlideCraft",
  description: "Markdown/YAML をテンプレートに流し込んで、整った PowerPoint を作るデスクトップアプリ。",
  base: "/slidecraft/",
  lastUpdated: true,
  cleanUrls: true,
  // `\`\`\`diagram` fences hold DiagramSpec YAML; highlight them as YAML (silences the "language not
  // loaded" warning). `mermaid` is highlighted by VitePress's built-in mermaid support if enabled.
  markdown: { languageAlias: { diagram: "yaml" } },
  srcExclude: [
    "adr/**",
    "design/**",
    "ROADMAP.md",
    "shipped.md",
    "RELEASING.md",
    "mcp-server.md",
    "user-guide.md",
    "README.md",
  ],
  themeConfig: {
    nav: [
      { text: "スターター", link: "/guide/getting-started" },
      { text: "インストール", link: "/guide/installation" },
      { text: "Markdown", link: "/guide/markdown-authoring" },
      { text: "変更履歴", link: "/changelog" },
    ],
    sidebar: {
      "/": [
        {
          text: "はじめる",
          items: [
            { text: "SlideCraft とは", link: "/" },
            { text: "インストールガイド", link: "/guide/installation" },
            { text: "スターターガイド", link: "/guide/getting-started" },
          ],
        },
        {
          text: "書く",
          items: [
            { text: "Markdown 執筆ガイド", link: "/guide/markdown-authoring" },
            { text: "図（ダイアグラム）", link: "/guide/diagrams" },
            { text: "テンプレート", link: "/guide/templates" },
          ],
        },
        {
          text: "編集と出力",
          items: [{ text: "二段階編集と出力", link: "/guide/editing-and-export" }],
        },
        {
          text: "AI・連携",
          items: [
            { text: "支援AI設定ガイド", link: "/guide/ai-setup" },
            { text: "MCP ガイド（エージェント連携）", link: "/guide/mcp" },
          ],
        },
        {
          text: "その他",
          items: [
            { text: "FAQ", link: "/guide/faq" },
            { text: "開発・貢献", link: "/guide/contributing" },
            { text: "問題の報告", link: "/guide/reporting-issues" },
            { text: "変更履歴", link: "/changelog" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/zyuuryuu/slidecraft" }],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/zyuuryuu/slidecraft/edit/main/docs/:path",
      text: "このページを編集",
    },
    footer: {
      message: "Apache-2.0 License",
      copyright: "© 2026 The SlideCraft Authors",
    },
    outline: { label: "このページの内容", level: [2, 3] },
    docFooter: { prev: "前へ", next: "次へ" },
  },
});
