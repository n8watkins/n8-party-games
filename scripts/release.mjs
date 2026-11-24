// The release record: which build of the site a page or a room is running.
//
// scripts/build-public.mjs writes it twice from one object, as `release.js` in the public folder
// (pages import /release.js) and as dist/release.js, which the Worker imports by the name
// "n8-party-games/release" (an alias in wrangler.jsonc). So a page and the room it talks to agree
// on what a release is by construction, and /api/version answers with the same record.
//
//   RELEASE = { id, site, commit, dirty, pushed, builtAt, games, carries }
//
// - `id`: a short hash of every file of the built site (path and bytes, `_headers` and
//   `_redirects` included) except the record itself, the local build's preview pages and the
//   releases it carries, so a rebuild of the same code keeps its id, with the local or the
//   production settings, and any change a browser of the live site could see makes a new one.
//   The id is also the name of the release's folder (/r/<id>/, party-kit/build/folders.mjs), which
//   the pages name, so it is worked out from the site as built with ID_PLACEHOLDER in its place
//   (scripts/build-public.mjs, build). Server-only changes keep the id: they change `commit`,
//   and the Worker's version id (the version metadata binding) tells deploys apart.
// - `carries`: the releases whose files this build also holds, newest first, each `{id, commit}`
//   (scripts/carried.mjs): pages still open on one of them keep loading its files. The next
//   deploy reads this list from the live site to know what to carry in its turn.
// - `site`: the site's version (package.json, set by release-kit; RELEASING.md).
// - `commit`: the git commit the build was made from, 12 hex digits; `dirty` when the working
//   tree had changes (gitState); `pushed` when the commit is on origin/main. A deploy refuses a
//   dirty tree and an unpushed commit (releaseProblem).
// - `builtAt`: when the build ran (ISO time); not part of the id.
// - `games`: each hosted game's own version: a game that is a package (Cork & Bell, Tin Derby)
//   by its package.json, with the git ref it is pinned at when it is a git dependency; a game kept
//   in this repository (Paper Masks, Who Am I? at the Table) by `version` in its manifest.
//   The Floor, the Table and Hot Potato are the site's own and share `site`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";

/** Where the page's copy is served, and the name the build gives the Worker's copy beside the public folder. */
export const RELEASE_FILE = "release.js";
/** Where a local build (--preview) puts the pages still waiting for approval (scripts/build-public.mjs): not part of a release. */
export const PREVIEW_DIR = "preview";
/** Hex digits of the build hash in a release id. */
export const ID_LENGTH = 12;
/** A release id: 12 lowercase hex digits. */
export const RELEASE_ID = /^[0-9a-f]{12}$/;
/** What stands where the id goes while the id is worked out: the site is hashed as built with this, then built with the id. */
export const ID_PLACEHOLDER = "0".repeat(ID_LENGTH);
/** A plain SemVer version, as release-kit writes them. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The release id of a built folder: sha256 over each file's site path and bytes, in path order,
 * cut to ID_LENGTH hex digits. `files` is [{path, bytes}] as buildPublic returns; `read(path)`
 * gives a file's bytes. release.js is left out (it holds the id), and so is anything a build adds
 * after it. The pages a local build adds with --preview (PREVIEW_DIR) are left out too: they never
 * reach the live site, so a local build and a production-settings build of one tree are one
 * release (the pre-deploy gate runs both side by side). `salt`, for a local test build only
 * (TEST_SALT), is hashed first: the same files under another salt are another release, as a
 * deploy of changed files would be.
 */
