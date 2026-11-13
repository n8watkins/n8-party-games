import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const kit = (path) => fileURLToPath(new URL(`./party-kit/${path}`, import.meta.url));

export default defineConfig({
  // The kit by its package name is this repository's own folder (the same alias as wrangler.jsonc).
  resolve: {
    alias: [
      { find: /^n8-party-games\/kit$/, replacement: kit("src/worker/index.js") },
      { find: /^n8-party-games\/kit\/core$/, replacement: kit("src/core/room-core.js") },
      { find: /^n8-party-games\/kit\/rng$/, replacement: kit("src/core/rng.js") },
      { find: /^n8-party-games\/kit\/http$/, replacement: kit("src/worker/http.js") },
      { find: /^n8-party-games\/kit\/build$/, replacement: kit("build/public.mjs") },
    ],
  },
  test: { include: ["party-kit/test/**/*.test.js", "lobby/test/**/*.test.js"], environment: "node" },
});
