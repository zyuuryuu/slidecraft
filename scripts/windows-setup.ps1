# windows-setup.ps1 — set up a Windows machine to build/run the SlideCraft Tauri DESKTOP app.
#
# WHY native Windows (not WSL): WebView2 (= Chromium) renders the app correctly, unlike WSLg's
# webkit2gtk (blank window). Build the Rust/Tauri side on the NATIVE Windows filesystem (C:\…),
# NOT over \\wsl.localhost\… (slow + flaky file-watching).
#
# Run from an ELEVATED PowerShell (admin — the VS C++ Build Tools need it), from inside the cloned
# repo:  powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1
#
# Already present on this machine (probed): git, WebView2 Runtime. Missing: Node, Rust, MSVC C++.

$ErrorActionPreference = "Stop"
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

Step "1/4  Node.js (LTS)"
if (Have node) { Write-Host "ok: $(node -v)" } else {
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
}

Step "2/4  Rust (rustup, MSVC toolchain)"
if (Have cargo) { Write-Host "ok: $(rustc --version)" } else {
  winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
}

Step "3/4  Microsoft C++ Build Tools (the MSVC linker Tauri needs)"
if (Have cl) { Write-Host "ok: MSVC present" } else {
  Write-Host "Installing VS 2022 Build Tools + the 'Desktop development with C++' workload (large; needs admin)…"
  winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements `
    --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

Step "4/4  WebView2 Runtime"
$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if ($wv) { Write-Host "ok: WebView2 $($wv.pv)" } else { winget install -e --id Microsoft.EdgeWebView2Runtime }

Write-Host "`nToolchain done. CLOSE and reopen PowerShell (so PATH picks up node/cargo), then:" -ForegroundColor Green
Write-Host "  rustup default stable-msvc" -ForegroundColor Yellow
Write-Host "  npm install" -ForegroundColor Yellow
Write-Host "  npm run tauri dev        # hot-reload dev app (verifies the GUI renders on WebView2)" -ForegroundColor Yellow
Write-Host "  npm run tauri build      # produce the .msi / .exe installer" -ForegroundColor Yellow
