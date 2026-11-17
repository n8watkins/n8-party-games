// A game for fewer seats than the party, with the rest as its audience (W6: KR-12 and the
// audience), proved on the real Durable Object class. A party of four votes for a two-seat game
// that takes an audience (`manifest.audience`); its players are chosen on two spots (lights on the
// wall), the first pieces to stand on them; the host starts it when both are taken. Each of the
// four roles gets its own frames: a player sees the other's secret and never its own, the audience
// sees both, the big screen neither. Only the players play, place and hold the game up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_FRAME, dropFakeRuntime, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
import { SETTINGS_FIELDS, from, spotsFor4, standOn, stepOff, turnGame } from "./turn-game.js";
import { SETTINGS_MS } from "../server/lobby-core.js";
import { SETTLE_MS } from "../shared/vote.js";
import { voteTo } from "./fake-room.js";
import * as corkAndBell from "cork-and-bell";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const spots = (game, opts) => spotsFor4(createLobbyRoom, game, opts);
const roomOf = (ws) => ws.messages().filter((m) => m.room).at(-1)?.room;
const refusals = (msgs) => msgs.filter((m) => m.t === "settings-no");
/** The game frames a socket got from `since` on, as raw text, the way they went down the wire. */
const gameText = (msgs) => msgs.filter((m) => GAME_FRAME.test(JSON.stringify(m))).map((m) => JSON.stringify(m)).join("\n");

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

/** Ann (seat 0) and Bo (seat 1) take the spots and Ann starts: Cy and Di are the audience. */
async function annAndBo(r) {
  await standOn(r, r.ws.ann, 0, 0);
  await standOn(r, r.ws.bo, 1, 1);
  expect(r.ctx.room.core.activity.seats).toEqual([0, 1]);
  r.say(r.ws.ann, { t: "settings-start" });
  await settle();
  expect(r.ctx.room.core.activity.kind).toBe("game");
  const state = r.ctx.room.core.activity.state;
  return { s0: state.secrets[0], s1: state.secrets[1] };
}

/** Checks each role's frames for the two secrets: `text` maps a socket to the text it was sent. */
function expectRoles(r, { s0, s1 }, text, { cy = true, di = true } = {}) {
  const t = (who) => text(r.ws[who]);
  // A player never gets its own secret, and gets the other's.
  expect(t("ann")).not.toContain(s0);
  expect(t("ann")).toContain(s1);
  expect(t("bo")).not.toContain(s1);
  expect(t("bo")).toContain(s0);
  // The audience gets both; the big screen neither.
  for (const [who, on] of [["cy", cy], ["di", di]]) {
    if (!on) continue;
    expect(t(who)).toContain(s0);
    expect(t(who)).toContain(s1);
  }
  expect(t("screen")).not.toContain(s0);
  expect(t("screen")).not.toContain(s1);
}

