// Static build for GitHub Pages: `npm run build:pages` writes ./out-pages.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = fileURLToPath(new URL("./site", import.meta.url));
const outDir = fileURLToPath(new URL("./out-pages", import.meta.url));

// PWA: once the build is written, the service worker learns every file of this version,
// so the installed app works offline from the first visit, lazy chunks included.
function precache(): Plugin {
  return {
    name: "scrivia-precache",
    apply: "build",
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
      const files = walk(outDir).map(f => relative(outDir, f).split(sep).join("/")).filter(f => f !== "sw.js" && !f.endsWith(".map")).sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const sw = join(outDir, "sw.js"), source = readFileSync(sw, "utf8");
      const build = `const BUILD = ${JSON.stringify({ version: hash.digest("hex").slice(0, 12), files })};`;
      if (!source.includes("const BUILD = { version: 'dev', files: [] };")) throw new Error("sw.js: BUILD placeholder not found");
      writeFileSync(sw, source.replace("const BUILD = { version: 'dev', files: [] };", build));
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react(), precache()],
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
  },
});
