// The releases a deploy carries: the two that were live before it.
//
// A Worker version serves only its own files (Cloudflare: "Version skew and static assets"). A
// page still open on the release before keeps asking for that release's files, by their own
// addresses (its folder /r/<id>/, or, for the release from before there were folders, the old
// flat addresses), until the "new version" switch reloads it at a safe point
// (site/release-switch.js). So each deploy also holds the files of the two releases before it.
//
// Where they come from, with nothing stored and no secret:
//   1. The live site says what it is and what it carries: GET /api/version answers
//      `{release, commit, carries: [{id, commit}, ...]}` (the release record, scripts/release.mjs).
//      The new deploy carries the live release and the newest one the live release carries. Its own
//      record lists them, so the next deploy finds the chain again the same way. After a rollback
//      the live site is the release rolled back to, and the chain goes on from there.
//   2. Each one is built again from its commit: the commit's files (git archive) in a folder of
//      their own, `npm ci` there (its own lock file: a game pinned at another commit then is that
//      commit again), and its own build (`node scripts/build-public.mjs --out=DIR`, which needs no
//      network and carries nothing). Its id must come out as the live site said: the id is a hash
//      of the built site, so the files carried are byte for byte the ones that were served.
//
// A deploy that cannot do this fails, saying why: it never ships without them silently. The way
// round is deliberate: RELEASE_CARRY=none (the owner's word), for the first deploy of a new site,
// or when the live site cannot be reached and waiting is worse than an open page that may miss a file.
//
// Local and test builds never come here: they carry nothing (or, the release test, the builds it
// names with --carry=DIR), and need no network.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_FILE, RELEASE_ID, recordIn } from "./release.mjs";

/** The live site. */
export const LIVE = "https://partygames.n8builds.dev";
/** How many releases before its own a deploy holds. */
export const CARRIED_RELEASES = 2;
/** The environment variable that lets a deploy go out without the releases before it: only `none` is taken. */
export const NO_CARRY = "RELEASE_CARRY";
/** A commit as the record holds it: 12 hex digits (a full hash is taken too). */
const COMMIT = /^[0-9a-f]{12,40}$/;

/** What every failure says last: the one way round, and whose call it is. */
const WAY_ROUND = `To deploy without the releases before this one (pages still open on them may fail to load a part until they reload), on the owner's word only: ${NO_CARRY}=none npm run deploy`;

/** An error from here, with the way round. `refusal` marks it as a plain answer, not a fault of the build. */
function refusal(message) {
  return Object.assign(new Error(`${message}\n${WAY_ROUND}`), { refusal: true });
}

/**
 * What a deploy should carry, wanted or not: "live" for an upload (and for `--carry=live`),
 * "none" when RELEASE_CARRY=none says so, the folders `--carry=DIR,DIR` names, or null (a local
 * build: nothing). A RELEASE_CARRY that is not `none` is refused: a typing mistake must not pass
 * for the default.
 */
export function carryWanted({ carry = null, upload = false, env = process.env }) {
  const said = env[NO_CARRY];
  if (said !== undefined && said !== "none") throw Object.assign(new Error(`${NO_CARRY} takes only "none" (deploy without the releases before this one), not ${JSON.stringify(said)}.`), { refusal: true });
  if (carry !== null && carry !== "live") return { dirs: carry.split(",").filter(Boolean) };
  if (upload || carry === "live") return said === "none" ? "none" : "live";
  return null;
}

/**
 * The releases to carry when replacing the live one: the live release, then what it carries,
 * newest first, each `{id, commit}`. `version` is what /api/version answered. A live site from
 * before the record listed what it carries (no `carries`) carries nothing. Anything that is not a
 * release id and a commit is refused: it would be built and served.
 */
export function carryChain(version) {
  if (!version || version.ok !== true) throw refusal("The live site's /api/version did not answer with a release record.");
  const chain = [{ id: version.release, commit: version.commit }, ...(Array.isArray(version.carries) ? version.carries : [])];
  const seen = new Set();
  const out = [];
  for (const entry of chain) {
    if (!RELEASE_ID.test(entry?.id ?? "") || !COMMIT.test(entry?.commit ?? "")) throw refusal(`The live site names a release that is not an id and a commit: ${JSON.stringify(entry)}.`);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, commit: entry.commit });
  }
  return out;
}

/** The first CARRIED_RELEASES of `chain` that are not the build itself (a deploy of the same release again carries what the live one carries). */
export function toCarry(chain, ownId, count = CARRIED_RELEASES) {
  return chain.filter((entry) => entry.id !== ownId).slice(0, count);
}

