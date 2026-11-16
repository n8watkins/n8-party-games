// The ghost's second half (lobby/shared/ghost.js): the fade, the scare and boo. Its rules as
// numbers, the room's judgement of each (LobbyCore.fade, boo, bump into a faded ghost, the vote
// that does not count a faded ghost), and on the real Durable Object class that each reaches every
// page, is refused to the sender only in the same style as a choice of piece, and costs a socket
// its rate limit when spammed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { COOLDOWN_SLACK_MS, IMMUNE_MS, IMPACT_MS, KNOCK_DISTANCE, STUN_MS, knockLanding } from "../shared/bump.js";
import { CHARACTERS, moveOf } from "../shared/characters.js";
import { FADE_COOLDOWN_MS, FADE_MS, SCARE, SCARE_MS, SPOOK, SPOOK_AGAIN_MS, SPOOK_DISTANCE, SPOOK_MS, SPOOK_REACH, SPOOK_SLACK, fadeFraction, fadeLeft, frightPose, frightState, isFaded, mayFade, maySpook } from "../shared/ghost.js";
import { COUNT_MS, boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, boxCentre, lightAt } from "../shared/world.js";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime } from "./fake-room.js";
import { turnGame } from "./turn-game.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const wall = () => ({ boxes: [boxFromManifest(coinFlipManifest, { test: true })], games: new Map([["coin-flip", coinFlip]]) });

/** A room of seated, connected players at 1000 ms. */
function party(...names) {
  const core = new LobbyCore({ ...wall(), seed: 7, code: "BCDFGH", now: 1000 });
  for (const name of names) core.connect(core.join(name, 1000).token, 1000);
  return core;
}

/** Puts a seat's piece at x, standing, facing `face`, in steps the room believes. */
function place(core, seat, x, now, face = 1) {
  const m = core.members[seat];
  while (Math.abs(x - m.x) > 1) core.move(seat, { x: Math.abs(x - m.x) > POSITION_SLACK ? m.x + Math.sign(x - m.x) * (POSITION_SLACK - 10) : x, d: 0, r: m.rev }, now);
  core.move(seat, { x, d: face, r: m.rev }, now);
  core.move(seat, { x, d: 0, r: m.rev }, now);
  core.evaluate(now);
}

function ghost(core, seat, now = 1000) {
  core.members[seat].character = "ghost";
  core.members[seat].lookAt = now;
}

