import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/ — the Vitest config (its `test` block) is merged here,
// so there's no separate vitest.config.ts at the repo root.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Prevent vite from obscuring Rust errors
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Don't watch the Rust crate: while `tauri dev` runs, cargo writes/locks files under
    // src-tauri/target (build-script .exes), and Vite's file watcher crashes with EBUSY on
    // those locked files on Windows. Tauri's own scaffold excludes src-tauri for this reason.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
