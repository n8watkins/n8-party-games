// The party room's rules, driven directly with a fake clock: seats, movement, the vote, the
// count, ties, bumps, coming and going, starting a game, the Tonight board, sleeping and closing.
import { describe, expect, it } from "vitest";
import { IDLE_SHUTDOWN_MS, RECONNECT_GRACE_MS, STALE_ROOM_MS } from "../../party-kit/src/core/room-core.js";
import * as cork from "cork-and-bell";
import { game as coinFlip, FLIP_MS, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { BUDGET_CLOSE_MS, LobbyCore, MAX_ROOM_LIFE_MS } from "../server/lobby-core.js";
import { AWAY_MS, COUNT_MS, SETTLE_MS, TOSS_MS, boxFromManifest } from "../shared/vote.js";
import { BUMP_PUSH, POSITION_SLACK, boxCentre, lightAt, spawnX } from "../shared/world.js";

const duo = { id: "duo", name: "Duo", players: { min: 2, max: 4 }, devices: { phone: true, desktop: true } };
const big = { id: "big", name: "Big", players: { min: 1, max: 4 }, devices: { phone: true, sharedScreen: "required" } };
const soon = { id: "soon", name: "Soon", players: { min: 1, max: 4 }, devices: { phone: true } };

/** A wall of four boxes: Coin Flip (1-4), Duo (2-4), Big (needs a screen), Soon (not built). */
function wall() {
  const boxes = [boxFromManifest(coinFlipManifest, { test: true }), boxFromManifest(duo), boxFromManifest(big), boxFromManifest(soon, { soon: true })];
  const games = new Map([
    ["coin-flip", coinFlip],
    ["duo", coinFlip],
    ["big", coinFlip],
  ]);
  return { boxes, games };
}

function room(now = 1000) {
  return new LobbyCore({ ...wall(), seed: 7, code: "BCDFGH", now });
}

function seated(core, name, now = 1000) {
  const joined = core.join(name, now);
  core.connect(joined.token, now);
  return joined;
}

/** Puts a seat's piece in the middle of box `i`'s light (or at `x`), as its page would say. */
function stand(core, seat, i, now, x = boxCentre(i, core.boxes.length)) {
  const m = core.members[seat];
  // Walk there in steps the room believes.
  let at = m.x;
  while (Math.abs(x - at) > POSITION_SLACK) {
    at += Math.sign(x - at) * POSITION_SLACK;
    core.move(seat, { x: at, d: 0, r: m.rev }, now);
  }
  const moved = core.move(seat, { x, d: 0, r: m.rev }, now);
  core.evaluate(now);
  return moved;
}

describe("joining", () => {
  it("seats up to four players by the door, in the dark, each with a colour", () => {
    const core = room();
    const seats = ["Ann", "Bo", "Cy", "Di"].map((n) => seated(core, n).seat);
    expect(seats).toEqual([0, 1, 2, 3]);
    const view = core.view(1000);
    expect(new Set(view.members.map((m) => m.colour)).size).toBe(4);
    for (const m of view.members) expect(lightAt(m.x, core.boxes.length)).toBe(-1);
    expect(core.join("Eve", 1000)).toMatchObject({ ok: false, error: "room_full" });
  });

  it("cleans nicknames, refuses empty ones and keeps names apart", () => {
    const core = room();
    expect(core.join("   ", 1000)).toMatchObject({ ok: false, error: "bad_name" });
    seated(core, "Ann");
    seated(core, "ann");
    expect(core.view(1000).members.filter(Boolean).map((m) => m.name)).toEqual(["Ann", "ann 2"]);
  });

  it("lets big screens watch without a seat, and never shows a token", () => {
    const core = room();
    const screen = core.watch(1000);
    core.connect(screen.token, 1000);
    const ann = seated(core, "Ann");
    const view = core.view(1000);
    expect(view.screens).toBe(1);
    expect(core.identify(screen.token)).toEqual({ role: "screen", seat: -1 });
    expect(JSON.stringify(view)).not.toContain(ann.token);
    expect(JSON.stringify(view)).not.toContain(screen.token);
  });
});

describe("moving", () => {
  it("relays where a piece is and which way it walks, and works out the rest", () => {
    const core = room();
    seated(core, "Ann");
    const moved = core.move(0, { x: 200, d: 1, r: 0, j: 1 }, 1000);
    expect(moved.relay).toEqual({ t: "m", s: 0, x: 200, d: 1, j: 1 });
    expect(moved.fix).toBeNull();
    // A second later the room knows where the piece has got to without being told.
    expect(core.view(2000).members[0].x).toBe(630);
  });

  it("corrects a piece that claims to be somewhere it could not have reached", () => {
    const core = room();
    seated(core, "Ann");
    const moved = core.move(0, { x: 1700, d: 0, r: 0 }, 1000);
    expect(moved.fix).toMatchObject({ t: "fix", x: spawnX(0, 4), rev: 1 });
    expect(core.members[0].x).toBe(spawnX(0, 4));
    // News sent before the page heard of the correction is out of date and ignored.
    expect(core.move(0, { x: 300, d: 0, r: 0 }, 1010)).toBeNull();
    expect(core.move(0, { x: 300, d: 0, r: 1 }, 1020)).not.toBeNull();
  });

  it("ignores anything that is not a position, and keeps pieces inside the room", () => {
    const core = room();
    seated(core, "Ann");
    for (const bad of [null, {}, { x: "12" }, { x: NaN }, { x: Infinity }]) expect(core.move(0, bad, 1000)).toBeNull();
    expect(core.move(0, { x: -5000, d: -1, r: 0 }, 1000).relay.x).toBeGreaterThanOrEqual(110);
    expect(core.move(3, { x: 300, d: 0, r: 0 }, 1000)).toBeNull();
  });
});

describe("the vote", () => {
  it("starts straight away for a player alone: one light, the count, the game", () => {
    const core = room();
    seated(core, "Ann");
    expect(core.voteView(1000).waiting).toEqual([0]);
    stand(core, 0, 0, 2000);
    const vote = core.voteView(2000);
    expect(vote.standing).toEqual({ 0: "coin-flip" });
    expect(vote.count.endsIn).toBe(COUNT_MS);
    expect(core.nextWake(2000)).toBe(2000 + COUNT_MS);
    expect(core.tick(2000 + COUNT_MS - 1).start).toBeNull();
    expect(core.tick(2000 + COUNT_MS).start).toBe("coin-flip");
  });

  it("waits, by name, for whoever is still in the dark", () => {
    const core = room();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000);
    const vote = core.voteView(2000);
    expect(vote.count).toBeNull();
    expect(vote.waiting).toEqual([1]);
    stand(core, 1, 1, 3000);
    expect(core.voteView(3000).count.endsIn).toBe(COUNT_MS);
  });

  it("pauses when someone steps out of every light, and starts over when they are back", () => {
    const core = room();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000);
    stand(core, 1, 0, 2000);
    expect(core.count).not.toBeNull();
    stand(core, 1, -1, 3000, boxCentre(0, 4) + 200);
    expect(core.count).toBeNull();
    expect(core.tick(2000 + COUNT_MS).start).toBeNull();
    stand(core, 1, 0, 4000);
    expect(core.count.endsAt).toBe(4000 + COUNT_MS);
  });

  it("gives the game to the light with the most players", () => {
    const core = room();
    for (const n of ["Ann", "Bo", "Cy"]) seated(core, n);
    stand(core, 0, 1, 2000);
    stand(core, 1, 0, 2000);
    stand(core, 2, 0, 2000);
    expect(core.voteView(2000).leaders).toEqual(["coin-flip"]);
    expect(core.tick(2000 + COUNT_MS).start).toBe("coin-flip");
  });

  it("settles a tie with a coin toss everybody can watch", () => {
    const core = room();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000);
    stand(core, 1, 1, 2000);
    expect(core.voteView(2000).leaders).toEqual(["coin-flip", "duo"]);
    const out = core.tick(2000 + COUNT_MS);
    expect(out.start).toBeNull();
    const toss = core.voteView(2000 + COUNT_MS).toss;
    expect(toss.between).toEqual(["coin-flip", "duo"]);
    expect(toss.between).toContain(toss.winner);
    expect(toss.endsIn).toBe(TOSS_MS);
    // Stepping out during the toss changes nothing: it is already being decided.
    stand(core, 1, -1, 2000 + COUNT_MS + 100, boxCentre(1, 4) + 150);
    expect(core.toss).not.toBeNull();
    expect(core.tick(2000 + COUNT_MS + TOSS_MS).start).toBe(toss.winner);
  });

  it("switches a light off, and says why, for a game the party cannot play", () => {
    const core = room();
    seated(core, "Ann");
    expect(core.lights()).toEqual({ "coin-flip": null, duo: "Needs 2 players", big: "Needs a big screen", soon: "Coming soon" });
    expect(room().lights()["coin-flip"]).toBe("Needs a player");
    // Standing under a switched-off light is standing in the dark.
    stand(core, 0, 1, 2000);
    expect(core.voteView(2000).standing).toEqual({ 0: null });
    expect(core.count).toBeNull();
    // A second player and a screen switch two of them on.
    seated(core, "Bo", 3000);
    const screen = core.watch(3000);
    core.connect(screen.token, 3000);
    expect(core.lights()).toEqual({ "coin-flip": null, duo: null, big: null, soon: "Coming soon" });
    core.disconnect(screen.token, 4000);
    expect(core.lights().big).toBe("Needs a big screen");
  });

  it("lets someone join in the middle of a count, which waits for them", () => {
    const core = room();
    seated(core, "Ann");
    stand(core, 0, 0, 2000);
    expect(core.count).not.toBeNull();
    seated(core, "Bo", 2500);
    core.evaluate(2500);
    expect(core.count).toBeNull();
    expect(core.voteView(2500).waiting).toEqual([1]);
  });
});

