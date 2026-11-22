// The release record: which build of the site a page or a room is running.
//
// scripts/build-public.mjs writes it twice from one object, as `release.js` in the public folder
// (pages import /release.js) and as dist/release.js, which the Worker imports by the name
// "n8-party-games/release" (an alias in wrangler.jsonc). So a page and the room it talks to agree
// on what a release is by construction, and /api/version answers with the same record.
//
//   RELEASE = { id, site, commit, dirty, builtAt, games }
//
// - `id`: a short hash of every built public file (path and bytes) except release.js itself, so a
//   rebuild of the same code keeps its id, and any change a browser could see makes a new one.
//   Server-only changes keep the id: they change `commit`, and the Worker's version id (the
//   version metadata binding) tells deploys apart.
// - `site`: the site's version (package.json, set by release-kit; RELEASING.md).
// - `commit`: the git commit the build was made from, 12 hex digits, and `dirty` when the working
//   tree had changes. A production build refuses a dirty tree (assertReleasable).
// - `builtAt`: when the build ran (ISO time); not part of the id.
// - `games`: each hosted game's own version: a game that is a package (Cork & Bell, Tin Derby)
//   by its package.json, with the git ref it is pinned at when it is a git dependency; a game kept
//   in this repository (Paper Masks, Who Am I? at the Table) by `version` in its manifest.
//   The Floor, the Table and Hot Potato are the site's own and share `site`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Where the page's copy is served, and the name the build gives the Worker's copy beside the public folder. */
export const RELEASE_FILE = "release.js";
/** Hex digits of the build hash in a release id. */
export const ID_LENGTH = 12;
/** A release id: 12 lowercase hex digits. */
export const RELEASE_ID = /^[0-9a-f]{12}$/;
/** A plain SemVer version, as release-kit writes them. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The release id of a built folder: sha256 over each file's site path and bytes, in path order,
 * cut to ID_LENGTH hex digits. `files` is [{path, bytes}] as buildPublic returns; `read(path)`
 * gives a file's bytes. release.js is left out (it holds the id), and so is anything a build adds
 * after it.
 */
export function releaseId(files, read) {
  const hash = createHash("sha256");
  for (const { path } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (path === RELEASE_FILE) continue;
    const bytes = read(path);
    // Length-prefixed, so no two different folders can hash the same.
    hash.update(`${path.length}:${path}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, ID_LENGTH);
}

/** The repository's commit (12 hex digits) and whether its working tree has changes; null commit outside git. */
export function gitState(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const commit = git("rev-parse", `--short=${ID_LENGTH}`, "HEAD");
    // Untracked files count: a new page left out of a commit would ship without being in it.
    const dirty = git("status", "--porcelain", "--untracked-files=normal") !== "";
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: true };
  }
}

/** The environment variable that lets a production build of a dirty tree through, for local checks only. */
export const ALLOW_DIRTY = "RELEASE_ALLOW_DIRTY";

/**
 * A production build (the build command a deploy runs) must come from one commit and nothing
 * else, so the record says exactly what is live. A local server with the production settings
 * (DEPLOY.md step 3, and the gate's own) may set RELEASE_ALLOW_DIRTY=1; its record then says
 * `dirty: true`. Throws with what to do.
 */
export function assertReleasable({ commit, dirty }, env = process.env) {
  if (commit && !dirty) return;
  if (env[ALLOW_DIRTY] === "1") return;
  if (!commit) throw new Error("build-public: a production build needs the git repository (no commit found)");
  throw new Error(
    `build-public: the working tree has uncommitted changes, and a production build must come from one commit (${commit}). ` +
      `Commit or stash them first. For a local server with the production settings only, set ${ALLOW_DIRTY}=1.`,
  );
}

/**
 * Each hosted game's version (see the header). `games` are the modules games.js lists;
 * `pkg` is this repository's package.json, for the pins.
 */
export function gameVersions(games, pkg, require = createRequire(import.meta.url)) {
  const pins = { ...pkg.dependencies, ...pkg.devDependencies };
  const out = {};
  for (const { manifest } of games) {
    const spec = pins[manifest.id];
    if (spec) {
      const own = require(`${manifest.id}/package.json`);
      const ref = /^github:[^#]+#(.+)$/.exec(spec)?.[1];
      out[manifest.id] = { version: own.version, ...(ref && { ref }) };
    } else {
      if (!SEMVER.test(manifest.version ?? "")) throw new Error(`build-public: ${manifest.id} is kept in this repository, so its manifest needs a version ("1.2.3"), not ${JSON.stringify(manifest.version)}`);
      out[manifest.id] = { version: manifest.version };
    }
  }
  return out;
}

/** The release record for a built folder. */
export function releaseRecord({ root, files, out, games, git = gitState(root), now = new Date() }) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return {
    id: releaseId(files, (path) => readFileSync(join(out, path))),
    site: pkg.version,
    commit: git.commit ?? "unknown",
    dirty: git.dirty,
    builtAt: now.toISOString(),
    games: gameVersions(games, pkg),
  };
}

/** The module text both copies hold. */
export function releaseModule(record) {
  return [
    "// Written by scripts/build-public.mjs (scripts/release.mjs): which build this is. Do not edit.",
    `export const RELEASE = Object.freeze(${JSON.stringify(record)});`,
    "",
  ].join("\n");
}
