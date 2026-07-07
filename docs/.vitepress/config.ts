import { defineConfig } from "vitepress";

// SlideCraft documentation site (VitePress → GitHub Pages). The dev/internal docs (ADRs, design
// notes, ROADMAP, shipped log, RELEASING, the raw user-guide/mcp-server sources) stay in the repo
// for contributors but are excluded from the public site — the site is the curated end-user guide.
//
// Bilingual: the root locale is Japanese; `/en/` mirrors the curated guide in English. VitePress
// renders the language-switcher dropdown automatically because `locales` has more than one entry.
// Each locale carries its own nav/sidebar/UI labels; the `/en/` pages live under docs/en/ and link
// to each other with the `/en/` prefix (VitePress does NOT auto-rewrite absolute links).

const jaThemeConfig = {
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
  editLink: {
    pattern: "https://github.com/zyuuryuu/slidecraft/edit/main/docs/:path",
    text: "このページを編集",
  },
  outline: { label: "このページの内容", level: [2, 3] as [number, number] },
  docFooter: { prev: "前へ", next: "次へ" },
};

const enThemeConfig = {
  nav: [
    { text: "Get started", link: "/en/guide/getting-started" },
    { text: "Install", link: "/en/guide/installation" },
    { text: "Markdown", link: "/en/guide/markdown-authoring" },
    { text: "Changelog", link: "/en/changelog" },
  ],
  sidebar: {
    "/en/": [
      {
        text: "Getting started",
        items: [
          { text: "What is SlideCraft", link: "/en/" },
          { text: "Installation guide", link: "/en/guide/installation" },
          { text: "Starter guide", link: "/en/guide/getting-started" },
        ],
      },
      {
        text: "Authoring",
        items: [
          { text: "Markdown authoring", link: "/en/guide/markdown-authoring" },
          { text: "Diagrams", link: "/en/guide/diagrams" },
          { text: "Templates", link: "/en/guide/templates" },
        ],
      },
      {
        text: "Editing & export",
        items: [{ text: "Two-stage editing & export", link: "/en/guide/editing-and-export" }],
      },
      {
        text: "AI & integration",
        items: [
          { text: "AI setup guide", link: "/en/guide/ai-setup" },
          { text: "MCP guide (agent integration)", link: "/en/guide/mcp" },
        ],
      },
      {
        text: "More",
        items: [
          { text: "FAQ", link: "/en/guide/faq" },
          { text: "Development & contributing", link: "/en/guide/contributing" },
          { text: "Reporting issues", link: "/en/guide/reporting-issues" },
          { text: "Changelog", link: "/en/changelog" },
        ],
      },
    ],
  },
  editLink: {
    pattern: "https://github.com/zyuuryuu/slidecraft/edit/main/docs/:path",
    text: "Edit this page",
  },
  outline: { label: "On this page", level: [2, 3] as [number, number] },
  docFooter: { prev: "Previous", next: "Next" },
};

export default defineConfig({
  title: "SlideCraft",
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
  locales: {
    root: {
      label: "日本語",
      lang: "ja-JP",
      description: "Markdown/YAML をテンプレートに流し込んで、整った PowerPoint を作るデスクトップアプリ。",
      themeConfig: jaThemeConfig,
    },
    en: {
      label: "English",
      lang: "en-US",
      description: "A desktop app that pours Markdown/YAML into your template to produce polished PowerPoint decks.",
      themeConfig: enThemeConfig,
    },
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: "https://github.com/zyuuryuu/slidecraft" }],
    search: { provider: "local" },
    footer: {
      message: "Apache-2.0 License",
      copyright: "© 2026 The SlideCraft Authors",
    },
  },
});
