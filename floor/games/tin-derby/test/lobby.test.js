// Tin Derby in the party room's own rules (lobby/server/lobby-core.js), driven with a fake clock: each player
// races as the piece they chose in the room, a dropped phone's car is the house's, and the places reach the
// Tonight board.
import { describe, expect, it } from "vitest";
import { LobbyCore } from "../../../../lobby/server/lobby-core.js";
import { COUNT_MS, boxFromManifest } from "../../../../lobby/shared/vote.js";
import { POSITION_SLACK, boxCentre } from "../../../../lobby/shared/world.js";
import { game, manifest } from "../party.js";

function derbyRoom(now = 1000) {
  const boxes = [boxFromManifest(manifest, { view: manifest.path + manifest.lobby.view })];
  return new LobbyCore({ boxes, games: new Map([[manifest.id, game]]), seed: 11, code: "BCDFGH", now });
}

function seated(core, name, now = 1000) {
  const joined = core.join(name, now);
  core.connect(joined.token, now);
  return joined;
}

/** Walks a seat's piece into the box's light in steps the room believes. */
function stand(core, seat, now) {
  const m = core.members[seat], x = boxCentre(0, core.boxes.length);
  let at = m.x;
  while (Math.abs(x - at) > POSITION_SLACK) {
    at += Math.sign(x - at) * POSITION_SLACK;
    core.move(seat, { x: at, d: 0, r: m.rev }, now);
  }
  core.move(seat, { x, d: 0, r: m.rev }, now);
  core.evaluate(now);
}

/** Votes the party onto the game and starts it. Returns the time it started. */
function start(core) {
  for (const m of core.members) if (m) stand(core, m.seat, 2000);
  core.evaluate(2000);
  const at = 2000 + COUNT_MS;
  expect(core.tick(at).start).toBe("tin-derby");
  expect(core.startGame("tin-derby", at)).toEqual({ ok: true, ended: null });
  return at;
}

describe("Tin Derby in the party room", () => {
  it("hangs with a sign that reads 1-4 and the view its manifest names", () => {
    const core = derbyRoom();
    expect(core.boxes[0]).toMatchObject({ id: "tin-derby", min: 1, max: 4, url: null, view: "/tin-derby/page/party-view.js" });
  });

  it("gives each player the piece they chose in the room, and the house cars the pieces nobody chose", () => {
    const core = derbyRoom();
    const ann = seated(core, "Ann"), bo = seated(core, "Bo");
    expect(core.setLook(ann.seat, { c: "ghost" }, 1500)).toMatchObject({ ok: true, changed: true });
    start(core);
    const cars = core.activity.state.cars;
    expect(cars.filter((c) => !c.house).map((c) => [c.seat, c.name, c.character, c.trait])).toEqual([
      [0, "Ann", "ghost", "ghost"],
      [1, "Bo", "pawn", "pawn"],
    ]);
    // The house takes the two characters nobody chose.
    expect(cars.filter((c) => c.house).map((c) => c.character).sort()).toEqual(["robot", "slime"]);
    expect(bo.seat).toBe(1);
  });

  it("drives a dropped phone's car with the house, runs the race to its end, and puts the places on the Tonight board", () => {
    const core = derbyRoom();
    const ann = seated(core, "Ann");
    seated(core, "Bo");
    let now = start(core);
    // Ann's phone drops at once: the house drives her car. Bo's phone sends nothing: his car never sets off.
    core.disconnect(ann.token, now);
    const step = 1000 / game.tickHz;
    let ended = null, snapshots = 0, handed = 0;
    while (!ended && now < 400_000) {
      now += step;
      const tick = core.gameTick(now);
      handed += tick.events.filter((e) => e.k === "a" && e.on).length;
      if (tick.snapshot) snapshots++;
      ended = tick.ended;
    }
    expect(handed).toBe(1);
    expect(ended).toBeTruthy();
    expect(snapshots).toBeGreaterThan(30);
    const rows = core.view(now).members.filter(Boolean).map((m) => [m.name, m.points]);
    // Ann's car (the house's) finished; Bo's stood on the grid, so he is second with 2 points.
    expect(rows).toEqual([["Ann", 3], ["Bo", 2]]);
  });
});
