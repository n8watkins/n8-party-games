// The repository's packages: the hub at the root and the in-house games in games/<id>, npm
// workspaces that share the root's one node_modules.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const ROOT_PACKAGE = read("package.json");
const GAME_IDS = readdirSync(join(ROOT, "games"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "games", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

describe("the games' workspaces", () => {
  it("are found", () => {
    expect(GAME_IDS).toEqual(["hot-potato", "paper-masks", "tin-derby", "who-am-i"]);
  });

  it("have no node_modules of their own", () => {
    const own = GAME_IDS.filter((id) => existsSync(join(ROOT, "games", id, "node_modules")));
    expect(
      own,
      `games/${own[0]}/node_modules should not exist: every game shares the root node_modules. ` +
        "It is usually vitest's cache, from running vitest inside the game's folder " +
        "(run the game's tests with `npm test -w <game>` from anywhere, or `npx vitest run games/<id>` from the root), " +
        "or a game dependency whose range differs from the root's (npm then installs a second copy there). " +
        "Delete the folder, then `npm ci` from the root.",
    ).toEqual([]);
  });

  it("each run their unit tests through the root's config, from the root", () => {
    for (const id of GAME_IDS) {
      expect(read(`games/${id}/package.json`).scripts?.test, id).toBe(`cd ../.. && vitest run games/${id}`);
    }
  });

  it("each name their browser tests exactly as the root's scripts do", () => {
    const rootScripts = new Set(Object.values(ROOT_PACKAGE.scripts));
    for (const id of GAME_IDS) {
      const scripts = read(`games/${id}/package.json`).scripts ?? {};
      for (const [name, command] of Object.entries(scripts)) {
        if (!name.startsWith("test:e2e")) continue;
        expect(command.startsWith("cd ../.. && "), `${id} ${name}`).toBe(true);
        expect(rootScripts.has(command.slice("cd ../.. && ".length)), `${id} ${name}: ${command} is no root script`).toBe(true);
      }
    }
  });
});
