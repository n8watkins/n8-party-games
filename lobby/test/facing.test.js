// The room knows which way a piece faces whenever its page does: a quick turn whose walk ends
// inside the page's send gap still reaches the room, with the real Pilot (lobby/shared/pilot.js)
// talking to the room's core (lobby/server/lobby-core.js).
import { describe, expect, it } from "vitest";
import { LobbyCore } from "../server/lobby-core.js";
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { Pilot } from "../shared/pilot.js";
import { POSITION_SLACK } from "../shared/world.js";
import { WALL } from "../wall.js";

/** Pat (seat 0) and Sam (seat 1), seated and connected at 1000 ms. */
function party() {
  const core = new LobbyCore({ ...WALL, seed: 7, code: "BCDFGH", now: 1000 });
  for (const n of ["Pat", "Sam"]) core.connect(core.join(n, 1000).token, 1000);
  return core;
}

/** Puts a seat's piece at x, standing, in steps the room believes. */
function place(core, seat, x, now) {
  const m = core.members[seat];
  while (Math.abs(x - m.x) > 1) core.move(seat, { x: Math.abs(x - m.x) > POSITION_SLACK ? m.x + Math.sign(x - m.x) * (POSITION_SLACK - 10) : x, d: 0, r: m.rev }, now);
}

function be(core, seat, character) {
  Object.assign(core.members[seat], { character, lookAt: 1000 - LOOK_COOLDOWN_MS * 10 });
}

/** Seat 0's page: the real Pilot, its messages handed to the room on the test's clock. */
function page(core) {
  const clock = { now: 2000 };
  const sent = [];
  const out = [];
  const pilot = new Pilot({
    lights: core.wall,
    x: core.members[0].x,
    rev: core.members[0].rev,
    send: (m) => {
      sent.push({ at: clock.now, ...m });
      if (m.t === "m") out.push(core.move(0, m, clock.now)?.relay);
      else if (m.t === "b") out.push(core.bump(0, clock.now, m.f));
      else if (m.t === "hook") out.push(core.hook(0, clock.now, m.f).relay);
    },
  });
  const at = (t) => (clock.now = t);
  return { pilot, sent, out, at };
}

/** Walks the page left a little and lets go, then taps right in the same late burst of keys (a busy page). */
function walkLeftThenTapRight({ pilot, at }) {
  pilot.steer(-1, at(2000));
  for (let t = 2016; t <= 2100; t += 16) pilot.step(at(t));
  pilot.steer(0, at(2400)); // the walk's key-up, handled late
  pilot.steer(1, at(2402)); // the tap right, its key-down in the same burst
  pilot.steer(0, at(2404)); // and its key-up, before the send gap let the tap go
}

