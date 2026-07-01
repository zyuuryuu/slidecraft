# SlideCraft — Homebrew Cask (source of truth; mirror to the `zyuuryuu/homebrew-slidecraft` tap).
#
# Why a cask instead of a direct .dmg download:
#   The macOS build is AD-HOC signed but NOT notarized (no $99 Apple Developer account). `brew
#   install --cask` strips the `com.apple.quarantine` xattr on install, so Gatekeeper's
#   "unidentified developer" block never fires — the app opens cleanly. An own tap
#   (`brew tap zyuuryuu/slidecraft`) has no notarization requirement (unlike official homebrew-cask).
#
# Per release, update `version` and BOTH sha256 values. Compute them from the published .dmg assets:
#   shasum -a 256 SlideCraft_<version>_aarch64.dmg   # -> on_arm  sha256
#   shasum -a 256 SlideCraft_<version>_x64.dmg       # -> on_intel sha256
# (`scripts/update-cask.mjs` automates this against a GitHub release — see packaging/homebrew/README.md.)
cask "slidecraft" do
  version "0.1.0"

  on_arm do
    sha256 "0000000000000000000000000000000000000000000000000000000000000000" # TODO: aarch64 .dmg sha256
    url "https://github.com/zyuuryuu/slidecraft/releases/download/v#{version}/SlideCraft_#{version}_aarch64.dmg"
  end
  on_intel do
    sha256 "0000000000000000000000000000000000000000000000000000000000000000" # TODO: x64 .dmg sha256
    url "https://github.com/zyuuryuu/slidecraft/releases/download/v#{version}/SlideCraft_#{version}_x64.dmg"
  end

  name "SlideCraft"
  desc "YAML/JSON to PPTX diagram slide generator (Tauri desktop app)"
  homepage "https://github.com/zyuuryuu/slidecraft"

  # Track the latest GitHub release tag so `brew livecheck` / autobump can flag new versions.
  livecheck do
    url :url
    strategy :github_latest
  end

  app "SlideCraft.app"

  # Remove user data + the auto-downloaded offline-AI model (~2.4 GB) on `brew uninstall --zap`.
  zap trash: [
    "~/Library/Application Support/com.slidecraft.desktop",
    "~/Library/Caches/com.slidecraft.desktop",
    "~/Library/Preferences/com.slidecraft.desktop.plist",
    "~/Library/Saved Application State/com.slidecraft.desktop.savedState",
  ]
end
