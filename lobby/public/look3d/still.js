// A posed room, with nobody connected: the 3D look fed a made-up room instead of a live one.
// It is how the stills and the short loops on the rooms page are taken, how a concept room is
// looked at before it is live, and how frame time is measured without a server in the way.
//
//   still.html?room=<skin>           any skin in skins.js, live or concept
//     &shot=vote|count|toss|off|empty|live  the moment (default vote: four pieces mid-vote; live: the
//                                    wall as it hangs today, with the games that are not built yet dark)
//     &look=baked                    the baked look (../baked/room-baked.js) on today's wall of five boxes
//     &as=screen|player              the big screen's bottom line, or a player's buttons (seat 2)
//     &zoom=room|closer              a player's view
//     &bare=1                        no bottom line or buttons at all
//     &walk=1                        the pieces pace about, for measuring
//     &at=<seconds>                  how long the room has been open: what its timed events go by
//     &event=<name>&u=0.5            hold one timed event part way through (0 to 1), for a still
//     &show=1                        a little show: an event passes, someone is bumped by the
//                                    room's feature, someone jumps under a lamp
//     &clock=step                    nothing moves until window.__still.advance(seconds) is
//                                    called: for taking a loop frame by frame
//
// The boxes here are the four of the approved stills, made with the same boxFromManifest the
// room uses. A live room never reads this file: its boxes come from the game list.
import { Hud } from "../hud.js";
import { camera } from "../shared/camera.js";
import { boxFromManifest } from "../shared/vote.js";
import { boxCentre, lightHalf } from "../shared/world.js";
import { Room3D } from "./room3d.js";

const query = new URLSearchParams(location.search);
const shot = query.get("shot") ?? "vote";
const role = query.get("as") === "player" ? "player" : "screen";
const show = query.get("show") === "1";
const stepped = query.get("clock") === "step";
const YOU = 2;

const BOXES = [
  boxFromManifest({ id: "cork-and-bell", name: "Cork & Bell", blurb: "Pop the targets, ring the bell", players: { min: 1, max: 4 }, devices: { phone: true, desktop: true } }),
  boxFromManifest({ id: "who-am-i", name: "Who Am I?", blurb: "Ask questions, guess your name", players: { min: 2, max: 2 }, devices: { phone: true, desktop: false } }),
  boxFromManifest({ id: "tin-derby", name: "Tin Derby", blurb: "Wind up your tin racer and go", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false, sharedScreen: "required" } }),
  boxFromManifest({ id: "flood", name: "Flood", blurb: "Climb before the water rises", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false } }),
];
const baked = query.get("look") === "baked";
// The baked look is shown on today's wall of five boxes (&boxes=6 adds the local test game's box).
if (baked) BOXES.push(boxFromManifest({ id: "fox-trouble", name: "Fox Trouble", blurb: "Solve the room together, cause trouble", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false } }));
if (baked && query.get("boxes") === "6") BOXES.splice(1, 0, boxFromManifest({ id: "coin-flip", name: "Coin Flip", blurb: "Test game: luck picks the order", players: { min: 1, max: 4 }, devices: { phone: true, desktop: true } }));
const N = BOXES.length;
const light = (i, off = 0) => Math.round(boxCentre(i, N) + off);
/** Where the room's feature is (look3d/space.js, boardX), in world units. */
const FEATURE = 1722;
const SEATS = [
  { name: "Mabel", colour: "#c8382c", x: light(0, -64), points: 5, face: 1 },
  { name: "Fitch", colour: "#2f6f8f", x: light(0, 62), points: 2, face: -1 },
  { name: "Dolly", colour: "#d9a02a", x: light(2, 8), points: 7, face: -1 },
  { name: "Tom", colour: "#3f7a4a", x: light(2, lightHalf(N) + 52), points: 4, face: 1 },
];
if (show) {
  // Tom has wandered over to the room's feature, and Fitch has followed him there.
  SEATS[3].x = FEATURE;
  SEATS[1].x = FEATURE - 118;
  SEATS[1].face = 1;
}

function fixture() {
  const members = SEATS.map((s, seat) => ({ seat, name: s.name, colour: s.colour, connected: true, x: s.x, d: 0, rev: 1, points: s.points }));
  const lights = Object.fromEntries(BOXES.map((b) => [b.id, null]));
  const standing = { 0: "cork-and-bell", 1: show ? null : "cork-and-bell", 2: "tin-derby", 3: null };
  const vote = { lights, standing, waiting: show ? [1, 3] : [3], leaders: ["cork-and-bell"], count: null, toss: null };
  if (shot === "count") {
    members[2].x = light(0, 0);
    members[3].x = light(0, 96);
    members[0].x = light(0, -96);
    Object.assign(standing, { 2: "cork-and-bell", 3: "cork-and-bell" });
    Object.assign(vote, { waiting: [], count: { endsIn: 1900 } });
  } else if (shot === "toss") {
    members[3].x = light(2, 70);
    members[2].x = light(2, -40);
    standing[3] = "tin-derby";
    Object.assign(vote, { waiting: [], leaders: ["cork-and-bell", "tin-derby"], toss: { between: ["cork-and-bell", "tin-derby"], winner: "tin-derby", endsIn: 1900, of: 3200 } });
  } else if (shot === "off") {
    lights["who-am-i"] = "For up to 2 players";
    lights["tin-derby"] = "Needs a big screen";
    members[2].x = light(3, -10);
    standing[2] = "flood";
  } else if (shot === "live") {
    for (const id of ["tin-derby", "flood", "fox-trouble"]) if (id in lights) lights[id] = "Coming soon";
    members[2].x = light(1, 10);
    members[3].x = light(1, lightHalf(N) + 70);
    standing[2] = "who-am-i";
  } else if (shot === "empty") {
    members.length = 0;
    for (const b of BOXES) lights[b.id] = b.min > 1 ? `Needs ${b.min} players` : "Needs a player";
    Object.assign(vote, { standing: {}, waiting: [], leaders: [] });
  }
  // The room has been open for `at` seconds: its timed events go by that.
  const age = Number(query.get("at") ?? 1000);
  return { pin: "4827", phase: "lobby", members, boxes: BOXES, vote, tonight: { games: members.length ? 3 : 0 }, last: null, screens: 1, closing: null, closesIn: (4 * 3600 - age) * 1000, idleLimit: 600_000 };
}

