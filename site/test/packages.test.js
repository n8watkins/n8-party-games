// The repository's packages: the hub at the root, whose exports are its public surface (the kit),
// and its npm workspaces, which share the root's one node_modules: the in-house games in
// games/<id> and the private @n8games/lobby (lobby/), the party room and test helpers they reach.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { init as initLexer, parse as parseModule } from "es-module-lexer";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const ROOT_PACKAGE = read("package.json");
const GAME_IDS = readdirSync(join(ROOT, "games"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "games", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

/** The workspaces: the lobby's folder and each game's. */
const WORKSPACE_DIRS = ["lobby", ...GAME_IDS.map((id) => `games/${id}`)];

/** npm calls here can take seconds on a loaded machine: these tests get a minute. */
const SLOW = { timeout: 60_000 };

/**
 * The files an install of each package holds, by package name: npm's own list for a pack (an
 * install from git, as an outside game installs the hub, packs the clone the same way). One call
 * for the root (no `args`) or for every workspace (`--workspaces`).
 */
function packedFiles(args = []) {
  const out = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  return new Map(Object.values(out).map((entry) => [entry.name, new Set(entry.files.map((file) => file.path))]));
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
function unpackedExports(dir, packedByName) {
  const packed = packedByName.get(read(join(dir, "package.json")).name) ?? new Set();
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

/** The git-tracked scripts under `dir` (a path from the root). */
const scriptsIn = (dir) =>
  execFileSync("git", ["ls-files", "--", `${dir}/*.js`, `${dir}/*.mjs`], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

/**
 * The packages `file` imports by bare name (static imports, re-exports and import() of a plain
 * string), read with a real lexer: "vitest", "@n8games/lobby", "n8-party-games". Relative paths, site
 * paths ("/x.js") and the runtimes' own modules (node:, cloudflare:) are not packages.
 */
function bareImports(file) {
  const [imports] = parseModule(readFileSync(join(ROOT, file), "utf8"), file);
  const names = new Set();
  for (const { specifier } of imports) {
    if (typeof specifier !== "string" || /^(\.|\/|[a-z]+:)/.test(specifier)) continue;
    const parts = specifier.split("/");
    names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
  return names;
}

/** Every package a package.json declares, by name, with its range. */
const declared = (pkg) => ({ ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.devDependencies });

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

  it("names only files an outside install contains (the root's files list)", SLOW, () => {
    expect(
      unpackedExports(".", packedFiles()),
      "the root package.json exports a file its `files` list leaves out, so a game that installs the hub from git cannot import it",
    ).toEqual([]);
  });
});

describe("the games' workspaces", () => {
  it("are found", () => {
    expect(GAME_IDS).toEqual(["hot-potato", "paper-masks", "tin-derby", "who-am-i"]);
  });

  it("have no node_modules of their own (nor has the lobby's)", () => {
    const own = WORKSPACE_DIRS.filter((dir) => existsSync(join(ROOT, dir, "node_modules")));
    expect(
      own,
      `${own[0]}/node_modules should not exist: every workspace shares the root node_modules. ` +
        "It is usually vitest's cache, from running vitest inside that folder " +
        "(run a game's tests with `npm test -w <game>` from anywhere, or `npx vitest run games/<id>` from the root), " +
        "or a dependency declared there with a range other than the root's (npm then installs a second copy there). " +
        "Delete the folder, then `npm ci` from the root.",
    ).toEqual([]);
  });

  it("declare every package they import, each tool with the root's own range", SLOW, async () => {
    await initLexer;
    const workspaces = new Set([ROOT_PACKAGE.name, ...WORKSPACE_DIRS.map((dir) => read(`${dir}/package.json`).name)]);
    const atRoot = declared(ROOT_PACKAGE);
    const problems = [];
    for (const id of GAME_IDS) {
      const pkg = read(`games/${id}/package.json`);
      const own = declared(pkg);
      for (const file of scriptsIn(`games/${id}`)) {
        for (const name of bareImports(file)) {
          if (name !== pkg.name && !(name in own)) problems.push(`${file} imports ${name}, which games/${id}/package.json does not declare`);
        }
      }
      for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (workspaces.has(name)) continue;
        if (atRoot[name] !== range) problems.push(`games/${id}/package.json has ${name} ${range}, the root ${atRoot[name] ?? "nothing"}: one range, the root's, keeps one copy in the root node_modules`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("are declared by the hub wherever it imports them", SLOW, async () => {
    await initLexer;
    const games = new Set(WORKSPACE_DIRS.map((dir) => read(`${dir}/package.json`).name));
    const atRoot = declared(ROOT_PACKAGE);
    const problems = [];
    for (const file of scriptsIn(".").filter((path) => !path.startsWith("games/"))) {
      for (const name of bareImports(file)) if (games.has(name) && !(name in atRoot)) problems.push(`${file} imports ${name}, which the root package.json does not declare`);
    }
    expect(problems).toEqual([]);
  });

  it("each have a plain SemVer version, as the lobby's package has", () => {
    for (const dir of WORKSPACE_DIRS) {
      expect(read(`${dir}/package.json`).version ?? "(none)", `${dir}/package.json's version`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("export only files their own files list keeps", SLOW, () => {
    const packed = packedFiles(["--workspaces"]);
    const missing = WORKSPACE_DIRS.flatMap((dir) => unpackedExports(dir, packed).map((line) => `${dir}: ${line}`));
    expect(missing).toEqual([]);
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
