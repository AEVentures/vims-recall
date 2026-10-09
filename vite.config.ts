import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tsconfigPaths from "vite-tsconfig-paths";

/** Served from https://aeventures.github.io/vims-recall/ ; override with VITE_BASE=/ for a root domain. */
const base = process.env.VITE_BASE ?? "/vims-recall/";

export default defineConfig({
  base,
  plugins: [
    react(),
    tsconfigPaths(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: { globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,wasm}"], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, navigateFallback: `${base}index.html` },
      includeAssets: ["og.png", "icon.svg"],
      manifestFilename: "manifest.json",
      manifest: {
        name: "VIMS Recall",
        short_name: "Recall",
        description: "Spaced-repetition flashcards. Local-first, private, fast.",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#0b0c10",
        theme_color: "#0b0c10",
        icons: [{ src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" }]
      }
    })
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    exclude: ["node_modules/**", "dist/**"]
  }
});