/** What the live site's /api/version answers. Tried `tries` times, a little apart; never cached. */
export async function liveVersion({ url = LIVE, fetchImpl = fetch, tries = 3, timeoutMs = 10_000, waitMs = 2000 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    try {
      const res = await fetchImpl(`${url}/api/version`, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`it answered ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
    }
  }
  throw refusal(`Could not ask the live site what it is (${url}/api/version): ${last?.message ?? last}.`);
}

/** The environment a carried release's own build runs in: a plain build by hand, whatever started this one. */
function plainBuildEnv(env = process.env) {
  const { WRANGLER_COMMAND, RELEASE_ALLOW_DIRTY, [NO_CARRY]: none, ...rest } = env;
  return rest;
}

/**
 * Builds the release `id` again from `commit` of the repository at `root`, in a folder of its own
 * under `work`. Returns `{id, commit, dir}`, `dir` being its built public folder. Throws, saying
 * what to do, when the commit is not in this clone, its packages or its build fail, or its id
 * comes out as another one. `run(cmd, args, options)` stands in for execFileSync in the tests.
 */
export function rebuildRelease({ root, work, id, commit, run = execFileSync, log = console.error }) {
  const quiet = { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const step = (what, cmd, args, options) => {
    try {
      return run(cmd, args, { ...quiet, ...options });
    } catch (err) {
      const said = `${err.stderr ?? ""}${err.stdout ?? ""}`.trim().split("\n").slice(-12).join("\n");
      throw refusal(`Could not build release ${id} again from commit ${commit}: ${what} failed.\n${said || err.message}`);
    }
  };
  try {
    run("git", ["cat-file", "-e", `${commit}^{commit}`], { ...quiet, cwd: root });
  } catch {
    throw refusal(`The commit ${commit} of release ${id} is not in this clone: run \`git fetch origin\` and try again.`);
  }
  const base = join(work, id);
  const src = join(base, "src");
  const built = join(base, "build");
  mkdirSync(src, { recursive: true });
  log(`build-public: building release ${id} again from commit ${commit}, to carry it...`);
  const tar = join(base, "src.tar");
  step("reading its files (git archive)", "git", ["archive", "--format=tar", "-o", tar, commit], { cwd: root });
  step("unpacking its files (tar)", "tar", ["-xf", tar, "-C", src], {});
  rmSync(tar, { force: true });
  // Its own packages, by its own lock file. No install scripts: the build runs none of them.
  step("installing its packages (npm ci)", process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: src, env: plainBuildEnv(), timeout: 600_000 });
  step("its own build", process.execPath, [join("scripts", "build-public.mjs"), `--out=${built}`], { cwd: src, env: plainBuildEnv(), timeout: 300_000 });
  const got = recordIn(readFileSync(join(built, RELEASE_FILE), "utf8"))?.id ?? null;
  if (got !== id) {
    throw refusal(`Commit ${commit} built again is release ${got ?? "(none)"}, not ${id} as the live site says: the files would not be the ones that were served, so they are not carried.`);
  }
  return { id, commit, dir: join(built, "public") };
}

/**
 * What a deploy carries, read from the live site: `{chain, carry(ownId), cleanup()}`. `chain` is
 * the releases the live site names (carryChain); `carry(ownId)` builds again the ones to hold
 * beside the build with id `ownId` and returns them as `[{id, commit, dir}]`; `cleanup()` removes
 * the folders they were built in. `version` and `rebuild` stand in for the live site and the
 * builds in the tests.
 */
export async function carriedFromLive({ root, version = liveVersion, rebuild = rebuildRelease, log = console.error } = {}) {
  const chain = carryChain(await version());
  let work = null;
  return {
    chain,
    carry(ownId) {
      const wanted = toCarry(chain, ownId);
      if (!wanted.length) return [];
      work ??= mkdtempSync(join(tmpdir(), "party-carried-"));
      return wanted.map((entry) => rebuild({ root, work, ...entry, log }));
    },
    cleanup() {
      if (work) rmSync(work, { recursive: true, force: true });
      work = null;
    },
  };
}

/** A build made with `--out=DIR`, as something to carry: `{id, commit, dir}` from DIR/release.js and DIR/public. */
export function builtIn(dir) {
  const record = recordIn(readFileSync(join(dir, RELEASE_FILE), "utf8"));
  if (!record?.id) throw new Error(`${dir} holds no build to carry: no release record in ${join(dir, RELEASE_FILE)}`);
  return { id: record.id, commit: record.commit, dir: join(dir, "public") };
}
