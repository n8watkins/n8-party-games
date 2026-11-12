// The plain logic the room and the page share: where things are, who can play what, what a
// player's page sends, what a device shows and the words under the room. Also the kit's pieces
// the lobby added: the awake meter and the per-socket rate limit.
import { describe, expect, it } from "vitest";
import { AwakeMeter, EVENT_FLOOR_MS, addRoomTime, emptyUsage, rollOver } from "../../party-kit/src/worker/budget-logic.js";
import { SOCKET_RATE, newBucket, strike, takeMessage } from "../../party-kit/src/worker/limit-logic.js";
import { game as coinFlip, FLIP_MS } from "../games/coin-flip.js";
import { camera, CLOSER, PHONE_FRAME } from "../shared/camera.js";
import { Pilot, SEND_GAP_MS } from "../shared/pilot.js";
import { playerLine, statusLine } from "../shared/status.js";
import { badgeFor, boxFromManifest, leaders, playersLabel, pointsForPlace, standingsFromRows, tally, whyNot } from "../shared/vote.js";
import { BUMP_REACH, JUMP_HEIGHT, JUMP_MS, ROOM, WALK_SPEED, boxCentre, boxWidth, bumpTarget, jumpHeight, lightAt, lightHalf, posAt, spawnX } from "../shared/world.js";
import { WALL } from "../wall.js";

describe("the room as numbers", () => {
  it("gives every box a pool of light with dark between them, for any number of boxes", () => {
    for (const n of [3, 4, 5, 6]) {
      for (let i = 0; i < n; i++) {
        expect(lightAt(boxCentre(i, n), n)).toBe(i);
        expect(lightAt(boxCentre(i, n) + lightHalf(n) + 1, n)).toBe(-1);
        if (i) expect(boxCentre(i, n) - boxCentre(i - 1, n)).toBeGreaterThan(2 * lightHalf(n) + 30);
      }
      expect(boxWidth(n)).toBeGreaterThan(150);
    }
  });

  it("puts new arrivals by the door, in the dark", () => {
    for (let seat = 0; seat < 4; seat++) {
      for (const n of [3, 4, 5, 6]) expect(lightAt(spawnX(seat, n), n), `seat ${seat} of ${n}`).toBe(-1);
      expect(spawnX(seat, 5)).toBeGreaterThanOrEqual(ROOM.minX);
    }
  });

  it("carries a walking piece forward and stops it at the walls", () => {
    expect(posAt({ x: 500, d: 0, t: 0 }, 9000)).toBe(500);
    expect(posAt({ x: 500, d: 1, t: 1000 }, 2000)).toBe(500 + WALK_SPEED);
    expect(posAt({ x: 500, d: -1, t: 0 }, 60000)).toBe(ROOM.minX);
    expect(posAt({ x: 500, d: 1, t: 0 }, 60000)).toBe(ROOM.maxX);
  });

  it("jumps in an arc that is over in half a second", () => {
    expect(jumpHeight(0)).toBe(0);
    expect(jumpHeight(JUMP_MS / 2)).toBeCloseTo(JUMP_HEIGHT);
    expect(jumpHeight(JUMP_MS)).toBe(0);
    expect(jumpHeight(-5)).toBe(0);
  });

  it("lands a bump on the nearest piece in front, within reach", () => {
    const others = [
      { seat: 1, x: 560 },
      { seat: 2, x: 530 },
      { seat: 3, x: 400 },
    ];
    expect(bumpTarget(500, 1, others)).toBe(2);
    expect(bumpTarget(500, -1, others)).toBe(3);
    expect(bumpTarget(500, 1, [{ seat: 1, x: 500 + BUMP_REACH + 1 }])).toBe(-1);
  });
});