describe("bumps", () => {
  it("nudges the nearest piece in front, weakly, with a cooldown", () => {
    const core = room();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000, 400);
    stand(core, 1, 0, 2000, 460);
    core.move(0, { x: 400, d: 1, r: 0 }, 2000);
    core.move(0, { x: 400, d: 0, r: 0 }, 2000);
    const hit = core.bump(0, 2100);
    expect(hit).toMatchObject({ t: "b", s: 0, to: 1, x: 460 + BUMP_PUSH, rev: 1 });
    expect(core.bump(0, 2200)).toBeNull();
    // Behind the bumper's back nothing is hit.
    core.move(0, { x: 400, d: -1, r: 0 }, 3200);
    core.move(0, { x: 400, d: 0, r: 0 }, 3200);
    expect(core.bump(0, 3300)).toMatchObject({ to: -1 });
  });

  it("can knock a player out of their light, which stops the count", () => {
    const core = room();
    seated(core, "Ann");
    seated(core, "Bo");
    const edge = boxCentre(0, 4) + 100;
    stand(core, 0, 0, 2000, edge - 60);
    stand(core, 1, 0, 2000, edge);
    core.move(0, { x: edge - 60, d: 1, r: 0 }, 2000);
    core.move(0, { x: edge - 60, d: 0, r: 0 }, 2000);
    core.evaluate(2000);
    expect(core.count).not.toBeNull();
    core.bump(0, 2500);
    expect(core.evaluate(2500)).toEqual({ view: true, state: true });
    expect(core.count).toBeNull();
    expect(core.voteView(2500).waiting).toEqual([1]);
  });
});

