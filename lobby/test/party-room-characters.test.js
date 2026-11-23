// Choosing a character and a colour (lobby/shared/characters.js): the check of a choice, the
// room's rules for it (LobbyCore.setLook), and on the real Durable Object class that the choice
// reaches every page and the screen, survives a dropped phone and a rebuilt room, and that a bad
// or unknown one is refused to the page that sent it and changes nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEAT_COLOURS } from "../../party-kit/src/core/room-core.js";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { CHARACTERS, COLOUR_PRESETS, DEFAULT_CHARACTER, LOOK_COOLDOWN_MS, LOOK_SLACK_MS, MIN_LUMINANCE, characterOr, cleanColour, isCharacter, isPale, luminance, readLook } from "../shared/characters.js";
import { boxFromManifest } from "../shared/vote.js";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
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
function seatedRoom(...names) {
  const core = new LobbyCore({ ...wall(), seed: 7, code: "BCDFGH", now: 1000 });
  const tokens = names.map((name) => {
    const joined = core.join(name, 1000);
    core.connect(joined.token, 1000);
    return joined.token;
  });
  return { core, tokens };
}

describe("the list of characters and colours", () => {
  it("has the pawn as the default, then the ghost, the slime and the robot", () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual(["pawn", "ghost", "slime", "robot"]);
    expect(DEFAULT_CHARACTER).toBe("pawn");
    for (const id of ["ghost", "slime", "robot"]) {
      expect(isCharacter(id), id).toBe(true);
      expect(characterOr(id), id).toBe(id);
    }
    for (const bad of ["dragon", "", "Ghost", "Slime", "ROBOT", " robot", null, undefined, 3, {}, ["ghost"], ["slime"], "__proto__", "constructor"]) expect(isCharacter(bad), String(bad)).toBe(false);
    expect(characterOr("dragon")).toBe("pawn");
  });

  it("offers the four seat colours first, and every preset is a colour the room keeps as it is", () => {
    expect(COLOUR_PRESETS.slice(0, 4).map((c) => c.hex)).toEqual(SEAT_COLOURS);
    for (const c of COLOUR_PRESETS) expect(cleanColour(c.hex), c.name).toBe(c.hex);
    expect(new Set(COLOUR_PRESETS.map((c) => c.hex)).size).toBe(COLOUR_PRESETS.length);
  });

  it("takes any six-digit colour, in lower case, and nothing else", () => {
    expect(cleanColour("#AABBCC")).toBe("#aabbcc");
    for (const bad of ["red", "#abc", "#aabbccdd", "aabbcc", "#gggggg", " #aabbcc", "#aabbcc;", "url(x)", "", null, undefined, 0xaabbcc, {}, ["#aabbcc"]]) expect(cleanColour(bad), String(bad)).toBeNull();
  });

  it("lifts a colour too dark to see in the room, and leaves the others alone", () => {
    for (const dark of ["#000000", "#0a0a0a", "#00001f", "#1a0000"]) {
      const lifted = cleanColour(dark);
      expect(luminance(lifted), dark).toBeGreaterThanOrEqual(MIN_LUMINANCE);
      // Lifting again changes nothing: what the room keeps is stable.
      expect(cleanColour(lifted), dark).toBe(lifted);
    }
    expect(cleanColour("#ffffff")).toBe("#ffffff");
    expect(isPale("#f4ead4")).toBe(true);
    expect(isPale("#c8382c")).toBe(false);
  });

  it("reads a choice of one part or both, and says why a bad one is refused", () => {
    expect(readLook({ c: "ghost" })).toEqual({ character: "ghost" });
    expect(readLook({ v: "#3AA9A0" })).toEqual({ colour: "#3aa9a0" });
    expect(readLook({ c: "pawn", v: "#3aa9a0" })).toEqual({ character: "pawn", colour: "#3aa9a0" });
    expect(readLook({ c: "slime", v: "#3aa9a0" })).toEqual({ character: "slime", colour: "#3aa9a0" });
    expect(readLook({ c: "robot" })).toEqual({ character: "robot" });
    expect(readLook({ c: "dragon", v: "#3aa9a0" }).error).toMatch(/character/);
    expect(readLook({ c: "ghost", v: "blue" }).error).toMatch(/colour/);
    expect(readLook({}).error).toBeTruthy();
    expect(readLook(null).error).toBeTruthy();
  });
});

