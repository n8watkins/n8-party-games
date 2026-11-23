// The browser tests' shorter away clock (PARTY_TEST_AWAY_GRACE_MS): read only on a test server
// (PARTY_DEBUG on, the local environment in wrangler.jsonc), never in production, and said in the
// config so a test knows what to wait for and the production-settings step can check it is off.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handlePartyApi } from "../../party-kit/src/worker/index.js";
import { PROTOCOL, PROTOCOL_HEADER } from "../../party-kit/src/worker/http.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { testAwayGrace } = await import("../server/lobby-room.js");

const config = async (env) => {
  const res = await handlePartyApi(new Request("https://partygames.n8builds.dev/api/party/config", { headers: { [PROTOCOL_HEADER]: PROTOCOL } }), { PARTY_RATE_LIMIT: "off", ...env });
  return res.json();
};

describe("the test server's shorter away clock", () => {
  it("is read only where PARTY_DEBUG is on", () => {
    expect(testAwayGrace({ PARTY_DEBUG: "on", PARTY_TEST_AWAY_GRACE_MS: "20000" })).toBe(20_000);
    expect(testAwayGrace({ PARTY_TEST_AWAY_GRACE_MS: "20000" })).toBeNull();
    expect(testAwayGrace({ PARTY_DEBUG: "off", PARTY_TEST_AWAY_GRACE_MS: "20000" })).toBeNull();
    for (const bad of ["", "soon", "0", "-5", undefined]) expect(testAwayGrace({ PARTY_DEBUG: "on", PARTY_TEST_AWAY_GRACE_MS: bad })).toBeNull();
    expect(testAwayGrace(undefined)).toBeNull();
  });

  it("is in the config on a test server, and null in production", async () => {
    expect((await config({ PARTY_DEBUG: "on", PARTY_TEST_AWAY_GRACE_MS: "20000" })).testAwayGraceMs).toBe(20_000);
    expect((await config({ PARTY_TEST_AWAY_GRACE_MS: "20000" })).testAwayGraceMs).toBeNull();
    expect((await config({})).testAwayGraceMs).toBeNull();
  });

  it("is set only in wrangler.jsonc's local environment, which has PARTY_DEBUG on; production has neither", () => {
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const local = text.indexOf('"local"');
    expect(local).toBeGreaterThan(0);
    const before = text.slice(0, local);
    expect(before).not.toContain("PARTY_TEST_AWAY_GRACE_MS");
    expect(before).not.toContain('"PARTY_DEBUG"');
    expect(text.slice(local)).toContain('"PARTY_TEST_AWAY_GRACE_MS"');
    expect(text.slice(local)).toContain('"PARTY_DEBUG": "on"');
  });
});
