// One party, two waiting rooms: the room's mode, driven directly with a fake clock. Who may switch
// the party, every moment a switch is refused, what a switch does to the vote, the vote doing
// nothing in the plain room, the mode in the room view, and a room saved before modes.
// The page side's small rules (where to go, the loop guard) are at the end.
import { describe, expect, it } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { DROP_FADE_MS, HOST_GRACE_MS, LobbyCore, TABLE_STALE_MS } from "../server/lobby-core.js";
import { STALE_ROOM_MS } from "../../party-kit/src/core/room-core.js";
import { COUNT_MS, SETTLE_MS, boxFromManifest } from "../shared/vote.js";
import { DEFAULT_MODE, HOP_GAP_MS, HOP_KEY, MODES, MODE_COOLDOWN_MS, MODE_NAME, MODE_PAGE, arrived, hopNow, hopTarget, isMode, mayHop, modeLocked, modeOf, modeTitle, readHop } from "../shared/mode.js";
import { POSITION_SLACK, boxCentre, spawnX } from "../shared/world.js";

const duo = { id: "duo", name: "Duo", players: { min: 1, max: 4 }, devices: { phone: true, desktop: true } };

function wall() {
  const boxes = [boxFromManifest(coinFlipManifest, { test: true }), boxFromManifest(duo)];
  return { boxes, games: new Map([["coin-flip", coinFlip], ["duo", coinFlip]]) };
}

function room(now = 1000) {
  return new LobbyCore({ ...wall(), seed: 7, code: "BCDFGH", now });
}

function seated(core, name, now = 1000) {
  const joined = core.join(name, now);
  core.connect(joined.token, now);
  return joined;
}

/** Walks a seat's piece into the middle of box `i`'s light, in steps the room believes. */
function stand(core, seat, i, now) {
  const m = core.members[seat];
  const x = boxCentre(i, core.boxes.length);
  let at = m.x;
  while (Math.abs(x - at) > POSITION_SLACK) {
    at += Math.sign(x - at) * POSITION_SLACK;
    core.move(seat, { x: at, d: 0, r: m.rev }, now);
  }
  const moved = core.move(seat, { x, d: 0, r: m.rev }, now);
  core.evaluate(now);
  return moved;
}

/** Ann (the host) and Bo, both here. */
function party(now = 1000) {
  const core = room(now);
  const ann = seated(core, "Ann", now);
  const bo = seated(core, "Bo", now);
  return { core, ann, bo };
}

