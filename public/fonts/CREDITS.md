# Bundled fonts — credits

These fonts are the **source** fonts for runtime CJK glyph subsetting in HTML export (#193 /
#115-b): the app never ships them whole to a viewer — `src/components/font-subsetter.ts` extracts
only the glyphs a given deck actually uses (and pins the variable `wght` axis to the requested
weight) and embeds the resulting few-KB WOFF2 in the exported `.html`. They stand in for whatever
gothic/mincho-classified CJK font a template names in `<a:ea>` (font-stack.ts / #192) — the actual
named font itself is never reproduced (its own EULA may forbid that); these are the substitute
SlideCraft has redistribution rights to.

- **NotoSansJP-Variable.ttf** — Noto Sans JP, a variable font (`wght` axis 100–900). Gothic
  (sans-serif) design. © Google / Adobe (Source Han Sans lineage). **SIL Open Font License 1.1** —
  full text in `OFL-NotoSansJP.txt`.
- **NotoSerifJP-Variable.ttf** — Noto Serif JP, a variable font (`wght` axis 200–900). Mincho
  (serif) design. © Google (Source Han Serif lineage). **SIL Open Font License 1.1** — full text
  in `OFL-NotoSerifJP.txt`.

Both are fetched verbatim from Google's `google/fonts` repository (`ofl/notosansjp/`,
`ofl/notoserifjp/`), the same source Google Fonts itself serves from.

Subsetting pins `wght` to 400 (Regular) or 700 (Bold) per run — see
`src/engine/font-subset-plan.ts` for the gothic/mincho + bold → asset + weight mapping.
