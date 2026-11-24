// The repository's packages: the hub at the root and the in-house games in games/<id>, npm
// workspaces that share the root's one node_modules.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const ROOT_PACKAGE = read("package.json");
const GAME_IDS = readdirSync(join(ROOT, "games"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "games", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

/**
 * The files an install of the package in `dir` holds: npm's own list for a pack (an install from
 * git, as an outside game installs the hub, packs the clone the same way).
 */
function packedFiles(dir) {
  const out = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: join(ROOT, dir), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  const [entry] = Object.values(out);
  return new Set(entry.files.map((file) => file.path));
}

/** Every [subpath, target file pattern] a package.json's exports name, through any conditions. */
function exportTargets(exports) {
  const targets = [];
  const walk = (subpath, target) => {
    if (typeof target === "string") targets.push([subpath, target]);
    else if (target && typeof target === "object") for (const value of Object.values(target)) walk(subpath, value);
  };
  for (const [subpath, target] of Object.entries(exports ?? {})) walk(subpath, target);
  return targets;
}

/** The export targets in `dir`'s package.json that an install of it would not contain. */
function unpackedExports(dir) {
  const packed = packedFiles(dir);
  const tracked = execFileSync("git", ["ls-files", "--", dir === "." ? "." : dir], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((path) => (dir === "." ? path : path.slice(dir.length + 1)));
  const missing = [];
  for (const [subpath, target] of exportTargets(read(join(dir, "package.json")).exports)) {
    const pattern = target.replace(/^\.\//, "");
    const star = pattern.indexOf("*");
    const files = star < 0 ? [pattern] : tracked.filter((path) => path.startsWith(pattern.slice(0, star)) && path.endsWith(pattern.slice(star + 1)));
    if (files.length === 0) missing.push(`${subpath} -> ${target} (no such file)`);
    for (const file of files) if (!packed.has(file)) missing.push(`${subpath} -> ${file}`);
  }
  return missing;
}

describe("the hub's public surface", () => {
  it("is the kit and the Table's adapter, nothing in-house", () => {
    expect(Object.keys(ROOT_PACKAGE.exports)).toEqual([
      "./kit",
      "./kit/core",
      "./kit/rng",
      "./kit/http",
      "./kit/build",
      "./kit/build/folders",
      "./kit/client/*",
      "./table",
      "./table/draws",
      "./package.json",
    ]);
  });

  it("names only files an outside install contains (the root's files list)", () => {
    expect(
      unpackedExports("."),
      "the root package.json exports a file its `files` list leaves out, so a game that installs the hub from git cannot import it",
    ).toEqual([]);
  });
});

describe("the games' workspaces", () => {
  it("are found", () => {
    expect(GAME_IDS).toEqual(["hot-potato", "paper-masks", "tin-derby", "who-am-i"]);
  });

  it("have no node_modules of their own (nor has the lobby's)", () => {
    const own = [...GAME_IDS.map((id) => `games/${id}`), "lobby"].filter((dir) => existsSync(join(ROOT, dir, "node_modules")));
    expect(
      own,
      `${own[0]}/node_modules should not exist: every workspace shares the root node_modules. ` +
        "It is usually vitest's cache, from running vitest inside that folder " +
        "(run a game's tests with `npm test -w <game>` from anywhere, or `npx vitest run games/<id>` from the root), " +
        "or a dependency declared there with a range other than the root's (npm then installs a second copy there). " +
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
