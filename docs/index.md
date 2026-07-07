---
layout: home

hero:
  name: SlideCraft
  text: Markdown → PowerPoint
  tagline: テンプレートに流し込むだけ。フォントもレイアウトも崩さず、整ったスライドを。
  actions:
    - theme: brand
      text: スターターガイド
      link: /guide/getting-started
    - theme: alt
      text: インストール
      link: /guide/installation
    - theme: alt
      text: GitHub
      link: https://github.com/zyuuryuu/slidecraft

features:
  - icon: 📝
    title: Markdown で書く
    details: 見出し・箇条書き・表・図を Markdown で。配置や装飾はテンプレートとエンジンにまかせて、内容に集中できます。
  - icon: 📊
    title: 12 種のネイティブ図＋Mermaid
    details: フローチャート・シーケンス・ガント・KPI ほか 12 種を編集可能な PPTX 図形として出力。class/state/ER/mindmap は Mermaid 経由で。
  - icon: 🎨
    title: テンプレート流し込み
    details: 会社の .pptx を取り込んで色・フォント・レイアウトを適用。壊れたテンプレの修復取込や、配色から新規作成も。
  - icon: 🤖
    title: 内蔵オフライン AI
    details: llamafile を同梱。クラウドに送らず手元で生成・編集を補助。外部プロバイダ（Anthropic/OpenAI/OpenRouter/Ollama）も選べます。
  - icon: 🖥
    title: WYSIWYG プレビュー
    details: テンプレートの色・装飾を反映した見たままプレビュー。二段階編集（内容とデザイン）で、崩さず調整。
  - icon: 🔌
    title: エージェント連携（MCP）
    details: slidecraft serve で上流 AI（Claude 等）が Tools 経由で編集。GUI がライブ反映する協働ホストにも対応。
---

## SlideCraft とは

**SlideCraft** は、Markdown/YAML で書いたスライドを **会社テンプレートの PowerPoint** に流し込んで
`.pptx` を作るデスクトップアプリ（Tauri v2 + React + TypeScript）です。テキストは Markdown で書き、
配置・装飾はテンプレートとエンジンにまかせる分業で、**フォントやレイアウトを崩さずに**整ったスライドを作れます。

- **書く** — Markdown（[執筆ガイド](/guide/markdown-authoring)・[図](/guide/diagrams)）
- **見る** — テンプレートの色・フォントを反映した WYSIWYG プレビュー（[二段階編集](/guide/editing-and-export)）
- **出す** — 編集可能な図形で構成された `.pptx`、または遷移つきスタンダロン HTML

まずは [インストール](/guide/installation) → [スターターガイド](/guide/getting-started) へ。

::: tip 早期版（v0.1.0）
0.x 系のため、MINOR 更新でも破壊的変更があり得ます。不具合や要望は [問題の報告](/guide/reporting-issues) からどうぞ。
:::
