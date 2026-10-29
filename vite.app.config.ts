import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The App's window, loaded by Tauri. Its Content Security Policy is in
// src-tauri/tauri.conf.json.
export default defineConfig({
  root: "app",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@ui": fileURLToPath(new URL("./ui", import.meta.url)) } },
  // The App has no favicon, nor any other public files.
  publicDir: false,
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: "../dist-app",
    emptyOutDir: true,
    // Fonts are files, never data: URLs, which the Content Security Policy
    // refuses.
    assetsInlineLimit: 0,
  },
});