describe("which games the party can play", () => {
  const box = (players, devices, extra) => boxFromManifest({ id: "g", name: "G", players, devices }, extra);

  it("reads the badge from the manifest's devices", () => {
    expect(badgeFor({ phone: true, desktop: true, sharedScreen: true })).toBe("any");
    expect(badgeFor({ phone: true, desktop: false })).toBe("phones");
    expect(badgeFor({ phone: true, sharedScreen: "required" })).toBe("screen");
    expect(playersLabel(1, 4)).toBe("1-4 players");
    expect(playersLabel(2, 2)).toBe("2 players");
  });

  it("says in a few words why a light is off", () => {
    expect(whyNot(box({ min: 2, max: 4 }, {}), { players: 1, screens: 0 })).toBe("Needs 2 players");
    expect(whyNot(box({ min: 2, max: 2 }, {}), { players: 3, screens: 0 })).toBe("For up to 2 players");
    expect(whyNot(box({ min: 1, max: 4 }, { sharedScreen: "required" }), { players: 2, screens: 0 })).toBe("Needs a big screen");
    expect(whyNot(box({ min: 1, max: 4 }, { sharedScreen: "required" }), { players: 2, screens: 1 })).toBeNull();
    expect(whyNot(box({ min: 1, max: 4 }, {}, { soon: true }), { players: 2, screens: 1 })).toBe("Coming soon");
  });

  it("counts the lights, finds a tie, and pays 3, 2, 1", () => {
    const counts = tally({ 0: "a", 1: "b", 2: "a", 3: null });
    expect(counts).toEqual({ a: 2, b: 1 });
    expect(leaders(counts, ["a", "b"])).toEqual(["a"]);
    expect(leaders(tally({ 0: "b", 1: "a" }), ["a", "b"])).toEqual(["a", "b"]);
    expect(leaders({}, ["a", "b"])).toEqual([]);
    expect([1, 2, 3, 4].map(pointsForPlace)).toEqual([3, 2, 1, 0]);
  });

  it("turns a game's own result rows into places, sharing a place on equal scores", () => {
    const rows = [
      { seat: 2, score: 90 },
      { seat: 0, score: 70 },
      { seat: 1, score: 70 },
      { seat: 3, score: 10 },
    ];
    expect(standingsFromRows(rows)).toEqual([
      { seat: 2, place: 1 },
      { seat: 0, place: 2 },
      { seat: 1, place: 2 },
      { seat: 3, place: 4 },
    ]);
    expect(standingsFromRows(null)).toEqual([]);
  });

  it("hangs Cork & Bell, the test game and three coming-soon boxes on the site's wall", () => {
    expect(WALL.boxes.map((b) => b.id)).toEqual(["cork-and-bell", "coin-flip", "who-am-i", "tin-derby", "flood"]);
    expect(WALL.boxes[0]).toMatchObject({ name: "Cork & Bell", badge: "any", min: 2, max: 4, soon: false });
    expect(WALL.boxes[1]).toMatchObject({ test: true, min: 1 });
    expect(WALL.boxes.filter((b) => b.soon).map((b) => b.badge)).toEqual(["phones", "screen", "phones"]);
    for (const b of WALL.boxes) expect(b.blurb.length, b.id).toBeGreaterThan(5);
    expect([...WALL.games.keys()]).toEqual(["cork-and-bell", "coin-flip"]);
  });
});

describe("Coin Flip, the test game", () => {
  it("gives the same order for the same seed, and is over when the coins land", () => {
    const seats = [0, 1, 2, 3].map((seat) => ({ seat, name: "P" + seat, kind: "human" }));
    const a = coinFlip.create({ seed: 99, seats, now: 0, round: 1 });
    const b = coinFlip.create({ seed: 99, seats, now: 0, round: 1 });
    expect(a.order).toEqual(b.order);
    expect([...a.order].sort()).toEqual([0, 1, 2, 3]);
    expect(coinFlip.tick(a, FLIP_MS - 1)).toEqual([]);
    expect(coinFlip.snapshot(a, 100).order).toBeNull();
    expect(coinFlip.isOver(a)).toBe(false);
    expect(coinFlip.tick(a, FLIP_MS)).toEqual([{ k: "shown", order: a.order }]);
    expect(coinFlip.isOver(a)).toBe(true);
    expect(coinFlip.standings(a).map((s) => s.place)).toEqual([1, 2, 3, 4]);
  });
});

