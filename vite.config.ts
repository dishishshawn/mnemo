import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/mnemo/"); local dev serves from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon-64.png", "icon-180.png", "logo.png"],
      manifest: {
        name: "Mnemo",
        short_name: "Mnemo",
        description: "Turn your course material into flashcards, practice questions, study guides and podcasts.",
        theme_color: "#4f83c6",
        background_color: "#f4f8fe",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // The sync API must always hit the network.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  test: {
    environment: "node",
    // `just smoke` sets SMOKE=1 to run the live Gemini test instead of the unit tests.
    // SMOKE_FILE=<path> runs one ad-hoc live check instead.
    include: process.env.SMOKE_FILE ? [process.env.SMOKE_FILE] : process.env.SMOKE ? ["scripts/smoke.test.ts"] : ["src/**/*.test.ts"],
  },
});