describe("the room faces a piece the way its page does", () => {
  it("a pawn that walked left and tapped right in one burst kicks right: its kick bounces off the hardened slime ahead", () => {
    const core = party();
    be(core, 1, "slime");
    place(core, 0, 1000, 1000);
    // The walk left ends about 828: the slime 72 ahead of it, to its right.
    place(core, 1, 900, 1000);
    const p = page(core);
    walkLeftThenTapRight(p);
    for (let t = 2420; t <= 2600; t += 100) p.pilot.step(p.at(t));
    const stood = core.members[0].x;
    expect(900 - stood).toBeLessThan(100);
    // The tap's own message never went (its d of 1 was overwritten by its key-up's 0), yet the room knows.
    expect(p.sent.filter((m) => m.t === "m" && m.d === 1)).toHaveLength(0);
    expect(p.pilot.face).toBe(1);
    expect(core.members[0].face).toBe(1);
    core.slime(1, "harden", p.at(2700));
    p.pilot.bump(p.at(2750));
    const kick = p.out.at(-1);
    expect(kick).toMatchObject({ t: "b", s: 0, f: 1, to: -1, bo: 1 });
    expect(core.members[0].x).toBeLessThan(stood - 60);
  });

  it("a kick sent inside the send gap, before the turn went, says the turn first and kicks the way the page faces", () => {
    const core = party();
    be(core, 1, "slime");
    place(core, 0, 1000, 1000);
    place(core, 1, 900, 1000);
    const p = page(core);
    walkLeftThenTapRight(p);
    core.slime(1, "harden", p.at(2410));
    p.pilot.bump(p.at(2420));
    const kickAt = p.sent.findIndex((m) => m.t === "b");
    expect(p.sent[kickAt - 1]).toMatchObject({ t: "m", d: 0, f: 1 });
    expect(p.out.at(-1)).toMatchObject({ t: "b", f: 1, to: -1, bo: 1 });
  });

  it("a robot that walked right and turned left in one burst throws its hook left", () => {
    const core = party();
    be(core, 0, "robot");
    place(core, 0, 1000, 1000);
    place(core, 1, 900, 1000);
    const p = page(core);
    p.pilot.move = "hook";
    p.pilot.steer(1, p.at(2000));
    for (let t = 2016; t <= 2100; t += 16) p.pilot.step(p.at(t));
    p.pilot.steer(0, p.at(2400));
    p.pilot.steer(-1, p.at(2402));
    p.pilot.steer(0, p.at(2404));
    expect(p.pilot.hook(p.at(2420))).toBe(true);
    expect(p.sent.at(-1)).toMatchObject({ t: "hook", f: -1 });
    expect(p.out.at(-1)).toMatchObject({ t: "hook", s: 0, f: -1 });
    expect(core.members[0].hook.dir).toBe(-1);
  });

  it("tells the other pages which way a standing piece turned", () => {
    const core = party();
    place(core, 0, 1000, 1000);
    const p = page(core);
    walkLeftThenTapRight(p);
    p.pilot.step(p.at(2500));
    expect(p.out.at(-1)).toMatchObject({ t: "m", s: 0, d: 0, f: 1 });
  });

  it("keeps an older page working: a move, kick or hook without a facing leaves the room's, and only -1 or 1 is taken", () => {
    const core = party();
    place(core, 0, 1000, 1000);
    const m = core.members[0];
    core.move(0, { x: 1000, d: -1, r: m.rev }, 2000);
    core.move(0, { x: 1000, d: 0, r: m.rev }, 2000);
    expect(m.face).toBe(-1);
    const relay = core.move(0, { x: 1000, d: 0, r: m.rev }, 2100).relay;
    expect(relay.f).toBeUndefined();
    expect(m.face).toBe(-1);
    for (const f of [0, 2, "1", null, 0.5]) core.move(0, { x: 1000, d: 0, f, r: m.rev }, 2200);
    expect(m.face).toBe(-1);
    expect(core.bump(0, 2300)).toMatchObject({ f: -1 });
  });

  it("a kick's or a hook's own facing turns a standing piece when no move said it (a turn a knock swallowed on the page)", () => {
    const core = party();
    place(core, 0, 1000, 1000);
    const m = core.members[0];
    core.move(0, { x: 1000, d: -1, r: m.rev }, 2000);
    core.move(0, { x: 1000, d: 0, r: m.rev }, 2000);
    expect(m.face).toBe(-1);
    expect(core.bump(0, 2300, 1)).toMatchObject({ t: "b", s: 0, f: 1 });
    expect(m.face).toBe(1);
    be(core, 0, "robot");
    const thrown = core.hook(0, 9000, -1);
    expect(thrown.relay).toMatchObject({ t: "hook", s: 0, f: -1 });
    expect(m.hook.dir).toBe(-1);
  });

  it("a walking piece faces the way the room has it walking: a facing that contradicts the walk is the room's call", () => {
    const core = party();
    place(core, 0, 1000, 1000);
    const m = core.members[0];
    core.move(0, { x: 1000, d: -1, f: 1, r: m.rev }, 2000);
    expect(m.face).toBe(-1);
    expect(core.bump(0, 2010, 1)).toMatchObject({ f: -1 });
  });
});
