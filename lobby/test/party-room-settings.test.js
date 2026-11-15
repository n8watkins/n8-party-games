// A game's settings after the vote, and what a rematch carries (W5: KR-8), proved on the real
// Durable Object class with the turn-based test game given settings and a carry. When such a game
// wins the vote the room does not start it: it is in a settings step, saved, woken by its time
// limit only, in which the party's host changes the settings (checked by the game), starts the
// game or goes back to the room, and everyone else sees the picks. A rematch of the same people in
// the same seats starts from what the last match left.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeEnv, openRoom, settle, useFakeRuntime, voteIn, voteTo } from "./fake-room.js";
import { SETTINGS_FIELDS, choosing as choosingIn, from, started as startedIn, turnGame } from "./turn-game.js";
import { SETTINGS_MS } from "../server/lobby-core.js";
import { SETTLE_MS } from "../shared/vote.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const choosing = (game, opts) => choosingIn(createLobbyRoom, game, opts);
const roomOf = (ws) => ws.messages().filter((m) => m.room).at(-1)?.room;
const refusals = (msgs) => msgs.filter((m) => m.t === "settings-no");

let intervals;
beforeEach(() => {
  useFakeRuntime();
  intervals = vi.spyOn(globalThis, "setInterval");
});
afterEach(dropFakeRuntime);

/** The host wins the game: Ann says `win` on her turn (the first one, unless Bo starts). */
async function annWins(r) {
  const { ctx, say, ws } = r;
  const a = ctx.room.core.activity;
  const first = a.state.seats[a.state.turn];
  if (first !== 0) say(ws.bo, { t: "in", d: { say: "pass" } });
  await settle();
  say(ws.ann, { t: "in", d: { say: "got it", win: true } });
  await settle();
  expect(ctx.room.core.activity.kind).toBe("lobby");
}

/** Waits out the rest after a game and votes the game in again, up to the settings step. */
async function voteAgain(r) {
  await vi.advanceTimersByTimeAsync(SETTLE_MS);
  await voteTo(r, "settings", [r.ws.ann, 0], [r.ws.bo, 1]);
  await settle();
}