describe("the ghost's rules, as numbers", () => {
  it("are the owner's: a fade of 2.5 s on an 8 s cooldown, a scare that stuns for about 0.75 s, a spook weaker than a kick", () => {
    expect(FADE_MS).toBe(2500);
    expect(FADE_COOLDOWN_MS).toBe(8000);
    // The start and the freeze together: "about 0.75 s", then the scurry.
    expect(SCARE.freeze + 160).toBe(750);
    expect(SCARE_MS).toBeGreaterThan(STUN_MS);
    expect(SPOOK_DISTANCE).toBeLessThan(KNOCK_DISTANCE);
    expect(SPOOK_MS).toBeLessThan(STUN_MS);
  });

  it("makes the ghost's move the fade, and every other character's the kick", () => {
    expect(moveOf("ghost")).toBe("fade");
    for (const c of CHARACTERS.filter((c) => c.id !== "ghost")) expect(moveOf(c.id), c.id).toBe("kick");
    expect(moveOf("not-a-character")).toBe("kick");
  });

  it("counts the cooldown from the start of a fade", () => {
    expect(fadeLeft(-Infinity, 0)).toBe(0);
    expect(fadeLeft(1000, 1000)).toBe(FADE_COOLDOWN_MS);
    expect(fadeLeft(1000, 1000 + FADE_COOLDOWN_MS)).toBe(0);
    expect(fadeFraction(FADE_COOLDOWN_MS)).toBe(0);
    expect(fadeFraction(0)).toBe(1);
    expect(isFaded({ fadedUntil: 5000 }, 4999)).toBe(true);
    expect(isFaded({ fadedUntil: 5000 }, 5000)).toBe(false);
    expect(isFaded({ fadedUntil: 5000 }, 4000, false)).toBe(false);
  });

  it("says why a fade is refused, and how long to wait when waiting will do", () => {
    const room = { fades: true, lobby: true, busy: null };
    expect(mayFade({}, 0, room)).toEqual({ ok: true });
    expect(mayFade({}, 0, { ...room, fades: false }).why).toMatch(/ghost/);
    expect(mayFade({}, 0, { ...room, lobby: false })).toMatchObject({ ok: false });
    expect(mayFade({}, 0, { ...room, busy: "Not during the count." })).toEqual({ ok: false, why: "Not during the count." });
    expect(mayFade({ stunUntil: 500 }, 0, room)).toMatchObject({ ok: false, wait: 500 });
    expect(mayFade({ fadeAt: 0 }, 1000, room)).toMatchObject({ ok: false, wait: FADE_COOLDOWN_MS - 1000 });
    // Two messages are never exactly as far apart as they were sent: a little early is allowed.
    expect(mayFade({ fadeAt: 0 }, FADE_COOLDOWN_MS - COOLDOWN_SLACK_MS, room).ok).toBe(true);
  });

  it("lets a faded ghost spook a piece it touches once, never a ghost, never one on the floor or just spooked", () => {
    const pawn = { seat: 1, x: 500, fades: false };
    expect(maySpook(500, pawn, 0).ok).toBe(true);
    expect(maySpook(500 + SPOOK_REACH + SPOOK_SLACK, pawn, 0).ok).toBe(true);
    expect(maySpook(500 + SPOOK_REACH + SPOOK_SLACK + 1, pawn, 0).why).toMatch(/far/);
    expect(maySpook(500, { ...pawn, fades: true }, 0).why).toMatch(/ghost/);
    expect(maySpook(500, pawn, 0, [1]).why).toMatch(/this fade/);
    expect(maySpook(500, { ...pawn, spookedUntil: 10 }, 0).ok).toBe(false);
    expect(maySpook(500, { ...pawn, stunUntil: 10 }, 0).ok).toBe(false);
    expect(maySpook(500, { ...pawn, immuneUntil: 10 }, 0).ok).toBe(false);
  });

  it("plays a scare as a start, a freeze and a scurry to where the room put the piece, and never knocks it over", () => {
    const states = [];
    for (let ms = 0; ms < SCARE_MS + IMMUNE_MS + 100; ms += 10) {
      const pose = frightPose(ms, 400, 190, SCARE, IMMUNE_MS);
      if (states.at(-1) !== pose.state) states.push(pose.state);
      for (const k of ["dx", "lift", "tilt", "sx", "sy", "scared", "pale"]) expect(Number.isFinite(pose[k]), `${k} at ${ms}`).toBe(true);
      // Upright the whole time: a lean, never a fall.
      expect(Math.abs(pose.tilt)).toBeLessThan(15);
      expect(pose.lift).toBeGreaterThanOrEqual(0);
    }
    expect(states).toEqual(["standing", "start", "frozen", "running", "safe", "up"]);
    // While the kick is on its way, the kicker is where it was; at the end of the scurry, where the room put it.
    expect(frightPose(IMPACT_MS - 1, 400, 190, SCARE, IMMUNE_MS).x).toBe(400);
    expect(frightPose(SCARE_MS - 1, 400, 190, SCARE, IMMUNE_MS).x).toBeCloseTo(190, 0);
    expect(frightState(SCARE_MS, SCARE, IMMUNE_MS)).toBe("safe");
    // It looks back at the ghost while frozen, and the way it runs while running.
    expect(frightPose(IMPACT_MS + 300, 400, 190, SCARE, IMMUNE_MS).face).toBe(1);
    expect(frightPose(SCARE_MS - 100, 400, 190, SCARE, IMMUNE_MS).face).toBe(-1);
  });

  it("does not shiver for a viewer who asked for less motion, and keeps its jump small", () => {
    for (let ms = IMPACT_MS; ms < SCARE_MS; ms += 7) {
      const calm = frightPose(ms, 400, 190, SCARE, IMMUNE_MS, true);
      expect(calm.dx, `at ${ms}`).toBe(0);
      expect(calm.lift).toBeLessThanOrEqual(SCARE.hop * 0.4 + 0.001);
    }
  });

  it("plays a spook at once, with no freeze, and done sooner than a knock", () => {
    expect(frightState(0, SPOOK, IMMUNE_MS)).toBe("start");
    expect(frightState(SPOOK_MS, SPOOK, IMMUNE_MS)).toBe("safe");
    expect(frightPose(SPOOK_MS - 1, 500, 640, SPOOK, IMMUNE_MS).x).toBeCloseTo(640, 0);
  });

  it("lands a spook in the dark, a shorter way than a kick", () => {
    const n = 1;
    const from = boxCentre(0, n);
    const spook = knockLanding(from, 1, n, null, { distance: SPOOK_DISTANCE, least: 60 });
    const kick = knockLanding(from, 1, n);
    expect(lightAt(spook, n)).toBe(-1);
    expect(spook - from).toBeLessThanOrEqual(kick - from);
  });
});

