import { describe, expect, it } from "vitest";
import { IDLE_SHUTDOWN_MS, LagLine, RECONNECT_GRACE_MS, RoomCore, STALE_ROOM_MS, cleanName } from "../src/core/room-core.js";
import { hashSeed, makeRng } from "../src/core/rng.js";
import { pickFreePin, isPin } from "../src/worker/pin-logic.js";
import { RATE_LIMITS, clientKey, nextWindow } from "../src/worker/limit-logic.js";
import { INCLUDED_GB_S, ROOM_MEMORY_GB, addRoomTime, budgetState, emptyUsage, limitsFromEnv } from "../src/worker/budget-logic.js";

/** A tiny game: every input adds to the seat's count; the round ends after `length` ticks. */
function counterGame(length = 5) {
  return {
    id: "counter",
    minSeats: 2,
    maxSeats: 4,
    snapshotEvery: 2,
    create: ({ seed, seats }) => ({ seed, ticks: 0, counts: Object.fromEntries(seats.map((s) => [s.seat, 0])), log: [] }),
    input: (state, seat, input) => {
      state.counts[seat] += input.n ?? 1;
      state.log.push({ seat, n: input.n ?? 1 });
    },
    bot: () => [{ n: 10 }],
    tick: (state) => {
      state.ticks += 1;
      return state.log.splice(0);
    },
    snapshot: (state) => ({ ticks: state.ticks, counts: { ...state.counts } }),
    isOver: (state) => state.ticks >= length,
    result: (state) => ({ counts: { ...state.counts } }),
  };
}

function room(game = counterGame(), now = 1000) {
  return new RoomCore({ game, seed: 42, code: "BCDFGH", now });
}

function seated(core, name, now = 1000) {
  const joined = core.join(name, now);
  core.connect(joined.token, now);
  return joined;
}

describe("joining and seats", () => {
  it("seats up to four players in order, each with a colour, and turns a fifth away", () => {
    const core = room();
    const seats = ["Ann", "Bo", "Cy", "Di"].map((n) => seated(core, n).seat);
    expect(seats).toEqual([0, 1, 2, 3]);
    expect(new Set(core.view(1000).seats.map((s) => s.colour)).size).toBe(4);
    expect(core.join("Eve", 1000)).toMatchObject({ ok: false, error: "room_full" });
  });

  it("cleans nicknames and keeps them unique", () => {
    expect(cleanName("  <b>Nat\u0007</b>   W  ")).toBe("bNat/b W");
    expect(cleanName("x".repeat(40))).toHaveLength(14);
    const core = room();
    seated(core, "Sam");
    const second = seated(core, "sam");
    expect(core.view(1000).seats[second.seat].name).toBe("sam 2");
    expect(core.join("   ", 1000)).toMatchObject({ ok: false, error: "bad_name" });
  });

  it("never shows a token in the view", () => {
    const core = room();
    const { token } = seated(core, "Ann");
    expect(JSON.stringify(core.view(1000))).not.toContain(token);
  });

  it("lets a screen watch without a seat, and makes the first arrival the host", () => {
    const core = room();
    const screen = core.watch(1000);
    core.connect(screen.token, 1000);
    const ann = seated(core, "Ann");
    expect(core.identify(screen.token)).toEqual({ role: "screen", seat: -1 });
    expect(core.hostToken).toBe(screen.token);
    expect(core.view(1000).screens).toBe(1);
    expect(ann.seat).toBe(0);
  });
});

describe("ready and start", () => {
  it("starts only when every connected human is ready, and fills up to the minimum with a bot", () => {
    const core = room();
    const ann = seated(core, "Ann");
    expect(core.canStart()).toBe(false);
    expect(core.start(1000).ok).toBe(false);
    core.setReady(ann.seat, true);
    expect(core.start(2000).ok).toBe(true);
    const view = core.view(2000);
    expect(view.phase).toBe("playing");
    expect(view.seats.filter(Boolean).map((s) => s.kind)).toEqual(["human", "bot"]);
    expect(view.startAt).toBe(2000);
  });

  it("gives each round its own seed, derived from the room's", () => {
    const a = room();
    const b = room();
    for (const core of [a, b]) {
      const ann = seated(core, "Ann");
      core.setReady(ann.seat, true);
      core.start(2000);
    }
    expect(a.state.seed).toBe(b.state.seed);
    const first = a.state.seed;
    for (let i = 0; i < 5; i++) a.tick(3000 + i);
    a.setReady(0, true);
    a.start(4000);
    expect(a.state.seed).not.toBe(first);
  });
});

