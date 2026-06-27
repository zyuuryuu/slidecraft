#!/usr/bin/env bash
# tauri-dev-wsl.sh — launch `tauri dev` under WSL2/WSLg.
#
# WSLg exposes the GPU only via the d3d12 Mesa driver; webkit2gtk (2.52+) tries the
# ZINK (GL-on-Vulkan) path and crashes the webview ("MESA: error: ZINK: failed to
# choose pdev" / "failed to create dri2 screen"). Forcing CPU rendering (llvmpipe)
# avoids that GPU path so the window actually opens. Output is tee'd to a log so a
# crash is easy to share.
#
# Usage:  npm run tauri:wsl       (or: bash scripts/tauri-dev-wsl.sh)
#         SLIDECRAFT_LOG=/path npm run tauri:wsl   # custom log path
set -u
cd "$(dirname "$0")/.." || exit 1

LOG="${SLIDECRAFT_LOG:-/tmp/slidecraft-tauri-dev.log}"

# Free a stale dev server / app left by a previous crashed run (your own processes).
fuser -k 5173/tcp 2>/dev/null || true
pkill -f 'diagram-pipeline-desktop' 2>/dev/null || true
sleep 1

{
  echo "=== slidecraft tauri:wsl ==="
  echo "webkit2gtk : $(pkg-config --modversion webkit2gtk-4.1 2>/dev/null || echo '?')"
  echo "DISPLAY=$DISPLAY  WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}"
  echo "renderer   : forcing software GL (llvmpipe) to dodge the WSLg ZINK/dri2 crash"
  echo "log        : $LOG"
  echo "============================"
} | tee "$LOG"

# Use X11 (XWayland) instead of native Wayland — webkit2gtk under WSLg frequently fails
# to map a window / exits silently on the Wayland backend; X11 is far more reliable.
export GDK_BACKEND=x11
# Force software rendering so the WSL2 GPU path can't crash the webview, and capture a
# full Rust backtrace if the backend panics.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
export RUST_BACKTRACE=full
# Surface GTK/GLib + GDK diagnostics so a window-creation failure is visible in the log.
export G_MESSAGES_DEBUG=all

# tee so the terminal shows it live AND the full session lands in $LOG.
npm run tauri dev 2>&1 | tee -a "$LOG"
