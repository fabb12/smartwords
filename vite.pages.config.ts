// Static build for GitHub Pages: `npm run build:pages` writes ./out-pages.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./site", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./out-pages", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
});
