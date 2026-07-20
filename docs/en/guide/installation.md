# Installation

SlideCraft is a desktop app for Windows / macOS / Linux. Normally, you obtain the distribution installer for your OS
from [Releases](https://github.com/zyuuryuu/slidecraft/releases). You can also run it from source for development, but
this is not needed for general use.

This page covers the following:

- [Getting the distribution installer (by OS)](#getting-the-distribution-installer-by-os)
- [First launch on macOS (notes on ad-hoc signing)](#macos)
- [Running from source for development](#running-from-source-for-development)

After installing, see [Markdown authoring](/en/guide/markdown-authoring), [Diagrams](/en/guide/diagrams), and
[Templates](/en/guide/templates) for how to use it, and [FAQ](/en/guide/faq) if something goes wrong.

---

## Getting the distribution installer (by OS)

Each version on [Releases](https://github.com/zyuuryuu/slidecraft/releases) includes installers for each OS.

| OS | Format | How to get / install |
|---|---|---|
| Windows | `.msi` (recommended) / `.exe` | Download and run |
| macOS | Homebrew cask (recommended) / `.dmg` | Command below. Official builds are **Apple Silicon (arm64) only** (`_aarch64.dmg`). Intel Macs build from source |
| Linux | `.AppImage` (recommended) / `.deb` / `.rpm` | Make the AppImage executable and run it, or install the deb / rpm |

### Windows

The simplest path is to download and run the `.msi`. The same release may also include a `.exe` (NSIS) installer.
Either way, once installed you can launch it from the Start menu.

::: tip SmartScreen warning
If the app is unsigned, Microsoft Defender SmartScreen may show a warning on first launch.
Click "More info" → "Run anyway" to launch it.
:::

### Linux

There are three distribution formats. Choose the one that matches your distribution.

**AppImage (works on any distribution; recommended)**

```bash
chmod +x SlideCraft_0.2.0_amd64.AppImage
./SlideCraft_0.2.0_amd64.AppImage
```

**Debian / Ubuntu family (.deb)**

```bash
sudo apt install ./SlideCraft_0.2.0_amd64.deb
```

**Fedora / RHEL family (.rpm)**

```bash
sudo dnf install ./SlideCraft-0.2.0-1.x86_64.rpm
```

::: details If the AppImage does not launch
Older distributions require FUSE. Install `libfuse2`, or run it extracted with `--appimage-extract-and-run`.

```bash
sudo apt install libfuse2          # Debian/Ubuntu
./SlideCraft_0.2.0_amd64.AppImage --appimage-extract-and-run
```
:::

### macOS

The macOS build is distributed with **ad-hoc signing (`codesign -s -`)** and is **not notarized by Apple**
(because that would require the Apple Developer Program at $99/year). Given this policy, **going through the Homebrew cask is the cleanest option**.

::: tip Using an Intel Mac
The official installer (cask / `.dmg`) is **Apple Silicon (arm64) only** (the Intel build was retired due to CI runner constraints).
On an Intel Mac, build from source instead — see [Running from source for development](#running-from-source-for-development).
:::

```bash
# Via tap (one shot)
brew install --cask zyuuryuu/slidecraft/slidecraft

# Or add the tap first
brew tap zyuuryuu/slidecraft
brew install --cask slidecraft
```

`brew install --cask` strips the `com.apple.quarantine` attribute during installation. In most environments this lets you open the app without a first-launch warning, but **on newer macOS (Sequoia 15 and later), because the app is not notarized, you may see a warning like "'SlideCraft' may damage your Mac…" on first launch** (this does not mean the app is broken). In that case, you can open it as follows:

**System Settings → Privacy & Security → (toward the bottom) "'SlideCraft' was blocked…" → "Open Anyway"** → then "Open" in the confirmation dialog. Once you allow it, it will launch normally from then on.

::: tip Tip for macOS 15 and later
On macOS 15 (Sequoia) and later, the old "right-click → 'Open'" alone no longer works, so the **System Settings → "Open Anyway"** path above is the reliable method. This is the general behavior for non-notarized apps; the root-cause fix is Developer-ID signing + notarization ($99; see "Future" below).
:::

::: tip Using it from an AI agent (no build required)
When you install via Homebrew, the MCP server that lets upstream AI (Claude Code / Cursor / Claude Desktop) drive SlideCraft is also **bundled and registered on PATH** (v0.2.0 and later). No source clone or system Node is needed; register it with `claude mcp add slidecraft -- slidecraft-mcp`. See the [MCP guide](/en/guide/mcp) for details.
:::

::: warning First-launch note when opening the .dmg directly on macOS
If you download the `.dmg` directly instead of using Homebrew, the quarantine attribute remains, so Gatekeeper shows
"'SlideCraft' is damaged and can't be opened" or "cannot verify the developer" and **blocks it as-is**.
This stems from ad-hoc signing (not notarized) and does not mean the app is broken. Resolve it with either of the following.

**Method A — Open via right-click (GUI)**
Control-click (or right-click) SlideCraft.app in `/Applications` → **"Open"** →
click **"Open"** again in the dialog. Once you allow it, it will launch normally from then on.

**Method B — Strip the quarantine attribute (Terminal)**

```bash
xattr -dr com.apple.quarantine /Applications/SlideCraft.app
```

Because Apple Silicon (M series) cannot run any unsigned binary, ad-hoc signing is mandatory; the bundled
`node` / `llamafile` (for the [built-in offline AI](/en/guide/ai-setup)) are also ad-hoc signed individually.
Once you strip the quarantine from the app itself with either method above, these will launch without issue.
:::

::: tip Future: the notarization path
The path that would let you open the `.dmg` directly without stripping quarantine (i.e., listing on the official homebrew-cask or Developer-ID signing +
notarization) requires the $99 Apple Developer Program, so it is currently deferred.
For now, please use the cask above, or the right-click / `xattr` approach.
:::

---

## Running from source for development

These are the steps to build and run from source code instead of the distributed version. **Not needed for normal use**;
it is intended for development, customization, or trying the latest unreleased features.

### Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | 20 or later | Frontend (Vite / React / TypeScript) |
| Rust | 1.70 or later | Building the Tauri desktop shell |

On Linux, additional system libraries are required.

```bash
# Debian / Ubuntu family
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev patchelf
```

### Clone and set up

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft
npm install
```

### Starting the dev server

```bash
npm run dev          # Vite dev server (browser: http://localhost:5173)
npm run tauri dev    # Launch Tauri + Vite together (desktop window)
```

`npm run dev` is for the browser-based demo / development, while `npm run tauri dev` launches it as the desktop app.
Desktop-specific features such as persistent template storage and the built-in offline AI run on the `tauri dev` side.

### Building the installer

To generate an installer (`.msi` / `.dmg` / `.AppImage` / `.deb` / `.rpm`) for your own environment.

```bash
npm run build        # Build the frontend (tsc + vite)
npm run tauri build  # Generate an installer for the running OS
```

::: tip Verifying it works
If you want to use AI features after launching, see [AI setup](/en/guide/ai-setup); if you want to drive SlideCraft from an AI agent (Claude Desktop / Claude Code, etc.),
see [MCP](/en/guide/mcp).
:::

---

## Next steps

- Create your first slide → [Markdown authoring](/en/guide/markdown-authoring)
- Import a company template → [Templates](/en/guide/templates)
- Draw a diagram → [Diagrams](/en/guide/diagrams)
- Trouble with launching or installing → [FAQ](/en/guide/faq)
