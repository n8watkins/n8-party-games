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
import { ALLOW_DIRTY, ID_PLACEHOLDER, PREVIEW_DIR, RELEASE_FILE, RELEASE_ID, SEMVER, buildKind, flatReleaseId, gameVersions, gitState, pageRecord, releaseId, releaseModule, releaseProblem, testBuildProblem } from "../../scripts/release.mjs";
import { BUILD_FLAGS, SERVED, build, planId, readArgs } from "../../scripts/build-public.mjs";
import { CARRIED_RELEASES } from "../../scripts/carried.mjs";
import { GAMES, TURN_GAMES } from "../../games.js";
import { VERSION_PATH, handleVersion, versionInfo } from "../../party-kit/src/worker/version.js";
import { unstable_readConfig } from "wrangler";
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
    // The site as before release folders, and builds to carry named by hand: a test's too.
    expect(testBuildProblem({ flat: true }, { upload: true, production: false })).toMatch(/local test build only/);
    expect(testBuildProblem({ carry: "/tmp/a,/tmp/b" }, { upload: false, production: true })).toMatch(/local test build only/);
    expect(testBuildProblem({ out: "/tmp/x", salt: "a1", carry: "/tmp/a" }, { upload: false, production: false })).toBeNull();
    expect(testBuildProblem({ out: "/tmp/x", flat: true }, { upload: false, production: false })).toBeNull();
  });

  it("let a build carry what the live site names, which is what a deploy does anyway", () => {
    expect(testBuildProblem({ carry: "live" }, { upload: true, production: true })).toBeNull();
    expect(testBuildProblem({ carry: "live" }, { upload: false, production: false })).toBeNull();
  });

  it("refuse a flat build that carries: the site from before the folders held nothing but itself", () => {
    expect(testBuildProblem({ flat: true, carry: "/tmp/a" }, { upload: false, production: false })).toMatch(/carries nothing/);
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

  it("is at /release.js and written the same for the Worker; the pages' own, in the release's folder, holds its id and the site's version", () => {
    expect(SERVED).toContain(RELEASE_FILE);
    expect(built.map((f) => f.path)).toEqual(expect.arrayContaining([RELEASE_FILE, `r/${record.id}/${RELEASE_FILE}`]));
    expect(readFileSync(WORKER, "utf8")).toBe(text);
    const own = readFileSync(join(OUT, "r", record.id, RELEASE_FILE), "utf8");
    expect(recordIn(own)).toEqual({ id: record.id, site: pkg.version });
    expect(own).toBe(releaseModule(pageRecord(record)));
    // The list of what was built gives each copy its real size.
    expect(built.find((f) => f.path === RELEASE_FILE).bytes).toBe(Buffer.byteLength(text));
    expect(built.find((f) => f.path === `r/${record.id}/${RELEASE_FILE}`).bytes).toBe(Buffer.byteLength(own));
  });

  it("gives the pages only what the id decides, so their copy is the same bytes whenever and from whatever commit it is built", () => {
    expect(pageRecord({ ...record, commit: "ffffffffffff", pushed: false, builtAt: "2030-01-01T00:00:00.000Z", carries: [{ id: "aaaaaaaaaaaa", commit: "111111111111" }], games: {} })).toEqual(pageRecord(record));
    expect(Object.keys(pageRecord(record))).toEqual(["id", "site"]);
    // A local build of a tree with changes says so on the page; a deploy never is one, and a
    // commit built again outside git (to be carried) has nothing to be dirty against.
    expect(pageRecord({ ...record, dirty: true })).toEqual({ id: record.id, site: pkg.version, dirty: true });
    expect(pageRecord({ ...record, dirty: true, commit: "unknown" })).toEqual({ id: record.id, site: pkg.version });
    expect(releaseLine(pageRecord(record))).toBe(`Version ${pkg.version}, build ${record.id}`);
    expect(releaseLine(pageRecord({ ...record, dirty: true }))).toBe(`Version ${pkg.version}, build ${record.id} (local changes)`);
  });

  it("holds an id, the site's version, the commit and the games, and carries nothing by itself", () => {
    expect(record.id).toMatch(RELEASE_ID);
    expect(record.id).not.toBe(ID_PLACEHOLDER);
    expect(record).toMatchObject({ site: pkg.version, commit: CLEAN.commit, dirty: false, pushed: true, carries: [] });
    expect(new Date(record.builtAt).toISOString()).toBe(record.builtAt);
    expect(record.games).toEqual(gameVersions([...GAMES, ...TURN_GAMES], pkg));
  });

  it("names its folder by its id, and the pages name that folder: the Worker and the pages agree by construction", () => {
    expect(built.filter((f) => f.path.startsWith("r/")).every((f) => f.path.startsWith(`r/${record.id}/`))).toBe(true);
    expect(readFileSync(join(OUT, "lobby", "index.html"), "utf8")).toContain(`src="/r/${record.id}/lobby/main.js"`);
    // The placeholder the id was worked out with is nowhere in what is served.
    for (const page of ["index.html", "lobby/index.html", "cork-and-bell/index.html", "_headers", "_redirects"]) expect(readFileSync(join(OUT, page), "utf8"), page).not.toContain(ID_PLACEHOLDER);
  });

  describe("its id (planId), from the site as built with the placeholder", () => {
    const at = `r/${ID_PLACEHOLDER}`;
    const plan = {
      id: ID_PLACEHOLDER,
      files: [
        { path: "index.html", data: Buffer.from(`<script src="/${at}/main.js"></script>`) },
        { path: `${at}/main.js`, data: Buffer.from("export {}") },
        { path: "m/aaaa.webp", data: Buffer.from("pic") },
        { path: "_headers", data: Buffer.from("/*\n  X-Frame-Options: SAMEORIGIN\n") },
      ],
      redirects: [{ from: `/${at}/art/a.webp`, to: "/m/aaaa.webp", status: 301 }],
    };
    const withFile = (path, text) => ({ ...plan, files: plan.files.map((f) => (f.path === path ? { path, data: Buffer.from(text) } : f)) });
    const id = planId(plan);

    it("is 12 hex digits, the same for the same site", () => {
      expect(id).toMatch(RELEASE_ID);
      expect(planId({ ...plan, files: [...plan.files].reverse() })).toBe(id);
    });

    it("changes with any file a browser could be sent: a page, a module, a media file", () => {
      expect(planId(withFile("index.html", "<p>other</p>"))).not.toBe(id);
      expect(planId(withFile(`${at}/main.js`, "export {};"))).not.toBe(id);
      expect(planId(withFile("m/aaaa.webp", "pic2"))).not.toBe(id);
    });

    it("changes when a header rule changes (a CSP or cache rule is part of a release), and when a redirect does", () => {
      expect(planId(withFile("_headers", "/*\n  X-Frame-Options: DENY\n"))).not.toBe(id);
      expect(planId({ ...plan, redirects: [{ ...plan.redirects[0], to: "/m/bbbb.webp" }] })).not.toBe(id);
      expect(planId({ ...plan, redirects: [{ ...plan.redirects[0], status: 302 }] })).not.toBe(id);
      expect(planId({ ...plan, redirects: [] })).not.toBe(id);
    });

    it("does not hash the record itself, at its own address or in the folder", () => {
      const record = [{ path: RELEASE_FILE, data: Buffer.from("anything") }, { path: `${at}/${RELEASE_FILE}`, data: Buffer.from("anything else") }];
      expect(planId({ ...plan, files: [...plan.files, ...record] })).toBe(id);
      // Only those two: a file of that name elsewhere is a file like any other.
      expect(planId({ ...plan, files: [...plan.files, { path: `${at}/lobby/${RELEASE_FILE}`, data: Buffer.from("x") }] })).not.toBe(id);
    });

    it("is another release under a test build's salt", () => {
      expect(planId(plan, { salt: "one" })).not.toBe(id);
      expect(planId(plan, { salt: "one" })).toBe(planId(plan, { salt: "one" }));
    });

    it("changes with the site's version, which the pages show: a version bump alone is another release", () => {
      const at010 = planId(plan, { site: "0.1.0" });
      expect(at010).not.toBe(id);
      expect(planId(plan, { site: "0.1.1" })).not.toBe(at010);
      expect(planId(plan, { site: "0.1.0" })).toBe(at010);
      // The version is not a file: no file of that name could stand in for it.
      expect(planId({ ...plan, files: [...plan.files, { path: "site", data: Buffer.from("0.1.0") }] })).not.toBe(at010);
    });
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
      carries: [],
      worker: { id: meta.id, tag: null, timestamp: meta.timestamp },
    });
  });

  it("says which releases it carries, for the next deploy to carry in its turn", () => {
    const carries = [{ id: "aaaaaaaaaaaa", commit: "111111111111" }, { id: "bbbbbbbbbbbb", commit: "222222222222" }];
    expect(versionInfo({ ...release, carries }, {}).carries).toEqual(carries);
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

describe("two builds of one tree", () => {
  const site = { "index.html": "<p>hi</p>", "main.js": "export {}" };
  /** Builds the tree for real into a folder of its own, as the command line `flags` would, and gives its release id. */
  const built = [];
  afterAll(() => {
    for (const dir of built) rmSync(dir, { recursive: true, force: true });
  });
  const idBuiltWith = (flags) => {
    const args = readArgs(["node", "build-public.mjs", ...flags]);
    expect(args.problem, flags.join(" ")).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "party-release-flags-"));
    built.push(dir);
    // --production only refuses a tree a deploy may not ship (a test's tree may be dirty): what it
    // builds is the same code, called here directly, with what the flags ask of it.
    build(dir, { git: CLEAN, preview: args.preview });
    return recordIn(readFileSync(join(dir, RELEASE_FILE), "utf8")).id;
  };
  /** The build command's flags of a wrangler environment ("" is production's settings). */
  const flagsOf = (env) => unstable_readConfig({ config: join(ROOT, "wrangler.jsonc"), env: env || undefined }).build.command.split(/\s+/).slice(2);

  it("are one release whether or not the local preview pages were built with them", () => {
    expect(idOf({ ...site, [`${PREVIEW_DIR}/landing/index.html`]: "<p>preview</p>" })).toBe(idOf(site));
    // Anything else added is another release.
    expect(idOf({ ...site, "previewer/index.html": "x" })).not.toBe(idOf(site));
  });

  it("are one release with the exact flags the gate's Workers build with: the local ones and the production settings", () => {
    const local = flagsOf("local");
    const production = flagsOf("");
    expect(local).toContain("--preview");
    expect(production).toContain("--production");
    const ids = [idBuiltWith(local), idBuiltWith(production), idBuiltWith([])];
    expect(new Set(ids).size, ids.join(" ")).toBe(1);
  }, 120_000);

  it("are one release with every flag the build takes: none of them changes a file a deploy ships", () => {
    const plain = idBuiltWith([]);
    for (const flag of Object.keys(BUILD_FLAGS)) expect(idBuiltWith([flag]), flag).toBe(plain);
  }, 120_000);

  it("refuses a flag it does not know, so a new one is in BUILD_FLAGS and in the test above", () => {
    expect(readArgs(["node", "x", "--prevew"]).problem).toMatch(/--prevew is not a flag/);
    expect(readArgs(["node", "x", "--out", "/tmp/x"]).problem).toMatch(/--out=VALUE/);
    expect(readArgs(["node", "x", "--preview", "--production", "--list", "--out=/tmp/x", "--salt=a1"]).problem).toBeNull();
    expect(readArgs(["node", "x", "--carry", "live"]).problem).toMatch(/--carry=VALUE/);
    expect(readArgs(["node", "x", "--carry=live"])).toMatchObject({ carry: "live", flat: false, problem: null });
    expect(readArgs(["node", "x", "--flat", "--out=/tmp/x", "--carry=/tmp/a,/tmp/b"])).toMatchObject({ carry: "/tmp/a,/tmp/b", flat: true, out: "/tmp/x", problem: null });
  });
});