describe("coming and going", () => {
  it("keeps a dropped phone's piece, grey and still voting, then lets it fade", () => {
    const core = room();
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    stand(core, 0, 0, 2000);
    stand(core, 1, 1, 2000);
    expect(core.count).not.toBeNull();
    core.disconnect(bo.token, 2500);
    // The count starts over without waiting for the dropped player, whose vote still counts.
    expect(core.count).toBeNull();
    core.evaluate(2500);
    const vote = core.voteView(2500);
    expect(vote.waiting).toEqual([]);
    expect(vote.standing).toEqual({ 0: "coin-flip", 1: null }); // Duo needs two connected players
    expect(core.view(2500).members[1]).toMatchObject({ connected: false, name: "Bo" });
    expect(core.count.endsAt).toBe(2500 + COUNT_MS);
    // Back inside the grace: the same seat, the same spot.
    expect(core.connect(bo.token, 3000)).toEqual({ role: "player", seat: 1 });
    expect(core.view(3000).members[1].connected).toBe(true);
    // Gone for good: after the grace the piece fades and a note names who left.
    core.disconnect(bo.token, 4000);
    expect(core.nextWake(4000)).toBeLessThanOrEqual(4000 + RECONNECT_GRACE_MS);
    const out = core.tick(4000 + RECONNECT_GRACE_MS);
    expect(out.changed).toBe(true);
    expect(core.view(4000 + RECONNECT_GRACE_MS).members[1]).toBeNull();
    expect(core.drainNotes()).toEqual([{ k: "left", why: "dropped", name: "Bo", colour: "#2f6f8f" }]);
    expect(core.identify(bo.token)).toBeNull();
    expect(core.identify(ann.token)).toEqual({ role: "player", seat: 0 });
  });

  it("frees the seat at once for someone who leaves on purpose, and restarts the count", () => {
    const core = room();
    seated(core, "Ann");
    const bo = seated(core, "Bo");
    stand(core, 0, 0, 2000);
    stand(core, 1, 0, 2000);
    expect(core.count.endsAt).toBe(2000 + COUNT_MS);
    core.leave(bo.token, 4000);
    core.evaluate(4000);
    expect(core.view(4000).members[1]).toBeNull();
    expect(core.drainNotes()).toMatchObject([{ k: "left", why: "left", name: "Bo" }]);
    expect(core.count.endsAt).toBe(4000 + COUNT_MS);
    expect(core.tick(2000 + COUNT_MS).start).toBeNull();
  });
});

