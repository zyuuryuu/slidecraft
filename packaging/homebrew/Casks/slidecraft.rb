# SlideCraft — Homebrew Cask (source of truth; mirror to the `zyuuryuu/homebrew-slidecraft` tap).
#
# Why a cask instead of a direct .dmg download:
#   The macOS build is AD-HOC signed but NOT notarized (no $99 Apple Developer account). `brew
#   install --cask` strips the `com.apple.quarantine` xattr on install, so Gatekeeper's
#   "unidentified developer" block never fires — the app opens cleanly. An own tap
#   (`brew tap zyuuryuu/slidecraft`) has no notarization requirement (unlike official homebrew-cask).
#
# v0.1.0 ships **Apple Silicon (arm64) only** — the Intel (x64) .dmg isn't built yet (CI runner
# scarcity). When an x64 .dmg is published, restore the on_arm/on_intel split and drop `depends_on arch`.
#
# Per release, update `version` + `sha256`. Compute it from the published .dmg:
#   shasum -a 256 SlideCraft_<version>_aarch64.dmg
# (`scripts/update-cask.mjs` automates this against a GitHub release — see packaging/homebrew/README.md.)
cask "slidecraft" do
  version "0.1.0"
  sha256 "118df00267d97307a9157caa1520793c619d2134a388a70dff2e4dde53bfc3fb"

  url "https://github.com/zyuuryuu/slidecraft/releases/download/v#{version}/SlideCraft_#{version}_aarch64.dmg"
  name "SlideCraft"
  desc "Markdown/YAML to PPTX slide generator (Tauri desktop app)"
  homepage "https://github.com/zyuuryuu/slidecraft"

  # v0.1.0 は Apple Silicon (arm64) のみ配布。Intel Mac 版は未生成なので明示的に拒否する。
  depends_on arch: :arm64

  # Track the latest GitHub release tag so `brew livecheck` / autobump can flag new versions.
  livecheck do
    url :url
    strategy :github_latest
  end

  app "SlideCraft.app"

  # Put the bundled MCP server launcher on PATH so an upstream agent (Claude Code / Cursor / Claude
  # Desktop) can drive SlideCraft with NO source build and NO system Node — `slidecraft-mcp` execs the
  # Node runtime + the self-contained MCP server (cli.cjs) that ship inside the .app. Register with:
  #   claude mcp add slidecraft -- slidecraft-mcp
  # NOTE: the wrapper exists only in v0.1.1+ .dmgs. Do NOT ship this stanza in a cask that still points
  # at the v0.1.0 .dmg (which lacks it) — `brew install` fails on the missing binary target.
  binary "#{appdir}/SlideCraft.app/Contents/Resources/slidecraft-mcp"

  # Belt-and-suspenders: guarantee the launcher is executable regardless of how resources were packed.
  # `system_command` is the supported cask-DSL way to run a helper from a postflight block; `chmod +x`
  # is idempotent and harmless if the executable bit is already set.
  postflight do
    system_command "/bin/chmod",
                   args: ["+x", "#{appdir}/SlideCraft.app/Contents/Resources/slidecraft-mcp"]
  end

  # Remove user data + the auto-downloaded offline-AI model (~2.4 GB) on `brew uninstall --zap`.
  zap trash: [
    "~/Library/Application Support/com.slidecraft.desktop",
    "~/Library/Caches/com.slidecraft.desktop",
    "~/Library/Preferences/com.slidecraft.desktop.plist",
    "~/Library/Saved Application State/com.slidecraft.desktop.savedState",
  ]
end