describe("a two-seat game voted for by a party of four", () => {
  it("keeps its light on for the four, and chooses its players on two spots, which the host starts once both are taken", async () => {
    const game = turnGame();
    const r = await spots(game);
    const { ctx, say, ws } = r;
    const core = ctx.room.core;
    // The game was not created: the room is choosing its players on two spots, the game's own light and the next.
    expect(game.calls.created).toEqual([]);
    expect(core.activity).toMatchObject({ kind: "settings", id: "turns", seats: [], spots: [{ place: "turns", seat: null }, { place: "spare-0", seat: null }] });
    for (const w of Object.values(ws)) expect(roomOf(w)).toMatchObject({ phase: "settings", choosing: { id: "turns", seats: [], spots: [{ place: "turns", seat: null }, { place: "spare-0", seat: null }], by: 0, fields: [] } });
    // The spots are the only lights on; everyone starts again in the dark, by the door.
    expect(roomOf(ws.screen).vote.lights).toEqual({ turns: null, "spare-0": null, "spare-1": "" });
    expect(Object.values(core.standing(Date.now()))).toEqual([null, null, null, null]);
    expect(ctx.alarm.at).toBe(core.activity.endsAt);

    const since = from(ws.ann, ws.bo, ws.cy, ws.screen);
    // Nobody may start with a spot empty: not the host, and nobody but the host at all.
    say(ws.ann, { t: "settings-start" });
    say(ws.bo, { t: "settings-start" });
    await settle();
    expect(refusals(since(ws.ann))).toMatchObject([{ error: "spots_open" }]);
    expect(refusals(since(ws.bo))).toMatchObject([{ error: "not_host" }]);
    expect(core.activity.kind).toBe("settings");

    // Cy stands on the first spot first: it is hers, and everyone sees it.
    await standOn(r, ws.cy, 2, 0);
    expect(core.activity.spots.map((s) => s.seat)).toEqual([2, null]);
    expect(roomOf(ws.screen).choosing).toMatchObject({ seats: [2], spots: [{ seat: 2 }, { seat: null }] });
    // Bo comes to the same spot: Cy keeps it. With one spot empty the host still cannot start.
    await standOn(r, ws.bo, 1, 0);
    expect(core.activity.spots.map((s) => s.seat)).toEqual([2, null]);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(refusals(since(ws.ann)).at(-1)).toMatchObject({ error: "spots_open" });
    // Bo goes on to the second spot. Then Cy steps off, which frees hers, and Ann takes it.
    await standOn(r, ws.bo, 1, 1);
    expect(core.activity.spots.map((s) => s.seat)).toEqual([2, 1]);
    await stepOff(r, ws.cy, 2, 0);
    expect(core.activity.spots.map((s) => s.seat)).toEqual([null, 1]);
    expect(roomOf(ws.screen).choosing.spots.map((s) => s.seat)).toEqual([null, 1]);
    await standOn(r, ws.ann, 0, 0);
    expect(core.activity.spots.map((s) => s.seat)).toEqual([0, 1]);
    expect(ctx.store.get("lobby").choosing.spots.map((s) => s.seat)).toEqual([0, 1]);

    // Bo may not start it even now; the host does, and the game has exactly the two on the spots.
    say(ws.bo, { t: "settings-start" });
    await settle();
    expect(refusals(since(ws.bo)).at(-1)).toMatchObject({ error: "not_host" });
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    expect(game.calls.created).toHaveLength(1);
    expect(game.calls.created[0].seats.map((s) => [s.seat, s.name])).toEqual([
      [0, "Ann"],
      [1, "Bo"],
    ]);
    // A game without settings gets no `settings` in its context, exactly as before.
    expect(game.calls.created[0]).not.toHaveProperty("settings");
    // Every page knows who plays and that the rest watch.
    expect(roomOf(ws.cy).game).toMatchObject({ id: "turns", seats: [0, 1], audience: true, turns: true });
  });

  it("lets a dropped piece's spot go, goes back to the room when time runs out with a spot empty, and starts by itself when both are taken", async () => {
    const r = await spots(turnGame());
    const { ctx, ws } = r;
    const core = ctx.room.core;
    await standOn(r, ws.cy, 2, 0);
    // Cy's phone drops: her spot is free again.
    ctx.room.webSocketClose(ws.cy, 1006, "");
    await settle();
    expect(core.activity.spots.map((s) => s.seat)).toEqual([null, null]);
    await standOn(r, ws.di, 3, 1);
    // Time is up with one spot empty: nobody plays, everyone hears why and is back in the room.
    await vi.advanceTimersByTimeAsync(SETTINGS_MS);
    expect(core.activity.kind).toBe("lobby");
    expect(ws.ann.messages().filter((m) => m.t === "note" && m.k === "cancelled")).toMatchObject([{ text: "Nobody took every spot, so turns did not start." }]);

    // The next time both spots are taken, the time limit starts the game with the two on them.
    const again = await spotsAgain(r);
    await standOn(again, ws.bo, 1, 0);
    await standOn(again, ws.di, 3, 1);
    await vi.advanceTimersByTimeAsync(SETTINGS_MS);
    expect(core.activity).toMatchObject({ kind: "game", seats: [1, 3] });
  });

  it("plays exactly the people everyone saw on the spots: one who leaves frees hers, and a newcomer in her seat plays only by standing on one", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    const core = ctx.room.core;
    await standOn(r, ws.ann, 0, 0);
    await standOn(r, ws.di, 3, 1);
    const since = from(ws.ann);
    // Di leaves the party: her spot is free at once, and Start is refused.
    say(ws.di, { t: "leave" });
    await settle();
    expect(core.activity.spots.map((s) => s.seat)).toEqual([0, null]);
    expect(core.serialize().choosing.players).toEqual({ 0: r.tokens.ann });
    // Ed joins in her seat: he is not on a spot, so he does not play.
    const ed = await ctx.room.join({ nickname: "Ed", as: "player" });
    expect(ed.seat).toBe(3);
    const edWs = await r.connect(ed.token);
    await settle();
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(refusals(since(ws.ann)).at(-1)).toMatchObject({ error: "spots_open" });
    // Once he stands on the free spot, everyone sees him there, and he plays.
    await standOn(r, edWs, 3, 1);
    expect(roomOf(ws.screen).choosing.spots.map((s) => s.seat)).toEqual([0, 3]);
    // Tokens never reach a page.
    expect(ws.screen.text()).not.toContain(ed.token);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(core.activity).toMatchObject({ kind: "game", seats: [0, 3] });
    expect(core.activity.names).toEqual({ 0: "Ann", 3: "Ed" });
  });

  it("keeps the spots and who stands on them through a sleep", async () => {
    const r = await spots(turnGame());
    await standOn(r, r.ws.cy, 2, 1);
    await r.sleepAndWake();
    const core = r.ctx.room.core;
    expect(core.activity).toMatchObject({ kind: "settings", seats: [2], spots: [{ seat: null }, { seat: 2 }] });
    await standOn(r, r.ws.di, 3, 0);
    r.say(r.ws.ann, { t: "settings-start" });
    await settle();
    expect(core.activity).toMatchObject({ kind: "game", seats: [2, 3] });
  });

  it("goes through the game's settings and the spots in one step, and with no more members than seats everyone plays with no spots", async () => {
    const game = turnGame({ settings: true });
    const r = await spots(game, { manifest: { settings: SETTINGS_FIELDS } });
    const { say, ws, ctx } = r;
    expect(roomOf(ws.di).choosing).toMatchObject({ picks: { pace: 30 }, spots: [{ seat: null }, { seat: null }] });
    say(ws.ann, { t: "settings", v: { pace: 60 } });
    await settle();
    await standOn(r, ws.ann, 0, 0);
    await standOn(r, ws.di, 3, 1);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 3] });
    expect(game.calls.created.at(-1).settings).toMatchObject({ pace: 60 });

    // A party of exactly two votes the same game: the settings step as before, with no spots.
    const two = await openRoom(createLobbyRoom, turnGame({ settings: true }), { more: 2, manifest: { audience: true, settings: SETTINGS_FIELDS } });
    two.ctx.keepAlive = true;
    const ann = await two.ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await two.ctx.room.join({ nickname: "Bo", as: "player" });
    const w = { ann: await two.connect(ann.token), bo: await two.connect(bo.token) };
    await voteTo(two, "settings", [w.ann, 0], [w.bo, 1]);
    expect(two.ctx.room.core.activity.seats).toEqual([0, 1]);
    expect(two.ctx.room.core.activity).not.toHaveProperty("spots");
    expect(roomOf(w.bo).choosing).not.toHaveProperty("spots");

    // And a game with no settings starts the moment the vote ends.
    const plain = await openRoom(createLobbyRoom, turnGame(), { more: 2, manifest: { audience: true } });
    plain.ctx.keepAlive = true;
    const a = await plain.ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const b = await plain.ctx.room.join({ nickname: "Bo", as: "player" });
    await voteIn(plain, [await plain.connect(a.token), 0], [await plain.connect(b.token), 1]);
    expect(plain.ctx.room.core.activity.seats).toEqual([0, 1]);
  });
});