describe("a build that carries the releases before it", () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  /** A build of this tree under `salt` (another release each), as `{id, commit, dir, record}`. */
  const made = (salt, options = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "party-carry-"));
    dirs.push(dir);
    build(dir, { git: { ...CLEAN, commit: `${salt}`.padEnd(12, "0").slice(0, 12) }, preview: false, salt, ...options });
    const record = recordIn(readFileSync(join(dir, RELEASE_FILE), "utf8"));
    return { id: record.id, commit: record.commit, dir, record };
  };
  const exists = (dir, path) => {
    try {
      readFileSync(join(dir, path));
      return true;
    } catch {
      return false;
    }
  };
  const one = made("a1");
  const two = made("a2");
  const three = made("a3");
  // The release from before there were folders: every file at its own address.
  const old = made("a0", { flat: true });
  const alone = made("a4");

  it("builds the site as it was before release folders when asked to (a test build), with that build's own id", () => {
    expect(old.record.id).toBe(flatReleaseId(old.dir, "a0"));
    expect(exists(old.dir, "lobby/main.js")).toBe(true);
    expect(exists(old.dir, "r")).toBe(false);
    expect(readFileSync(join(old.dir, "lobby", "index.html"), "utf8")).toContain(`src="main.js"`);
    expect(old.record.carries).toEqual([]);
  });

  it("holds each one's folder beside its own, lists them newest first, and keeps its own id", () => {
    const next = made("a4", { carry: [two, one] });
    expect(next.id).toBe(alone.id);
    expect(next.record.carries).toEqual([{ id: two.id, commit: two.commit }, { id: one.id, commit: one.commit }]);
    for (const id of [next.id, two.id, one.id]) expect(exists(next.dir, `r/${id}/lobby/main.js`), id).toBe(true);
    // Each carried folder is the very one that release served.
    expect(readFileSync(join(next.dir, "r", two.id, "lobby", "index.html"), "utf8")).toBe(readFileSync(join(two.dir, "r", two.id, "lobby", "index.html"), "utf8"));
    // The pages are its own, and name only its own folder.
    const page = readFileSync(join(next.dir, "lobby", "index.html"), "utf8");
    expect(page).toContain(`/r/${next.id}/lobby/main.js`);
    expect(page).not.toContain(two.id);
    // Its record in its folder, theirs in theirs, each the very bytes that release served.
    expect(recordIn(readFileSync(join(next.dir, "r", two.id, RELEASE_FILE), "utf8")).id).toBe(two.id);
    expect(readFileSync(join(next.dir, "r", two.id, RELEASE_FILE), "utf8")).toBe(readFileSync(join(two.dir, "r", two.id, RELEASE_FILE), "utf8"));
    expect(recordIn(readFileSync(join(next.dir, "r", next.id, RELEASE_FILE), "utf8"))).toEqual({ id: next.id, site: next.record.site });
    expect(recordIn(readFileSync(join(next.dir, RELEASE_FILE), "utf8"))).toEqual(next.record);
    // What it carries is not part of what its own folder holds: the same release, built alone, has the same folder.
    expect(readFileSync(join(next.dir, "r", next.id, RELEASE_FILE), "utf8")).toBe(readFileSync(join(alone.dir, "r", alone.id, RELEASE_FILE), "utf8"));
  });

  it(`carries ${CARRIED_RELEASES} at most, never itself, and none twice`, () => {
    expect(CARRIED_RELEASES).toBe(2);
    const next = made("a4", { carry: [alone, three, three, two, one] });
    expect(next.record.carries.map((c) => c.id)).toEqual([three.id, two.id]);
    expect(exists(next.dir, `r/${one.id}/lobby/main.js`)).toBe(false);
  });

  it("asks what to carry once it knows its own id, when given a function", () => {
    const asked = [];
    const next = made("a4", {
      carry: (id) => {
        asked.push(id);
        return [one];
      },
    });
    expect(asked).toEqual([alone.id]);
    expect(next.record.carries.map((c) => c.id)).toEqual([one.id]);
  });

  it("carries the release from before the folders at its old addresses, under this release's own pages", () => {
    const first = made("a4", { carry: [old] });
    expect(first.id).toBe(alone.id);
    expect(first.record.carries).toEqual([{ id: old.id, commit: old.commit }]);
    // What a page still open on the old release loads later: a module by its old address, with what it imports, and its media.
    for (const path of ["lobby/main.js", "lobby/look3d/room3d.js", "party-kit/client/sounds.js", "cork-and-bell/game/party-view.js", "cork-and-bell/game/vendor/three.module.js", "lobby/sounds/CREDITS.txt"]) {
      expect(readFileSync(join(first.dir, path)).equals(readFileSync(join(old.dir, path))), path).toBe(true);
    }
    // The pages are this release's: a reload of the old page loads the new one.
    expect(readFileSync(join(first.dir, "lobby", "index.html"), "utf8")).toContain(`/r/${first.id}/lobby/main.js`);
    expect(readFileSync(join(first.dir, "index.html"), "utf8")).toBe(readFileSync(join(alone.dir, "index.html"), "utf8"));
    // So are the record at /release.js, the headers and the redirects.
    expect(recordIn(readFileSync(join(first.dir, RELEASE_FILE), "utf8")).id).toBe(first.id);
    for (const path of ["_headers", "_redirects"]) expect(readFileSync(join(first.dir, path), "utf8")).toBe(readFileSync(join(alone.dir, path), "utf8"));
  });

  it("goes on carrying it one release later, beside the first release with folders", () => {
    const first = made("a5", { carry: [old] });
    const second = made("a6", { carry: [first, old] });
    expect(second.record.carries.map((c) => c.id)).toEqual([first.id, old.id]);
    expect(exists(second.dir, `r/${first.id}/lobby/main.js`)).toBe(true);
    expect(readFileSync(join(second.dir, "lobby", "main.js")).equals(readFileSync(join(old.dir, "lobby", "main.js")))).toBe(true);
    // And lets it go after that: the third release with folders has only folders.
    const third = made("a7", { carry: [second, first, old] });
    expect(third.record.carries.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(exists(third.dir, "lobby/main.js")).toBe(false);
  }, 60_000);
});

describe("the release line on the pages", () => {
  it("says the version and the build, and marks a build of local changes", () => {
    const release = { id: "797991e34665", site: "0.1.0", dirty: false };
    expect(releaseLine(release)).toBe("Version 0.1.0, build 797991e34665");
    expect(releaseLine({ ...release, dirty: true })).toBe("Version 0.1.0, build 797991e34665 (local changes)");
  });
});
