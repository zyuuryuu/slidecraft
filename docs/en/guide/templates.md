# Templates

Templates are the source of a slide's appearance — its **colors, fonts, and layouts**. SlideCraft assembles a `.pptx` by pouring the [Markdown](/en/guide/markdown-authoring) you wrote into the template you selected. By separating text content from design, you can produce polished slides without breaking your fonts or layouts.

This page covers the ways in to templates. There are two intake modes: **faithful import** and **theme-only Re-make**.

1. **Import an existing `.pptx` (faithful)** — reuse your company-standard layouts and placeholders exactly as they are
2. **Import the theme only (Re-make)** — inherit just the fonts, colors, background, and logo, then rebuild with SlideCraft's own layouts
3. **Repair-import a broken template** — "clean up and import" a `.pptx` whose placeholder roles are broken
4. **Create a template from scratch** — pick colors and fonts and build from zero (with AI suggestions and live preview)

::: tip Persisted
On the desktop version, imported and created templates are saved to the app's local data area, and **remain selectable from the master picker after a restart**. The browser version (for development and demos) keeps them only within the session, and they are lost when it is closed.
:::

---

## What a template determines

A single template bundles the following three things together.

| Element | Contents |
|------|------|
| **Colors** | A set of semantically assigned colors — heading color, body color, background color, accent color, and so on |
| **Fonts** | Two families: one for headings (major) and one for body text (minor) |
| **Layouts** | Structural templates for slides such as title slides, body, comparison, and KPI |

When your Markdown is parsed, the engine automatically selects the best layout for each slide and applies the template's colors and fonts. You do not need to be aware of layout names (if you want to specify one explicitly, you can write `<!-- slide: layout-name -->` at the top of the Markdown; see [Markdown authoring](/en/guide/markdown-authoring)).

---

## 1. Importing an existing template (.pptx)

When you load a `.pptx` you have on hand (such as a company-standard empty template), its **colors, fonts, and decoration** are applied to your slides.

### Steps

1. Choose **Import a template** from the master picker.
2. Select the `.pptx` file.
3. A health check runs, and if there are no problems it is registered and applied as-is.

The imported template is reflected in the main preview immediately (WYSIWYG). From then on, this template's colors, fonts, and layouts are used in every conversion.

::: tip What kind of .pptx should I prepare?
The slides inside can be empty. What SlideCraft reads is the **slide master / layouts / theme** (the definition of the appearance). Just hand over a company-distributed "template .pptx" or `.potx` as-is, and that appearance becomes available.
:::

### It works even with templates that are not your company standard

SlideCraft's automatic layout selection and content pouring adapt **to the placeholder structure of the master you supply**. Even with templates that name things unusually, or "unfamiliar" templates with unexpected placeholder structures, it infers each placeholder's role (title placeholder, body placeholder, etc.) from its type and accepts it. Because it binds by **placeholder type and index** rather than by name, the design is robust against naming inconsistency.

::: tip Logos from the imported template appear in the preview too
Images placed on a layout or master (such as a company logo) are rendered as-is in the preview and in HTML output.
:::

---

## 1-b. Importing the theme only (Re-make)

Next to "Import a master (.pptx)" there is one more intake point: **"✨ Import the theme only (Re-make)."** This one **extracts only the fonts, colors, background, and logo** from a company template, transplants them onto SlideCraft's own polished layouts, and creates a new template.

### Which should you choose?

| Aspect | Faithful import (1.) | Theme-only Re-make (1-b.) |
| --- | --- | --- |
| **Layouts used** | The company template's layouts and placeholder arrangement, as-is | SlideCraft's own polished layouts |
| **What is inherited** | Nearly the entire appearance (including custom layouts) | Fonts, colors, background, logo |
| **When it fits** | You want to faithfully reproduce a company-specific layout | A third-party template's placeholder structure is unusual and breaks under faithful import / "as long as the colors, fonts, and logo are ours, any polished layout is fine" |

Re-make's strength is that it **structurally avoids** the quirks of a third-party master's placeholder structure (such as inconsistent placeholder numbering).

