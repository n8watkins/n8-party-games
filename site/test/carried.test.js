// The releases a deploy carries (scripts/carried.mjs): read from the live site, each built again
// from its commit and checked against the id the live site gave. A deploy that cannot do it fails,
// saying why and the one way round; a local build never asks at all.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CARRIED_RELEASES, LIVE, NO_CARRY, builtIn, carriedFromLive, carryChain, carryCheck, carryWanted, liveVersion, rebuildRelease, toCarry } from "../../scripts/carried.mjs";
import { releaseModule } from "../../scripts/release.mjs";

const A = { id: "aaaaaaaaaaaa", commit: "111111111111" };
const B = { id: "bbbbbbbbbbbb", commit: "222222222222" };
const C = { id: "cccccccccccc", commit: "333333333333" };
const live = (release, carries) => ({ ok: true, name: "n8-party-games", release: release.id, commit: release.commit, ...(carries && { carries }) });
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const temp = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `party-${name}-`));
  made.push(dir);
  return dir;
};

describe("what a build carries (carryWanted)", () => {
  it("is nothing for a local build, a dev server and a build by hand: they never ask the live site", () => {
    expect(carryWanted({ carry: null, upload: false, env: {} })).toBeNull();
  });

  it("is what the live site names for a deploy, and for a build that asks for it", () => {
    expect(carryWanted({ carry: null, upload: true, env: {} })).toBe("live");
    expect(carryWanted({ carry: "live", upload: false, env: {} })).toBe("live");
  });

  it("is the builds a test names", () => {
    expect(carryWanted({ carry: "/tmp/a,/tmp/b", upload: false, env: {} })).toEqual({ dirs: ["/tmp/a", "/tmp/b"] });
  });

  it("is nothing for a deploy only when RELEASE_CARRY=none says so, and any other value is refused", () => {
    expect(NO_CARRY).toBe("RELEASE_CARRY");
    expect(carryWanted({ carry: null, upload: true, env: { RELEASE_CARRY: "none" } })).toBe("none");
    for (const value of ["", "0", "no", "None", "off"]) expect(() => carryWanted({ carry: null, upload: true, env: { RELEASE_CARRY: value } }), value).toThrow(/takes only "none"/);
    // It changes nothing for a local build, which carries nothing anyway.
    expect(carryWanted({ carry: null, upload: false, env: { RELEASE_CARRY: "none" } })).toBeNull();
  });
});

