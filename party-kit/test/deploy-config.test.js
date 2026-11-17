// The deploy settings: the production Worker (the top level of wrangler.jsonc) keeps every test
// switch off and the room budget at 10%; the local environment keeps the switches tests rely on;
// and the public folder holds only what a browser loads.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_readConfig } from "wrangler";
import { afterAll, describe, expect, it } from "vitest";
import { OUT as DIST, SERVED, build } from "../../scripts/build-public.mjs";
import { headersFile } from "../build/public.mjs";

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

  it("keeps logs and serves only the built public folder", () => {
    expect(prod.observability.enabled).toBe(true);
    expect(prod.assets.directory).toBe("./dist/public");
    expect(prod.build.command).toBe("node scripts/build-public.mjs");
    expect(prod.durable_objects.bindings.map((b) => b.name).sort()).toEqual(["PARTY_BUDGET", "PARTY_LIMITER", "PARTY_LOBBIES", "PARTY_PINS", "PARTY_ROOMS", "PARTY_SCORES"]);
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
    expect(headers).toMatch(/frame-src 'self' https:\/\/challenges\.cloudflare\.com;/);
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
    const rules = headers.split(/\n(?=\/)/).filter((rule) => !rule.startsWith("/party/*\n"));
    expect(rules).toHaveLength(3);
    expect(rules[0]).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(rules[1]).toBe("/lab/hot-potato/*\n  ! Permissions-Policy\n  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
    expect(rules[2].trimEnd()).toBe("/one-device/hot-potato/*\n  ! Permissions-Policy\n  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
    expect(headersFile([])).not.toContain("microphone=(self)");
  });

  it("lets the zone's Cloudflare Web Analytics beacon load and report, and nothing else from outside", () => {
    const headers = readFileSync(join(OUT, "_headers"), "utf8");
    expect(headers).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(headers).toMatch(/connect-src 'self' https:\/\/cloudflareinsights\.com;/);
  });
});