### What Re-make inherits

- **Fonts** (heading / body)
- **Colors** — background, body color, accent, and so on, mapped in a **contrast-safe** way (never produces an unreadable palette)
- **Background and design pattern** — beyond dark/light, whether a body slide is "with a header bar" or "flat (heading on white)" is **absorbed to match the source template's design**
- **Logo** — the source template's logo is re-placed on surfaces such as the cover, section dividers, and closing

::: tip Both are always available
Re-make does **not replace** faithful import. Both intake points are in the import menu, so you can choose whichever suits each template. Use Re-make for templates that don't pour cleanly, and faithful import when you want to keep a custom layout.
:::

---

## 2. Repair-importing a broken template

A `.pptx` whose title or body placeholders have **lost their role (type)** cannot be poured into correctly as-is (because it can't tell which is the title and which is the body). SlideCraft diagnoses this at import time and rescues it via **"clean up and import."**

### How it is rescued

A health check runs at import time, and when it detects a fatal problem (no title placeholder role = `NO_TITLE_ROLE` / no body placeholder role = `NO_BODY_ROLE`), it presents a **repair plan**.

- **Candidate inference** — it selects candidates from among the role-less placeholders using deterministic rules.
  - **Title candidate**: the placeholder with the largest font size (the only clue that survives master inheritance; requires 18pt or more). On a tie, a placeholder nearer the top of the page is preferred.
  - **Body candidate**: the largest-area placeholder among those remaining.
- **Minimal patch** — it makes the smallest XML change, merely assigning a role (the type attribute) to the chosen placeholders. It leaves all other placeholders untouched.
- **Suggestions with reasons in Japanese** — it shows why each repair was made, such as "this placeholder will be treated as the title (because it has the largest font size)."

When you choose **"clean up and import"** in the confirmation dialog, only the bytes with the repair applied are registered and applied.

::: warning No over-repair
A template that has no fatal problem (i.e. is usable as-is) is **not altered at all**. Repair only assigns roles; it does not move placeholder coordinates or rewrite layout names. If repair cannot resolve the fatal problem, import is refused as before (you will never silently end up in a broken state).
:::

::: details Only the "role (type)" is repaired
Each placeholder in a PPTX carries a role, such as `<p:ph type="title">`. When this type is missing, the engine cannot judge whether the placeholder is a title or body. Repair only re-applies this type; it does not rebuild the placeholder's substance (position, size) or the layout naming.
:::

---

## 3. Creating a template from scratch

Even without a template on hand, you can generate and register a new template `.pptx` from zero **just by picking colors and fonts**. Open the creation modal from **"＋ Create a template…"** in the master picker.

There are four things you can do in the creation modal.

- Choose colors (a 9-color palette) and fonts (manually or via **AI suggestion**)
- Select a subset of the layouts to use (just the ones you need out of 30)
- Define custom layouts
- Live preview (changes are reflected in the rendering instantly)

### 3-1. Colors — the 9-color palette

Colors consist of **nine slots, each with a meaning**. Instead of abstract names like "accent 1," you specify by **role**, such as "title text" and "body text," so meaning stays intact even when you change a color.

| Slot | Role |
|---------|------|
| `background` | Background of dark layouts / the header bar of light layouts |
| `canvas` | Background of light layouts (body slides) |
| `titleText` | Title text (sits on the background / header bar) |
| `bodyText` | Body text (sits on the canvas) |
| `subtle` | Supporting text (subtitles, meta information) |
| `muted` | Faint text (sources, page numbers) |
| `accent` | Emphasis (category labels, comparison option 1) |
| `accent2` | Secondary emphasis (comparison option 2) |
| `emphasis` | Emphasis text such as large numbers (on the canvas) |

::: tip Contrast is corrected automatically
So that text doesn't get buried in the background, SlideCraft automatically checks the important color pairs. Specifically, it computes the contrast ratio of **titleText vs. background** and **bodyText vs. canvas**, and if it falls below the WCAG standard (ratio under 3), it automatically nudges the text color toward white or a dark tone to guarantee legibility (it announces when it has made a correction). Even if you fail at picking colors, the text will never become unreadable.
:::

### 3-2. Fonts

You specify two font families.

- **major (for headings)** — large text such as titles
- **minor (for body)** — body text such as bullets and paragraphs

### 3-3. Letting AI suggest colors and fonts (✨)

Instead of picking colors and fonts by hand, you can have them suggested from **✨ (Let AI handle it)** by describing the mood and use case in natural language.

> Example: "Calm, financial-sector, formal with a navy base."

What the AI returns is **only a spec (a JSON of color and font suggestions)**. The code that actually writes out the PPTX is always deterministic, and the AI's output is not used as-is. The returned suggestion is cleaned up before use as follows.

- Colors are normalized to 6-digit hex (invalid values fall back to the default)
- The contrast guard above is applied
- If a font name is empty, it falls back to the default

::: tip Complete with the built-in offline AI
Suggestions also work with the built-in offline AI (the llamafile sidecar). You get color proposals without sending anything to the cloud. Even the sloppy JSON of a small local model is always reduced to a "usable spec" on the harness side. See [AI setup](/en/guide/ai-setup) for details.
:::

### 3-4. Selecting a subset of layouts

Templates come with **30 built-in layouts** (title slide, body, comparison, KPI, section dividers, and so on). In the creation modal, you can include **only the layouts you need** by checking them off. For a template with a limited purpose, you can omit unneeded layouts to keep it tidy.

::: warning Empty / insufficient is blocked
A configuration that selects no layouts at all, or that lacks the required title and body placeholders, is rejected as invalid by the same health gate used at import time. A broken template is never created silently.
:::

### 3-5. Custom layouts

When the built-in layouts aren't enough, you can define your own in the **layout editor**. For each placeholder, you specify position, size, font family (major/minor), color slot, alignment, and so on via a form, and preview it instantly on a showcase slide.

- Layout names are automatically kept non-empty and unique (duplicates and empty names are corrected).
- Numeric values such as coordinates are guarded as finite values (invalid values are blocked).

### 3-6. Live preview

In the creation modal, **the actual rendering result is reflected on the spot every time you change a color, font, or layout**. This is not a mock that approximates the appearance; it is the actual preview rendering (displayed with the same renderer as production, going through `writeTemplate → loadTemplate → distill`), so **what you see is exactly what you get** (WYSIWYG). You can nail down the result on the spot, without cycling through set → apply → check.

Once you've finished creating it, generate → register → apply reflects that template in the main preview immediately.

---

## About verifying in real PowerPoint

::: warning
Generated and repaired templates pass a round-trip verification through SlideCraft's own loading logic (read back, health OK, coordinate error within ±1%, content survives). Structural validation via python-pptx and the like is also a permanent gate. However, **verifying the file opens in real PowerPoint remains partly a manual item** due to constraints of the development environment. For a template intended for company distribution, we recommend opening it once in actual PowerPoint to check, just in case.
:::

---

## Frequently asked questions

**Q. The colors and fonts of the imported .pptx aren't applied.**
A. SlideCraft reads the **master / layouts / theme**, not the slide body. Check that the template's appearance is defined in the theme. If the template has broken roles, you can rescue it with the "repair import" above.

**Q. The template I created is gone at the next launch.**
A. Persistence is a feature of the desktop version. The browser version (for demos) keeps things only within the session. Please use the desktop version.

**Q. I picked a palette where the text blends into the background and is unreadable.**
A. The contrast of titleText/background and bodyText/canvas is corrected automatically. If it still bothers you, explicitly adjust the text color slots in the palette.

For anything else, see the [FAQ](/en/guide/faq) as well.

---

## Related pages

- [Installation](/en/guide/installation) — getting and launching the app
- [Markdown authoring](/en/guide/markdown-authoring) — how to write slide content
- [Diagrams](/en/guide/diagrams) — native diagrams that inherit the template colors
- [AI setup](/en/guide/ai-setup) — the built-in AI used for AI suggestions of colors and fonts
- [MCP](/en/guide/mcp) — use from an AI agent
