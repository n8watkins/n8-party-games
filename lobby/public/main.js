// The party room's page. It is three things on top of each other: the way in (door.js), the
// room drawn as one picture (scene.js), and the words and buttons over it (hud.js). This file
// joins them to the room over the kit's client and to the player's keys and fingers.
import { PartyClient } from "/party-kit/client/party-client.js";
import { openDoor } from "./door.js";
import { h, s, set } from "./dom.js";
import { GAME_VIEWS } from "./games/views.js";
import { Hud, showClosed } from "./hud.js";
import { Scene } from "./scene.js";
import { camera } from "./shared/camera.js";
import { Pilot } from "./shared/pilot.js";

const params = new URLSearchParams(location.search);
const app = document.getElementById("app");
// The keep-alive is a fixed text the room answers without waking up (lobby/server/lobby-room.js).
const link = new PartyClient({ api: "/api/lobby", quietPing: { text: "ping", everyMs: 20_000 }, lag: Number(params.get("lag") ?? 0) });

let door = null;
let svg = null;
let scene = null;
let hud = null;
let pilot = null;
let room = null;
let voteAt = 0;
let stage = null;
let stageBox = null;
let zoom = "closer";
let focus = 960;
let lastFrame = 0;
let compact = null;
let view = null;
let viewSize = "";
let entering = false;
let veil = null;
/** Set when this device chose to go, so the socket closing is not taken for the room ending. */
let bye = null;
/** Which walk keys and buttons are down, newest last, so the latest one wins. */
const held = [];

const phone = () => Math.min(innerWidth, innerHeight) < 520;
const isPlayer = () => link.you?.role === "player";

// ---------------------------------------------------------------- in and out

function showDoor(message = "") {
  teardown();
  const code = params.get("join") ?? "";
  door = openDoor(app, link, { mode: params.has("start") ? "start" : "join", code, message });
}

function teardown() {
  veil?.remove();
  veil = null;
  door?.close();
  door = null;
  stage?.unmount();
  stage = null;
  hud?.destroy();
  hud = null;
  svg?.remove();
  stageBox?.remove();
  svg = scene = pilot = stageBox = view = null;
  held.length = 0;
}

/** The room answered for the first time: draw it. */
async function enter() {
  entering = true;
  const joinUrl = await link.joinUrl("/lobby/");
  entering = false;
  if (!room) return;
  veil?.remove();
  veil = null;
  door?.close();
  door = null;
  // The address is now just the room; a reload comes back to the same seat from the saved session.
  history.replaceState(null, "", "/lobby/");
  svg = s("svg", { class: "scene", preserveAspectRatio: "xMidYMid slice", role: "img", "aria-label": "The party room" });
  app.append(svg);
  stageBox = h("div", "stage", "", app);
  stageBox.hidden = true;
  compact = phone() && isPlayer();
  scene = new Scene(svg, { compact, own: isPlayer() ? link.you.seat : -1, host: new URL(joinUrl).host, qr: link.qrUrl(joinUrl) });
  scene.build(room);
  hud = new Hud(app, {
    role: link.you.role,
    seat: link.you.seat,
    on: {
      steer: (d, down) => press(`pad${d}`, d, down),
      jump,
      bump,
      zoom: () => (zoom = zoom === "closer" ? "room" : "closer"),
      leave: () => {
        bye = "left";
        link.leave();
      },
    },
  });
  zoom = phone() ? "closer" : "room";
  apply(room);
  if (!lastFrame) requestAnimationFrame(frame);
}

function closed(reason) {
  teardown();
  room = null;
  veil = showClosed(app, reason);
}

// ---------------------------------------------------------------- what the room says

function apply(next) {
  room = next;
  voteAt = performance.now();
  if (!scene) return;
  scene.setRoom(room, voteAt);
  const me = isPlayer() ? room.members[link.you.seat] : null;
  if (me) {
    if (!pilot) {
      pilot = new Pilot({ lights: room.boxes.length, send: (m) => link.send(m), x: me.x, rev: me.rev });
      focus = me.x;
    } else if (pilot.rev !== me.rev) pilot.place(me.x, me.rev, voteAt);
  }
  if (room.phase !== "playing" && stage) endStage();
}

link.on("room", (next) => {
  if (scene) return apply(next);
  room = next;
  if (!entering) void enter();
});

link.on("message", (msg) => {
  if (!scene) return;
  const now = performance.now();
  switch (msg.t) {
    case "m":
      scene.onMove(msg, now);
      break;
    case "b":
      scene.onBump(msg, now);
      if (pilot && msg.to === link.you.seat) pilot.place(msg.x, msg.rev, now);
      break;
    case "fix":
      pilot?.place(msg.x, msg.rev, now);
      break;
    case "vote":
      room.vote = msg.vote;
      voteAt = now;
      scene.setVote(msg.vote, now);
      break;
    case "note":
      if (msg.k === "left") hud?.note(`${msg.name} left`, msg.colour);
      break;
    default:
      break;
  }
});

// A game: the room page shows the game's own view while it is on, and the result when it ends.
function startStage(snapshot) {
  if (stage || !room?.game) return;
  const mount = GAME_VIEWS[room.game.id];
  if (!mount) return;
  steerNow(0);
  held.length = 0;
  stageBox.hidden = false;
  stage = mount(stageBox, { room, you: link.you, snapshot });
}