describe("the authoritative round", () => {
  function playing() {
    const core = room();
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    core.setReady(ann.seat, true);
    core.setReady(bo.seat, true);
    core.start(2000);
    return { core, ann, bo };
  }

  it("applies human inputs, returns the events, and sends snapshots on schedule", () => {
    const { core, ann } = playing();
    expect(core.input(ann.seat, { n: 3 }, 2010)).toBe(true);
    const first = core.tick(2033);
    expect(first.events).toEqual([{ seat: 0, n: 3 }]);
    expect(first.snapshot).toBeNull();
    const second = core.tick(2066);
    expect(second.snapshot).toEqual({ ticks: 2, counts: { 0: 3, 1: 0 } });
  });

  it("ignores inputs outside a round and from seats that are not human", () => {
    const core = room();
    const ann = seated(core, "Ann");
    expect(core.input(ann.seat, { n: 1 }, 1000)).toBe(false);
    core.setReady(ann.seat, true);
    core.start(2000);
    expect(core.input(1, { n: 1 }, 2000)).toBe(false); // the bot's seat
    expect(core.input(3, { n: 1 }, 2000)).toBe(false); // nobody there
  });

  it("ends the round, reports the result and clears ready for the rematch", () => {
    const { core } = playing();
    let out;
    for (let i = 0; i < 5; i++) out = core.tick(2100 + i * 33);
    expect(out.ended).toBe(true);
    expect(core.phase).toBe("ended");
    expect(core.view(3000).result).toEqual({ counts: { 0: 0, 1: 0 } });
    expect(core.canStart()).toBe(false);
    core.setReady(0, true);
    core.setReady(1, true);
    expect(core.start(4000).ok).toBe(true);
    expect(core.round).toBe(2);
  });
});

describe("dropping, reconnecting and bots", () => {
  function playing() {
    const core = room(counterGame(100000));
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    core.setReady(ann.seat, true);
    core.setReady(bo.seat, true);
    core.start(2000);
    return { core, ann, bo };
  }

  it("puts a bot in a dropped seat at once so the round goes on", () => {
    const { core, bo } = playing();
    core.disconnect(bo.token, 3000);
    const seat = core.view(3000).seats[bo.seat];
    expect(seat).toMatchObject({ kind: "bot", away: true, name: "Bo" });
    core.tick(3033);
    expect(core.state.counts[bo.seat]).toBe(10); // the stand-in played
    expect(core.input(bo.seat, { n: 99 }, 3040)).toBe(false);
  });

  it("gives the same seat back inside 30 seconds", () => {
    const { core, bo } = playing();
    core.disconnect(bo.token, 3000);
    core.tick(3000 + RECONNECT_GRACE_MS - 1);
    expect(core.connect(bo.token, 3000 + RECONNECT_GRACE_MS - 1)).toEqual({ role: "player", seat: bo.seat });
    expect(core.view(0).seats[bo.seat]).toMatchObject({ kind: "human", away: false, connected: true, name: "Bo" });
    expect(core.input(bo.seat, { n: 1 }, 40000)).toBe(true);
  });

  it("keeps the bot after 30 seconds and refuses the old token", () => {
    const { core, bo } = playing();
    core.disconnect(bo.token, 3000);
    const out = core.tick(3000 + RECONNECT_GRACE_MS);
    expect(out.roomChanged).toBe(true);
    expect(core.connect(bo.token, 3000 + RECONNECT_GRACE_MS + 1)).toBeNull();
    expect(core.view(0).seats[bo.seat]).toMatchObject({ kind: "bot", away: false });
    expect(core.view(0).seats[bo.seat].name).not.toBe("Bo");
  });

  it("replaces a player who leaves on purpose with a bot, with no way back", () => {
    const { core, bo } = playing();
    core.leave(bo.token, 3000);
    expect(core.view(0).seats[bo.seat]).toMatchObject({ kind: "bot", away: false });
    expect(core.connect(bo.token, 3001)).toBeNull();
  });

  it("frees the seat of a player who leaves the lobby, and passes the host on", () => {
    const core = room();
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    expect(core.view(0).hostSeat).toBe(ann.seat);
    core.leave(ann.token, 2000);
    expect(core.view(0).seats[ann.seat]).toBeNull();
    expect(core.view(0).hostSeat).toBe(bo.seat);
  });

  it("lets a late joiner take a free bot seat during a round, but not a held one", () => {
    const { core, bo } = playing();
    core.disconnect(bo.token, 3000);
    expect(core.join("Cy", 3100)).toMatchObject({ ok: false });
    core.tick(3000 + RECONNECT_GRACE_MS);
    expect(core.join("Cy", 40000)).toMatchObject({ ok: true, seat: bo.seat });
  });

  it("host adds and removes stand-ins in the lobby", () => {
    const core = room();
    seated(core, "Ann");
    expect(core.addBot()).toEqual({ ok: true, seat: 1 });
    expect(core.view(0).seats[1]).toMatchObject({ kind: "bot", ready: true });
    expect(core.removeBot(1)).toBe(true);
    expect(core.removeBot(0)).toBe(false);
  });
});