describe("what a player's page sends", () => {
  function pilot(x = 150) {
    const sent = [];
    return { sent, p: new Pilot({ lights: 5, send: (m) => sent.push(m), x }) };
  }

  it("says nothing while standing still or walking in a straight line through the dark", () => {
    const { sent, p } = pilot();
    for (let t = 0; t < 5000; t += 16) p.step(t);
    expect(sent).toEqual([]);
    p.steer(1, 5000);
    expect(sent).toEqual([{ t: "m", x: 150, d: 1, r: 0 }]);
    for (let t = 5016; t < 5300; t += 16) p.step(t);
    expect(sent.length).toBe(1);
  });

  it("says so when it changes direction, jumps, or steps into or out of a light", () => {
    const { sent, p } = pilot(boxCentre(0, 5) - lightHalf(5) - 20);
    p.steer(1, 0);
    for (let t = 16; t <= 600; t += 16) p.step(t);
    // In at one edge of the first light and out at the other.
    expect(sent.map((m) => lightAt(m.x, 5))).toEqual([-1, 0, -1]);
    for (let t = 616; t <= 1000; t += 16) p.step(t);
    expect(p.jump(1100)).toBe(true);
    expect(p.jump(1200)).toBe(false);
    expect(sent.at(-1)).toMatchObject({ j: 1, d: 1 });
    p.steer(0, 1300);
    expect(sent.at(-1)).toMatchObject({ d: 0 });
    expect(sent.at(-1).j).toBeUndefined();
  });

  it("never sends faster than its gap, however fast the keys are mashed", () => {
    const { sent, p } = pilot();
    for (let t = 0; t < 1000; t += 5) p.steer(t % 10 ? 1 : -1, t);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(1000 / SEND_GAP_MS) + 1);
    for (let i = 1; i < sent.length; i++) expect(sent[i].x).toBeDefined();
  });

  it("walks under a light that is off without a word, and speaks up if it comes on overhead", () => {
    const { sent, p } = pilot(boxCentre(2, 5) - lightHalf(5) - 20);
    p.setLit([0, 1], 0);
    p.steer(1, 0);
    for (let t = 16; t <= 250; t += 16) p.step(t);
    // Under the third box, whose light is off: nothing but the first step.
    expect(lightAt(p.x, 5)).toBe(2);
    expect(sent.length).toBe(1);
    p.steer(0, 300);
    expect(sent.length).toBe(2);
    p.setLit([0, 1, 2], 1000);
    expect(sent.length).toBe(3);
    expect(lightAt(sent.at(-1).x, 5)).toBe(2);
  });

  it("goes where the room puts it and answers with the room's revision", () => {
    const { sent, p } = pilot();
    p.place(600, 3, 1000);
    expect(p.x).toBe(600);
    expect(sent.at(-1)).toEqual({ t: "m", x: 600, d: 0, r: 3 });
    expect(p.bump(2000)).toBe(true);
    expect(p.bump(2100)).toBe(false);
    expect(sent.at(-1)).toEqual({ t: "b" });
  });
});

describe("what a device shows", () => {
  it("shows a big screen the stills' frame exactly", () => {
    expect(camera({ w: 1920, h: 1080, bar: 90 })).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080, scale: 1 });
  });

  it("fits the whole room on a sideways phone, above its buttons", () => {
    const v = camera({ w: 844, h: 390, bar: 64, phone: true });
    expect(v.x).toBeLessThanOrEqual(PHONE_FRAME.left);
    expect(v.x + v.width).toBeGreaterThanOrEqual(PHONE_FRAME.right);
    expect(v.y).toBeLessThanOrEqual(PHONE_FRAME.top + 0.01);
    // The foot of the frame sits on top of the buttons.
    expect((PHONE_FRAME.bottom - v.y) * v.scale).toBeCloseTo(390 - 64);
  });

  it("goes closer around the player's own piece and stays inside the room", () => {
    const whole = camera({ w: 844, h: 390, bar: 64, phone: true });
    const mid = camera({ w: 844, h: 390, bar: 64, phone: true, mode: "closer", focusX: 900 });
    expect(mid.scale).toBeCloseTo((844 / 1920) * CLOSER);
    expect(mid.scale).toBeGreaterThan(whole.scale);
    expect(mid.x + mid.width / 2).toBeCloseTo(900);
    expect(camera({ w: 844, h: 390, bar: 64, phone: true, mode: "closer", focusX: 150 }).x).toBe(0);
    const right = camera({ w: 844, h: 390, bar: 64, phone: true, mode: "closer", focusX: 1800 });
    expect(right.x + right.width).toBeCloseTo(1920);
  });

  it("still works on an upright phone: a slice of the room around the player", () => {
    const v = camera({ w: 390, h: 844, bar: 300, phone: true, focusX: 960 });
    expect(v.width).toBeCloseTo(720);
    // With room to spare above the buttons, the room sits in the middle of it.
    expect(v.y).toBeLessThan(0);
    expect(v.y + (844 - 300) / v.scale).toBeGreaterThan(950);
    expect(v.x + v.width / 2).toBeCloseTo(960);
  });
});