describe("the audience", () => {
  it("gets both secrets, the players each the other's, the big screen neither, in raw frames, also after a rebuild of the room; a member who joins after the start gets neither", async () => {
    const game = turnGame({ own: true, presence: true });
    const r = await spots(game);
    const { ctx, say, ws } = r;
    const secrets = await annAndBo(r);
    // Every frame since the room began, as sent.
    expectRoles(r, secrets, (w) => w.text());
    // Each socket's own viewer: two players, two of the audience, a screen.
    const core = ctx.room.core;
    expect([0, 1, 2, 3].map((seat) => core.viewerOf({ role: "player", seat }))).toEqual([
      { role: "player", seat: 0 },
      { role: "player", seat: 1 },
      { role: "audience", seat: 2 },
      { role: "audience", seat: 3 },
    ]);
    expect(core.viewerOf({ role: "screen", seat: -1 })).toEqual({ role: "screen" });

    // The room is rebuilt mid-match (an eviction, a deploy): the same roles, frame for frame.
    await r.sleepAndWake();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    const since = from(...Object.values(ws));
    say(ws.ann, { t: "in", d: { say: "is it a dog?" } });
    await settle();
    say(ws.bo, { t: "in", d: { say: "no" } });
    await settle();
    expectRoles(r, secrets, (w) => gameText(since(w)));
    for (const w of Object.values(ws)) expect(since(w).some((m) => m.t === "snap")).toBe(true);

    // Di leaves the party; Ed joins in her seat while the match is on: he joined mid-match, so he
    // watches it as the big screen does, with neither secret (party-room-late-joiners.test.js).
    const told = game.calls.presence.length;
    say(ws.di, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("game");
    const ed = await ctx.room.join({ nickname: "Ed", as: "player" });
    expect(ed.seat).toBe(3);
    const edWs = await r.connect(ed.token);
    await settle();
    expect(ctx.room.core.viewerOf({ role: "player", seat: 3 })).toEqual({ role: "screen", seat: 3 });
    expect(edWs.text()).not.toContain(secrets.s0);
    expect(edWs.text()).not.toContain(secrets.s1);
    // Neither her leaving nor his coming was the game's business.
    expect(game.calls.presence.slice(told).filter((c) => c.seat >= 2)).toEqual([]);
  });

  it("cannot play: an input from the audience is refused and changes nothing", async () => {
    const game = turnGame();
    const r = await spots(game);
    const { ctx, say, ws } = r;
    await annAndBo(r);
    const inputs = game.calls.input;
    const saved = JSON.stringify(ctx.store.get("lobby").game);
    const since = from(ws.ann, ws.cy);
    say(ws.cy, { t: "in", d: { say: "it's a dog", win: true }, id: "cy-1" });
    await settle();
    expect(since(ws.cy)).toEqual([{ t: "error", id: "cy-1", error: "not_in_game", message: "That seat is not playing this game." }]);
    expect(since(ws.ann)).toEqual([]);
    expect(game.calls.input).toBe(inputs);
    expect(JSON.stringify(ctx.store.get("lobby").game)).toBe(saved);
  });

  it("does not place: only the players get points on the Tonight board", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    await annAndBo(r);
    say(ws.ann, { t: "in", d: { say: "got it", win: true } });
    await settle();
    const core = ctx.room.core;
    expect(core.activity.kind).toBe("lobby");
    expect(core.last.rows.map((row) => [row.seat, row.place, row.points])).toEqual([
      [0, 1, 3],
      [1, 2, 2],
    ]);
    expect(core.members.map((m) => m.points)).toEqual([3, 2, 0, 0]);
    expect(core.history.at(-1)).toMatchObject({ winners: [{ name: "Ann" }] });
    const end = ws.di.messages().find((m) => m.t === "end");
    expect(end.last.rows.map((row) => row.seat)).toEqual([0, 1]);
    expect(end.room.tonight).toMatchObject({ games: 1 });
  });

  it("can drop, hide its page or leave without the game hearing of it; a player who leaves ends the match", async () => {
    const game = turnGame({ presence: true });
    const r = await spots(game);
    const { ctx, say, ws } = r;
    await annAndBo(r);
    const state = () => JSON.stringify(ctx.room.core.activity.state);
    const before = state();
    const told = game.calls.presence.length;
    const sent = from(ws.ann, ws.bo);
    // Cy hides her page, Di's phone drops, Cy leaves the party.
    say(ws.cy, { t: "away" });
    await settle();
    ctx.room.webSocketClose(ws.di, 1006, "");
    await settle();
    say(ws.cy, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    expect(state()).toBe(before);
    expect(game.calls.presence.slice(told)).toEqual([]);
    expect([...sent(ws.ann), ...sent(ws.bo)].filter((m) => GAME_FRAME.test(JSON.stringify(m)))).toEqual([]);
    // Bo leaves for good: the match ends there, with a note.
    say(ws.bo, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ws.ann.messages().filter((m) => m.t === "note").at(-1)).toMatchObject({ k: "ended", why: "left", seat: 1, name: "Bo" });
  });

  it("never gets a player's away treatment: a hidden audience page that goes silent is closed as any silent socket is", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    await annAndBo(r);
    // Bo (a player) and Cy (the audience) hide their pages; their keep-alives stop.
    say(ws.bo, { t: "away" });
    say(ws.cy, { t: "away" });
    await settle();
    ctx.keepAlive = false;
    await vi.advanceTimersByTimeAsync(26_000);
    // Something wakes the room: Ann takes her turn, and the room looks for silent sockets.
    say(ws.ann, { t: "in", d: { say: "is it a dog?" } });
    await settle();
    // The player is given the game's grace; the audience member is not.
    expect(ws.bo.closed).toBeNull();
    expect(ws.cy.closed).toMatchObject({ reason: "silent" });
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
  });

  it("does not take a rematch's carry: it follows the two seats on the spots", async () => {
    const game = turnGame({ carry: true });
    const r = await spots(game);
    const { ctx, say, ws } = r;
    await annAndBo(r);
    say(ws.ann, { t: "in", d: { say: "got it", win: true } });
    await settle();
    expect(ctx.room.core.carries.turns.seats).toBeTruthy();
    // The same two take the spots again: the carry is theirs.
    const again = await spotsAgain(r);
    await standOn(again, ws.bo, 1, 0);
    await standOn(again, ws.ann, 0, 1);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created.at(-1).carry).toMatchObject({ loser: 1 });
    // Bo wins this one; then Ann and Cy take the spots: other seats, no carry.
    say(ws.bo, { t: "in", d: { say: "got it", win: true } });
    await settle();
    const third = await spotsAgain(r);
    await standOn(third, ws.ann, 0, 0);
    await standOn(third, ws.cy, 2, 1);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(game.calls.created.at(-1).carry).toBeNull();
  });
});

