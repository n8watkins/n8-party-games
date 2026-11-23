// A whole party behind one address (a home's wifi) meets a new build at once, and the zone's rate
// rule ("Slow down floods": 100 requests to /api/ per 10 s from one address) must not trip
// (site/release-switch.js, review item 3 of PR #88).
//
// The worst moment: a deploy restarts the room while the party is in the lobby. Every phone's
// socket opens again within half a second (party-client.js reconnectDelay), the room's hello
// names the new build at a safe point, and every phone must ask /api/version and reload, after
// which its page opens its socket again (and a big screen may fetch its config and QR code).
// This plays that out for 30 phones on the real watchRoomRelease, with fake time, and counts the
// requests to /api/ in every 10 s window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spreadMs, watchRoomRelease } from "../release-switch.js";
import { API_REQUESTS_PER_RELOAD, FLOOD_RULE } from "./release-budget.js";

const NEW = "cccccccccccc";
const PHONES = 30;

/** A small seeded random, so every run plays out the same. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function memory() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, String(v)), removeItem: (k) => void kept.delete(k) };
}

/** The most requests in any window of `ms` (sliding, from each request). */
function busiest(times, ms) {
  const sorted = [...times].sort((a, b) => a - b);
  let most = 0;
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (sorted[i] - sorted[j] >= ms) j++;
    most = Math.max(most, i - j + 1);
  }
  return most;
}

/** A party of `phones` meets build NEW after a deploy; returns every /api/ request's time and each reload's. */
async function deployInto(phones, seed) {
  const random = seeded(seed);
  const t0 = Date.now();
  const requests = [];
  const reloads = [];
  const ask = () => requests.push(Date.now() - t0);
  const links = [];
  for (let i = 0; i < phones; i++) {
    const handlers = new Map();
    const link = {
      on: (t, h) => handlers.set(t, h),
      fire: (t, ...a) => handlers.get(t)?.(...a),
      room: { members: Array.from({ length: phones }, () => ({})), screens: 0 },
      helloProtocol: "2",
      askRelease: () => {},
    };
    watchRoomRelease(link, {
      notice: () => {},
      live: async () => (ask(), NEW),
      random,
      storage: memory(),
      reload: () => {
        reloads.push(Date.now() - t0);
        // The new page: its socket, and what else a page may ask for as it loads.
        for (let k = 0; k < API_REQUESTS_PER_RELOAD; k++) ask();
      },
      visibility: null,
    });
    links.push(link);
  }
  // The room restarts: every socket opens again 250 to 500 ms later, and hears the new build.
  for (const link of links) {
    setTimeout(
      () => {
        ask();
        link.fire("release", { id: NEW, safe: true, protocol: "2" });
      },
      250 + random() * 250,
    );
  }
  await vi.advanceTimersByTimeAsync(2 * spreadMs(phones) + 1000);
  return { requests, reloads };
}

describe("a party of 30 behind one address meets a new build", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("every phone reloads once, spread over the party's spread, and the rate rule is never reached", async () => {
    let worst = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { requests, reloads } = await deployInto(PHONES, seed);
      expect(reloads).toHaveLength(PHONES);
      // Spread out: no more than a third of the party in any one second.
      expect(busiest(reloads, 1000)).toBeLessThanOrEqual(Math.ceil(PHONES / 3));
      expect(Math.max(...reloads)).toBeLessThan(spreadMs(PHONES) + 1000);
      // Each phone: its socket back, one /api/version, and its page's own after the reload.
      expect(requests).toHaveLength(PHONES * (2 + API_REQUESTS_PER_RELOAD));
      worst = Math.max(worst, busiest(requests, FLOOD_RULE.windowMs));
    }
    // With a fifth of the rule to spare for anything else the phones ask for meanwhile.
    expect(worst).toBeLessThanOrEqual(FLOOD_RULE.requests * 0.8);
  });

  it("without the spread, the same party would trip it (the check above can fail)", () => {
    const together = Array.from({ length: PHONES * (2 + API_REQUESTS_PER_RELOAD) }, () => 500);
    expect(busiest(together, FLOOD_RULE.windowMs)).toBeGreaterThan(FLOOD_RULE.requests * 0.8);
  });

  it("a small party is not kept waiting: four phones have all reloaded within four seconds", async () => {
    const { reloads } = await deployInto(4, 7);
    expect(reloads).toHaveLength(4);
    expect(Math.max(...reloads)).toBeLessThan(spreadMs(4) + 600);
    expect(spreadMs(4)).toBeLessThanOrEqual(4000);
  });
});