describe("the room's judgement", () => {
  it("fades a ghost for 2.5 s, refuses it again until 8 s after it began, and tells a page arriving in the middle", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    expect(core.fade(0, 2000)).toEqual({ ok: true, relay: { t: "fade", s: 0, for: FADE_MS } });
    expect(core.view(2500).members[0]).toMatchObject({ faded: FADE_MS - 500, fadeCool: FADE_COOLDOWN_MS - 500 });
    expect(core.view(2000 + FADE_MS).members[0].faded).toBeUndefined();
    expect(core.fade(0, 3000)).toMatchObject({ ok: false, wait: FADE_COOLDOWN_MS - 1000 });
    expect(core.fade(0, 2000 + FADE_COOLDOWN_MS).ok).toBe(true);
    // A pawn has no fade, and nothing about one in the view.
    expect(core.fade(1, 2000)).toMatchObject({ ok: false, why: "Only a ghost can fade." });
    expect(core.view(2500).members[1]).not.toHaveProperty("fadeCool");
  });

  it("takes a faded ghost's vote away: the light does not count it, and the count waits for it to turn solid", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    const mid = boxCentre(0, 1);
    place(core, 0, mid - 40, 2000);
    place(core, 1, mid + 40, 2000);
    core.count = null;
    core.fade(0, 2000);
    core.evaluate(2001);
    expect(core.standing(2001)[0]).toBeNull();
    expect(core.voteView(2001).waiting).toEqual([0]);
    expect(core.count).toBeNull();
    // The room wakes when the fade ends, and then the count starts.
    expect(core.nextWake(2001)).toBe(2000 + FADE_MS);
    core.evaluate(2000 + FADE_MS);
    expect(core.standing(2000 + FADE_MS)[0]).toBe("coin-flip");
    expect(core.count?.endsAt).toBe(2000 + FADE_MS + COUNT_MS);
  });

  it("never fades during a count, a coin toss, a game starting, the settings or at the Table", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    core.count = { endsAt: 99_999 };
    expect(core.fade(0, 2000)).toMatchObject({ ok: false, why: "Not during the count." });
    core.count = null;
    core.toss = { between: ["a", "b"], winner: "a", endsAt: 99_999 };
    expect(core.fade(0, 2000)).toMatchObject({ ok: false, why: "Not during the coin toss." });
    core.toss = null;
    core.starting = "coin-flip";
    expect(core.fade(0, 2000)).toMatchObject({ ok: false, why: "Not while a game starts." });
    core.starting = null;
    core.activity = { kind: "settings", id: "coin-flip", endsAt: 99_999 };
    expect(core.fade(0, 2000).ok).toBe(false);
    core.activity = { kind: "lobby" };
    core.mode = "turn-based";
    expect(core.plainRoom()).toBe(true);
    expect(core.fade(0, 2000).ok).toBe(false);
    core.mode = "party-games";
    expect(core.fade(0, 2000).ok).toBe(true);
  });

  it("does not let a ghost kick", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    place(core, 0, 400, 2000);
    place(core, 1, 460, 2000);
    expect(core.bump(0, 2100)).toBeNull();
    expect(core.bumpWait(0, 2100)).toBeNull();
  });

  it("scares a pawn that kicks a faded ghost: the kick passes through, and the pawn runs a kick's distance the other way", () => {
    const core = party("Ann", "Bo");
    ghost(core, 1);
    place(core, 0, 600, 2000, 1);
    place(core, 1, 660, 2000);
    core.fade(1, 2050);
    const ghostBefore = core.members[1].x;
    const hit = core.bump(0, 2100);
    expect(hit).toMatchObject({ t: "b", s: 0, f: 1, to: -1, sc: 1, x: knockLanding(600, -1, 1), rev: core.members[0].rev });
    expect(hit.x).toBeLessThan(600);
    // The ghost is where it was, untouched; the pawn cannot move until it has stopped running, then is safe for a while.
    expect(core.members[1].x).toBe(ghostBefore);
    expect(core.move(0, { x: hit.x, d: 1, r: hit.rev }, 2100 + SCARE_MS - 1)).toBeNull();
    expect(core.view(2100).members[0]).toMatchObject({ down: SCARE_MS, safe: SCARE_MS + IMMUNE_MS });
    expect(core.move(0, { x: hit.x, d: 1, r: hit.rev }, 2100 + SCARE_MS)).not.toBeNull();
    // A solid ghost is knocked as anyone is: it can be hit again the moment it turns solid.
    place(core, 0, 600, 2100 + SCARE_MS + IMMUNE_MS, 1);
    expect(core.bump(0, 2100 + SCARE_MS + IMMUNE_MS)).toMatchObject({ to: 1 });
  });

  it("spooks a piece a faded ghost drifts through, the way it was going, once a fade and not again for a while", () => {
    const core = party("Ann", "Bo", "Cy");
    ghost(core, 0);
    const mid = boxCentre(0, 1);
    place(core, 1, mid, 2000);
    place(core, 2, mid + 300, 2000);
    place(core, 0, mid - 30, 2000);
    expect(core.boo(0, 1, 2000)).toMatchObject({ ok: false, why: "Only a faded ghost can spook." });
    core.fade(0, 2000);
    core.move(0, { x: mid - 30, d: 1, r: core.members[0].rev }, 2000);
    const out = core.boo(0, 1, 2050);
    expect(out).toMatchObject({ ok: true, relay: { t: "spook", s: 0, to: 1, rev: 1 } });
    // Out of its light, into the dark, the way the ghost drifts.
    expect(out.relay.x).toBeGreaterThan(mid);
    expect(lightAt(out.relay.x, 1)).toBe(-1);
    expect(core.view(2050).members[1]).toMatchObject({ down: SPOOK_MS });
    // Its cap: the same piece again in this fade, or in the next, is refused.
    expect(core.boo(0, 1, 2100).ok).toBe(false);
    // Too far away to have touched it.
    expect(core.boo(0, 2, 2100)).toMatchObject({ ok: false, why: "Too far away." });
    // Nonsense is refused, not thrown.
    for (const bad of [0, -1, 9, "1", null, undefined, 1.5]) expect(core.boo(0, bad, 2100).ok, String(bad)).toBe(false);
    // A later fade, after the piece's own SPOOK_AGAIN_MS, may spook it again.
    const later = 2000 + Math.max(FADE_COOLDOWN_MS, SPOOK_AGAIN_MS);
    place(core, 1, mid, later);
    place(core, 0, mid - 20, later);
    core.fade(0, later);
    expect(core.boo(0, 1, later + 10).ok).toBe(true);
  });

  it("never lets a ghost spook another ghost, and never during a game", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    ghost(core, 1);
    place(core, 0, 400, 2000);
    place(core, 1, 410, 2000);
    core.fade(0, 2000);
    expect(core.boo(0, 1, 2010)).toMatchObject({ ok: false, why: "A ghost cannot spook a ghost." });
    core.members[1].character = "pawn";
    core.activity = { kind: "game", id: "coin-flip", seats: [0, 1] };
    expect(core.boo(0, 1, 2010).ok).toBe(false);
  });

  it("makes a ghost that changes character mid-fade solid at once", () => {
    const core = party("Ann");
    ghost(core, 0, -10_000);
    core.fade(0, 2000);
    expect(core.faded(core.members[0], 2100)).toBe(true);
    expect(core.setLook(0, { c: "pawn" }, 2100).ok).toBe(true);
    expect(core.faded(core.members[0], 2100)).toBe(false);
  });
});

