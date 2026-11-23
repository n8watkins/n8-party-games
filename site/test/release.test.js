// The release record (scripts/release.mjs): its id follows every built file and nothing else, a
// deploy is made only from one clean commit already on origin/main, every hosted game has a
// version, the build writes the same record for the pages and the Worker, and /api/version
// answers with it, never cached.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The site's Worker is imported below; its room classes need the runtime's base class.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
import { ALLOW_DIRTY, RELEASE_FILE, RELEASE_ID, SEMVER, buildKind, builtFiles, gameVersions, gitState, releaseId, releaseModule, releaseProblem, releaseRecord, testBuildProblem } from "../../scripts/release.mjs";
import { SERVED, build } from "../../scripts/build-public.mjs";
import { headersFile } from "../../party-kit/build/public.mjs";
import { GAMES, TURN_GAMES } from "../../games.js";
import { VERSION_PATH, handleVersion, versionInfo } from "../../party-kit/src/worker/version.js";
import { releaseLine } from "../release-line.js";

const ROOT = join(import.meta.dirname, "..", "..");
const files = (map) => Object.keys(map).map((path) => ({ path, bytes: map[path].length }));
const idOf = (map) => releaseId(files(map), (path) => Buffer.from(map[path]));
/** The record a module holds, read back without importing it. */
const recordIn = (text) => JSON.parse(/Object\.freeze\((.*)\);/.exec(text)[1]);
const CLEAN = { commit: "0123456789ab", dirty: false, pushed: true, paths: [] };

describe("the release id", () => {
  const site = { "index.html": "<p>hi</p>", "main.js": "export {}", "art/a.webp": "pic" };

  it("is 12 hex digits, the same for the same files in any order", () => {
    const id = idOf(site);
    expect(id).toMatch(RELEASE_ID);
    const reversed = Object.fromEntries(Object.entries(site).reverse());
    expect(idOf(reversed)).toBe(id);
  });

  it("changes when a file's bytes, its name or the set of files change", () => {
    const id = idOf(site);
    expect(idOf({ ...site, "main.js": "export {};" })).not.toBe(id);
    const { "main.js": code, ...rest } = site;
    expect(idOf({ ...rest, "main2.js": code })).not.toBe(id);
    expect(idOf({ ...site, "extra.css": "" })).not.toBe(id);
  });

  it("does not hash release.js itself, which holds the id", () => {
    expect(idOf({ ...site, [RELEASE_FILE]: "anything" })).toBe(idOf(site));
  });

  it("cannot be fooled by moving bytes between a name and a file", () => {
    expect(idOf({ ab: "c" })).not.toBe(idOf({ a: "bc" }));
  });

  it("is another release for the same files under a test build's salt, the same again for the same salt", () => {
    const salted = (salt) => releaseId(files(site), (path) => Buffer.from(site[path]), salt);
    expect(salted("")).toBe(idOf(site));
    expect(salted("one")).toMatch(RELEASE_ID);
    expect(salted("one")).not.toBe(idOf(site));
    expect(salted("one")).not.toBe(salted("two"));
    expect(salted("one")).toBe(salted("one"));
  });
});

describe("a local test build's options (testBuildProblem)", () => {
  it("are let through for a local build, and none is no problem anywhere", () => {
    expect(testBuildProblem({ out: "/tmp/x", salt: "a1" }, { upload: false, production: false })).toBeNull();
    expect(testBuildProblem({}, { upload: true, production: true })).toBeNull();
  });

  it("never reach the live site: refused with --production and on an upload", () => {
    expect(testBuildProblem({ out: "/tmp/x" }, { upload: false, production: true })).toMatch(/local test build only/);
    expect(testBuildProblem({ salt: "a1" }, { upload: true, production: false })).toMatch(/local test build only/);
  });

  it("take a plain salt only", () => {
    expect(testBuildProblem({ salt: "a b" }, { upload: false, production: false })).toMatch(/--salt/);
    expect(testBuildProblem({ salt: "x".repeat(41) }, { upload: false, production: false })).toMatch(/--salt/);
  });
});