describe("a game and the Tonight board", () => {
  function play(core, at) {
    const started = core.startGame("coin-flip", at);
    expect(started).toMatchObject({ ok: true, ended: null });
    expect(core.view(at).phase).toBe("playing");
    let out = core.gameTick(at + 250);
    expect(out.ended).toBeNull();
    out = core.gameTick(at + FLIP_MS);
    expect(out.events).toMatchObject([{ k: "shown" }]);
    return out.ended;
  }

  it("starts with the party's seats, ends with places, and brings everyone back with 3, 2, 1 points", () => {
    const core = room();
    for (const n of ["Ann", "Bo", "Cy", "Di"]) seated(core, n);
    for (const seat of [0, 1, 2, 3]) stand(core, seat, 0, 2000);
    expect(core.tick(2000 + COUNT_MS).start).toBe("coin-flip");
    const ended = play(core, 5000);
    expect(ended.last.rows.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(ended.last.rows.map((r) => r.points)).toEqual([3, 2, 1, 0]);
    const view = core.view(5000 + FLIP_MS);
    expect(view.phase).toBe("lobby");
    expect(view.tonight.games).toBe(1);
    expect(view.members.map((m) => m.points).sort()).toEqual([0, 1, 2, 3]);
    // Everyone is back by the door, moved there by the room, and no count starts while the result is read.
    for (const m of view.members) expect(m).toMatchObject({ x: spawnX(m.seat, 4), rev: 1 });
    stand(core, 0, 0, 5000 + FLIP_MS + 100);
    expect(core.count).toBeNull();
    expect(core.nextWake(5000 + FLIP_MS + 100)).toBe(5000 + FLIP_MS + SETTLE_MS);
  });

  it("adds up over several games and survives the room sleeping", () => {
    const core = room();
    seated(core, "Ann");
    play(core, 2000);
    play(core, 20000);
    expect(core.view(30000).members[0].points).toBe(6);
    const woken = LobbyCore.restore(wall(), structuredClone(core.serialize()), 40000);
    expect(woken.view(40000)).toMatchObject({ tonight: { games: 2 }, phase: "lobby" });
    expect(woken.view(40000).members[0]).toMatchObject({ points: 6, connected: false });
  });

  it("gives someone who dropped and came back by name their points again", () => {
    const core = room();
    const ann = seated(core, "Ann");
    play(core, 2000);
    core.disconnect(ann.token, 10000);
    core.tick(10000 + RECONNECT_GRACE_MS);
    expect(core.view(50000).members[0]).toBeNull();
    seated(core, "ann", 50000);
    expect(core.view(50000).members[0]).toMatchObject({ name: "ann", points: 3 });
  });

  it("plays a dropped player's seat with the game's own stand-in, and lets late joiners watch", () => {
    const pressed = [];
    const game = { ...coinFlip, bot: (state, seat) => [{ seat }], input: (state, seat, data) => pressed.push([seat, data]) };
    const core = new LobbyCore({ boxes: wall().boxes, games: new Map([["coin-flip", game]]), seed: 1, code: "BCDFGH", now: 1000 });
    seated(core, "Ann");
    const bo = seated(core, "Bo");
    core.startGame("coin-flip", 2000);
    core.disconnect(bo.token, 2100);
    seated(core, "Cy", 2200);
    core.gameTick(2250);
    expect(pressed).toEqual([[1, { seat: 1 }]]);
    expect(core.gameInput(0, { go: 1 }, 2300)).toBe(true);
    expect(core.gameInput(1, { go: 1 }, 2300)).toBe(false);
    expect(core.gameInput(2, { go: 1 }, 2300)).toBe(false);
    const ended = core.gameTick(2000 + FLIP_MS).ended;
    expect(ended.last.rows.map((r) => r.seat).sort()).toEqual([0, 1]);
  });

  it("never gives a newcomer the seat of someone who left in the middle of a game", () => {
    const core = room();
    seated(core, "Ann");
    const bo = seated(core, "Bo");
    core.startGame("coin-flip", 2000);
    core.leave(bo.token, 2100);
    // Seat 1 is free in the room but still has a part in the game: the newcomer gets seat 2.
    expect(seated(core, "Cy", 2200).seat).toBe(2);
    seated(core, "Di", 2200);
    expect(core.join("Eve", 2300)).toMatchObject({ ok: false, error: "room_full", message: "A game is on and its seats are taken. Join when it ends." });
    core.gameTick(2000 + FLIP_MS);
    expect(core.join("Eve", 2000 + FLIP_MS + 10)).toMatchObject({ ok: true, seat: 1 });
  });
});

describe("Cork & Bell through the seam", () => {
  const manifest = cork.manifest;
  /** The site's own wall entry for the hosted game, with the game itself. */
  function corkRoom() {
    const boxes = [boxFromManifest(manifest, { view: manifest.path + manifest.lobby.view })];
    return new LobbyCore({ boxes, games: new Map([[manifest.id, cork.game]]), seed: 21, code: "BCDFGH", now: 1000 });
  }
  /** Runs the room's game loop at the game's own rate until the game ends. A seat fires when `aims` says so. */
  function playOut(core, from, aims = () => null) {
    const step = 1000 / cork.game.tickHz;
    let now = from;
    let ended = null;
    let snapshots = 0;
    const kinds = new Set();
    while (!ended && now < from + 110_000) {
      now += step;
      for (const seat of core.activity.seats) {
        const aim = aims(seat, core.activity.state, now);
        if (aim) core.gameInput(seat, aim, now);
      }
      const out = core.gameTick(now);
      for (const e of out.events) kinds.add(e.k);
      if (out.snapshot) snapshots++;
      ended = out.ended;
    }
    return { ended, now, snapshots, kinds };
  }
  /** The game's own stand-in, used here as a hand on the gun. */
  const botAim = (seat, state, now) => cork.game.bot(state, seat, now)[0] ?? null;

  it("hangs with a sign that reads 1-4 and a light that is on for one player", () => {
    const core = corkRoom();
    expect(core.boxes[0]).toMatchObject({ min: 1, max: 4, url: null, view: "/cork-and-bell/game/party-view.js" });
    expect(core.lights()).toEqual({ "cork-and-bell": "Needs a player" });
    seated(core, "Ann");
    expect(core.lights()).toEqual({ "cork-and-bell": null });
  });

  it("starts a battle for the party's seats, plays ninety seconds, and turns the scores into 3, 2 and 1", () => {
    const core = corkRoom();
    for (const n of ["Ann", "Bo", "Cy", "Di"]) seated(core, n);
    for (const seat of [0, 1, 2, 3]) stand(core, seat, 0, 2000);
    core.evaluate(2000);
    expect(core.tick(2000 + COUNT_MS).start).toBe("cork-and-bell");
    const at = 2000 + COUNT_MS;
    expect(core.startGame("cork-and-bell", at)).toEqual({ ok: true, ended: null });
    expect(core.view(at)).toMatchObject({ phase: "playing", game: { id: "cork-and-bell", name: "Cork & Bell", round: 1 } });
    expect(core.activity.state.seats.map((s) => [s.seat, s.name])).toEqual([[0, "Ann"], [1, "Bo"], [2, "Cy"], [3, "Di"]]);
    // Nothing of the lobby wakes the room while the game is on: the game's own timer does.
    expect(core.nextWake(at)).toBeNull();
    // Three play; Di holds the gun and never fires.
    const { ended, now, snapshots, kinds } = playOut(core, at, (seat, state, t) => (seat === 3 ? null : botAim(seat, state, t)));
    expect((now - at) / 1000).toBeGreaterThan(93);
    expect((now - at) / 1000).toBeLessThan(97);
    expect(snapshots).toBeGreaterThan(150);
    expect([...kinds]).toEqual(expect.arrayContaining(["f", "atk", "time"]));
    const rows = ended.last.rows;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.points)).toEqual([3, 2, 1, 0]);
    expect(rows[3]).toMatchObject({ name: "Di", score: 0 });
    for (let i = 1; i < rows.length; i++) expect(rows[i].score).toBeLessThanOrEqual(rows[i - 1].score);
    expect(ended.result.map((r) => r.seat)).toEqual(rows.map((r) => r.seat));
    const view = core.view(now);
    expect(view).toMatchObject({ phase: "lobby", game: null, tonight: { games: 1 } });
    expect(view.members.map((m) => m.points).sort()).toEqual([0, 1, 2, 3]);
    for (const m of view.members) expect(m).toMatchObject({ x: spawnX(m.seat, 1), rev: 1 });
    // Asleep again: after the rest, the next wake-up is the slow "forgotten room" check.
    expect(core.nextWake(now + SETTLE_MS + 1)).toBe(now + STALE_ROOM_MS);
  });

  it("gives a party of one a round to itself", () => {
    const core = corkRoom();
    seated(core, "Ann");
    stand(core, 0, 0, 2000);
    core.evaluate(2000);
    expect(core.tick(2000 + COUNT_MS).start).toBe("cork-and-bell");
    core.startGame("cork-and-bell", 2000 + COUNT_MS);
    const { ended } = playOut(core, 2000 + COUNT_MS, botAim);
    expect(ended.last.rows).toHaveLength(1);
    expect(ended.last.rows[0]).toMatchObject({ name: "Ann", place: 1, points: 3 });
    expect(ended.last.rows[0].score).toBeGreaterThan(0);
  });

  it("plays a dropped player's stall with the game's own stand-in until they are back", () => {
    const core = corkRoom();
    seated(core, "Ann");
    const bo = seated(core, "Bo");
    core.startGame("cork-and-bell", 2000);
    core.disconnect(bo.token, 2100);
    const { ended } = playOut(core, 2000);
    // Ann never fired; Bo was away for the whole round and the stand-in scored for the seat.
    const [first, second] = ended.last.rows;
    expect(first).toMatchObject({ seat: 1, place: 1 });
    expect(first.score).toBeGreaterThan(0);
    expect(second).toMatchObject({ seat: 0, score: 0 });
  });
});

