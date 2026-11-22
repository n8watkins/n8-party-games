// The deploy settings: the production Worker (the top level of wrangler.jsonc) keeps every test
// switch off and the room budget at 10%; the local environment keeps the switches tests rely on;
// and the public folder holds only what a browser loads.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { unstable_readConfig } from "wrangler";
import { afterAll, describe, expect, it } from "vitest";
import { COMPUTED_IMPORTS, OUT as DIST, SERVED, build } from "../../scripts/build-public.mjs";
import { WALL } from "../../lobby/wall.js";
import { BOT_CHECK_MODULE, headersFile, moduleGraph, roomMakingPages } from "../build/public.mjs";

const read = (env) => unstable_readConfig({ config: "wrangler.jsonc", env });

describe("the production configuration", () => {
  const prod = read(undefined);

  it("limits rates, has no simulated latency and keeps the 10% room budget", () => {
    expect(prod.vars.PARTY_RATE_LIMIT).toBe("on");
    expect(prod.vars.PARTY_SIM_LATENCY).toBe("off");
    expect(prod.vars.PARTY_ROOM_BUDGET_SHARE).toBe("0.1");
    expect(prod.vars.PARTY_ROOM_BUDGET_DAY_SHARE).toBeUndefined();
    // The door into the budget's books and a room's inner state is for local tests only.
    expect(prod.vars.PARTY_DEBUG).toBeUndefined();
    // Coin Flip, the placeholder game, hangs only on the local wall.
    expect(prod.vars.PARTY_TEST_GAMES).toBeUndefined();
  });

  it("answers only at its custom domain", () => {
    expect(prod.routes).toEqual([{ pattern: "partygames.n8builds.dev", custom_domain: true }]);
    expect(prod.workers_dev).toBe(false);
    expect(prod.preview_urls).toBe(false);
  });

  it("holds no secret in plain variables", () => {
    expect(Object.keys(prod.vars)).not.toContain("TURNSTILE_SECRET_KEY");
  });

  it("names the bot check's real site key, never one of Cloudflare's test keys, and leaves the local environment without it", () => {
    expect(prod.vars.TURNSTILE_SITE_KEY).toBe("0x4AAAAAAGM24cDseqMFt3A0");
    expect(prod.vars.TURNSTILE_SITE_KEY).not.toMatch(/^[123]x0+A[AB]$/);
    expect(read("local").vars.TURNSTILE_SITE_KEY).toBeUndefined();
  });

  it("keeps logs and serves only the built public folder", () => {
    expect(prod.observability.enabled).toBe(true);
    expect(prod.assets.directory).toBe("./dist/public");
    // --production: a deploy's build refuses a working tree with uncommitted changes (scripts/release.mjs).
    expect(prod.build.command).toBe("node scripts/build-public.mjs --production");
    expect(prod.durable_objects.bindings.map((b) => b.name).sort()).toEqual(["PARTY_BUDGET", "PARTY_LIMITER", "PARTY_LOBBIES", "PARTY_PINS", "PARTY_ROOMS", "PARTY_SCORES"]);
  });

  it("hands the Worker the build's release record and its own version id, in both environments", () => {
    for (const config of [prod, read("local")]) {
      expect(config.alias["n8-party-games/release"]).toBe("./dist/release.js");
      expect(config.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
    }
    // The local build never refuses a dirty tree: only the deploy's does.
    expect(read("local").build.command).not.toContain("--production");
  });
});

describe("the local configuration", () => {
  const local = read("local");

  it("keeps the switches the playtests need, with the same budget", () => {
    expect(local.vars.PARTY_SIM_LATENCY).toBe("on");
    expect(local.vars.PARTY_RATE_LIMIT).toBe("off");
    expect(local.vars.PARTY_TEST_GAMES).toBe("on");
    expect(local.vars.PARTY_ROOM_BUDGET_SHARE).toBe("0.1");
    expect(local.name).toBe("n8-party-games-local");
  });

  it("has no custom domain, so local join links and QR codes keep the local address", () => {
    expect(local.routes ?? []).toEqual([]);
  });
});

describe("the public folder", () => {
  // Built into a folder of the test's own, never dist/public: a local Worker may be serving that
  // one right now (the pre-deploy gate starts its Workers right after these tests), and its
  // folder holds the preview pages that this build, like production's, leaves out.
  const OUT = mkdtempSync(join(tmpdir(), "party-public-"));
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));
  const files = build(OUT);
  /** The site's own computed imports, known to the build (scripts/build-public.mjs). */
  const known = { computedImports: COMPUTED_IMPORTS };

  it("builds into the folder it is given, leaving the served dist/public alone", () => {
    expect(OUT).not.toBe(DIST);
    expect(DIST.endsWith(join("dist", "public"))).toBe(true);
    expect(statSync(join(OUT, "_headers")).isFile()).toBe(true);
    expect(files.length).toBeGreaterThan(10);
  });

  it("holds only files under the allowlist, and no dotfiles, notes or server code", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const { path } of files) {
      expect(SERVED.some((s) => path === s || path.startsWith(s + "/")), path).toBe(true);
      expect(path.split("/").some((p) => p.startsWith(".")), path).toBe(false);
      expect(path).not.toMatch(/\.(md|mjs|py|blend|sh)$/);
    }
  });

  it("leaves out the pages that are not approved yet, which only the local build holds", () => {
    expect(files.some(({ path }) => path.startsWith("preview/"))).toBe(false);
    expect(read(undefined).build.command).not.toContain("--preview");
    expect(read("local").build.command).toContain("--preview");
  });

  it("has every file under the 25 MiB limit", () => {
    for (const { path, bytes } of files) expect(bytes, path).toBeLessThanOrEqual(25 * 1024 * 1024);
  });

  it("sends a CSP that allows each page's inline import map and nothing else inline", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    expect(headers).toMatch(/Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(headers).not.toContain("unsafe-inline");
    expect(headers).not.toContain("unsafe-eval");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    // The party room frames a hosted game's own page: this site may frame itself, and nobody else may.
    expect(headers).toContain("frame-ancestors 'self'");
    expect(headers).toContain("X-Frame-Options: SAMEORIGIN");
    expect(headers).toMatch(/frame-src 'self';/);
    // A site that frames nothing keeps the kit's default: no framing at all.
    expect(headersFile([])).toContain("frame-ancestors 'none'");
    expect(headersFile([])).toContain("X-Frame-Options: DENY");
  });

  it("lets only the Table's pages show pictures from Wikimedia's upload host (Who Am I?), with the same policy otherwise", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    const rules = headers.split(/\n(?=\/)/);
    const csp = (rule) => rule.match(/^ {2}Content-Security-Policy: (.*)$/m)?.[1];
    // Everywhere else: no outside picture host.
    expect(csp(rules[0]).match(/img-src ([^;]*);/)[1]).toBe("'self' data: blob:");
    // The Table (/party/*): the site-wide policy detached and sent again with only img-src widened.
    const table = rules.find((rule) => rule.startsWith("/party/*\n"));
    expect(table).toBeDefined();
    expect(table.split("\n")).toEqual(["/party/*", "  ! Content-Security-Policy", `  Content-Security-Policy: ${csp(table)}`, ...(table.endsWith("\n") ? [""] : [])]);
    expect(csp(table)).toBe(csp(rules[0]).replace("img-src 'self' data: blob:;", "img-src 'self' data: blob: https://upload.wikimedia.org;"));
    // Pictures are only pictures: no script, style, frame or connection may come from there.
    for (const directive of ["default-src", "script-src", "style-src", "connect-src", "frame-src", "font-src"]) {
      expect(csp(table).match(new RegExp(`${directive} ([^;]*)`))?.[1] ?? "").not.toContain("wikimedia");
    }
    expect(rules.filter((rule) => rule.includes("wikimedia"))).toEqual([table]);
    // The kit's default adds none, and only a bare https origin is taken.
    expect(headersFile([])).toContain("img-src 'self' data: blob:;");
    expect(headersFile([])).not.toContain("! Content-Security-Policy");
    expect(() => headersFile([], { images: { "/x/*": ["http://upload.wikimedia.org"] } })).toThrow();
    expect(() => headersFile([], { images: { "/x/*": ["https://a.example; script-src *"] } })).toThrow();
  });

  it("lets only Hot Potato and its hearing test use the microphone, and changes nothing else for them", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    const rules = headers.split(/\n(?=\/)/).filter((rule) => !rule.includes("! Content-Security-Policy"));
    expect(rules).toHaveLength(3);
    expect(rules[0]).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(rules[1]).toBe("/lab/hot-potato/*\n  ! Permissions-Policy\n  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
    expect(rules[2].trimEnd()).toBe("/one-device/hot-potato/*\n  ! Permissions-Policy\n  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
    expect(headersFile([])).not.toContain("microphone=(self)");
  });

  it("lets only the pages that make rooms run the bot check (Turnstile), with the same policy otherwise", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    const rules = headers.split(/\n(?=\/)/);
    const csp = (rule) => rule.match(/^ {2}Content-Security-Policy: (.*)$/m)?.[1];
    const TURNSTILE = "https://challenges.cloudflare.com";
    // Everywhere else (the front page, the Table, Hot Potato...): nothing from Turnstile at all.
    expect(csp(rules[0])).not.toContain(TURNSTILE);
    expect(csp(rules.find((rule) => rule.startsWith("/party/*\n")))).not.toContain(TURNSTILE);
    // The pages that load the kit's bot check: Cork & Bell's own page (the kit's lobby), the party
    // room's way in and the Table's start page. Tin Derby's page makes no rooms, and is not one.
    const pages = roomMakingPages(OUT, known);
    expect(pages).toEqual(["/cork-and-bell/*", "/lobby/*", "/table/*"]);
    const widened = rules.filter((rule) => rule.includes(TURNSTILE));
    expect(widened.map((rule) => rule.split("\n")[0])).toEqual(pages);
    for (const rule of widened) {
      const [path, detach, set, ...rest] = rule.split("\n");
      expect([detach, rest.join("")]).toEqual(["  ! Content-Security-Policy", ""]);
      expect(set, path).toBe(`  Content-Security-Policy: ${csp(rule)}`);
      // Script, frame and the script's calls home, from that one origin; nothing else is widened.
      expect(csp(rule), path).toBe(
        csp(rules[0])
          .replace(/(script-src [^;]*) (https:\/\/static\.cloudflareinsights\.com)/, `$1 ${TURNSTILE} $2`)
          .replace("connect-src 'self' https://cloudflareinsights.com", `connect-src 'self' ${TURNSTILE} https://cloudflareinsights.com`)
          .replace("frame-src 'self';", `frame-src 'self' ${TURNSTILE};`),
      );
    }
    // The kit's default, for a game's own site whose pages all make rooms: every page, one policy.
    expect(headersFile([])).toContain(`script-src 'self' ${TURNSTILE} `);
    expect(headersFile([])).toContain(`frame-src ${TURNSTILE};`);
    expect(headersFile([])).not.toContain("! Content-Security-Policy");
    // A site may list none, and then nothing loads from there anywhere; frames fall back to none.
    expect(headersFile([], { botCheck: [] })).not.toContain(TURNSTILE);
    expect(headersFile([], { botCheck: [] })).toContain("frame-src 'none';");
    // A path in both lists gets both, in one policy.
    const both = headersFile([], { images: { "/x/*": ["https://pics.example"] }, botCheck: ["/x/*"] }).split(/\n(?=\/)/);
    expect(both).toHaveLength(2);
    expect(csp(both[1])).toContain("img-src 'self' data: blob: https://pics.example;");
    expect(csp(both[1])).toContain(`frame-src ${TURNSTILE};`);
    // Only plain site paths, and none that overlap (a page would get two policies).
    expect(() => headersFile([], { botCheck: ["/x/*\n  Content-Security-Policy: *"] })).toThrow();
    expect(() => headersFile([], { botCheck: ["lobby/*"] })).toThrow();
    expect(() => headersFile([], { botCheck: ["/a/*", "/a/b/*"] })).toThrow();
  });

  it("lists every page that makes a room, and no page that makes none", () => {
    // Read independently of the bot check: a page makes a room when something it loads calls a
    // party client's create() (party-client.js only defines it). Each such page must be listed,
    // and each listed folder must hold such a page.
    const htmlPages = files.filter(({ path }) => path.endsWith(".html")).map(({ path }) => join(OUT, path));
    const callsCreate = (file) => !file.endsWith(join("party-kit", "client", "party-client.js")) && !file.includes(`${sep}vendor${sep}`) && /\b\w+\.create\(\s*\{/.test(readFileSync(file, "utf8"));
    const folderOf = (page) => `/${dirname(page).slice(OUT.length + 1).split(sep).join("/")}/*`.replace(/^\/\/\*$/, "/*");
    const listed = roomMakingPages(OUT, known);
    const covered = (folder) => listed.some((path) => folder.startsWith(path.slice(0, -1)));
    const makers = htmlPages.filter((page) => moduleGraph(OUT, page, known).some(callsCreate));
    expect(makers.length).toBeGreaterThan(0);
    for (const page of makers) expect(covered(folderOf(page)), page).toBe(true);
    for (const path of listed) expect(makers.some((page) => folderOf(page).startsWith(path.slice(0, -1))), path).toBe(true);
    // The pages that only join or show a game load no bot check, and are not listed.
    for (const page of ["party/index.html", "tin-derby/page/index.html", "index.html"]) {
      expect(moduleGraph(OUT, join(OUT, page), known).includes(join(OUT, BOT_CHECK_MODULE)), page).toBe(false);
    }
    expect(moduleGraph(OUT, join(OUT, "party/index.html"), known).some((f) => f.endsWith("party-client.js"))).toBe(true);
    // The graph follows site paths, relative paths and an import map, and skips imports named in comments.
    const lobbyGraph = moduleGraph(OUT, join(OUT, "lobby/index.html"), known).map((f) => f.slice(OUT.length + 1));
    expect(lobbyGraph).toEqual(expect.arrayContaining(["lobby/main.js", "lobby/door.js", BOT_CHECK_MODULE]));
  });

  it("reads every page's imports, with only the two known computed ones, and no game view a party loads that way makes rooms", () => {
    expect(COMPUTED_IMPORTS).toEqual(["lobby/main.js", "party/stage.js"]);
    // The build itself ran roomMakingPages with that list (a computed import anywhere else throws).
    const views = [...WALL.boxes, ...WALL.table].map((entry) => entry.view).filter(Boolean);
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      const file = join(OUT, view);
      expect(statSync(file).isFile(), view).toBe(true);
      expect(moduleGraph(OUT, file, known).includes(join(OUT, BOT_CHECK_MODULE)), view).toBe(false);
    }
  });

  it("lets the zone's Cloudflare Web Analytics beacon load and report, and nothing else from outside", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    expect(headers).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(headers).toMatch(/connect-src 'self' https:\/\/cloudflareinsights\.com;/);
  });
});
