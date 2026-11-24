// The deploy settings: the production Worker (the top level of wrangler.jsonc) keeps every test
// switch off and the room budget at 10%; the local environment keeps the switches tests rely on;
// and the public folder holds only what a browser loads.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { unstable_readConfig } from "wrangler";
import { afterAll, describe, expect, it } from "vitest";
import { COMPUTED_IMPORTS, OUT as DIST, SERVED, STABLE, STABLE_MEDIA, build, buildTree } from "../../scripts/build-public.mjs";
import { RELEASE_FILE, recordIn } from "../../scripts/release.mjs";
import { WALL } from "../../lobby/wall.js";
import { IMMUTABLE, MAX_STATIC_REDIRECTS, isMedia } from "../build/folders.mjs";
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
  // The same site as a flat tree (every file at its own site path): what the pages are written
  // against, and what the module graph and the pages that make rooms are read from.
  const TREE = mkdtempSync(join(tmpdir(), "party-tree-"));
  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(TREE, { recursive: true, force: true });
  });
  const files = build(OUT);
  const tree = buildTree(TREE);
  // The record's place in the tree: the build writes it last (scripts/build-public.mjs, build).
  writeFileSync(join(TREE, RELEASE_FILE), "");
  const id = recordIn(readFileSync(join(OUT, RELEASE_FILE), "utf8")).id;
  const folder = `r/${id}/`;
  /** The site's own computed imports, known to the build (scripts/build-public.mjs). */
  const known = { computedImports: COMPUTED_IMPORTS };
  /** The same for the site in its release folder, where those two files are served. */
  const knownFolded = { computedImports: COMPUTED_IMPORTS.map((path) => folder + path) };
  const pages = tree.map((f) => f.path).filter((path) => path.endsWith(".html"));

  it("builds into the folder it is given, leaving the served dist/public alone", () => {
    expect(OUT).not.toBe(DIST);
    expect(DIST.endsWith(join("dist", "public"))).toBe(true);
    expect(statSync(join(OUT, "_headers")).isFile()).toBe(true);
    expect(files.length).toBeGreaterThan(10);
  });

  it("holds only files under the allowlist, and no dotfiles, notes or server code", () => {
    expect(tree.length).toBeGreaterThan(10);
    for (const { path } of tree) {
      expect(SERVED.some((s) => path === s || path.startsWith(s + "/")) || path === "_headers", path).toBe(true);
      expect(path.split("/").some((p) => p.startsWith(".")), path).toBe(false);
      expect(path).not.toMatch(/\.(md|mjs|py|blend|sh)$/);
    }
    // The served site is that tree and nothing more: each file is one of the tree's at its own
    // address or in the release's folder, media under its hash, or what Workers reads.
    const inTree = new Set([...tree.map((f) => f.path), RELEASE_FILE]);
    for (const { path } of files) {
      const where = path.startsWith(folder) ? path.slice(folder.length) : path;
      expect(inTree.has(where) || /^m\/[0-9a-f]{20}\.[a-z0-9]+$/.test(path) || path === "_redirects" || path === "_headers", path).toBe(true);
    }
  });

  it("leaves out the pages that are not approved yet, which only the local build holds", () => {
    expect(files.some(({ path }) => path.includes("preview/"))).toBe(false);
    expect(read(undefined).build.command).not.toContain("--preview");
    expect(read("local").build.command).toContain("--preview");
  });

  it("keeps the pages at their own addresses, and every other file in the release's folder or under its hash", () => {
    const served = files.map((f) => f.path);
    // Outside the folder and the media: the pages, what an installed site reads, and what Workers reads.
    const outside = served.filter((path) => !path.startsWith("r/") && !path.startsWith("m/"));
    const stable = (path) => STABLE.some((entry) => path === entry || path.startsWith(`${entry}/`));
    expect(outside.filter((path) => !pages.includes(path) && !stable(path)).sort()).toEqual(["_headers", "_redirects"]);
    expect(outside.filter((path) => path.endsWith(".html")).sort()).toEqual([...pages].sort());
    // In the folder: every file of the tree that is not media, the pages too.
    for (const { path, bytes } of tree) {
      if (path === "_headers") continue;
      expect(served.includes(folder + path), path).toBe(!isMedia(path, bytes));
    }
    // One release, one folder.
    expect(new Set(served.filter((path) => path.startsWith("r/")).map((path) => path.split("/")[1]))).toEqual(new Set([id]));
  });

  it("sends every media file on from its place in the folder to its hash, for good, within what Workers reads", () => {
    const lines = readFileSync(join(OUT, "_redirects"), "utf8").split("\n").filter((line) => line && !line.startsWith("#"));
    const media = tree.filter((f) => isMedia(f.path, f.bytes));
    expect(media.length).toBeGreaterThan(100);
    const lasting = new Map(lines.filter((line) => line.endsWith(" 301")).map((line) => line.split(" ")));
    expect([...lasting.keys()].sort()).toEqual(media.map((f) => `/${folder}${f.path}`).sort());
    for (const [from, to] of lasting) {
      expect(statSync(join(OUT, to)).isFile(), to).toBe(true);
      expect(readFileSync(join(OUT, to)).equals(readFileSync(join(TREE, from.slice(folder.length + 1)))), from).toBe(true);
    }
    // The passing ones: only the media a game's own page still asks for by its old address.
    const passing = lines.filter((line) => line.endsWith(" 302")).map((line) => line.split(" ")[0]);
    expect(passing.length).toBeGreaterThan(0);
    for (const from of passing) expect(STABLE_MEDIA.some((entry) => from.startsWith(`/${entry}/`)), from).toBe(true);
    // Each deploy holds two more releases' redirects (scripts/carried.mjs): three times these must fit.
    expect(lasting.size * 3 + passing.length).toBeLessThan(MAX_STATIC_REDIRECTS);
  });

  it("makes every page load only from its own release's folder and the media, and every such address is served", () => {
    const redirected = new Set(readFileSync(join(OUT, "_redirects"), "utf8").split("\n").map((line) => line.split(" ")[0]));
    for (const page of pages) {
      const html = readFileSync(join(OUT, page), "utf8");
      // The copy in the folder is the same page.
      expect(readFileSync(join(OUT, folder + page), "utf8"), page).toBe(html);
      const loads = [...html.matchAll(/<(?:script|link|img|source)\b[^>]*?\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => !/^(data:|https:)/.test(ref));
      for (const ref of loads) {
        if (ref === "/manifest.webmanifest") continue;
        expect(ref, `${page} loads ${ref}`).toMatch(new RegExp(`^/(${folder}|m/)`));
        expect(existsSync(join(OUT, ref.split(/[?#]/)[0])), `${page} loads ${ref}`).toBe(true);
      }
      // Its modules, followed all the way: each is in the folder (an import by site path was made relative).
      const graph = moduleGraph(OUT, join(OUT, page), knownFolded).map((f) => f.slice(OUT.length + 1).split(sep).join("/"));
      const flat = moduleGraph(TREE, join(TREE, page), known).map((f) => f.slice(TREE.length + 1).split(sep).join("/"));
      expect(graph.sort(), page).toEqual(flat.map((path) => folder + path).sort());
    }
    // A stylesheet names media straight by its hash, and nothing by a site path that is gone.
    for (const { path } of files.filter((f) => f.path.endsWith(".css"))) {
      for (const [, ref] of readFileSync(join(OUT, path), "utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (ref.startsWith("data:")) continue;
        const at = ref.startsWith("/") ? ref.slice(1) : join(dirname(path), ref).split(sep).join("/");
        expect(existsSync(join(OUT, at)) || redirected.has(`/${at}`), `${path}: url(${ref})`).toBe(true);
      }
    }
  });

  it("keeps the release's folder and the media for a year, and no page, no API and nothing else", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    const cached = headers.split(/\n(?=\/)/).filter((rule) => /Cache-Control/i.test(rule)).map((rule) => rule.trimEnd().split("\n"));
    expect(cached).toEqual([
      ["/r/*", `  Cache-Control: ${IMMUTABLE}`],
      ["/m/*", `  Cache-Control: ${IMMUTABLE}`],
    ]);
    // The API never reaches the static files' headers: the Worker runs first there.
    expect(read(undefined).assets.run_worker_first).toEqual(["/api/*"]);
    // A missing file is answered by the Worker (no fallback page), which never lets it be kept (assetOr404).
    expect(read(undefined).assets.not_found_handling).toBeUndefined();
    expect(readFileSync("worker.js", "utf8")).toMatch(/assetOr404\(env\.ASSETS\.fetch\(request\)\)/);
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
    // Only that rule, and the same again for the page's copy in a release's folder.
    expect(rules.filter((rule) => rule.includes("wikimedia")).map((rule) => rule.trimEnd())).toEqual([table.trimEnd(), `/r/:release${table.trimEnd()}`]);
    // The kit's default adds none, and only a bare https origin is taken.
    expect(headersFile([])).toContain("img-src 'self' data: blob:;");
    expect(headersFile([])).not.toContain("! Content-Security-Policy");
    expect(() => headersFile([], { images: { "/x/*": ["http://upload.wikimedia.org"] } })).toThrow();
    expect(() => headersFile([], { images: { "/x/*": ["https://a.example; script-src *"] } })).toThrow();
  });

  it("lets only Hot Potato and its hearing test use the microphone, and changes nothing else for them", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    const rules = headers.split(/\n(?=\/)/).filter((rule) => /Permissions-Policy/.test(rule));
    const mic = "  ! Permissions-Policy\n  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()";
    expect(rules[0]).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    // The two pages, and each one's copy in a release's folder.
    expect(rules.slice(1).map((rule) => rule.trimEnd())).toEqual([`/lab/hot-potato/*\n${mic}`, `/one-device/hot-potato/*\n${mic}`, `/r/:release/lab/hot-potato/*\n${mic}`, `/r/:release/one-device/hot-potato/*\n${mic}`]);
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
    const pages = roomMakingPages(TREE, known);
    expect(pages).toEqual(["/cork-and-bell/*", "/lobby/*", "/table/*"]);
    const widened = rules.filter((rule) => rule.includes(TURNSTILE));
    // Each such page, and its copy in a release's folder (a game's page shown in the party room's frame).
    expect(widened.map((rule) => rule.split("\n")[0])).toEqual([...pages, ...pages.map((path) => `/r/:release${path}`)]);
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
    const OUT = TREE; // read from the flat tree, where a page's modules are at their site paths
    const htmlPages = tree.filter(({ path }) => path.endsWith(".html")).map(({ path }) => join(OUT, path));
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
      const file = join(TREE, view);
      expect(statSync(file).isFile(), view).toBe(true);
      expect(moduleGraph(TREE, file, known).includes(join(TREE, BOT_CHECK_MODULE)), view).toBe(false);
      // And it is served from the release's folder, where a page looks for it (site/site-path.js).
      expect(statSync(join(OUT, folder, view)).isFile(), view).toBe(true);
    }
  });

  it("lets the zone's Cloudflare Web Analytics beacon load and report, and nothing else from outside", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    expect(headers).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(headers).toMatch(/connect-src 'self' https:\/\/cloudflareinsights\.com;/);
  });
});