describe("the room's rules for a choice", () => {
  it("starts everyone as a pawn in the seat's colour, and shows the choice in the room view", () => {
    const { core } = seatedRoom("Ann", "Bo");
    expect(core.view(1000).members.slice(0, 2).map((m) => [m.character, m.colour])).toEqual([
      ["pawn", SEAT_COLOURS[0]],
      ["pawn", SEAT_COLOURS[1]],
    ]);
    expect(core.setLook(1, { c: "ghost", v: "#8A5BC4" }, 2000)).toEqual({ ok: true, changed: true });
    expect(core.view(2000).members[1]).toMatchObject({ character: "ghost", colour: "#8a5bc4" });
    expect(core.view(2000).members[0]).toMatchObject({ character: "pawn", colour: SEAT_COLOURS[0] });
  });

  it("lets two players be the same character in the same colour", () => {
    const { core } = seatedRoom("Ann", "Bo");
    expect(core.setLook(0, { c: "ghost", v: "#8a5bc4" }, 2000).ok).toBe(true);
    expect(core.setLook(1, { c: "ghost", v: "#8a5bc4" }, 2000).ok).toBe(true);
    expect(core.view(2000).members.slice(0, 2).map((m) => [m.character, m.colour])).toEqual([
      ["ghost", "#8a5bc4"],
      ["ghost", "#8a5bc4"],
    ]);
  });

  it("changes one part and keeps the other", () => {
    const { core } = seatedRoom("Ann");
    core.setLook(0, { c: "ghost" }, 2000);
    expect(core.members[0]).toMatchObject({ character: "ghost", colour: SEAT_COLOURS[0] });
    core.setLook(0, { v: "#d9619a" }, 3000);
    expect(core.members[0]).toMatchObject({ character: "ghost", colour: "#d9619a" });
  });

  it("takes the slime and the robot by the same rules as the ghost: the cooldown, its slack, a repeat that is no change", () => {
    const { core } = seatedRoom("Ann", "Bo");
    expect(core.setLook(0, { c: "slime", v: "#3aa9a0" }, 2000)).toEqual({ ok: true, changed: true });
    expect(core.setLook(1, { c: "robot" }, 2000)).toEqual({ ok: true, changed: true });
    expect(core.view(2000).members.slice(0, 2).map((m) => [m.character, m.colour])).toEqual([
      ["slime", "#3aa9a0"],
      ["robot", SEAT_COLOURS[1]],
    ]);
    expect(core.setLook(0, { c: "slime" }, 2001)).toEqual({ ok: true, changed: false });
    const early = core.setLook(0, { c: "robot" }, 2000 + LOOK_COOLDOWN_MS - LOOK_SLACK_MS - 1);
    expect(early.ok).toBe(false);
    expect(early.wait).toBe(LOOK_SLACK_MS + 1);
    expect(core.members[0].character).toBe("slime");
    // Inside the slack it is taken; from the slime to the robot to the ghost and back to a pawn.
    expect(core.setLook(0, { c: "robot" }, 2000 + LOOK_COOLDOWN_MS - LOOK_SLACK_MS + 10)).toEqual({ ok: true, changed: true });
    expect(core.setLook(0, { c: "ghost" }, 4000)).toEqual({ ok: true, changed: true });
    expect(core.setLook(0, { c: "pawn" }, 5000)).toEqual({ ok: true, changed: true });
    // Kept through a sleep, as any choice is.
    core.setLook(1, { c: "slime", v: "#8a5bc4" }, 6000);
    const woken = LobbyCore.restore(wall(), structuredClone(JSON.parse(JSON.stringify(core.serialize()))), 7000);
    expect(woken.view(7000).members[1]).toMatchObject({ character: "slime", colour: "#8a5bc4" });
  });

  it("refuses an unknown character or a bad colour and changes nothing, even when the other part is good", () => {
    const { core } = seatedRoom("Ann");
    for (const bad of [{ c: "dragon" }, { c: "dragon", v: "#d9619a" }, { c: "ghost", v: "pink" }, { c: "slime", v: "pink" }, { c: "Robot" }, { c: 7 }, { v: null }, {}, null]) {
      const out = core.setLook(0, bad, 2000);
      expect(out.ok, JSON.stringify(bad)).toBe(false);
      expect(out.why.length).toBeGreaterThan(0);
    }
    expect(core.members[0]).toMatchObject({ character: "pawn", colour: SEAT_COLOURS[0] });
    expect(core.setLook(3, { c: "ghost" }, 2000).ok).toBe(false); // nobody sits there
  });

  it("makes a second change wait a moment, and says a repeat of the same choice is no change", () => {
    const { core } = seatedRoom("Ann");
    expect(core.setLook(0, { c: "ghost" }, 2000)).toEqual({ ok: true, changed: true });
    expect(core.setLook(0, { c: "ghost" }, 2001)).toEqual({ ok: true, changed: false });
    const early = core.setLook(0, { c: "pawn" }, 2000 + LOOK_COOLDOWN_MS - LOOK_SLACK_MS - 1);
    expect(early.ok).toBe(false);
    // It says how long is left of the whole cooldown, so a page that sends it again then is taken.
    expect(early.wait).toBe(LOOK_SLACK_MS + 1);
    expect(core.members[0].character).toBe("ghost");
    expect(core.setLook(0, { c: "pawn" }, 2000 + LOOK_COOLDOWN_MS)).toEqual({ ok: true, changed: true });
  });

  it("takes a change that arrives a little inside the cooldown: the network is never that even", () => {
    const { core } = seatedRoom("Ann");
    // A phone that waited 1060 ms by its own clock, the first message 150 ms on the wire and the second 40 ms.
    core.setLook(0, { c: "ghost" }, 2150);
    expect(core.setLook(0, { v: "#8a5bc4" }, 2150 + 950)).toEqual({ ok: true, changed: true });
    expect(LOOK_SLACK_MS).toBeGreaterThanOrEqual(200);
    expect(LOOK_SLACK_MS).toBeLessThan(LOOK_COOLDOWN_MS / 2);
  });

  it("keeps the choice through a dropped phone and a sleep", () => {
    const { core, tokens } = seatedRoom("Ann", "Bo");
    core.setLook(0, { c: "ghost", v: "#3aa9a0" }, 2000);
    core.disconnect(tokens[0], 3000);
    expect(core.view(3500).members[0]).toMatchObject({ character: "ghost", colour: "#3aa9a0", connected: false });
    core.connect(tokens[0], 4000);
    expect(core.view(4000).members[0]).toMatchObject({ character: "ghost", colour: "#3aa9a0", connected: true });
    const woken = LobbyCore.restore(wall(), structuredClone(JSON.parse(JSON.stringify(core.serialize()))), 5000);
    expect(woken.view(5000).members[0]).toMatchObject({ character: "ghost", colour: "#3aa9a0" });
    expect(woken.view(5000).members[1]).toMatchObject({ character: "pawn", colour: SEAT_COLOURS[1] });
    // After a sleep the next change is not held up by a cooldown that did not survive it.
    expect(woken.setLook(0, { c: "pawn" }, 5000 + LOOK_COOLDOWN_MS).ok).toBe(true);
  });

  it("reads a save from before characters, or one with a character or colour it does not know, as a pawn in the seat's colour", () => {
    const { core } = seatedRoom("Ann", "Bo", "Cy");
    const saved = structuredClone(core.serialize());
    delete saved.members[0].character;
    saved.members[1].character = "dragon";
    saved.members[1].colour = "not a colour";
    saved.members[2].character = "ghost";
    saved.members[2].colour = "#D9619A";
    const woken = LobbyCore.restore(wall(), saved, 5000);
    expect(woken.view(5000).members.slice(0, 3).map((m) => [m.character, m.colour])).toEqual([
      ["pawn", SEAT_COLOURS[0]],
      ["pawn", SEAT_COLOURS[1]],
      ["ghost", "#d9619a"],
    ]);
  });
});