describe("idle shutdown", () => {
  it("asks to close one minute after the last person disconnects", () => {
    const core = room();
    const ann = seated(core, "Ann", 1000);
    expect(core.tick(1000 + IDLE_SHUTDOWN_MS * 2).close).toBe(false);
    core.disconnect(ann.token, 5000);
    expect(core.nextWake(5000)).toBe(5000 + RECONNECT_GRACE_MS);
    expect(core.tick(5000 + IDLE_SHUTDOWN_MS - 1).close).toBe(false);
    expect(core.tick(5000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });

  it("closes a room nobody ever connected to", () => {
    const core = room(counterGame(), 1000);
    expect(core.tick(1000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });

  it("counts the minute from when the room emptied, also when it slept in between", () => {
    const core = room();
    const ann = seated(core, "Ann", 1000);
    core.disconnect(ann.token, 5000);
    // The empty room is put to sleep and woken by its alarm a minute later.
    const woken = RoomCore.restore(counterGame(), JSON.parse(JSON.stringify(core.serialize())), 5000 + IDLE_SHUTDOWN_MS);
    expect(woken.tick(5000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
    // Saved with someone in it and woken with nobody (a restart): empty from the waking.
    const busy = room();
    seated(busy, "Bo", 1000);
    const restarted = RoomCore.restore(counterGame(), JSON.parse(JSON.stringify(busy.serialize())), 90_000);
    expect(restarted.tick(90_000 + IDLE_SHUTDOWN_MS - 1).close).toBe(false);
    expect(restarted.tick(90_000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });

  it("does not count bots as people", () => {
    const core = room();
    const ann = seated(core, "Ann");
    core.addBot();
    core.disconnect(ann.token, 2000);
    expect(core.tick(2000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });
});

describe("saving the lobby", () => {
  it("restores seats and tokens, with everyone marked as dropped until they reconnect", () => {
    const core = room();
    const ann = seated(core, "Ann");
    core.pin = "4821";
    const copy = RoomCore.restore(counterGame(), JSON.parse(JSON.stringify(core.serialize())), 9000);
    expect(copy.view(9000)).toMatchObject({ pin: "4821", code: "BCDFGH", seed: 42 });
    expect(copy.view(9000).seats[0]).toMatchObject({ name: "Ann", connected: false });
    expect(copy.connect(ann.token, 9001)).toEqual({ role: "player", seat: 0 });
  });
});

describe("simulated latency", () => {
  it("delivers each message after the lag, in order", () => {
    const timers = [];
    const got = [];
    const line = new LagLine(150, (m) => got.push(m), (fn, ms) => timers.push({ fn, ms }));
    line.push("a");
    line.push("b");
    expect(got).toEqual([]);
    expect(timers.map((t) => t.ms)).toEqual([150, 150]);
    timers.forEach((t) => t.fn());
    expect(got).toEqual(["a", "b"]);
  });

  it("is a straight pass-through at zero, and bounds silly values", () => {
    const got = [];
    new LagLine(0, (m) => got.push(m)).push("now");
    expect(got).toEqual(["now"]);
    expect(new LagLine(99999, () => {}).lagMs).toBe(2000);
    expect(new LagLine("nope", () => {}).lagMs).toBe(0);
  });
});

describe("the seed", () => {
  it("gives the same stream for the same seed and different streams for forks", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    const run = (r) => Array.from({ length: 5 }, () => r());
    expect(run(a)).toEqual(run(b));
    expect(run(makeRng(7).fork("moths"))).not.toEqual(run(makeRng(7)));
    expect(hashSeed("x")).toBe(hashSeed("x"));
    const r = makeRng(1);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r.int(4)).toBeLessThan(4);
    }
  });
});

describe("PINs and rate limits", () => {
  it("recognises four digits only", () => {
    expect(isPin("0042")).toBe(true);
    expect(isPin("42")).toBe(false);
    expect(isPin("12a4")).toBe(false);
  });

  it("never hands out a PIN that is taken", () => {
    const occupied = new Set(Array.from({ length: 9999 }, (_, i) => String(i).padStart(4, "0")));
    expect(pickFreePin(occupied)).toBe("9999");
    occupied.add("9999");
    expect(pickFreePin(occupied)).toBeNull();
  });

  it("counts attempts in a fixed window", () => {
    const rule = { limit: 2, windowMs: 1000 };
    let w = nextWindow({ start: 0, count: 0 }, rule, 0);
    w = nextWindow(w, rule, 500);
    expect(w.count).toBe(2);
    w = nextWindow(w, rule, 900);
    expect(w.count > rule.limit).toBe(true);
    expect(nextWindow(w, rule, 1000)).toEqual({ start: 1000, count: 1 });
  });

  it("treats one IPv6 /64 as one client", () => {
    expect(clientKey("2001:db8:1:2:aaaa::1")).toBe(clientKey("2001:db8:1:2:bbbb::9"));
    expect(clientKey("::ffff:10.0.0.7")).toBe("10.0.0.7");
  });
});

describe("the room budget", () => {
  const noon = Date.UTC(2026, 10, 12, 12);
  const hour = 60 * 60_000;

  it("is off unless a share is set", () => {
    expect(limitsFromEnv({})).toBeNull();
    expect(limitsFromEnv({ PARTY_ROOM_BUDGET_SHARE: "nonsense" })).toBeNull();
    expect(budgetState(addRoomTime(null, 1000 * hour, noon), null, noon)).toBe("open");
  });

  it("turns a share of the plan into GB-seconds, with a tenth of it per day", () => {
    const limits = limitsFromEnv({ PARTY_ROOM_BUDGET_SHARE: "0.05" });
    expect(limits.month).toBeCloseTo(INCLUDED_GB_S * 0.05);
    expect(limits.day).toBeCloseTo(limits.month / 10);
    expect(limitsFromEnv({ PARTY_ROOM_BUDGET_SHARE: "0.05", PARTY_ROOM_BUDGET_DAY_SHARE: "0.5" }).day).toBeCloseTo(limits.month / 2);
  });

  it("counts a room's awake time at 128 MB", () => {
    const usage = addRoomTime(emptyUsage(noon), hour, noon);
    expect(usage.monthUsed).toBeCloseTo(3600 * ROOM_MEMORY_GB);
    expect(usage.dayUsed).toBeCloseTo(usage.monthUsed);
  });

  it("closes for the day, reopens the next day, and closes for the month", () => {
    const limits = { month: 3600 * ROOM_MEMORY_GB * 3, day: 3600 * ROOM_MEMORY_GB * 2 };
    let usage = addRoomTime(null, hour, noon);
    expect(budgetState(usage, limits, noon)).toBe("open");
    usage = addRoomTime(usage, hour, noon + hour);
    expect(budgetState(usage, limits, noon + hour)).toBe("day");
    const tomorrow = noon + 24 * hour;
    expect(budgetState(usage, limits, tomorrow)).toBe("open");
    usage = addRoomTime(usage, hour, tomorrow);
    expect(budgetState(usage, limits, tomorrow)).toBe("month");
    expect(budgetState(usage, limits, Date.UTC(2026, 11, 1))).toBe("open");
  });

  it("limits new rooms per connection by burst and by day", () => {
    expect(RATE_LIMITS.create_short.limit).toBeLessThanOrEqual(5);
    expect(RATE_LIMITS.create_long.windowMs).toBe(24 * hour);
  });
});

describe("sleeping and forgotten rooms", () => {
  it("closes a room nobody has touched for twenty minutes, but never during a round", () => {
    const core = room();
    const ann = seated(core, "Ann");
    expect(core.nextWake(1000)).toBe(1000 + STALE_ROOM_MS);
    expect(core.tick(1000 + STALE_ROOM_MS - 1).close).toBe(false);
    expect(core.tick(1000 + STALE_ROOM_MS).close).toBe("stale");
    core.touch(1000 + STALE_ROOM_MS);
    expect(core.tick(1000 + STALE_ROOM_MS + 1).close).toBe(false);
    core.setReady(ann.seat, true);
    const t = 2000 + STALE_ROOM_MS;
    core.start(t);
    expect(core.nextWake(t)).toBeNull();
    expect(core.tick(t + STALE_ROOM_MS * 2).close).toBe(false);
  });

  it("keeps the results screen through sleep", () => {
    const core = room(counterGame(1));
    const ann = seated(core, "Ann");
    core.setReady(ann.seat, true);
    core.start(2000);
    expect(core.tick(2100).ended).toBe(true);
    const copy = RoomCore.restore(counterGame(1), JSON.parse(JSON.stringify(core.serialize())), 3000);
    copy.connect(ann.token, 3000);
    expect(copy.view(3000)).toMatchObject({ phase: "ended", round: 1, result: core.result });
    expect(copy.view(3000).seats[ann.seat]).toMatchObject({ name: "Ann", connected: true });
  });
});
