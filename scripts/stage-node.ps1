# stage-node.ps1 — stage a PINNED Node.js runtime as the Tauri externalBin sidecar, so the packaged
# app (.msi/.exe) can run the collab host (dist/mcp/host.cjs) on a machine with NO Node installed.
#
# Tauri requires the externalBin on disk as `node-<target-triple>.exe` BEFORE bundling, and at install
# time strips the suffix → `node.exe` next to SlideCraft.exe (collab.rs resolves it from current_exe()).
#
# Run BEFORE `npm run tauri build` (staging must precede bundling) — or just `npm run build:desktop`,
# which chains this then the build. Idempotent: re-run is a no-op unless -Force.
#
#   powershell -ExecutionPolicy Bypass -File scripts\stage-node.ps1 [-Force]
#
# Windows x64 only for now; add the mac/linux dist URLs + triples when those targets are needed.
param([switch]$Force)
$ErrorActionPreference = "Stop"

# Pinned LTS. host.cjs is bundled with esbuild --target=node20, so node 20/22/24 all run it; bump
# this when you want a newer runtime. Keep it an LTS for stability.
$NodeVersion = "v22.11.0"

$triple = (rustc --print host-tuple).Trim()
if ($triple -ne "x86_64-pc-windows-msvc") {
  throw "stage-node.ps1 currently supports Windows x64 only (host triple = '$triple'). Add the dist URL + triple for mac/linux when targeting them."
}

$binDir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
$dest = Join-Path $binDir "node-$triple.exe"

if ((Test-Path $dest) -and -not $Force) {
  Write-Host "node sidecar already staged: $dest  (use -Force to re-download)" -ForegroundColor Green
  exit 0
}

New-Item -ItemType Directory -Force $binDir | Out-Null
$zipName = "node-$NodeVersion-win-x64.zip"
$url = "https://nodejs.org/dist/$NodeVersion/$zipName"
$tmpZip = Join-Path $env:TEMP $zipName
$tmpDir = Join-Path $env:TEMP "slidecraft-node-$NodeVersion"

Write-Host "Downloading $url ..." -ForegroundColor Cyan
Invoke-WebRequest $url -OutFile $tmpZip
if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
Expand-Archive $tmpZip $tmpDir -Force

$nodeExe = Join-Path $tmpDir "node-$NodeVersion-win-x64\node.exe"
if (-not (Test-Path $nodeExe)) { throw "node.exe not found in the archive at $nodeExe" }
Copy-Item $nodeExe $dest -Force
Remove-Item -Force $tmpZip
Remove-Item -Recurse -Force $tmpDir

$mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host "Staged $dest  (Node $NodeVersion, $mb MB)" -ForegroundColor Green