describe("the settings step after the vote", () => {
  it("does not start the game: everyone sees the choices, it is saved, and it costs nothing while nobody taps", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    expect(game.calls.created).toEqual([]);
    for (const w of Object.values(ws)) expect(w.messages().some((m) => m.t === "start")).toBe(false);
    // Every page, the big screen too, has the step: the fields, the defaults, who chooses, the time.
    for (const w of Object.values(ws)) {
      expect(roomOf(w)).toMatchObject({
        phase: "settings",
        game: null,
        choosing: { id: "turns", name: "turns", picks: { pace: 30, rounds: 3, first: "host" }, seats: [0, 1], by: 0, of: SETTINGS_MS },
      });
    }
    const view = roomOf(ws.screen).choosing;
    expect(view.fields.map((f) => [f.key, f.label, f.default])).toEqual([
      ["pace", "Turn timer", 30],
      ["rounds", "Match length", 3],
      ["first", "Who starts", "host"],
    ]);
    expect(view.fields[0].options).toEqual([
      { value: 30, label: "30 seconds" },
      { value: 60, label: "60 seconds" },
    ]);
    expect(view.endsIn).toBeGreaterThan(SETTINGS_MS - 1000);
    // On record, with its time limit as the room's alarm; no timer of any kind runs.
    expect(ctx.store.get("lobby").choosing).toMatchObject({ id: "turns", picks: { pace: 30 }, seats: [0, 1] });
    expect(ctx.alarm.at).toBe(ctx.room.core.activity.endsAt);
    expect(ctx.room.timer).toBeNull();
    expect(intervals).not.toHaveBeenCalled();
    // The pieces stand still and no count starts while the settings are chosen.
    const before = ctx.room.core.members[0].x;
    say(ws.ann, { t: "m", x: before + 40, d: 1, r: ctx.room.core.members[0].rev });
    await settle();
    expect(ctx.room.core.members[0].x).toBe(before);
    expect(ctx.room.core.count).toBeNull();
    // Nothing wakes the room until the time limit: a minute later the alarm has not rung.
    const rang = ctx.alarm.rang;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.alarm.rang).toBe(rang);
    expect(ctx.room.core.activity.kind).toBe("settings");
  });

  it("lets the host change them, checked by the game, saved and shown to everyone", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "settings", v: { pace: 60 } });
    await settle();
    expect(game.calls.settings.at(-1)).toEqual({ pace: 60, rounds: 3, first: "host" });
    expect(ctx.store.get("lobby").choosing.picks).toEqual({ pace: 60, rounds: 3, first: "host" });
    for (const w of [ws.ann, ws.bo, ws.screen]) expect(since(w).at(-1)).toMatchObject({ t: "room", room: { phase: "settings", choosing: { picks: { pace: 60, rounds: 3, first: "host" } } } });
    // Now nine rounds may be chosen: the longer timer allows them.
    say(ws.ann, { t: "settings", v: { rounds: 9, first: "other" } });
    await settle();
    expect(ctx.room.core.activity.picks).toEqual({ pace: 60, rounds: 9, first: "other" });
    expect(refusals(since(ws.ann))).toEqual([]);
  });

  it("refuses settings the game turns down, with the game's own message, and choices that are not on offer", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    const since = from(ws.ann, ws.bo, ws.screen);
    const saved = JSON.stringify(ctx.store.get("lobby"));
    say(ws.ann, { t: "settings", v: { rounds: 9 } });
    await settle();
    expect(since(ws.ann)).toEqual([{ t: "settings-no", error: "too_long", message: "Nine rounds need the longer timer." }]);
    say(ws.ann, { t: "settings", v: { rounds: 7 } });
    say(ws.ann, { t: "settings", v: { colour: "red" } });
    say(ws.ann, { t: "settings", v: "rounds" });
    await settle();
    expect(refusals(since(ws.ann)).map((m) => m.error)).toEqual(["too_long", "bad_setting", "bad_setting", "bad_setting"]);
    expect(refusals(since(ws.ann))[1].message).toBe("That is not a choice for Match length.");
    // Nothing changed, nothing was saved, and nobody else heard a thing.
    expect(ctx.room.core.activity.picks).toEqual({ pace: 30, rounds: 3, first: "host" });
    expect(JSON.stringify(ctx.store.get("lobby"))).toBe(saved);
    expect(since(ws.bo)).toEqual([]);
    expect(since(ws.screen)).toEqual([]);
  });

  it("refuses a player who is not the host, and the big screen, whatever they try", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    const since = from(ws.ann, ws.bo, ws.screen);
    for (const w of [ws.bo, ws.screen]) {
      say(w, { t: "settings", v: { pace: 60 } });
      say(w, { t: "settings-start" });
      say(w, { t: "settings-cancel" });
    }
    await settle();
    for (const w of [ws.bo, ws.screen]) {
      expect(since(w)).toEqual(Array(3).fill({ t: "settings-no", error: "not_host", message: "Only the one who started the party chooses the settings." }));
    }
    expect(since(ws.ann)).toEqual([]);
    expect(ctx.room.core.activity).toMatchObject({ kind: "settings", picks: { pace: 30 } });
    expect(game.calls.created).toEqual([]);
    // Outside the step there is nothing to choose.
    say(ws.ann, { t: "settings-cancel" });
    await settle();
    say(ws.ann, { t: "settings", v: { pace: 60 } });
    await settle();
    expect(refusals(since(ws.ann))).toEqual([{ t: "settings-no", error: "not_choosing", message: "No settings are being chosen." }]);
  });

  it("starts the game with the host's settings when the host taps Start", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    say(ws.ann, { t: "settings", v: { pace: 60, first: "other" } });
    await settle();
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", id: "turns", seats: [0, 1] });
    expect(game.calls.created).toHaveLength(1);
    expect(game.calls.created[0]).toMatchObject({ settings: { pace: 60, rounds: 3, first: "other" }, round: 1 });
    expect(game.calls.created[0].seats.map((s) => s.seat)).toEqual([0, 1]);
    // No carry: the game has none.
    expect(game.calls.created[0]).not.toHaveProperty("carry");
    // The game was made with them: Bo starts, on a sixty-second timer, and everyone heard the start.
    expect(ctx.room.core.activity.state).toMatchObject({ turn: 1, turnMs: 60_000 });
    for (const w of Object.values(ws)) expect(w.messages().find((m) => m.t === "start")).toMatchObject({ room: { phase: "playing", game: { id: "turns", turns: true } } });
    expect(roomOf(ws.screen)).not.toHaveProperty("choosing");
    // Start again, now that the game is on: refused, nothing made twice.
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created).toHaveLength(1);
  });

  it("starts the game with the picks as they stand when its time runs out", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    say(ws.ann, { t: "settings", v: { pace: 60 } });
    await settle();
    await vi.advanceTimersByTimeAsync(SETTINGS_MS - 2000);
    expect(ctx.room.core.activity.kind).toBe("settings");
    await vi.advanceTimersByTimeAsync(3000);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.created[0].settings).toEqual({ pace: 60, rounds: 3, first: "host" });
  });

  it("starts with the defaults when the host never touched them", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    await vi.advanceTimersByTimeAsync(SETTINGS_MS + 1000);
    expect(r.ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.created[0].settings).toEqual({ pace: 30, rounds: 3, first: "host" });
  });

  it("lets the host go back to the room instead: nobody plays, and the pieces are by the door", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    const revs = [0, 1].map((s) => ctx.room.core.members[s].rev);
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "settings-cancel" });
    await settle();
    expect(ctx.room.core.activity).toEqual({ kind: "lobby" });
    expect(game.calls.created).toEqual([]);
    expect(ctx.store.get("lobby").choosing).toBeNull();
    for (const w of [ws.ann, ws.bo, ws.screen]) {
      expect(since(w)).toContainEqual({ t: "note", k: "cancelled", text: "Back to the room. turns did not start." });
      expect(roomOf(w)).toMatchObject({ phase: "lobby" });
      expect(roomOf(w)).not.toHaveProperty("choosing");
    }
    expect([0, 1].map((s) => ctx.room.core.members[s].rev)).toEqual(revs.map((v) => v + 1));
    // The rest after it, as after a game: no count at once, though nobody has moved.
    expect(ctx.room.core.count).toBeNull();
    await vi.advanceTimersByTimeAsync(SETTINGS_MS + 1000);
    expect(game.calls.created).toEqual([]);
  });

  it("is back in the room when a player it was chosen for leaves the party", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    const since = from(ws.ann, ws.screen);
    say(ws.bo, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(since(ws.ann)).toContainEqual({ t: "note", k: "cancelled", text: "Not enough players are left for turns, so it did not start." });
    await vi.advanceTimersByTimeAsync(SETTINGS_MS + 1000);
    expect(game.calls.created).toEqual([]);
  });

  it("carries on through a sleep: the same picks, the same host, and the same time limit", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    say(ws.ann, { t: "settings", v: { pace: 60 } });
    await settle();
    const endsAt = ctx.room.core.activity.endsAt;
    await vi.advanceTimersByTimeAsync(20_000);
    const since = from(ws.ann, ws.bo, ws.screen);
    await r.sleepAndWake();
    // Nobody hears anything for the wake itself.
    for (const w of [ws.ann, ws.bo, ws.screen]) expect(since(w)).toEqual([]);
    expect(ctx.room.core.activity).toMatchObject({ kind: "settings", id: "turns", picks: { pace: 60, rounds: 3, first: "host" }, seats: [0, 1], endsAt });
    expect(ctx.room.core.view(Date.now()).choosing).toMatchObject({ by: 0, picks: { pace: 60 } });
    // The host is still the host, and Bo still is not.
    say(ws.bo, { t: "settings", v: { first: "other" } });
    say(ws.ann, { t: "settings", v: { rounds: 9 } });
    await settle();
    expect(refusals(since(ws.bo)).map((m) => m.error)).toEqual(["not_host"]);
    expect(ctx.room.core.activity.picks).toEqual({ pace: 60, rounds: 9, first: "host" });
    // The alarm set before the sleep still ends the step, on time.
    await vi.advanceTimersByTimeAsync(endsAt - Date.now() - 500);
    expect(ctx.room.core.activity.kind).toBe("settings");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.created[0].settings).toEqual({ pace: 60, rounds: 9, first: "host" });
  });

  it("starts nothing when the hosting allowance is spent at Start", async () => {
    const game = turnGame({ settings: true });
    const env = fakeEnv();
    const r = await choosing(game, { env });
    env.PARTY_ROOM_BUDGET_SHARE = "0.1";
    env.PARTY_BUDGET = { getByName: () => ({ state: async () => "spent", spend: async () => "spent" }) };
    r.say(r.ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created).toEqual([]);
    expect(r.ctx.room.core.activity.kind).toBe("lobby");
    expect(roomOf(r.ws.bo)).toMatchObject({ phase: "lobby", closing: { reason: "budget" } });
  });

  it("refuses to start a game whose settings are not described, and says why in the log", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const game = turnGame({ settings: true });
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const ws = [await connect(ann.token), await connect(bo.token)];
    await expect(voteTo(r, "settings", [ws[0], 0], [ws[1], 1])).rejects.toThrow();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(errors.mock.calls.some(([text]) => /turns cannot start: A game with settings describes them in manifest\.settings/.test(text))).toBe(true);
    errors.mockRestore();
  });
});