describe("the ghost's moves on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  async function room() {
    const r = await openRoom(createLobbyRoom, turnGame());
    const { ctx, connect } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const screen = await ctx.room.join({ as: "screen" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
    await settle();
    r.say(ws.ann, { t: "look", c: "ghost" });
    await settle();
    return { ...r, ws };
  }
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("tells every page and the screen of a fade, and refuses one too soon to the sender only, with the wait", async () => {
    const { say, ws } = await room();
    const [a, b, s] = mark(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "fade" });
    await settle();
    for (const [page, n] of [[ws.ann, a], [ws.bo, b], [ws.screen, s]]) expect(since(page, n).find((m) => m.t === "fade")).toEqual({ t: "fade", s: 0, for: FADE_MS });
    const [a2, b2] = mark(ws.ann, ws.bo);
    await vi.advanceTimersByTimeAsync(1000);
    say(ws.ann, { t: "fade" });
    await settle();
    const no = since(ws.ann, a2).find((m) => m.t === "fade-no");
    expect(no).toMatchObject({ t: "fade-no", why: "Your fade is not ready yet." });
    expect(no.wait).toBeGreaterThan(FADE_COOLDOWN_MS - 1100);
    expect(since(ws.bo, b2).some((m) => m.t === "fade" || m.t === "fade-no")).toBe(false);
    // A pawn asking is told why, and so is a screen (which has no piece) told nothing at all.
    say(ws.bo, { t: "fade" });
    say(ws.screen, { t: "fade" });
    await settle();
    expect(since(ws.bo, b2).find((m) => m.t === "fade-no")).toMatchObject({ why: "Only a ghost can fade." });
  });

  it("closes a socket that spams the ghost's moves", async () => {
    const { say, ws } = await room();
    say(ws.ann, { t: "fade" });
    for (let i = 0; i < 40 && !ws.ann.closed; i++) {
      say(ws.ann, { t: "fade" });
      say(ws.ann, { t: "boo", to: 1 });
    }
    await settle();
    expect(ws.ann.closed).not.toBeNull();
    expect(ws.bo.closed).toBeNull();
  });

  it("refuses a fade during the count, and a kick into a faded ghost scares the kicker on every page", async () => {
    const { ctx, say, ws } = await room();
    const core = ctx.room.core;
    const mid = boxCentre(0, core.boxes.length);
    // Both in the light: the count starts.
    for (const [page, seat, x] of [[ws.ann, 0, mid + 40], [ws.bo, 1, mid - 20]]) {
      const m = core.members[seat];
      while (Math.abs(m.x - x) > 1) {
        say(page, { t: "m", x: Math.abs(x - m.x) > POSITION_SLACK ? m.x + Math.sign(x - m.x) * (POSITION_SLACK - 10) : x, d: 0, r: m.rev });
        await vi.advanceTimersByTimeAsync(20);
      }
    }
    expect(core.count).not.toBeNull();
    const [a] = mark(ws.ann);
    say(ws.ann, { t: "fade" });
    await settle();
    expect(since(ws.ann, a).find((m) => m.t === "fade-no")).toMatchObject({ why: "Not during the count." });
    expect(core.count).not.toBeNull();
    // Bo walks out, the count stops; Ann fades; Bo comes back facing her and kicks.
    say(ws.bo, { t: "m", x: mid - 300, d: 0, r: core.members[1].rev });
    await settle();
    expect(core.count).toBeNull();
    say(ws.ann, { t: "fade" });
    await settle();
    say(ws.bo, { t: "m", x: mid - 20, d: 1, r: core.members[1].rev });
    say(ws.bo, { t: "m", x: mid - 20, d: 0, r: core.members[1].rev });
    await settle();
    // The ghost is faded: no count, though both stand in the light.
    expect(core.count).toBeNull();
    const [a3, b3, s3] = mark(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "b" });
    await settle();
    for (const [page, n] of [[ws.ann, a3], [ws.bo, b3], [ws.screen, s3]]) expect(since(page, n).find((m) => m.t === "b")).toMatchObject({ s: 1, to: -1, sc: 0 });
    expect(core.members[1].x).toBeLessThan(mid - 20);
  });
});