const app = document.getElementById("app");
const phone = () => Math.min(innerWidth, innerHeight) < 520;
const room = fixture();
const View = baked ? (await import("../baked/room-baked.js")).RoomBaked : Room3D;
const view3d = await View.open(app, {
  boxes: N,
  concept: true,
  skin: query.get("room") ?? "bar",
  compact: phone() && role === "player",
  own: role === "player" ? YOU : -1,
  host: "partygames.n8builds.dev",
  qr: new URL("./rooms/qr.svg", import.meta.url).href,
});
// In stepped time the clock is this page's own: it starts now and moves only when told to.
let clock = performance.now();
const started = clock;
view3d.build(room);
let voteAt = clock;
view3d.setRoom(room, clock);
view3d.life.clock(room, clock);
for (const [seat, p] of view3d.pieces) p.face = SEATS[seat].face;
if (query.has("event")) {
  view3d.life.force = query.get("event");
  view3d.life.forceU = Number(query.get("u") ?? 0.5);
}
if (show) {
  // Start the room's clock a moment before its first passing thing arrives, so the show has one in it.
  const first = view3d.life.schedule(clock).filter((e) => e.lasts < 20).sort((a, b) => a.at - b.at)[0];
  if (first) view3d.life.base += first.at - view3d.life.T(clock) - 0.4;
}

const bare = query.get("bare") === "1";
const hud = bare ? null : new Hud(app, { role, seat: YOU, on: { steer() {}, jump() {}, bump() {}, zoom() {}, leave() {}, away() {} } });
const zoom = query.get("zoom") === "closer" ? "closer" : "room";
const walk = query.get("walk") === "1";
// The count and the toss are held at their moment unless the still is asked to run.
const frozen = query.get("run") !== "1";

/** The show's cues: [seconds in, what happens]. Each is something a live room does from messages every device hears. */
const cues = show
  ? [
      [1.5, (now) => view3d.onBump({ s: 1, f: 1, to: 3, x: FEATURE + 74, rev: 1 }, now)],
      [3.0, (now) => view3d.onMove({ s: 2, x: SEATS[2].x, d: 0, j: true }, now)],
      [3.3, (now) => view3d.onMove({ s: 3, x: FEATURE, d: -1 }, now)],
      [3.5, (now) => view3d.onMove({ s: 3, x: FEATURE, d: 0 }, now)],
    ]
  : [];

let last = 0;
let frames = 0;
const times = [];
function draw(now, dt) {
  if (frozen) voteAt = now;
  while (cues.length && now - started >= cues[0][0] * 1000) cues.shift()[1](now);
  if (walk) {
    // Everyone paces to and fro, and jumps now and then: the busiest the room gets.
    room.members.forEach((m, i) => {
      const x = SEATS[i].x + Math.sin(now / (700 + i * 130)) * 150;
      view3d.onMove({ s: m.seat, x, d: Math.cos(now / (700 + i * 130)) > 0 ? 1 : -1, j: frames % (140 + i * 31) === 0 }, now);
    });
    view3d.setVote(room.vote, voteAt);
  } else if (frozen) view3d.voteAt = voteAt;
  const mine = role === "player" ? view3d.ownX() : 960;
  const drama = room.vote.count || room.vote.toss;
  const view = camera({ w: innerWidth, h: innerHeight, bar: hud ? hud.barHeight() : 0, mode: role === "player" && !drama ? zoom : "room", focusX: mine, phone: phone() });
  view3d.frame(now, dt, null, view);
  hud?.update(room, room.vote, now, voteAt, zoom, 0);
  frames++;
  if (frames === 12) document.documentElement.dataset.ready = "1";
}

function frame(t) {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (t - (last || t)) / 1000);
  if (last) times.push(t - last);
  if (times.length > 600) times.shift();
  last = t;
  draw(now, dt);
}
if (stepped) for (let i = 0; i < 12; i++) draw(clock, 0);
else requestAnimationFrame(frame);

window.__still = {
  /** Stepped time only: moves the room on by `seconds`, a thirtieth of a second at a time, and draws it. */
  advance(seconds) {
    for (let left = seconds; left > 0.0001; left -= 1 / 30) {
      clock += 1000 / 30;
      view3d.idle = 0;
      draw(clock, 1 / 30);
    }
  },
  /** When each of the room's timed events next starts, in seconds from now. */
  schedule: () => view3d.life.schedule(performance.now()).map((e) => ({ ...e, in: e.at - view3d.life.T(performance.now()) })),
  reset: () => (times.length = 0),
  /** For measuring: the time between frames over the last few seconds, and what was drawn. */
  report() {
    const sorted = [...times].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    return { frames: sorted.length, median: at(0.5), p95: at(0.95), worst: at(1), ...view3d.stats() };
  },
};