describe("a game with no settings", () => {
  it("starts the moment the vote ends, created exactly as before", async () => {
    const game = turnGame();
    const r = await startedIn(createLobbyRoom, game);
    expect(Object.keys(game.calls.created[0]).sort()).toEqual(["now", "round", "seats", "seed"]);
    for (const w of Object.values(r.ws)) expect(w.messages().some((m) => m.room?.phase === "settings" || m.room?.choosing)).toBe(false);
    expect(r.ctx.store.get("lobby")).toMatchObject({ choosing: null, carries: {}, lastSettings: {} });
  });
});

describe("the way back, and a rematch", () => {
  it("keeps the last settings as the first picks when the same game wins the vote again", async () => {
    const game = turnGame({ settings: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    say(ws.ann, { t: "settings", v: { pace: 60, rounds: 9 } });
    await settle();
    say(ws.ann, { t: "settings-start" });
    await settle();
    await annWins(r);
    // The result is on every screen, and the room is the lobby again.
    for (const w of Object.values(ws)) expect(w.messages().find((m) => m.t === "end")).toMatchObject({ room: { phase: "lobby" }, last: { rows: [{ seat: 0, place: 1 }, { seat: 1, place: 2 }] } });
    expect(ctx.store.get("lobby").lastSettings).toEqual({ turns: { pace: 60, rounds: 9, first: "host" } });
    // Through a sleep, too.
    await r.sleepAndWake();
    await voteAgain(r);
    expect(ctx.room.core.activity.picks).toEqual({ pace: 60, rounds: 9, first: "host" });
    expect(roomOf(ws.bo).choosing.picks).toEqual({ pace: 60, rounds: 9, first: "host" });
  });

  it("passes the last match's carry to a rematch of the same two seats: the loser starts", async () => {
    const game = turnGame({ settings: true, carry: true });
    const r = await choosing(game);
    const { ctx, say, ws } = r;
    say(ws.ann, { t: "settings-start" });
    await settle();
    // The first match has nothing to carry from.
    expect(game.calls.created[0].carry).toBeNull();
    const used = Object.values(ctx.room.core.activity.state.secrets);
    await annWins(r);
    // Kept with the room, for the seats and the people in them, and never sent to anyone.
    const kept = ctx.store.get("lobby").carries.turns;
    expect(kept.carry).toEqual({ loser: 1, used });
    for (const w of Object.values(ws)) for (const m of w.messages()) expect(JSON.stringify(m)).not.toContain('"carries"');
    await r.sleepAndWake();
    await voteAgain(r);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created[1].carry).toEqual({ loser: 1, used });
    // Bo lost, so Bo starts, though the settings say the host does; the last draw is avoided.
    expect(ctx.room.core.activity.state).toMatchObject({ turn: 1, avoid: used });
  });

  it("drops the carry when the seats are not the same people", async () => {
    const game = turnGame({ settings: true, carry: true });
    const r = await choosing(game);
    const { ctx, connect, say, ws } = r;
    say(ws.ann, { t: "settings-start" });
    await settle();
    await annWins(r);
    expect(ctx.room.core.carries.turns).toBeDefined();
    // Bo leaves; Cy takes the same seat number. Not a rematch.
    say(ws.bo, { t: "leave" });
    await settle();
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    expect(cy.seat).toBe(1);
    ws.bo = await connect(cy.token);
    await voteAgain(r);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created[1].carry).toBeNull();
    expect(ctx.room.core.carries.turns).toBeUndefined();
    expect(ctx.store.get("lobby").carries).toEqual({});
  });

  it("drops the carry when the game is played by another set of seats", async () => {
    const game = turnGame({ settings: true, carry: true, fields: { maxSeats: 3 } });
    const r = await choosing(game, { players: { min: 2, max: 3 } });
    const { ctx, connect, say, ws } = r;
    say(ws.ann, { t: "settings-start" });
    await settle();
    await annWins(r);
    // Cy joins: the party is three, and so is the next game.
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    ws.cy = await connect(cy.token);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await voteTo(r, "settings", [ws.ann, 0], [ws.bo, 1], [ws.cy, 2]);
    expect(ctx.room.core.activity.seats).toEqual([0, 1, 2]);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created[1].carry).toBeNull();
    expect(game.calls.created[1].seats.map((s) => s.seat)).toEqual([0, 1, 2]);
  });

  it("keeps nothing when carry throws, and still ends the game as usual", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const game = turnGame({ settings: true, carry: true });
    game.carry = () => {
      throw new Error("boom");
    };
    const r = await choosing(game);
    r.say(r.ws.ann, { t: "settings-start" });
    await settle();
    await annWins(r);
    expect(r.ctx.room.core.carries).toEqual({});
    expect(r.ctx.room.core.members[0].points).toBe(3);
    expect(errors.mock.calls.some(([text]) => /carry\(\) failed/.test(text))).toBe(true);
    errors.mockRestore();
  });

  it("carries for a game without settings too: it starts at once, with the carry", async () => {
    const game = turnGame({ carry: true });
    const r = await startedIn(createLobbyRoom, game);
    expect(game.calls.created[0]).toMatchObject({ carry: null });
    expect(game.calls.created[0]).not.toHaveProperty("settings");
    await annWins(r);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await voteIn(r, [r.ws.ann, 0], [r.ws.bo, 1]);
    expect(game.calls.created[1].carry).toMatchObject({ loser: 1 });
  });
});