describe("what a release may be built from (releaseProblem)", () => {
  const dirty = { ...CLEAN, dirty: true, paths: [" M site/home.js", "?? site/new.js"] };

  it("a deploy goes ahead from a clean commit on origin/main", () => {
    expect(releaseProblem(CLEAN, { upload: true, env: {} })).toBeNull();
  });

  it("a deploy refuses uncommitted or untracked changes and names them, with no way round", () => {
    const problem = releaseProblem(dirty, { upload: true, env: {} });
    expect(problem).toMatch(/uncommitted or untracked/);
    expect(problem).toContain(" M site/home.js");
    expect(problem).toContain("?? site/new.js");
    expect(problem).not.toContain(ALLOW_DIRTY);
  });

  it("names at most ten paths, then how many more", () => {
    const many = { ...dirty, paths: Array.from({ length: 14 }, (_, i) => `?? f${i}.js`) };
    const problem = releaseProblem(many, { upload: true, env: {} });
    expect(problem).toContain("f9.js");
    expect(problem).not.toContain("f10.js");
    expect(problem).toContain("4 more");
  });

  it("a deploy refuses RELEASE_ALLOW_DIRTY outright, even on a clean tree", () => {
    for (const value of ["1", "0", "true"]) expect(releaseProblem(CLEAN, { upload: true, env: { [ALLOW_DIRTY]: value } })).toMatch(/never takes it/);
    expect(releaseProblem(dirty, { upload: true, env: { [ALLOW_DIRTY]: "1" } })).toMatch(/never takes it/);
  });

  it("a deploy refuses a commit that is not on origin/main", () => {
    expect(releaseProblem({ ...CLEAN, pushed: false }, { upload: true, env: {} })).toMatch(/not on origin\/main/);
  });

  it("a local server with the production settings refuses a dirty tree unless RELEASE_ALLOW_DIRTY=1, and never minds the push", () => {
    expect(releaseProblem(dirty, { upload: false, env: {} })).toMatch(/RELEASE_ALLOW_DIRTY=1/);
    expect(releaseProblem(dirty, { upload: false, env: { [ALLOW_DIRTY]: "1" } })).toBeNull();
    expect(releaseProblem(dirty, { upload: false, env: { [ALLOW_DIRTY]: "true" } })).not.toBeNull();
    expect(releaseProblem({ ...CLEAN, pushed: false }, { upload: false, env: {} })).toBeNull();
  });

  it("refuses a build outside git", () => {
    expect(releaseProblem({ commit: null, dirty: true, pushed: false }, { upload: false, env: {} })).toMatch(/git repository/);
  });

  it("knows a deploy from a dev server by what Wrangler tells its build", () => {
    expect(buildKind({ WRANGLER_COMMAND: "deploy" })).toBe("upload");
    expect(buildKind({ WRANGLER_COMMAND: "versions upload" })).toBe("upload");
    expect(buildKind({ WRANGLER_COMMAND: "dev" })).toBe("dev");
    expect(buildKind({})).toBe("manual");
  });

  it("relies on a Wrangler that still names its command to a custom build", () => {
    // Wrangler's runCustomBuild passes WRANGLER_COMMAND ("dev", or the command) to the build. If an
    // upgrade drops it, a deploy would build as "manual": still refusing a dirty tree, but taking
    // RELEASE_ALLOW_DIRTY and an unpushed commit. This trips first.
    const cli = readFileSync(join(ROOT, "node_modules", "wrangler", "wrangler-dist", "cli.js"), "utf8");
    expect(cli).toMatch(/WRANGLER_COMMAND: runOptions\.wranglerCommand/);
    expect(cli).toMatch(/wranglerCommand: "dev"/);
  });
});

