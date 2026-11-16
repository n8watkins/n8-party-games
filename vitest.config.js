import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const kit = (path) => fileURLToPath(new URL(`./party-kit/${path}`, import.meta.url));
const lobbyPublic = fileURLToPath(new URL("./lobby/public/", import.meta.url));
const lobbyShared = fileURLToPath(new URL("./lobby/shared/", import.meta.url));

/**
 * The party room's page imports the plain logic it shares with the room as "shared/...", next to
 * itself: the site serves lobby/shared at lobby/shared (scripts/build-public.mjs), so a page
 * module under lobby/public finds it there. Tests read the same files from where they are kept.
 */
const servedShared = {
  name: "lobby-served-shared",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer || !source.startsWith(".") || !importer.startsWith(lobbyPublic)) return null;
    const target = resolve(dirname(importer), source);
    const under = `${lobbyPublic}shared/`;
    return target.startsWith(under) ? lobbyShared + target.slice(under.length) : null;
  },
};

export default defineConfig({
  plugins: [servedShared],
  // The kit by its package name is this repository's own folder (the same alias as wrangler.jsonc).
  resolve: {
    alias: [
      { find: /^n8-party-games\/kit$/, replacement: kit("src/worker/index.js") },
      { find: /^n8-party-games\/kit\/core$/, replacement: kit("src/core/room-core.js") },
      { find: /^n8-party-games\/kit\/rng$/, replacement: kit("src/core/rng.js") },
      { find: /^n8-party-games\/kit\/http$/, replacement: kit("src/worker/http.js") },
      { find: /^n8-party-games\/kit\/build$/, replacement: kit("build/public.mjs") },
      // The 3D look's three.js is the copy Cork & Bell serves (lobby/public/look3d/three.js): the same release as this package's.
      { find: /^\/cork-and-bell\/game\/vendor\/three\.module\.js$/, replacement: "three" },
    ],
  },
  test: { include: ["party-kit/test/**/*.test.js", "lobby/test/**/*.test.js", "lab/**/*.test.js", "party/games/**/test/**/*.test.js"], environment: "node" },
});