describe("the party's mode", () => {
  it("starts in the character room and says so in the room view", () => {
    const { core } = party();
    expect(core.mode).toBe("party-games");
    expect(core.view(2000).mode).toBe("party-games");
  });

  it("is switched by the host, both ways, with a note naming who did it", () => {
    const { core, ann } = party();
    expect(core.setMode(ann.token, "turn-based", 2000)).toEqual({ ok: true, mode: "turn-based", by: 0, was: { mode: "party-games", modeAt: -Infinity } });
    expect(core.view(2000).mode).toBe("turn-based");
    expect(core.drainNotes()).toEqual([{ k: "mode", mode: "turn-based", seat: 0, name: "Ann", text: "Ann moved the party to the Table" }]);
    expect(core.setMode(ann.token, "party-games", 2000 + MODE_COOLDOWN_MS)).toMatchObject({ ok: true, mode: "party-games" });
    expect(core.drainNotes()[0].text).toBe("Ann moved the party to the Floor");
  });

  it("is not switched by anyone else while the host is here", () => {
    const { core, bo } = party();
    expect(core.setMode(bo.token, "turn-based", 2000)).toEqual({ ok: false, why: "Only the one who started the party can switch rooms." });
    expect(core.setMode("not-a-token", "turn-based", 2000).ok).toBe(false);
    expect(core.setMode(null, "turn-based", 2000).ok).toBe(false);
    expect(core.mode).toBe("party-games");
    expect(core.drainNotes()).toEqual([]);
  });

  it("stays the host's while the host's phone is only between pages, and passes to whoever holds the controls after that", () => {
    const { core, ann, bo } = party();
    core.disconnect(ann.token, 1500);
    // Inside the grace (a page moving to the other room): Bo may not switch or pick, and the view still names Ann.
    const inside = 1500 + HOST_GRACE_MS - 1;
    expect(core.setMode(bo.token, "turn-based", inside)).toEqual({ ok: false, why: "Only the one who started the party can switch rooms." });
    expect(core.setRoom(bo.token, "camp", inside).ok).toBe(false);
    expect(core.view(inside).picker).toEqual({ seat: 0 });
    // After it, the first connected player holds the controls until the host is back.
    const after = 1500 + HOST_GRACE_MS;
    expect(core.view(after).picker).toEqual({ seat: 1 });
    expect(core.setRoom(bo.token, "camp", after).ok).toBe(true);
    expect(core.setMode(bo.token, "turn-based", after).ok).toBe(true);
    core.connect(ann.token, after + 500);
    expect(core.setMode(bo.token, "party-games", after + MODE_COOLDOWN_MS).ok).toBe(false);
    expect(core.setMode(ann.token, "party-games", after + MODE_COOLDOWN_MS).ok).toBe(true);
  });

  it("hands the party on for good when the host's piece fades, as before", () => {
    const { core, ann, bo } = party();
    core.disconnect(ann.token, 1500);
    core.tick(1500 + DROP_FADE_MS);
    expect(core.hostToken).toBe(bo.token);
    expect(core.setMode(bo.token, "turn-based", 1500 + DROP_FADE_MS).ok).toBe(true);
  });

  it("is switched by the host even while someone else holds the controls (the room's rule for the picker)", () => {
    // A party started on a big screen: its first player holds the controls, the screen's own taps still count.
    const core = room();
    const screen = core.watch(1000);
    core.connect(screen.token, 1000);
    const ann = seated(core, "Ann");
    expect(core.pickerToken()).toBe(ann.token);
    expect(core.setMode(screen.token, "turn-based", 2000)).toMatchObject({ ok: true, mode: "turn-based", by: -1 });
    expect(core.drainNotes()[0].text).toBe("The room's screen moved the party to the Table");
    expect(core.setMode(ann.token, "party-games", 2000 + MODE_COOLDOWN_MS).ok).toBe(true);
  });

  it("refuses a mode that does not exist, and the one the party is already in", () => {
    const { core, ann } = party();
    expect(core.setMode(ann.token, "chess", 2000)).toEqual({ ok: false, why: "That is not a waiting room." });
    expect(core.setMode(ann.token, undefined, 2000).ok).toBe(false);
    expect(core.setMode(ann.token, "party-games", 2000)).toEqual({ ok: false, why: "The party is in that room already." });
  });

  it("refuses a second switch within the cooldown, so a double tap cannot bounce everyone twice", () => {
    const { core, ann } = party();
    expect(core.setMode(ann.token, "turn-based", 2000).ok).toBe(true);
    expect(core.setMode(ann.token, "party-games", 2000 + MODE_COOLDOWN_MS - 1)).toEqual({ ok: false, why: "Wait a moment before switching again." });
    expect(core.mode).toBe("turn-based");
    expect(core.setMode(ann.token, "party-games", 2000 + MODE_COOLDOWN_MS).ok).toBe(true);
  });

  it("refuses while the count is running", () => {
    const { core, ann, bo } = party();
    stand(core, 0, 0, 2000);
    stand(core, 1, 0, 2000);
    expect(core.count).not.toBeNull();
    expect(core.setMode(ann.token, "turn-based", 2100)).toEqual({ ok: false, why: "The count is running. Step out of the light to change the room." });
    expect(core.mode).toBe("party-games");
    expect(core.count).not.toBeNull();
    void bo;
  });

  it("refuses while a coin toss is picking the game", () => {
    const { core, ann } = party();
    stand(core, 0, 0, 2000);
    stand(core, 1, 1, 2000);
    core.tick(2000 + COUNT_MS);
    expect(core.toss).not.toBeNull();
    expect(core.setMode(ann.token, "turn-based", 2000 + COUNT_MS + 10)).toEqual({ ok: false, why: "A coin toss is picking the game. Wait a moment." });
  });

  it("refuses while a game is on", () => {
    const { core, ann } = party();
    expect(core.startGame("coin-flip", 2000).ok).toBe(true);
    expect(core.activity.kind).toBe("game");
    expect(core.setMode(ann.token, "turn-based", 2100)).toEqual({ ok: false, why: "A game is on. You can switch when it ends." });
  });

  it("refuses while a game's settings are being chosen", () => {
    const { core, ann } = party();
    // The settings step as the room holds it (the real one opens after a vote: party-room-mode.test.js).
    core.activity = { kind: "settings", id: "coin-flip", picks: {}, seats: [0, 1], players: {}, party: [], endsAt: 99_000, startedAt: 2000 };
    expect(core.setMode(ann.token, "turn-based", 2100)).toEqual({ ok: false, why: "A game's settings are being chosen. Go back to the room first, then switch." });
  });

  it("starts the vote over: every piece is back by the door, and the room rests before a count", () => {
    const { core, ann } = party();
    stand(core, 0, 1, 2000);
    const rev = core.members[0].rev;
    expect(core.setMode(ann.token, "turn-based", 3000).ok).toBe(true);
    expect(core.members[0].x).toBe(spawnX(0, core.boxes.length));
    expect(core.members[0].rev).toBe(rev + 1);
    expect(core.holdUntil).toBe(3000 + SETTLE_MS);
  });
});