describe("an outside game", () => {
  const away = { id: "away", name: "Away", players: { min: 2, max: 2 }, devices: { phone: true, desktop: false }, url: "https://away.example/" };
  /** Coin Flip and a game that plays on a site of its own, for exactly two. */
  function outsideRoom() {
    const boxes = [boxFromManifest(coinFlipManifest, { test: true }), boxFromManifest(away)];
    return new LobbyCore({ boxes, games: new Map([["coin-flip", coinFlip]]), seed: 7, code: "BCDFGH", now: 1000 });
  }

  it("has its light on only for a party of the size it takes", () => {
    const core = outsideRoom();
    seated(core, "Ann");
    expect(core.lights().away).toBe("Needs 2 players");
    seated(core, "Bo");
    expect(core.lights().away).toBeNull();
    seated(core, "Cy");
    expect(core.lights().away).toBe("For 2 players");
  });

  it("sends everyone to its own site when it wins the count: no game, no points, pieces back by the door", () => {
    const core = outsideRoom();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 1, 2000);
    stand(core, 1, 1, 2000);
    core.evaluate(2000);
    expect(core.count).not.toBeNull();
    const out = core.tick(2000 + COUNT_MS);
    expect(out).toMatchObject({ start: null, close: null, changed: true, away: { id: "away", name: "Away", url: "https://away.example/", in: AWAY_MS } });
    const view = core.view(2000 + COUNT_MS);
    expect(view).toMatchObject({ phase: "lobby", game: null, last: null, tonight: { games: 0 } });
    expect(view.members.filter(Boolean).map((m) => m.points)).toEqual([0, 0]);
    for (const m of view.members.filter(Boolean)) expect(m).toMatchObject({ x: spawnX(m.seat, 2), rev: 1 });
    expect(core.round).toBe(0);
    // Whoever stays is not sent off again the moment they step back into the light.
    stand(core, 0, 1, 2000 + COUNT_MS + 100);
    stand(core, 1, 1, 2000 + COUNT_MS + 100);
    core.evaluate(2000 + COUNT_MS + 200);
    expect(core.count).toBeNull();
    expect(core.nextWake(2000 + COUNT_MS + 200)).toBe(2000 + COUNT_MS + AWAY_MS + SETTLE_MS);
  });

  it("is sent to when it wins the toss as well", () => {
    const core = outsideRoom();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000);
    stand(core, 1, 1, 2000);
    core.evaluate(2000);
    core.tick(2000 + COUNT_MS);
    core.toss.winner = "away";
    expect(core.tick(2000 + COUNT_MS + TOSS_MS)).toMatchObject({ start: null, away: { id: "away" } });
  });

  it("leaves the room to empty and close by the usual rule once the pages have gone", () => {
    const core = outsideRoom();
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    stand(core, 0, 1, 2000);
    stand(core, 1, 1, 2000);
    core.evaluate(2000);
    const at = 2000 + COUNT_MS;
    core.tick(at);
    core.disconnect(ann.token, at + AWAY_MS);
    core.disconnect(bo.token, at + AWAY_MS);
    expect(core.tick(at + AWAY_MS + IDLE_SHUTDOWN_MS - 1).close).toBeNull();
    expect(core.tick(at + AWAY_MS + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });
});