describe("a choice on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  async function party(game = turnGame()) {
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const screen = await ctx.room.join({ as: "screen" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
    await settle();
    return { ...r, ws, tokens: { ann: ann.token, bo: bo.token, screen: screen.token } };
  }
  const lastRoom = (ws) => ws.messages().filter((m) => m.t === "room").at(-1)?.room;
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("carries a player's choice to every phone and to the screen", async () => {
    const { say, ws } = await party();
    say(ws.bo, { t: "look", c: "ghost", v: "#8a5bc4" });
    await settle();
    for (const page of [ws.ann, ws.bo, ws.screen]) {
      expect(lastRoom(page).members[1]).toMatchObject({ character: "ghost", colour: "#8a5bc4" });
      expect(lastRoom(page).members[0]).toMatchObject({ character: "pawn", colour: SEAT_COLOURS[0] });
    }
  });

  it("refuses a bad or unknown choice to the page that sent it only, with what the piece still is", async () => {
    const { ctx, say, ws } = await party();
    const [a, b, s] = mark(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "look", c: "dragon", v: "#8a5bc4" });
    say(ws.bo, { t: "look", c: "ghost", v: "javascript:alert(1)" });
    say(ws.bo, { t: "look" });
    await settle();
    const refusals = since(ws.bo, b).filter((m) => m.t === "look-no");
    expect(refusals).toHaveLength(3);
    for (const no of refusals) expect(no).toMatchObject({ c: "pawn", v: SEAT_COLOURS[1] });
    expect(since(ws.ann, a).filter((m) => m.t === "look-no" || m.t === "room")).toEqual([]);
    expect(since(ws.screen, s).filter((m) => m.t === "look-no" || m.t === "room")).toEqual([]);
    expect(ctx.room.core.members[1]).toMatchObject({ character: "pawn", colour: SEAT_COLOURS[1] });
  });

  it("answers a choice the piece already is to that page alone, so it is not left waiting", async () => {
    const { say, ws } = await party();
    const [a, b, s] = mark(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "look", c: "pawn", v: SEAT_COLOURS[1] });
    await settle();
    expect(since(ws.bo, b).filter((m) => m.t.startsWith("look") || m.t === "room")).toEqual([{ t: "look-ok", c: "pawn", v: SEAT_COLOURS[1] }]);
    expect(since(ws.ann, a).filter((m) => m.t.startsWith("look") || m.t === "room")).toEqual([]);
    expect(since(ws.screen, s).filter((m) => m.t.startsWith("look") || m.t === "room")).toEqual([]);
  });

  it("tells a page that changed too soon how long is left", async () => {
    const { say, ws } = await party();
    say(ws.bo, { t: "look", c: "ghost" });
    await settle();
    const [b] = mark(ws.bo);
    say(ws.bo, { t: "look", v: "#8a5bc4" });
    await settle();
    const no = since(ws.bo, b).find((m) => m.t === "look-no");
    expect(no).toMatchObject({ c: "ghost", v: SEAT_COLOURS[1] });
    expect(no.wait).toBeGreaterThan(LOOK_SLACK_MS);
    expect(no.wait).toBeLessThanOrEqual(LOOK_COOLDOWN_MS);
  });

  it("counts a change sent far too soon against the socket's rate limit, as an emote is, so a script hammering it is closed", async () => {
    const { ctx, say, ws } = await party();
    say(ws.bo, { t: "look", c: "ghost" });
    await settle();
    for (let i = 0; i < 40 && !ws.bo.closed; i++) say(ws.bo, { t: "look", v: i % 2 ? "#8a5bc4" : "#3aa9a0" });
    await settle();
    expect(ws.bo.closed?.reason).toBe("too_fast");
    expect(ws.ann.closed).toBeNull();
    expect(ctx.room.core.members[1]).toBeFalsy();
  });

  it("does not let the screen, which has no piece, choose one", async () => {
    const { ctx, say, ws } = await party();
    const [s] = mark(ws.screen);
    say(ws.screen, { t: "look", c: "ghost" });
    await settle();
    expect(since(ws.screen, s)).toEqual([]);
    expect(ctx.room.core.members.filter(Boolean).map((m) => m.character)).toEqual(["pawn", "pawn"]);
  });

  it("gives a phone that drops and comes back the piece it chose, and tells a page that joins later", async () => {
    const { ctx, say, connect, ws, tokens } = await party();
    say(ws.bo, { t: "look", c: "ghost", v: "#3aa9a0" });
    await settle();
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await settle();
    expect(lastRoom(ws.ann).members[1]).toMatchObject({ character: "ghost", colour: "#3aa9a0", connected: false });
    const back = await connect(tokens.bo);
    await settle();
    expect(lastRoom(back).members[1]).toMatchObject({ character: "ghost", colour: "#3aa9a0", connected: true });
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const late = await connect(cy.token);
    await settle();
    expect(lastRoom(late).members[1]).toMatchObject({ character: "ghost", colour: "#3aa9a0" });
    expect(lastRoom(late).members[2]).toMatchObject({ character: "pawn", colour: SEAT_COLOURS[2] });
  });

  it("keeps the choice when the room is rebuilt over the same storage", async () => {
    const { ctx, say, sleepAndWake, connect, ws, tokens } = await party();
    say(ws.ann, { t: "look", c: "ghost", v: "#d9619a" });
    await settle();
    expect(ctx.store.get("lobby").members[0]).toMatchObject({ character: "ghost", colour: "#d9619a" });
    await sleepAndWake();
    expect(ctx.room.core.members[0]).toMatchObject({ character: "ghost", colour: "#d9619a" });
    const again = await connect(tokens.bo);
    await settle();
    expect(lastRoom(again).members[0]).toMatchObject({ character: "ghost", colour: "#d9619a" });
  });

  it("refuses a change while a game is on, and the seat keeps what it chose before", async () => {
    const r = await party();
    const { ctx, say, ws } = r;
    say(ws.ann, { t: "look", c: "ghost" });
    await settle();
    await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
    await settle();
    const [a] = mark(ws.ann);
    say(ws.ann, { t: "look", c: "pawn" });
    await settle();
    expect(since(ws.ann, a).find((m) => m.t === "look-no")).toMatchObject({ c: "ghost" });
    // The game does not end a seat's choice: it is still a ghost.
    expect(ctx.room.core.members[0].character).toBe("ghost");
  });
});