describe("between the vote and the game", () => {
  it("refuses a switch and a room pick from the wake-up that chose the game until the room has dealt with it", () => {
    const { core, ann } = party();
    stand(core, 0, 0, 2000);
    stand(core, 1, 0, 2000);
    const out = core.tick(2000 + COUNT_MS);
    expect(out.start).toBe("coin-flip");
    expect(core.count).toBeNull();
    expect(core.activity.kind).toBe("lobby");
    // The room now waits on the budget check: nothing may move the party meanwhile.
    expect(core.starting).toBe("coin-flip");
    const at = 2000 + COUNT_MS + 10;
    expect(core.setMode(ann.token, "turn-based", at)).toEqual({ ok: false, why: "A game is starting. You can switch when it ends." });
    expect(core.setRoom(ann.token, "camp", at)).toEqual({ ok: false, why: "A game is starting. You can change the room when it ends." });
    expect(core.startGame("coin-flip", at).ok).toBe(true);
    expect(core.starting).toBeNull();
  });

  it("lets the room be switched again when the start is refused", () => {
    const { core, ann } = party();
    stand(core, 0, 0, 2000);
    stand(core, 1, 0, 2000);
    core.tick(2000 + COUNT_MS);
    core.refuseStart(2000 + COUNT_MS + 10);
    expect(core.starting).toBeNull();
    expect(core.setMode(ann.token, "turn-based", 2000 + COUNT_MS + 20).ok).toBe(true);
  });
});

describe("a switch taken back", () => {
  it("puts the mode and its cooldown back and drops the note, so the host can try again at once", () => {
    const { core, ann } = party();
    const done = core.setMode(ann.token, "turn-based", 2000);
    core.undoMode(done.was);
    expect(core.mode).toBe("party-games");
    expect(core.drainNotes()).toEqual([]);
    expect(core.setMode(ann.token, "turn-based", 2001).ok).toBe(true);
  });
});