export function releaseId(files, read, salt = "") {
  const hash = createHash("sha256");
  if (salt) hash.update(`salt:${salt.length}:${salt}:`);
  for (const { path } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (path === RELEASE_FILE || path.startsWith(`${PREVIEW_DIR}/`)) continue;
    const bytes = read(path);
    // Length-prefixed, so no two different folders can hash the same.
    hash.update(`${path.length}:${path}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, ID_LENGTH);
}

/** The branch every deployed commit must already be on (`pushed` in the record). */
export const MAIN_REF = "origin/main";
/** How many changed paths a refusal names before it says how many more there are. */
const PATHS_SHOWN = 10;

/**
 * The repository's state, as the record and the deploy checks need it:
 * - `commit`: HEAD, 12 hex digits (null outside git);
 * - `paths`: what makes the tree dirty, as `git status --porcelain` names them: anything modified,
 *   staged or untracked anywhere, and any gitignored file inside a folder the build copies to the
 *   site (`sources`, absolute paths; ones under node_modules, which the lock file pins, and
 *   dotfiles, which the build never copies, are left out);
 * - `dirty`: whether there are any;
 * - `pushed`: whether HEAD is on MAIN_REF as this clone last fetched it.
 */
export function gitState(root, { sources = [] } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let commit;
  try {
    commit = git("rev-parse", `--short=${ID_LENGTH}`, "HEAD").trim();
  } catch {
    return { commit: null, dirty: true, pushed: false, paths: [] };
  }
  const lines = (text) => text.split("\n").filter(Boolean);
  // Untracked files count: a new page left out of a commit would ship without being in it.
  const paths = lines(git("status", "--porcelain=v1", "--untracked-files=all"));
  const served = sources
    .map((path) => relative(root, path))
    .filter((path) => path && !path.startsWith("..") && !isAbsolute(path) && !path.split(sep).includes("node_modules"));
  if (served.length) {
    for (const line of lines(git("status", "--porcelain=v1", "--ignored=matching", "--untracked-files=all", "--", ...served))) {
      if (line.startsWith("!! ") && !line.slice(3).split("/").some((part) => part.startsWith("."))) paths.push(`${line} (gitignored, but inside a folder the site serves)`);
    }
  }
  let pushed = false;
  try {
    git("merge-base", "--is-ancestor", "HEAD", MAIN_REF);
    pushed = true;
  } catch {
    // Not on it, or no such ref in this clone.
  }
  return { commit, dirty: paths.length > 0, pushed, paths };
}

/** The environment variable that lets a production-settings build of a dirty tree through, for a local server only. */
export const ALLOW_DIRTY = "RELEASE_ALLOW_DIRTY";

/** `--carry=live`: carry what the live site says it is and carries (scripts/carried.mjs), as a deploy does. */
export const CARRY_LIVE = "live";

/**
 * A build's test options (scripts/build-public.mjs `--out=DIR`, `--salt=TEXT`, `--flat` and
 * `--carry=DIR,DIR`), for the end-to-end test of a new build (lobby/test/e2e-release.mjs): it
 * builds into a folder of its own, so it never touches dist/public that other local Workers
 * serve; a salt makes the same files another release, so restarting its Worker is a deploy;
 * `--flat` builds the site as it was before release folders (the release a first folder release
 * replaces); and `--carry` names the builds it carries, as a deploy carries the releases before
 * it. None may reach the live site: they are refused with --production and on an upload
 * (`--carry=live`, which is what a deploy does anyway, is not one of them). Returns the problem,
 * or null.
 */
export function testBuildProblem({ out = null, salt = null, flat = false, carry = null }, { upload, production }) {
  const dirs = carry !== null && carry !== CARRY_LIVE;
  if (!out && !salt && !flat && !dirs) return null;
  if (upload || production) return "--out, --salt, --flat and --carry=DIR are for a local test build only: a production build and a deploy never take them.";
  if (salt !== null && !/^[A-Za-z0-9_-]{1,40}$/.test(salt)) return "--salt takes 1 to 40 letters, digits, - or _.";
  if (flat && carry !== null) return "--flat is the site from before release folders: it carries nothing.";
  return null;
}

/**
 * Wrangler names the command a custom build runs for in WRANGLER_COMMAND: "dev" for `wrangler dev`,
 * "deploy" (or "versions upload") for an upload. A unit test checks the installed Wrangler still
 * sets it. Unset means the build was run by hand.
 */
export function buildKind(env = process.env) {
  const command = env.WRANGLER_COMMAND ?? "";
  return command === "" ? "manual" : command === "dev" ? "dev" : "upload";
}

/** The plain lines that say what is in the way, the paths listed up to PATHS_SHOWN. */
function listed(paths) {
  const shown = paths.slice(0, PATHS_SHOWN).map((p) => `  ${p}`);
  if (paths.length > PATHS_SHOWN) shown.push(`  ...and ${paths.length - PATHS_SHOWN} more (git status)`);
  return shown.join("\n");
}

/**
 * What stops a release from going live, or null. `upload` is a deploy (or the gate run as part of
 * one): it must be one clean commit that is already on MAIN_REF, and RELEASE_ALLOW_DIRTY is
 * refused outright. Otherwise (a local server with the production settings, or a build by hand)
 * only a dirty tree is refused, and RELEASE_ALLOW_DIRTY=1 lets it through; its record says
 * `dirty: true`.
 */
export function releaseProblem({ commit, dirty, pushed, paths = [] }, { upload, env = process.env }) {
  if (!commit) return "A production build needs the git repository: no commit was found.";
  if (upload && env[ALLOW_DIRTY]) return `${ALLOW_DIRTY} is set, and a deploy never takes it: unset it. It is only for a local server with the production settings.`;
  if (dirty && !(env[ALLOW_DIRTY] === "1" && !upload)) {
    return [
      `The working tree has uncommitted or untracked changes, and a ${upload ? "deploy" : "production build"} must come from one commit (${commit}).`,
      listed(paths),
      upload ? "Commit, stash or remove them first." : `Commit, stash or remove them first. For a local server with the production settings only, set ${ALLOW_DIRTY}=1.`,
    ].join("\n");
  }
  if (upload && !pushed) return `The commit ${commit} is not on ${MAIN_REF}: a deploy is made only from a commit already merged. Merge it through a pull request, then \`git fetch\` and check out main (or the commit to roll back to).`;
  return null;
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

/**
 * Every file in a built folder, as [{path}] with site paths: what the id covers. Read from the
 * folder itself, so a file the build writes late (the `_headers` file with the CSP and the cache
 * rules) is never left out.
 */
export function builtFiles(out) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.isFile() ? [join(dir, d.name)] : []));
  return walk(out).map((file) => ({ path: relative(out, file).split(sep).join("/") }));
}

/** The id of a built folder as it was before release folders (a `--flat` build): every file in it but release.js. */
export function flatReleaseId(out, salt = "") {
  return releaseId(builtFiles(out), (path) => readFileSync(join(out, path)), salt);
}

/**
 * The release record of the build with `id`. `carries` are the releases it holds beside its own,
 * newest first, each `{id, commit}`.
 */
export function releaseRecord({ root, id, games, git = gitState(root), now = new Date(), carries = [] }) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return {
    id,
    site: pkg.version,
    commit: git.commit ?? "unknown",
    dirty: git.dirty,
    pushed: git.pushed,
    builtAt: now.toISOString(),
    games: gameVersions(games, pkg),
    carries: carries.map(({ id, commit }) => ({ id, commit })),
  };
}

/** The record a release.js module's text holds, or null when it holds none. */
export function recordIn(text) {
  const json = /Object\.freeze\((\{.*\})\);/.exec(text ?? "")?.[1];
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

/** The module text both copies hold. */
export function releaseModule(record) {
  return [
    "// Written by scripts/build-public.mjs (scripts/release.mjs): which build this is. Do not edit.",
    `export const RELEASE = Object.freeze(${JSON.stringify(record)});`,
    "",
  ].join("\n");
}