describe("a dropped toss", () => {
  it("does not start a game the party can no longer play when the toss ends", () => {
    const core = room();
    seated(core, "Ann");
    const bo = seated(core, "Bo");
    stand(core, 0, 0, 2000);
    stand(core, 1, 1, 2000);
    core.tick(2000 + COUNT_MS);
    core.toss.winner = "duo";
    core.leave(bo.token, 2000 + COUNT_MS + 500);
    expect(core.tick(2000 + COUNT_MS + TOSS_MS)).toMatchObject({ start: null, changed: true });
    expect(core.toss).toBeNull();
  });
});

describe("sleeping and closing", () => {
  it("asks to be woken only for what is due: nothing for hours when people just stand around", () => {
    const core = room();
    seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000);
    // One in a light, one in the dark, nobody moving: the next wake-up is the twenty-minute "forgotten" check.
    expect(core.nextWake(3000)).toBe(2000 + STALE_ROOM_MS);
    expect(core.tick(2000 + STALE_ROOM_MS - 1).close).toBeNull();
    expect(core.tick(2000 + STALE_ROOM_MS).close).toBe("stale");
  });

  it("closes a minute after the last person goes", () => {
    const core = room();
    const ann = seated(core, "Ann");
    core.disconnect(ann.token, 5000);
    expect(core.nextWake(5000)).toBe(5000 + RECONNECT_GRACE_MS);
    core.tick(5000 + RECONNECT_GRACE_MS);
    expect(core.tick(5000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });

  it("still closes a minute after the last person went when it was put to sleep in between", () => {
    const core = room();
    const ann = seated(core, "Ann");
    core.disconnect(ann.token, 5000);
    core.tick(5000 + RECONNECT_GRACE_MS);
    // An empty room is put to sleep within seconds and woken by its alarm: the minute is counted
    // from when it emptied, not from each waking (which would keep it for twenty minutes, waking every one).
    const woken = LobbyCore.restore(wall(), structuredClone(core.serialize()), 5000 + IDLE_SHUTDOWN_MS);
    expect(woken.tick(5000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
    // A room saved while people were in it, and woken with nobody (a restart): empty from the waking.
    const busy = room();
    seated(busy, "Bo");
    const restarted = LobbyCore.restore(wall(), structuredClone(busy.serialize()), 90_000);
    expect(restarted.tick(90_000 + IDLE_SHUTDOWN_MS - 1).close).toBeNull();
    expect(restarted.tick(90_000 + IDLE_SHUTDOWN_MS).close).toBe("empty");
  });

  it("closes when it reaches its longest life, but not in the middle of a game", () => {
    const core = room();
    seated(core, "Ann");
    const end = 1000 + MAX_ROOM_LIFE_MS;
    core.move(0, { x: 200, d: 0, r: 0 }, end - 5000);
    expect(core.view(end - 5000).closesIn).toBe(5000);
    core.startGame("coin-flip", end - 1000);
    expect(core.tick(end + 10).close).toBeNull();
    core.gameTick(end + FLIP_MS);
    expect(core.tick(end + FLIP_MS + 1).close).toBe("expired");
  });

  it("is told when the hosting allowance is spent: no new game, and it closes a few minutes later", () => {
    const core = room();
    seated(core, "Ann");
    stand(core, 0, 0, 2000);
    expect(core.tick(2000 + COUNT_MS).start).toBe("coin-flip");
    core.refuseStart(5100);
    core.move(0, { x: boxCentre(0, 4), d: 0, r: 0 }, 5200);
    core.evaluate(5200);
    expect(core.count).toBeNull();
    expect(core.view(5200).closing).toEqual({ in: BUDGET_CLOSE_MS - 100, reason: "budget" });
    expect(core.nextWake(5200)).toBe(5100 + BUDGET_CLOSE_MS);
    expect(core.tick(5100 + BUDGET_CLOSE_MS).close).toBe("budget");
  });

  it("wakes with every piece where its socket last put it", () => {
    const core = room();
    const ann = seated(core, "Ann");
    seated(core, "Bo");
    stand(core, 0, 0, 2000);
    const saved = structuredClone(core.serialize());
    // After the save Ann walked on; only her socket knows.
    core.move(0, { x: 700, d: 0, r: 0 }, 3000);
    const piece = core.pieceOf(0);
    const woken = LobbyCore.restore(wall(), saved, 60000);
    expect(woken.resume(ann.token, piece)).toEqual({ role: "player", seat: 0 });
    const view = woken.view(60000);
    expect(view.members[0]).toMatchObject({ x: 700, connected: true });
    expect(view.members[1]).toMatchObject({ connected: false });
  });
});