describe("without the opt-in", () => {
  it("a two-seat game keeps its light off for a party of three, and a member who joins after the start watches as a screen", async () => {
    const game = turnGame();
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token), cy: await connect(cy.token) };
    await settle();
    expect(roomOf(ws.ann).vote.lights).toEqual({ turns: "For 2 players" });
    // Cy goes; Ann and Bo play; Cy comes back mid-game and only watches, as a screen.
    r.say(ws.cy, { t: "leave" });
    await settle();
    await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
    await settle();
    const s = ctx.room.core.activity.state.secrets;
    const late = await ctx.room.join({ nickname: "Cy", as: "player" });
    const cyWs = await connect(late.token);
    await settle();
    expect(ctx.room.core.viewerOf({ role: "player", seat: late.seat })).toEqual({ role: "screen", seat: late.seat });
    expect(cyWs.text()).not.toContain(s[0]);
    expect(cyWs.text()).not.toContain(s[1]);
    expect(cyWs.messages().find((m) => m.t === "snap").s).toMatchObject({ screen: true });
    // The room view's game says nothing of seats or an audience.
    expect(roomOf(cyWs).game).toEqual({ id: "turns", name: "turns", round: 1, turns: true });
  });

  it("Cork & Bell with four players starts at once, every phone a player, as before", async () => {
    const r = await openRoom(createLobbyRoom, corkAndBell.game, { players: corkAndBell.manifest.players, manifest: corkAndBell.manifest });
    const { ctx, connect } = r;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" })];
    for (const nickname of ["Bo", "Cy", "Di"]) tokens.push(await ctx.room.join({ nickname, as: "player" }));
    const screen = await ctx.room.join({ as: "screen" });
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    const screenWs = await connect(screen.token);
    expect(roomOf(screenWs).vote.lights["cork-and-bell"]).toBeNull();
    await voteIn(r, ...ws.map((w, seat) => [w, seat]));
    const core = ctx.room.core;
    expect(core.activity).toMatchObject({ kind: "game", id: "cork-and-bell", seats: [0, 1, 2, 3] });
    expect(core.activity).not.toHaveProperty("spots");
    expect([0, 1, 2, 3].map((seat) => core.viewerOf({ role: "player", seat }).role)).toEqual(["player", "player", "player", "player"]);
    expect(roomOf(screenWs).game).toEqual({ id: "cork-and-bell", name: "Cork & Bell", round: 1 });
    expect(r.wall.boxes[0]).not.toHaveProperty("audience");
    expect(r.wall.boxes[0]).not.toHaveProperty("upright");
    expect(ctx.room.timer).not.toBeNull();
    ctx.room.stopTimer();
  });
});

describe("an upright game", () => {
  it("says so in the room view's game, from its manifest's devices", async () => {
    const r = await spots(turnGame(), { manifest: { devices: { phone: true, desktop: false, upright: true } } });
    await annAndBo(r);
    expect(roomOf(r.ws.cy).game).toMatchObject({ upright: true, audience: true, seats: [0, 1] });
  });
});

/** Waits out the rest after a game (or a cancelled step) and votes the game in again, up to its spots. */
async function spotsAgain(r) {
  await vi.advanceTimersByTimeAsync(SETTLE_MS);
  const players = [
    [r.ws.ann, 0],
    [r.ws.bo, 1],
    [r.ws.cy, 2],
    [r.ws.di, 3],
  ].filter(([w, seat]) => r.ctx.room.core.members[seat]?.connected && !w.closed);
  await voteTo(r, "settings", ...players);
  await settle();
  expect(r.ctx.room.core.activity.spots).toBeTruthy();
  return r;
}
