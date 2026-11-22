// The release record (scripts/release.mjs): its id follows the built files and nothing else, a
// production build refuses a dirty tree, every hosted game has a version, the build writes the
// same record for the pages and the Worker, and /api/version answers with it, never cached.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { ALLOW_DIRTY, RELEASE_FILE, RELEASE_ID, SEMVER, assertReleasable, gameVersions, releaseId, releaseModule } from "../../scripts/release.mjs";
import { SERVED, build } from "../../scripts/build-public.mjs";
import { GAMES, TURN_GAMES } from "../../games.js";
import { VERSION_PATH, handleVersion, versionInfo } from "../../party-kit/src/worker/version.js";
import { releaseLine } from "../release-line.js";

const ROOT = join(import.meta.dirname, "..", "..");
const files = (map) => Object.keys(map).map((path) => ({ path, bytes: map[path].length }));
const idOf = (map) => releaseId(files(map), (path) => Buffer.from(map[path]));
/** The record a module holds, read back without importing it. */
const recordIn = (text) => JSON.parse(/Object\.freeze\((.*)\);/.exec(text)[1]);

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
});

describe("a production build", () => {
  it("goes ahead from a clean commit", () => {
    expect(() => assertReleasable({ commit: "abc123def456", dirty: false }, {})).not.toThrow();
  });

  it("refuses a working tree with uncommitted changes, and says how a local check gets through", () => {
    expect(() => assertReleasable({ commit: "abc123def456", dirty: true }, {})).toThrow(/uncommitted changes.*RELEASE_ALLOW_DIRTY=1/);
  });

  it("lets a dirty tree through only with RELEASE_ALLOW_DIRTY=1", () => {
    expect(() => assertReleasable({ commit: "abc123def456", dirty: true }, { [ALLOW_DIRTY]: "1" })).not.toThrow();
    expect(() => assertReleasable({ commit: "abc123def456", dirty: true }, { [ALLOW_DIRTY]: "true" })).toThrow();
  });

  it("refuses a build outside git", () => {
    expect(() => assertReleasable({ commit: null, dirty: true }, {})).toThrow(/git repository/);
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
  const git = { commit: "0123456789ab", dirty: false };
  const built = build(OUT, { workerRelease: WORKER, git });
  const text = readFileSync(join(OUT, RELEASE_FILE), "utf8");
  const record = recordIn(text);

  it("is served at /release.js and written the same for the Worker", () => {
    expect(SERVED).toContain(RELEASE_FILE);
    expect(built.map((f) => f.path)).toContain(RELEASE_FILE);
    expect(readFileSync(WORKER, "utf8")).toBe(text);
  });

  it("holds the id of every other built file, the site's version, the commit and the games", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(record.id).toBe(releaseId(built, (path) => readFileSync(join(OUT, path))));
    expect(record).toMatchObject({ site: pkg.version, commit: git.commit, dirty: false });
    expect(new Date(record.builtAt).toISOString()).toBe(record.builtAt);
    expect(record.games).toEqual(gameVersions([...GAMES, ...TURN_GAMES], pkg));
  });

  it("keeps its id when the same code is built again", () => {
    const again = mkdtempSync(join(tmpdir(), "party-release-again-"));
    try {
      build(again, { git: { commit: "ffffffffffff", dirty: true } });
      const second = recordIn(readFileSync(join(again, RELEASE_FILE), "utf8"));
      expect(second.id).toBe(record.id);
      expect(second).toMatchObject({ commit: "ffffffffffff", dirty: true });
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
  const release = { id: "797991e34665", site: "0.1.0", commit: "e9bcc7bab80f", dirty: false, builtAt: "2026-11-22T17:20:21.289Z", games: { "paper-masks": { version: "0.1.0" } } };
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