describe("the plain waiting room", () => {
  /** Ann and Bo in the plain room, past its rest. */
  function plain() {
    const p = party();
    p.core.setMode(p.ann.token, "turn-based", 2000);
    return { ...p, now: 2000 + SETTLE_MS + 1 };
  }

  it("has no vote: pieces do not walk or bump, and no count ever starts", () => {
    const { core, now } = plain();
    const m = core.members[0];
    const x = m.x;
    expect(core.move(0, { x: x + 10, d: 1, r: m.rev }, now)).toBeNull();
    expect(core.members[0].x).toBe(x);
    expect(core.bump(0, now)).toBeNull();
    expect(core.bumpWait(0, now)).toBeNull();
    // Even with every piece put in a light by hand, the room does not count.
    for (const seat of [0, 1]) Object.assign(core.members[seat], { x: boxCentre(0, core.boxes.length), t: now });
    core.evaluate(now);
    expect(core.count).toBeNull();
    expect(core.tick(now + COUNT_MS).start).toBeNull();
    expect(core.activity.kind).toBe("lobby");
  });

  it("opens no spot step", () => {
    const { core } = plain();
    core.boxes[0].audience = true;
    expect(core.spotsFor("coin-flip")).toBeNull();
  });

  it("still seats newcomers and lets dropped phones fade as the lobby does", () => {
    const { core, now } = plain();
    const cy = seated(core, "Cy", now);
    expect(cy.seat).toBe(2);
    core.disconnect(cy.token, now);
    expect(core.tick(now + 60_000).changed).toBe(true);
    expect(core.members[2]).toBeNull();
  });

  it("refuses a room pick (nobody sees the room's look there) and ignores emotes", () => {
    const { core, ann, now } = plain();
    expect(core.setRoom(ann.token, "camp", now)).toEqual({ ok: false, why: "The room's look is chosen on the Floor." });
    expect(core.room).toBe("bar");
    expect(core.emote(0, "popcorn", now)).toBeNull();
    // The same emote on the Floor is passed on.
    expect(party().core.emote(0, "popcorn", 2000).relay).toBeTruthy();
  });

  it("is not put away after twenty idle minutes while anyone is there, and adds no wake-up for it", () => {
    const { core, now } = plain();
    const quiet = core.lastActive;
    // The room's next wake-up is its own limits only: no earlier than the Table's long stale limit.
    expect(core.nextWake(now)).toBe(quiet + TABLE_STALE_MS);
    expect(core.view(now).idleLimit).toBe(TABLE_STALE_MS);
    expect(core.tick(quiet + STALE_ROOM_MS).close).toBeNull();
    expect(core.tick(quiet + TABLE_STALE_MS - 1).close).toBeNull();
    expect(core.tick(quiet + TABLE_STALE_MS).close).toBe("stale");
  });

  it("keeps the usual limit on the Floor, and at the Table once nobody is connected", () => {
    const floor = party();
    expect(floor.core.nextWake(5000)).toBe(floor.core.lastActive + STALE_ROOM_MS);
    const { core, ann, bo, now } = plain();
    core.disconnect(ann.token, now);
    core.disconnect(bo.token, now);
    expect(core.staleLimit()).toBe(STALE_ROOM_MS);
  });

  it("goes back to the character room, where the vote works again", () => {
    const { core, ann, now } = plain();
    expect(core.setMode(ann.token, "party-games", now + MODE_COOLDOWN_MS).ok).toBe(true);
    const later = now + MODE_COOLDOWN_MS + SETTLE_MS + 1;
    expect(stand(core, 0, 0, later)).not.toBeNull();
    stand(core, 1, 0, later);
    expect(core.count).not.toBeNull();
  });
});

describe("the mode through a sleep", () => {
  it("is saved with the room and comes back with it, cooldown included", () => {
    const { core, ann } = party();
    core.setMode(ann.token, "turn-based", 2000);
    const woken = LobbyCore.restore(wall(), structuredClone(core.serialize()), 3000);
    expect(woken.mode).toBe("turn-based");
    expect(woken.view(3000).mode).toBe("turn-based");
    expect(woken.setMode(ann.token, "party-games", 3000)).toEqual({ ok: false, why: "Wait a moment before switching again." });
  });

  it("reads a room saved before modes as the character room", () => {
    const { core, ann } = party();
    const old = structuredClone(core.serialize());
    delete old.mode;
    delete old.modeAt;
    const woken = LobbyCore.restore(wall(), old, 3000);
    expect(woken.mode).toBe("party-games");
    expect(woken.view(3000).mode).toBe("party-games");
    expect(woken.setMode(ann.token, "turn-based", 3000).ok).toBe(true);
  });

  it("reads a mode it does not know, or a cooldown written by JSON, safely", () => {
    const { core } = party();
    const odd = { ...structuredClone(core.serialize()), mode: "chess", modeAt: null };
    const woken = LobbyCore.restore(wall(), odd, 3000);
    expect(woken.mode).toBe("party-games");
    expect(woken.modeAt).toBe(-Infinity);
  });
});