describe("the repository's state (gitState)", () => {
  const repo = mkdtempSync(join(tmpdir(), "party-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  mkdirSync(join(repo, "site"));
  mkdirSync(join(repo, "notes"));
  writeFileSync(join(repo, ".gitignore"), "*.log\n");
  writeFileSync(join(repo, "site", "page.js"), "export {}");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  const sources = [join(repo, "site")];

  it("is clean right after a commit, and not pushed without origin/main", () => {
    const state = gitState(repo, { sources });
    expect(state).toMatchObject({ dirty: false, pushed: false, paths: [] });
    expect(state.commit).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is pushed only while HEAD is on origin/main", () => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    expect(gitState(repo, { sources }).pushed).toBe(true);
    git("commit", "-q", "--allow-empty", "-m", "two");
    expect(gitState(repo, { sources }).pushed).toBe(false);
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    expect(gitState(repo, { sources }).pushed).toBe(true);
  });

  it("counts a gitignored file inside a served folder as dirty, but not one elsewhere, nor a dotfile the build skips", () => {
    writeFileSync(join(repo, "notes", "x.log"), "");
    writeFileSync(join(repo, "site", ".x.log"), "");
    expect(gitState(repo, { sources }).dirty).toBe(false);
    writeFileSync(join(repo, "site", "debug.log"), "");
    const state = gitState(repo, { sources });
    expect(state.dirty).toBe(true);
    expect(state.paths.join("\n")).toMatch(/site\/debug\.log.*gitignored/);
    rmSync(join(repo, "site", "debug.log"));
  });

  it("counts an untracked file anywhere, by its own path, and a changed one", () => {
    mkdirSync(join(repo, "notes", "deep"), { recursive: true });
    writeFileSync(join(repo, "notes", "deep", "todo.md"), "");
    expect(gitState(repo, { sources }).paths).toContain("?? notes/deep/todo.md");
    rmSync(join(repo, "notes", "deep"), { recursive: true });
    writeFileSync(join(repo, "site", "page.js"), "export {};");
    expect(gitState(repo, { sources }).paths).toContain(" M site/page.js");
  });
});

describe("the games' versions", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const versions = gameVersions([...GAMES, ...TURN_GAMES], pkg);

  it("names every hosted game, each with a plain SemVer version", () => {
    expect(Object.keys(versions).sort()).toEqual([...GAMES, ...TURN_GAMES].map((g) => g.manifest.id).sort());
    for (const v of Object.values(versions)) expect(v.version).toMatch(SEMVER);
  });

  it("gives a game pinned from git the ref it is pinned at", () => {
    const spec = pkg.devDependencies["cork-and-bell"];
    expect(versions["cork-and-bell"].ref).toBe(spec.split("#")[1]);
    // Tin Derby is a folder of this repository installed by file:, so it has no ref.
    expect(versions["tin-derby"].ref).toBeUndefined();
  });

  it("refuses a game kept in this repository whose manifest has no version", () => {
    const loose = { manifest: { id: "no-version-game" } };
    expect(() => gameVersions([loose], pkg)).toThrow(/needs a version/);
    expect(gameVersions([{ manifest: { id: "x", version: "1.2.3" } }], pkg)).toEqual({ x: { version: "1.2.3" } });
  });
});

describe("the build's release record", () => {
  const OUT = mkdtempSync(join(tmpdir(), "party-release-"));
  const WORKER = join(OUT, "..", `${OUT.split("/").pop()}-worker-release.js`);
  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(WORKER, { force: true });
  });
  const built = build(OUT, { workerRelease: WORKER, git: CLEAN });
  const text = readFileSync(join(OUT, RELEASE_FILE), "utf8");
  const record = recordIn(text);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  it("is served at /release.js and written the same for the Worker", () => {
    expect(SERVED).toContain(RELEASE_FILE);
    expect(built.map((f) => f.path)).toContain(RELEASE_FILE);
    expect(readFileSync(WORKER, "utf8")).toBe(text);
  });

  it("holds the id of every other file in the folder, _headers included, and the site's version, the commit and the games", () => {
    const onDisk = builtFiles(OUT);
    expect(onDisk.map((f) => f.path)).toContain("_headers");
    expect(record.id).toBe(releaseId(onDisk, (path) => readFileSync(join(OUT, path))));
    expect(record).toMatchObject({ site: pkg.version, commit: CLEAN.commit, dirty: false, pushed: true });
    expect(new Date(record.builtAt).toISOString()).toBe(record.builtAt);
    expect(record.games).toEqual(gameVersions([...GAMES, ...TURN_GAMES], pkg));
  });

  it("changes its id when a header rule changes (a CSP or cache rule is part of a release)", () => {
    const games = [...GAMES, ...TURN_GAMES];
    const before = releaseRecord({ root: ROOT, out: OUT, games, git: CLEAN }).id;
    expect(before).toBe(record.id);
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    try {
      writeFileSync(join(OUT, "_headers"), headersFile([], { frames: "none" }));
      expect(releaseRecord({ root: ROOT, out: OUT, games, git: CLEAN }).id).not.toBe(before);
      writeFileSync(join(OUT, "_headers"), headers.replace("X-Frame-Options: SAMEORIGIN", "X-Frame-Options: DENY"));
      expect(releaseRecord({ root: ROOT, out: OUT, games, git: CLEAN }).id).not.toBe(before);
    } finally {
      writeFileSync(join(OUT, "_headers"), headers);
    }
  });

  it("keeps its id when the same code is built again from another commit", () => {
    const again = mkdtempSync(join(tmpdir(), "party-release-again-"));
    try {
      build(again, { git: { commit: "ffffffffffff", dirty: true, pushed: false, paths: [] } });
      const second = recordIn(readFileSync(join(again, RELEASE_FILE), "utf8"));
      expect(second.id).toBe(record.id);
      expect(second).toMatchObject({ commit: "ffffffffffff", dirty: true, pushed: false });
    } finally {
      rmSync(again, { recursive: true, force: true });
    }
  });

  it("is a module that exports RELEASE, frozen", async () => {
    const mod = await import(`data:text/javascript,${encodeURIComponent(releaseModule(record))}`);
    expect(mod.RELEASE).toEqual(record);
    expect(Object.isFrozen(mod.RELEASE)).toBe(true);
  });
});

