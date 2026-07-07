# Reporting Issues

If something isn't working while you use SlideCraft, the result isn't what you expected, or you'd like a feature added—
let us know by opening a GitHub Issue. The more reproducible information you provide, the faster we can fix it.
This page explains how to write a good report and how to gather the information that helps us most.

Here's where to report:

- **Issue list / open a new one** — [github.com/zyuuryuu/slidecraft/issues](https://github.com/zyuuryuu/slidecraft/issues)

::: tip Check the FAQ first
Common situations like "an image becomes body text," "a diagram doesn't render," "it won't open on macOS," or "the body text overflows"
can usually be solved through settings or notation. Skimming the [FAQ](/en/guide/faq) before reporting
may solve the problem right away.
:::

---

## Bug report or feature request?

Before opening an Issue, deciding which type it is helps you pick the template and title.

| | Bug report | Feature request |
|---|---|---|
| In one line | "Something is broken / not what I expected" | "It would be nice if I could do this" |
| Example | A diagram doesn't render, the PPTX is corrupt and won't open, the app crashes | I want a new diagram type, please add this notation |
| Required info | Reproduction steps, expected vs. actual, environment (below) | The problem you want to solve (Why), the ideal behavior (What) |
| Good title | `bug: gantt の図が空になる` | `feat: 縦書きテキストに対応してほしい` |

::: tip Write feature requests starting from the "problem"
Don't just say "I want a feature that does X"—also write "what you're trying to achieve" and "what's difficult right now."
When we understand the background (the problem), we can sometimes find a better solution than the requested implementation.
:::

---

## Do not post security vulnerabilities in public Issues

::: warning Report security issues privately
Do **not** post **security vulnerabilities**—such as information disclosure, arbitrary code execution, or sandbox escapes—
**in public GitHub Issues**. If the details become public, they could be exploited before a fix is released.

Instead, report them through GitHub's **Security Advisory (private)**:

1. Open the repository's **Security** tab
2. Choose **Report a vulnerability** ([Private Vulnerability Reporting](https://github.com/zyuuryuu/slidecraft/security/advisories/new))
3. Fill in the scope of impact, reproduction steps, and the anticipated exploitation scenario

Through this channel, your report is kept private until a fix is ready.
:::

The background of SlideCraft's security design (local execution, images only as data URIs, BYOK keys stored in the OS keychain, and so on)
is documented in the repository's ADRs (`docs/adr/0010-security-model.md` and others).

---

## Information to include in a good bug report

If we can reproduce it, we can usually fix it. Please gather the following.

### 1. Environment (OS and version)

- **OS and version** — e.g., Windows 11 23H2 / macOS 14.5 (Apple Silicon) / Ubuntu 24.04
- **SlideCraft version** — which build from [Releases](https://github.com/zyuuryuu/slidecraft/releases)
  (e.g., `v0.1.0`, or which of `.msi` / `.dmg` / `.AppImage` / `.deb` you installed)
- **How you obtained it** — installer directly / Homebrew cask / built from source (`npm run tauri dev`)
- **If AI-related** — the built-in offline AI or an external provider (BYOK). Also the tier (Small / Balanced).
  → [AI Setup](/en/guide/ai-setup)

### 2. Reproduction steps (the most important part)

Write numbered steps that anyone can follow top to bottom to get the same result.

```text
1. アプリを起動して新規プロジェクトを作る
2. 下の「最小 Markdown」を貼り付ける
3. テンプレート「標準」を選んでスライド化する
4. PPTX を書き出す
```

### 3. The result you expected, and the actual result

- **Expected** — what should have happened
- **Actual** — what actually happened (paste error messages exactly as they appear)

"It doesn't work" alone gives us nothing to investigate. Be specific, like "the gantt on the 3rd slide comes out blank."

### 4. Minimal reproduction Markdown / DiagramSpec

Paste the **smallest** input that triggers the problem in a code fence. Stripping it down to a dummy that
keeps only the problem—not your real data—makes isolating the cause much faster.

````markdown
# 再現用スライド

```diagram
type: gantt
nodes: []
gantt:
  startDate: 2025-01-01
  tasks:
    - { name: 要件定義, section: 設計, start: 0, end: 10, status: done }
```
````

For diagram-related issues, also note whether the target is one of the [12 native diagrams](/en/guide/diagrams) (```diagram```)
or a diagram via `mermaid` (class / state / ER / mindmap).
`gitGraph` / `sankey` / `C4` **cannot be converted to PPTX**, so having their output rejected is by design
(not a bug; see the [Diagram guide](/en/guide/diagrams) and the [FAQ](/en/guide/faq) for details).

### 5. Screenshots

For visual breakage (layout, overflow, color), an image speaks louder than words.
Please attach screenshots of the preview screen or the generated PPTX / HTML.

- Ideally one shot showing the overall situation plus one close-up of the problem area
- Capture error dialogs as the whole dialog

### 6. Input files (as much as you can share)

- Attaching your `.scft` project file, the imported `.pptx` template, the generated `.pptx`, and so on
  lets us reproduce the problem completely on our end.
- If they contain confidential information, rewrite them into the **smallest dummy that still reproduces the problem** before attaching.

::: details Copy-paste report template
Paste the following into the body of a new Issue and fill it in.

```markdown
## 概要
（何が起きるかを 1〜2 行で）

## 環境
- OS:
- SlideCraft バージョン:
- 入手方法（インストーラ / Homebrew / ソース）:
- AI（内蔵 / BYOK / 未使用）:

## 再現手順
1.
2.
3.

## 期待した結果

## 実際の結果
（エラーメッセージは原文のまま）

## 最小の再現 Markdown / 入力
（コードフェンスで）

## スクリーンショット / 添付ファイル
```
:::

---

## Where to find logs and diagnostics

SlideCraft writes diagnostic messages to **standard error (stderr)** at key points during startup and generation.
For issues where the app freezes on launch or crashes immediately, this output is a valuable clue.

### Launch from a terminal to see the output

Even for an app installed via the installer, running the executable from a terminal streams the diagnostic messages
to that terminal. The advantage is that you can capture messages right up to the moment it crashes.

::: code-group

```bash [Linux]
# AppImage をそのまま端末から実行（インストール済みなら実体パスを指定）
./SlideCraft*.AppImage
# 出力ごとファイルに残す
./SlideCraft*.AppImage 2>&1 | tee slidecraft.log
```

```bash [macOS]
# .app の実体を直接起動すると stderr がこの端末に出る
/Applications/SlideCraft.app/Contents/MacOS/SlideCraft
```

```powershell [Windows]
# インストール先の実行ファイルを PowerShell から起動
& "$env:LOCALAPPDATA\SlideCraft\SlideCraft.exe"
```

:::

Lines like `[slidecraft] …` / `[local_ai] …` that appear are the diagnostic messages.
They help isolate launch failures and AI sidecar problems, so please paste the **full text** into your Issue
(you may redact parts you'd rather not share, such as paths or machine names).

### Where the app stores its data

SlideCraft's persistent data—such as the built-in AI's model weights and integration runtimes—lives in the OS's standard
**application data area** (identifier `com.slidecraft.desktop`).
You may want to know this location for troubleshooting or for re-downloading a model.

| OS | Approximate location |
|---|---|
| Windows | `%LOCALAPPDATA%\com.slidecraft.desktop\` |
| macOS | `~/Library/Application Support/com.slidecraft.desktop/` |
| Linux | `~/.local/share/com.slidecraft.desktop/` |

The built-in AI model is downloaded once into `models/` under this directory ([AI Setup](/en/guide/ai-setup)).

::: warning Before deleting data
Deleting this area entirely also loses your imported templates and downloaded models,
and the models will be re-downloaded next time. Don't touch it unless a reset is needed for bug investigation.
:::

### Browser / development-build logs

When running from source with `npm run tauri dev`, the Vite / Tauri logs appear directly in the terminal you launched from.
When running the demo in a browser, frontend errors appear in the Console tab of the developer tools (DevTools).

---

## After you report

- We may add a comment asking for more information. It's needed to reproduce the issue, so please answer as best you can.
- Fixes are reflected in the [Changelog](/en/changelog).
- If you'd like to help on the code side, see [Development & Contributing](/en/guide/contributing). Fix PRs are welcome too.

A careful report saves time—both yours and that of the next person who hits the same problem. Thank you for your cooperation.
