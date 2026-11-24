import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const kit = (path) => fileURLToPath(new URL(`./party-kit/${path}`, import.meta.url));
const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * A page folder and the shared folder the site serves under it as "shared/" (scripts/build-public.mjs):
 * the party room (lobby/public with lobby/shared at lobby/shared) and Hot Potato
 * (one-device/hot-potato/public with its shared matcher and lists at one-device/hot-potato/shared).
 * A page module imports "./shared/..." next to itself; tests read the same files from where they are kept.
 */
const SERVED_SHARED = [
  [here("./lobby/public/"), here("./lobby/shared/")],
  [here("./one-device/hot-potato/public/"), here("./one-device/hot-potato/shared/")],
];
const servedShared = {
  name: "served-shared",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer || !source.startsWith(".")) return null;
    for (const [pub, shared] of SERVED_SHARED) {
      if (!importer.startsWith(pub)) continue;
      const target = resolve(dirname(importer), source);
      const under = `${pub}shared/`;
      return target.startsWith(under) ? shared + target.slice(under.length) : null;
    }
    return null;
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
      // The Worker's release record is written by a build (wrangler.jsonc's alias); the tests use a fixed stand-in.
      { find: /^n8-party-games\/release$/, replacement: here("./scripts/release-stub.js") },
      // The pages' copy at its site path (site/release-line.js imports it): the same stand-in.
      { find: /^\/release\.js$/, replacement: here("./scripts/release-stub.js") },
      // The 3D look's three.js is the copy Cork & Bell serves (lobby/public/look3d/three.js): the same release as this package's.
      { find: /^\/cork-and-bell\/game\/vendor\/three\.module\.js$/, replacement: "three" },
    ],
  },
  test: { include: ["party-kit/test/**/*.test.js", "lobby/test/**/*.test.js", "lab/**/*.test.js","one-device/**/*.test.js", "site/**/*.test.js", "games/**/*.test.js"], environment: "node" },
});