describe("GET /api/version", () => {
  const release = { id: "797991e34665", site: "0.1.0", commit: "e9bcc7bab80f", dirty: false, pushed: true, builtAt: "2026-11-22T17:20:21.289Z", games: { "paper-masks": { version: "0.1.0" } } };
  const meta = { id: "4fd8a8ac-2d6f-4c0e-9c44-1d3b1d6f0b11", tag: "", timestamp: "2026-11-22T17:30:00.000Z" };
  const get = (path, method = "GET") => new Request(`https://party.example${path}`, { method });

  it("answers in Who Am I?'s shape, with the release beside it", () => {
    expect(versionInfo(release, { CF_VERSION_METADATA: meta })).toEqual({
      ok: true,
      name: "n8-party-games",
      version: "0.1.0",
      commit: "e9bcc7bab80f",
      release: "797991e34665",
      dirty: false,
      pushed: true,
      builtAt: release.builtAt,
      games: release.games,
      worker: { id: meta.id, tag: null, timestamp: meta.timestamp },
    });
  });

  it("leaves the Worker version out without the binding", () => {
    expect(versionInfo(release, {}).worker).toBeNull();
    expect(versionInfo(release, { CF_VERSION_METADATA: { id: "not a version" } }).worker).toBeNull();
  });

  it("is never cached, and is JSON", async () => {
    const res = handleVersion(get(VERSION_PATH), release, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect((await res.json()).release).toBe(release.id);
  });

  it("takes only GET and HEAD, and no other path", () => {
    expect(handleVersion(get(VERSION_PATH, "POST"), release, {}).status).toBe(405);
    expect(handleVersion(get(VERSION_PATH, "HEAD"), release, {}).status).toBe(200);
    expect(handleVersion(get(`${VERSION_PATH}/x`), release, {})).toBeNull();
    expect(handleVersion(get("/api/versions"), release, {})).toBeNull();
  });

  it("is what the site's Worker answers, with the record it was built with", async () => {
    const { default: site } = await import("../../worker.js");
    const { RELEASE } = await import("n8-party-games/release");
    const res = await site.fetch(get(VERSION_PATH), {});
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).release).toBe(RELEASE.id);
  });
});

describe("the release line on the pages", () => {
  it("says the version and the build, and marks a build of local changes", () => {
    const release = { id: "797991e34665", site: "0.1.0", dirty: false };
    expect(releaseLine(release)).toBe("Version 0.1.0, build 797991e34665");
    expect(releaseLine({ ...release, dirty: true })).toBe("Version 0.1.0, build 797991e34665 (local changes)");
  });
});