describe("the releases to carry, from what the live site says (carryChain, toCarry)", () => {
  it("is the live release alone when the live site is from before the record listed what it carries", () => {
    expect(carryChain(live(A))).toEqual([A]);
  });

  it("is the live release, then what it carries, newest first", () => {
    expect(carryChain(live(A, [B, C]))).toEqual([A, B, C]);
    expect(toCarry(carryChain(live(A, [B, C])), "dddddddddddd")).toEqual([A, B]);
    expect(CARRIED_RELEASES).toBe(2);
  });

  it("goes on by itself: what one deploy carried, the next finds in the live record", () => {
    // Deploy 1 replaces A (from before the folders): carries A.
    const one = { id: "111111111111", commit: "aaaaaaaaaaa1" };
    const first = toCarry(carryChain(live(A)), one.id);
    expect(first).toEqual([A]);
    // Deploy 2 replaces 1, whose record says it carries A: carries 1 and A.
    const two = { id: "222222222222", commit: "aaaaaaaaaaa2" };
    const second = toCarry(carryChain(live(one, first)), two.id);
    expect(second).toEqual([one, A]);
    // Deploy 3 replaces 2: carries 2 and 1, and lets A go.
    const third = toCarry(carryChain(live(two, second)), "333333333333");
    expect(third).toEqual([two, one]);
    // A rollback to 1 puts 1's record back: the next deploy carries 1 and what 1 carried.
    expect(toCarry(carryChain(live(one, first)), "444444444444")).toEqual([one, A]);
  });

  it("carries what the live release carries when the same release is deployed again (a server-only change)", () => {
    expect(toCarry(carryChain(live(A, [B, C])), A.id)).toEqual([B, C]);
  });

  it("lists a release once", () => {
    expect(carryChain(live(A, [A, B, B]))).toEqual([A, B]);
  });

  it("refuses an answer that is no release record, and a release that is not an id and a commit: it would be built and served", () => {
    expect(() => carryChain(null)).toThrow(/did not answer with a release record/);
    expect(() => carryChain({ ok: false })).toThrow(/did not answer with a release record/);
    expect(() => carryChain(live({ id: "../../etc", commit: A.commit }))).toThrow(/not an id and a commit/);
    expect(() => carryChain(live(A, [{ id: B.id, commit: "main; rm -rf /" }]))).toThrow(/not an id and a commit/);
    expect(() => carryChain(live(A, [{ id: B.id }]))).toThrow(/not an id and a commit/);
    expect(() => carryChain(live({ id: A.id, commit: "unknown" }))).toThrow(/not an id and a commit/);
  });

  it("says the one way round with every refusal, and whose word it takes", () => {
    try {
      carryChain(null);
      expect.unreachable();
    } catch (err) {
      expect(err.refusal).toBe(true);
      expect(err.message).toMatch(/RELEASE_CARRY=none npm run deploy/);
      expect(err.message).toMatch(/owner's word/);
    }
  });
});

describe("asking the live site (liveVersion)", () => {
  const answer = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

  it("asks the live site's /api/version, never a cached copy", async () => {
    const asked = [];
    const got = await liveVersion({
      fetchImpl: async (url, init) => {
        asked.push([url, init.cache]);
        return answer(live(A));
      },
    });
    expect(got).toEqual(live(A));
    expect(LIVE).toBe("https://partygames.n8builds.dev");
    expect(asked).toEqual([[`${LIVE}/api/version`, "no-store"]]);
  });

  it("tries again after a failure, then gives the answer", async () => {
    let n = 0;
    const got = await liveVersion({ waitMs: 1, fetchImpl: async () => (++n < 3 ? Promise.reject(new Error("offline")) : answer(live(A))) });
    expect(n).toBe(3);
    expect(got.release).toBe(A.id);
  });

  it("fails loudly when it cannot be reached or answers an error, with the way round", async () => {
    await expect(liveVersion({ waitMs: 1, fetchImpl: async () => Promise.reject(new Error("getaddrinfo ENOTFOUND")) })).rejects.toThrow(/Could not ask the live site.*ENOTFOUND[\s\S]*RELEASE_CARRY=none/);
    await expect(liveVersion({ waitMs: 1, fetchImpl: async () => answer(null, false, 503) })).rejects.toThrow(/it answered 503/);
  });
});

describe("a release built again from its commit (rebuildRelease)", () => {
  // A small repository with a build of its own, as this one has: `node scripts/build-public.mjs
  // --out=DIR` writes DIR/public and DIR/release.js. Its release id is its page's text length, so
  // each commit below is another release; it also writes down what it was run with.
  const repo = temp("carried-repo");
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe", encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  mkdirSync(join(repo, "scripts"));
  mkdirSync(join(repo, "site"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "carried-fixture", version: "1.0.0", private: true }));
  writeFileSync(join(repo, "package-lock.json"), JSON.stringify({ name: "carried-fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "carried-fixture", version: "1.0.0" } } }));
  writeFileSync(
    join(repo, "scripts", "build-public.mjs"),
    [
      `import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `const out = process.argv.find((a) => a.startsWith("--out=")).slice(6);`,
      `const page = readFileSync("site/index.html", "utf8");`,
      `if (page.includes("BROKEN")) { console.error("the build broke: no such thing"); process.exit(1); }`,
      `const id = String(page.length).padStart(12, "0");`,
      `mkdirSync(join(out, "public", "r", id), { recursive: true });`,
      `writeFileSync(join(out, "public", "index.html"), page);`,
      `writeFileSync(join(out, "public", "r", id, "main.js"), "// " + page);`,
      `writeFileSync(join(out, "public", "ran.json"), JSON.stringify({ args: process.argv.slice(2), wrangler: process.env.WRANGLER_COMMAND ?? null, dirty: process.env.RELEASE_ALLOW_DIRTY ?? null, carry: process.env.RELEASE_CARRY ?? null, packages: existsSync("node_modules") || existsSync("package-lock.json") }));`,
      `writeFileSync(join(out, "release.js"), "export const RELEASE = Object.freeze(" + JSON.stringify({ id, commit: "fixture" }) + ");\\n");`,
    ].join("\n"),
  );
  const commit = (page) => {
    writeFileSync(join(repo, "site", "index.html"), page);
    git("add", "-A");
    git("commit", "-q", "-m", "page");
    return git("rev-parse", "--short=12", "HEAD");
  };
  const first = { commit: commit("<p>one</p>"), id: "000000000010" };
  const second = { commit: commit("<p>second</p>"), id: "000000000013" };
  const broken = { commit: commit("<p>BROKEN</p>"), id: "000000000013" };
  // The working tree moves on, and is dirty: neither changes what a commit builds.
  writeFileSync(join(repo, "site", "index.html"), "<p>not committed</p>");
  const quiet = () => {};

  it("builds the commit's own files with the commit's own build, and gives back its public folder", () => {
    const work = temp("carried-work");
    const got = rebuildRelease({ root: repo, work, ...first, log: quiet });
    expect(got).toEqual({ ...first, dir: join(work, first.id, "build", "public") });
    expect(readFileSync(join(got.dir, "index.html"), "utf8")).toBe("<p>one</p>");
    expect(readFileSync(join(got.dir, "r", first.id, "main.js"), "utf8")).toBe("// <p>one</p>");
    // Another commit beside it, in the same work folder.
    const other = rebuildRelease({ root: repo, work, ...second, log: quiet });
    expect(readFileSync(join(other.dir, "index.html"), "utf8")).toBe("<p>second</p>");
    // The repository itself is left as it was: no checkout, no worktree, its uncommitted change still there.
    expect(readFileSync(join(repo, "site", "index.html"), "utf8")).toBe("<p>not committed</p>");
    expect(git("worktree", "list").split("\n")).toHaveLength(1);
  });

  it("runs that build as a plain build by hand, whatever started this one: never as a deploy, never told to skip", () => {
    const work = temp("carried-work");
    const before = { ...process.env };
    process.env.WRANGLER_COMMAND = "deploy";
    process.env.RELEASE_ALLOW_DIRTY = "1";
    process.env.RELEASE_CARRY = "none";
    try {
      const got = rebuildRelease({ root: repo, work, ...first, log: quiet });
      const ran = JSON.parse(readFileSync(join(got.dir, "ran.json"), "utf8"));
      expect(ran).toEqual({ args: [`--out=${join(work, first.id, "build")}`], wrangler: null, dirty: null, carry: null, packages: true });
    } finally {
      for (const key of ["WRANGLER_COMMAND", "RELEASE_ALLOW_DIRTY", "RELEASE_CARRY"]) {
        if (key in before) process.env[key] = before[key];
        else delete process.env[key];
      }
    }
  });

  it("refuses a build whose id is not the one the live site gave: the files would not be the ones that were served", () => {
    const work = temp("carried-work");
    expect(() => rebuildRelease({ root: repo, work, commit: first.commit, id: "999999999999", log: quiet })).toThrow(new RegExp(`Commit ${first.commit} built again is release ${first.id}, not 999999999999[\\s\\S]*RELEASE_CARRY=none`));
  });

  it("says so when the commit is not in this clone, and to fetch", () => {
    const work = temp("carried-work");
    expect(() => rebuildRelease({ root: repo, work, commit: "0123456789ab", id: first.id, log: quiet })).toThrow(/commit 0123456789ab of release 000000000010 is not in this clone.*git fetch origin[\s\S]*RELEASE_CARRY=none/);
    expect(readdirSync(work)).toEqual([]);
  });

  it("says which step failed and what it said, when the commit's own build fails", () => {
    const work = temp("carried-work");
    expect(() => rebuildRelease({ root: repo, work, ...broken, log: quiet })).toThrow(/its own build failed\.\n[\s\S]*the build broke: no such thing[\s\S]*RELEASE_CARRY=none/);
  });

  it("is what a deploy does for each release the live site names, but its own, in a folder it removes after", async () => {
    const got = await carriedFromLive({ root: repo, version: async () => live(second, [first, { id: "eeeeeeeeeeee", commit: first.commit }]), log: quiet });
    expect(got.chain.map((c) => c.id)).toEqual([second.id, first.id, "eeeeeeeeeeee"]);
    const carried = got.carry("ffffffffffff");
    expect(carried.map((c) => c.id)).toEqual([second.id, first.id]);
    for (const c of carried) expect(existsSync(join(c.dir, "index.html"))).toBe(true);
    const work = join(carried[0].dir, "..", "..", "..");
    got.cleanup();
    expect(existsSync(work)).toBe(false);
    // Deployed again as the same release: it builds only what the live one carries.
    const again = await carriedFromLive({ root: repo, version: async () => live(second, [first]), log: quiet });
    expect(again.carry(second.id).map((c) => c.id)).toEqual([first.id]);
    again.cleanup();
  });

  it("builds nothing, and makes no folder, when there is nothing to carry", async () => {
    const built = [];
    const got = await carriedFromLive({ root: repo, version: async () => live(first), rebuild: (entry) => built.push(entry) });
    expect(got.carry(first.id)).toEqual([]);
    expect(built).toEqual([]);
    got.cleanup();
  });

  it("fails before any build when the live site cannot be asked", async () => {
    await expect(carriedFromLive({ root: repo, version: async () => Promise.reject(new Error("Could not ask the live site")) })).rejects.toThrow(/Could not ask the live site/);
  });

  describe("asked before the gate (carryCheck)", () => {
    it("says what the deploy will carry when the live site answers and this clone has the commits", async () => {
      const line = await carryCheck({ root: repo, env: {}, version: async () => live(second, [first, { id: "eeeeeeeeeeee", commit: first.commit }]) });
      expect(line).toBe(`This deploy will carry the releases before it: ${second.id} (commit ${second.commit}), ${first.id} (commit ${first.commit}).`);
    });

    it("refuses at once when a commit it must carry is not in this clone, or the live site cannot be asked", async () => {
      await expect(carryCheck({ root: repo, env: {}, version: async () => live(second, [{ id: first.id, commit: "0123456789ab" }]) })).rejects.toThrow(/commit 0123456789ab of release 000000000010.*not in this clone[\s\S]*RELEASE_CARRY=none/);
      await expect(carryCheck({ root: repo, env: {}, version: async () => Promise.reject(new Error("offline")) })).rejects.toThrow(/offline/);
    });

    it("asks nothing when the owner said to deploy without them, and says so", async () => {
      const line = await carryCheck({ root: repo, env: { RELEASE_CARRY: "none" }, version: async () => expect.unreachable() });
      expect(line).toMatch(/RELEASE_CARRY=none: this deploy will hold no release before its own/);
    });
  });
});

describe("a build to carry, named by its folder (builtIn)", () => {
  it("reads the release and the commit from the build's own record, and names its public folder", () => {
    const dir = temp("carried-built");
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "release.js"), releaseModule({ id: A.id, commit: A.commit, site: "0.1.0" }));
    expect(builtIn(dir)).toEqual({ ...A, dir: join(dir, "public") });
  });

  it("refuses a folder that holds no build", () => {
    const dir = temp("carried-built");
    writeFileSync(join(dir, "release.js"), "export const RELEASE = null;");
    expect(() => builtIn(dir)).toThrow(/holds no build to carry/);
  });
});