function endStage() {
  stage?.unmount();
  stage = null;
  if (stageBox) stageBox.hidden = true;
}

link.on("start", (msg) => {
  apply(msg.room);
  startStage(msg.s);
});
link.on("events", (events) => stage?.events(events));
link.on("snapshot", (snapshot) => (stage ? stage.snapshot(snapshot) : startStage(snapshot)));
link.on("end", (msg) => {
  endStage();
  apply(msg.room);
  hud?.result(msg.last);
});

link.on("status", (status) => {
  hud?.link(status === "reconnecting" ? "Reconnecting..." : "");
  // Back after a drop: the room stood the piece still, so say again where it is going.
  if (status === "open" && pilot) pilot.dirty = true;
});

link.on("closed", (why, reason) => {
  const said = bye ?? (why === "seat_lost" ? "seat_lost" : reason || "room_closed");
  bye = null;
  // A saved session whose room is gone leads back to the way in, not to a notice about a room never seen.
  if (!room) return showDoor(why === "seat_lost" ? "That seat is no longer held. Join again with the code." : "That party has ended.");
  closed(said);
});

link.on("error", (err) => hud?.note(err.message));

// ---------------------------------------------------------------- keys and fingers

const canMove = () => !!pilot && room?.phase === "lobby" && !hud?.sheet && !hud?.card;

function steerNow(d) {
  pilot?.steer(d, performance.now());
}

/** A walk key or button went down or up. The newest one still held decides the direction. */
function press(id, d, down) {
  const i = held.findIndex((k) => k.id === id);
  if (i !== -1) held.splice(i, 1);
  if (down) held.push({ id, d });
  steerNow(canMove() && held.length ? held[held.length - 1].d : 0);
}

function jump() {
  const now = performance.now();
  if (canMove() && pilot.jump(now)) scene.ownJump(now);
}

function bump() {
  const now = performance.now();
  if (canMove() && pilot.bump(now)) hud.bumped(now);
}

const WALK_KEYS = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
const JUMP_KEYS = new Set([" ", "ArrowUp", "w", "W"]);
const BUMP_KEYS = new Set(["b", "B", "x", "X", "Shift"]);

addEventListener("keydown", (e) => {
  if (!scene || e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") return hud?.sheet ? hud.sheet.click() : hud?.openSheet();
  if (e.key in WALK_KEYS) {
    if (!e.repeat) press(e.key.toLowerCase(), WALK_KEYS[e.key], true);
  } else if (JUMP_KEYS.has(e.key)) {
    if (!e.repeat) jump();
  } else if (BUMP_KEYS.has(e.key)) {
    if (!e.repeat) bump();
  } else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => {
  if (e.key in WALK_KEYS) press(e.key.toLowerCase(), WALK_KEYS[e.key], false);
});

// A hidden tab or a lost focus never leaves a piece walking into the wall.
function letGo() {
  held.length = 0;
  steerNow(0);
}
addEventListener("blur", letGo);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) letGo();
  else void keepAwake();
});

// A phone that dims and locks drops out of the party, so ask it to stay awake while the room is open.
let wake = null;
async function keepAwake() {
  if (!scene || wake || !navigator.wakeLock) return;
  try {
    wake = await navigator.wakeLock.request("screen");
    wake.addEventListener("release", () => (wake = null));
  } catch {
    // Not allowed right now (low battery, or no tap yet): the phone's own setting decides.
  }
}
addEventListener("pointerdown", keepAwake, { passive: true });

// ---------------------------------------------------------------- every frame

function frame(t) {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (t - (lastFrame || t)) / 1000);
  lastFrame = t;
  if (!scene || !room || !hud?.bar) return;
  // A window dragged across the phone size gets the other set of signs.
  if ((phone() && isPlayer()) !== compact) {
    compact = phone() && isPlayer();
    scene.opts.compact = compact;
    scene.tagSize = compact ? 26 : 21;
    zoom = phone() ? "closer" : "room";
    scene.build(room);
    scene.setRoom(room, now);
  }
  if (pilot) {
    if (!canMove() && pilot.d) steerNow(0);
    pilot.step(now);
  }
  const mine = isPlayer() ? scene.ownX() : 960;
  focus += (mine - focus) * Math.min(1, dt * 7);
  // While a count or a coin toss is on, a phone pulls back to the whole room: that is where it happens.
  const drama = room.phase === "lobby" && (room.vote.count || room.vote.toss);
  const aim = camera({ w: innerWidth, h: innerHeight, bar: hud.barHeight(), mode: isPlayer() && !drama ? zoom : "room", focusX: focus, phone: phone() });
  // The view glides from one framing to the next, except when the window itself changes shape.
  const size = `${innerWidth}x${innerHeight}`;
  if (!view || size !== viewSize) view = aim;
  else for (const k of ["x", "y", "width", "height"]) view[k] += (aim[k] - view[k]) * Math.min(1, dt * 9);
  viewSize = size;
  set(svg, { viewBox: `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.width.toFixed(2)} ${view.height.toFixed(2)}` });
  scene.frame(now, dt, pilot, view);
  hud.update(room, room.vote, now, voteAt, zoom);
}

// ---------------------------------------------------------------- begin

if (params.has("join") || params.has("start") || !link.resume()) showDoor();