describe("the words under the room", () => {
  const boxes = WALL.boxes;
  const member = (seat, name) => ({ seat, name, colour: "#000", connected: true, x: 0, d: 0, rev: 0, points: 0 });
  const base = { boxes, phase: "lobby", game: null, screens: 0, closing: null, members: [member(0, "Mabel"), member(1, "Tom"), null, null] };
  const vote = (over) => ({ lights: {}, standing: { 0: null, 1: null }, waiting: [], leaders: [], count: null, toss: null, ...over });

  it("asks for a vote and names who is in the dark", () => {
    const line = statusLine(base, vote({ waiting: [1] }));
    expect(line).toMatchObject({ chip: "VOTE", main: "Stand in a light to pick that game.", sub: "Waiting for" });
    expect(line.waiting).toEqual([{ name: "Tom", colour: "#000" }]);
  });

  it("counts down by name, and says a tie is coming", () => {
    const one = statusLine(base, vote({ leaders: ["coin-flip"], count: { endsIn: 3000 }, countLeft: 2100 }));
    expect(one).toMatchObject({ chip: "EVERYONE IS IN A LIGHT", main: "Coin Flip starts in 3.", sub: "Step out of your light to stop the count." });
    expect(statusLine(base, vote({ leaders: ["cork-and-bell", "coin-flip"], count: { endsIn: 900 } })).main).toBe("A tie. The coin toss is in 1.");
    expect(statusLine(base, vote({ toss: { between: ["cork-and-bell", "coin-flip"], winner: "coin-flip", endsIn: 100 } }))).toMatchObject({ chip: "TIE", sub: "Cork & Bell and Coin Flip." });
  });

  it("covers an empty room, a game in play and a room that is closing", () => {
    expect(statusLine({ ...base, members: [null, null, null, null] }, vote()).chip).toBe("JOIN");
    expect(statusLine({ ...base, phase: "playing", game: { name: "Coin Flip" } }, vote()).main).toBe("Coin Flip is on.");
    expect(statusLine({ ...base, closing: { in: 125000, reason: "budget" } }, vote()).sub).toBe("This room closes in 2:05.");
  });

  it("tells a player their own vote and who everyone is waiting for", () => {
    expect(playerLine(base, vote({ standing: { 0: "coin-flip", 1: null }, waiting: [1] }), 0)).toEqual({ vote: "Coin Flip", voted: true, rest: "Waiting for Tom" });
    expect(playerLine(base, vote({ standing: { 0: "coin-flip", 1: null }, waiting: [1] }), 1)).toEqual({ vote: "Not yet", voted: false, rest: "Everyone is waiting for you" });
    expect(playerLine(base, vote(), 0).rest).toBe("2 here, phones only");
    expect(playerLine({ ...base, screens: 1 }, vote({ leaders: ["coin-flip"], count: { endsIn: 2500 } }), 0).rest).toBe("Coin Flip starts in 3");
  });
});

describe("counting awake time", () => {
  it("charges every event at least the floor, and a held span second for second", () => {
    const meter = new AwakeMeter();
    meter.event(1000, 1000, "message");
    meter.event(1000, 1040, "request");
    expect(meter.take(2000)).toEqual({ ms: EVENT_FLOOR_MS + 40, requests: 1 / 20 + 1 });
    meter.hold(5000);
    meter.event(5500, 5500, "message"); // inside the hold: no time of its own
    meter.release(8000);
    expect(meter.take(9000)).toEqual({ ms: 3000, requests: 1 / 20 });
    expect(meter.take(9500)).toEqual({ ms: 0, requests: 0 });
  });

  it("reports a hold that is still running without losing or doubling any of it", () => {
    const meter = new AwakeMeter();
    meter.hold(0);
    expect(meter.take(60000).ms).toBe(60000);
    expect(meter.take(90000).ms).toBe(30000);
    meter.release(100000);
    expect(meter.take(100000).ms).toBe(10000);
  });

  it("keeps requests beside the time in the budget's books, per day and per month", () => {
    let usage = addRoomTime(emptyUsage(Date.UTC(2026, 10, 12)), 10_000, Date.UTC(2026, 10, 12), 7.5);
    expect(usage).toMatchObject({ monthUsed: 1.28, dayUsed: 1.28, monthRequests: 7.5, dayRequests: 7.5 });
    usage = rollOver(usage, Date.UTC(2026, 10, 13));
    expect(usage).toMatchObject({ dayUsed: 0, dayRequests: 0, monthRequests: 7.5 });
    // Usage saved before requests were counted still reads cleanly.
    expect(rollOver({ month: "2026-11", day: "2026-11-13", monthUsed: 2, dayUsed: 1 }, Date.UTC(2026, 10, 13))).toMatchObject({ monthRequests: 0, dayRequests: 0, monthUsed: 2 });
  });
});

describe("the rate limit on one socket", () => {
  it("lets a burst through, then drops, and refills with time", () => {
    const bucket = newBucket(0);
    const verdicts = [];
    for (let i = 0; i < SOCKET_RATE.burst + 5; i++) verdicts.push(takeMessage(bucket, 0));
    expect(verdicts.filter((v) => v === "ok").length).toBe(SOCKET_RATE.burst);
    expect(verdicts.slice(-5)).toEqual(["drop", "drop", "drop", "drop", "drop"]);
    expect(takeMessage(bucket, 1000)).toBe("ok");
  });

  it("closes a socket that keeps flooding, and sooner for messages it cannot read", () => {
    const bucket = newBucket(0);
    let verdict = "ok";
    let sent = 0;
    while (verdict !== "close" && sent < 10_000) {
      verdict = takeMessage(bucket, 0);
      sent += 1;
    }
    expect(sent).toBe(SOCKET_RATE.burst + SOCKET_RATE.strikes);
    const junk = newBucket(0);
    let n = 0;
    while (strike(junk) !== "close") n += 1;
    expect(n).toBeLessThan(SOCKET_RATE.strikes / 4);
  });
});
