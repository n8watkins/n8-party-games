// The deploy settings: the production Worker (the top level of wrangler.jsonc) keeps every test
// switch off and the room budget at 10%; the local environment keeps the switches tests rely on;
// and the public folder holds only what a browser loads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vitest";
import { OUT, SERVED, build } from "../../scripts/build-public.mjs";

const read = (env) => unstable_readConfig({ config: "wrangler.jsonc", env });

describe("the production configuration", () => {
  const prod = read(undefined);

  it("limits rates, has no simulated latency and keeps the 10% room budget", () => {
    expect(prod.vars.PARTY_RATE_LIMIT).toBe("on");
    expect(prod.vars.PARTY_SIM_LATENCY).toBe("off");
    expect(prod.vars.PARTY_ROOM_BUDGET_SHARE).toBe("0.1");
    expect(prod.vars.PARTY_ROOM_BUDGET_DAY_SHARE).toBeUndefined();
  });

  it("holds no secret in plain variables", () => {
    expect(Object.keys(prod.vars)).not.toContain("TURNSTILE_SECRET_KEY");
  });

  it("keeps logs and serves only the built public folder", () => {
    expect(prod.observability.enabled).toBe(true);
    expect(prod.assets.directory).toBe("./dist/public");
    expect(prod.build.command).toBe("node scripts/build-public.mjs");
    expect(prod.durable_objects.bindings.map((b) => b.name).sort()).toEqual(["PARTY_BUDGET", "PARTY_LIMITER", "PARTY_PINS", "PARTY_ROOMS"]);
  });
});

describe("the local configuration", () => {
  const local = read("local");

  it("keeps the switches the playtests need, with the same budget", () => {
    expect(local.vars.PARTY_SIM_LATENCY).toBe("on");
    expect(local.vars.PARTY_RATE_LIMIT).toBe("off");
    expect(local.vars.PARTY_ROOM_BUDGET_SHARE).toBe("0.1");
    expect(local.name).toBe("n8-party-games-local");
  });
});

describe("the public folder", () => {
  const files = build();

  it("holds only files under the allowlist, and no dotfiles, notes or server code", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const { path } of files) {
      expect(SERVED.some((s) => path === s || path.startsWith(s + "/")), path).toBe(true);
      expect(path.split("/").some((p) => p.startsWith(".")), path).toBe(false);
      expect(path).not.toMatch(/\.(md|mjs|py|blend|sh)$/);
    }
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
    expect(headers).toContain("frame-ancestors 'none'");
  });
});