describe("the pages' rules (lobby/shared/mode.js)", () => {
  /** A sessionStorage stand-in. */
  function store() {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), data };
  }

  it("names two modes, each with its page", () => {
    expect(MODES).toEqual(["party-games", "turn-based"]);
    expect(DEFAULT_MODE).toBe("party-games");
    expect(MODE_PAGE).toEqual({ "party-games": "/lobby/", "turn-based": "/party/" });
    // The names people read (the owner's): the values on the wire and in storage never change with them.
    expect(MODE_NAME).toEqual({ "party-games": "the Floor", "turn-based": "the Table" });
    expect(modeTitle("party-games")).toBe("The Floor");
    expect(modeTitle("turn-based")).toBe("The Table");
    expect(isMode("turn-based")).toBe(true);
    expect(isMode("TURN-BASED")).toBe(false);
    expect(isMode({})).toBe(false);
  });

  it("sends a page to the other room only when the room's mode is not its own; a room view with no mode is the character room", () => {
    expect(hopTarget({ mode: "turn-based" }, "party-games")).toBe("/party/");
    expect(hopTarget({ mode: "party-games" }, "turn-based")).toBe("/lobby/");
    expect(hopTarget({ mode: "turn-based" }, "turn-based")).toBeNull();
    expect(hopTarget({}, "party-games")).toBeNull();
    expect(hopTarget({}, "turn-based")).toBe("/lobby/");
    expect(modeOf({ mode: "nonsense" })).toBe("party-games");
  });

  it("says why a switch cannot happen now, from the room view", () => {
    expect(modeLocked({ phase: "lobby", vote: { count: null, toss: null } })).toBeNull();
    expect(modeLocked({ phase: "playing", vote: {} })).toBe("A game is on. You can switch when it ends.");
    expect(modeLocked({ phase: "settings", vote: {} })).toMatch(/settings are being chosen/);
    expect(modeLocked({ phase: "lobby", vote: { count: { endsIn: 100 } } })).toMatch(/count is running/);
  });

  it("hops at most once in a few seconds, then stays and offers a link (the loop guard)", () => {
    const s = store();
    const went = [];
    const go = (to) => went.push(to);
    expect(hopNow("/party/", { storage: s, now: 10_000, text: "Ann moved the party to the Table", go })).toBe(true);
    expect(JSON.parse(s.data.get(HOP_KEY))).toEqual({ at: 10_000, to: "/party/", text: "Ann moved the party to the Table" });
    expect(hopNow("/lobby/", { storage: s, now: 10_000 + HOP_GAP_MS - 1, go })).toBe(false);
    expect(hopNow("/lobby/", { storage: s, now: 10_000 + HOP_GAP_MS, go })).toBe(true);
    expect(went).toEqual(["/party/", "/lobby/"]);
    // A clock that stepped back is never a reason to stay stuck.
    expect(mayHop({ at: 50_000 }, 10_000)).toBe(true);
    expect(mayHop(null, 0)).toBe(true);
  });

  it("hops without a guard where nothing can be stored", () => {
    const went = [];
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(hopNow("/party/", { storage: broken, now: 1, go: (to) => went.push(to) })).toBe(true);
    expect(hopNow("/party/", { storage: null, now: 2, go: (to) => went.push(to) })).toBe(true);
    expect(went).toEqual(["/party/", "/party/"]);
    expect(readHop(broken)).toBeNull();
  });

  it("says once, on the page it arrived at, why the tab moved, and keeps the guard's time", () => {
    const s = store();
    hopNow("/party/", { storage: s, now: 10_000, text: "Ann moved the party to the Table", go: () => {} });
    expect(arrived(s, "/lobby/", 10_500)).toBe("");
    expect(arrived(s, "/party/", 10_500)).toBe("Ann moved the party to the Table");
    expect(arrived(s, "/party/", 10_600)).toBe("");
    expect(readHop(s).at).toBe(10_000);
    // A note left long ago is not said.
    const t = store();
    hopNow("/party/", { storage: t, now: 10_000, text: "old", go: () => {} });
    expect(arrived(t, "/party/", 40_000)).toBe("");
  });
});
