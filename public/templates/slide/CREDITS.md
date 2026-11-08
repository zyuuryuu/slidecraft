# Bundled templates — credits

The app ships these **built-in** templates (content-free "TemplateOnly" masters), selectable from
the master picker. All are original SlideCraft designs.

- **技術報告_スタンダード水色_TemplateOnly.pptx** — a clean technical-report style (standard light-blue) (default).
- **配布資料_公文書高密度_TemplateOnly.pptx** — a dense, official-document (公文書) handout style.
- **ビジュアルデッキ_マガジン_TemplateOnly.pptx** — a bold, magazine-style visual deck.
- **セールスピッチ_Pitch_TemplateOnly.pptx** — a sales-pitch / proposal style (one message per slide,
  big statement, hero number, quote, CTA close). Generated from the `PITCH_PRESET` writer preset
  (`src/engine/template-presets.ts`) by `scripts/gen-preset-templates.ts` (#595).
- **エグゼクティブ_Executive_TemplateOnly.pptx** — a dark, impact-first executive style (one message per slide, big KPI, decision-request close). Generated deterministically from the `EXECUTIVE_PRESET` writer preset by `scripts/gen-preset-templates.ts` (#596; #672).
- **マーケ_Campaign_TemplateOnly.pptx** — an image-first marketing / campaign style (off-white canvas, one
  muted accent, serif headings, full-bleed image with caption, image grid, colour-field section divider).
  Generated from the `CAMPAIGN_PRESET` writer preset by `scripts/gen-preset-templates.ts` (#598).

(The former default, `Midnight_Executive_30_TemplateOnly.pptx` — the canonical 30-layout development
template, also an original SlideCraft design — is no longer bundled; it is an input sample under
`samples/templates/` since #117.)

(Test fixtures — velis (CC0), the report/handout *全レイアウト見本* sample decks — live under
`tests/fixtures/`, not here; see that directory's notes.)
