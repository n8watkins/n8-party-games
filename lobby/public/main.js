// The party room's page. It is three things on top of each other: the way in (door.js), the
// room drawn as one picture (scene.js), and the words and buttons over it (hud.js). This file
// joins them to the room over the kit's client and to the player's keys and fingers.
import { PartyClient } from "/party-kit/client/party-client.js";
import { emoteById, soundById, soundPlaysHere } from "/party-kit/client/emotes.js";
import { SoundBoard } from "/party-kit/client/sounds.js";
import { openBoard } from "./board.js";
import { buzz } from "./bump-draw.js";
import { openDoor } from "./door.js";
import { h, s, set } from "./dom.js";
import { GAME_VIEWS } from "./games/views.js";
import { Hud, showClosed } from "./hud.js";
import { Scene } from "./scene.js";
import { IMPACT_MS } from "./shared/bump.js";
import { camera } from "./shared/camera.js";
import { Pilot } from "./shared/pilot.js";
import { playerLine, statusLine } from "./shared/status.js";

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
/** The Tonight board opened large (board.js), or null. */
let board = null;
/** Set when this device chose to go, so the socket closing is not taken for the room ending. */
let bye = null;
/** Which walk keys and buttons are down, newest last, so the latest one wins. */
const held = [];
/** When anyone last did anything, as far as this page knows: the room is put away after twenty idle minutes. */
let stirAt = performance.now();

/**
 * This device's soundboard player (the kit's). The browser allows sound only after a tap or a
 * key on the page, so every one tries to unlock it; until then a sound is simply not played.
 * The tests read what it did through __partyRoom (they run muted).
 */
const sounds = new SoundBoard();
globalThis.__partyRoom = { sounds };
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => sounds.unlock(), { capture: true, passive: true });

const phone = () => Math.min(innerWidth, innerHeight) < 520;
const isPlayer = () => link.you?.role === "player";

/** What the player's Pilot sends with: a move goes to the room, and counts as someone doing something. */
function sendMove(message) {
  stirAt = performance.now();
  link.send(message);
}

// ---------------------------------------------------------------- in and out

function showDoor(message = "") {
  teardown();
  const code = params.get("join") ?? "";
  // A phone is a device to play on, so its way in leads with playing; a wide screen is offered both.
  door = openDoor(app, link, { mode: params.has("start") ? "start" : "join", code, message, as: params.get("as") === "screen" ? "screen" : "player", small: phone() });
}

function teardown() {
  hideBoard();
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
  litKey = "";
  held.length = 0;
}

/** The room answered for the first time: draw it. */
async function enter() {
  entering = true;
  const joinUrl = await link.joinUrl("/lobby/");
  entering = false;
  stirAt = performance.now();
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
  scene = new Scene(svg, { compact, own: isPlayer() ? link.you.seat : -1, host: new URL(joinUrl).host, qr: link.qrUrl(joinUrl), onBoard: showBoard });
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
      away: goAway,
    },
  });
  zoom = phone() ? "closer" : "room";
  apply(room);
  if (!lastFrame) requestAnimationFrame(frame);
}

/**
 * Leaves for an outside game's own site. The seat is not given up: the room lets it go by its
 * usual rules once the page is gone, and coming straight back finds it again. Only an https
 * address or a page of this site is ever followed.
 */
function goAway(address) {
  let url;
  try {
    url = new URL(address, location.href);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.origin !== location.origin) return;
  location.assign(url.href);
}
// Coming back with the browser's back button can show the page as it was left, card and all:
// load it afresh, so it rejoins the room or says the party has ended.
addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});

function closed(reason) {
  const pin = room?.pin ?? null;
  teardown();
  room = null;
  veil = showClosed(app, reason, pin);
}

// ---------------------------------------------------------------- the Tonight board, large

/**
 * Opens the board large. The piece stops where it is and stays there, so its vote carries on.
 * Opening adds a step to the browser's history, so a phone's back gesture closes it.
 */
function showBoard() {
  if (board || !room || room.phase !== "lobby") return;
  letGo();
  board = openBoard(app, { room, own: isPlayer() ? link.you.seat : -1, onClose: () => hideBoard() });
  history.pushState({ board: true }, "");
}

/** Closes the board. `byBack`: the back gesture did it, so the history step is already gone. */
function hideBoard(byBack = false) {
  if (!board) return;
  board.remove();
  board = null;
  if (!byBack && history.state?.board) history.back();
}
addEventListener("popstate", () => hideBoard(true));

/** What the room is doing, in a few words, for the foot of the open board. */
function boardLine(now) {
  const live = { ...room.vote, countLeft: room.vote.count ? room.vote.count.endsIn - (now - voteAt) : null };
  const closingLeft = room.closing ? room.closing.in - (now - voteAt) : null;
  if (!isPlayer()) return statusLine(room, live, closingLeft).main;
  const line = playerLine(room, live, link.you.seat, closingLeft);
  return `Your vote: ${line.vote}. ${line.rest}.`;
}

// ---------------------------------------------------------------- what the room says

function apply(next) {
  room = next;
  voteAt = performance.now();
  sounds.setRoom(room.code);
  if (!scene) return;
  scene.setRoom(room, voteAt);
  const me = isPlayer() ? room.members[link.you.seat] : null;
  if (me) {
    if (!pilot) {
      pilot = new Pilot({ lights: room.boxes.length, send: sendMove, x: me.x, rev: me.rev });
      focus = me.x;
      // A page that arrives in the middle (a reload) takes the room's word on its bump.
      if (me.down > 0) pilot.knock(me.x, me.rev, voteAt, me.down);
      pilot.cool(me.cool ?? 0, voteAt);
    } else if (pilot.rev !== me.rev) pilot.place(me.x, me.rev, voteAt);
    tellLit(voteAt);
  }
  if (room.phase !== "playing" && stage) endStage();
  // A game takes the whole screen: the board makes way for it.
  if (room.phase === "playing") hideBoard();
}

/** Tells the player's Pilot which lights are on, whenever that changes: only those are worth reporting. */
let litKey = "";
function tellLit(now) {
  const lit = room.boxes.map((box, i) => (room.vote.lights[box.id] === null ? i : -1)).filter((i) => i >= 0);
  if (!pilot || litKey === lit.join()) return;
  litKey = lit.join();
  pilot.setLit(lit, now);
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
      stirAt = now;
      break;
    case "b":
      scene.onBump(msg, now);
      stirAt = now;
      // Knocked: the piece lies where the room threw it, and has nothing to say until it is up.
      if (pilot && msg.to === link.you.seat) pilot.knock(msg.x, msg.rev, now);
      feelBump(msg);
      break;
    case "cd":
      // The room refused a bump: its word on how long is left replaces this page's guess.
      pilot?.cool(msg.in, now);
      break;
    case "fix":
      pilot?.place(msg.x, msg.rev, now);
      break;
    case "e":
    case "sb":
      stirAt = now;
      expressed(msg);
      break;
    case "vote":
      room.vote = msg.vote;
      voteAt = now;
      scene.setVote(msg.vote, now);
      tellLit(now);
      break;
    case "note":
      if (msg.k === "left") hud?.note(`${msg.name} left`, msg.colour);
      break;
    case "away":
      // An outside game won the vote: the card says where everyone is going, then goAway runs.
      stirAt = now;
      letGo();
      hud?.away(msg, room.pin);
      break;
    default:
      break;
  }
});

/**
 * Someone sent an emote or a sound. A sound plays from the big screen when the room has one,
 * and on every player's device when it has none (the kit's rule), unless this device muted it.
 * Everybody sees who did it, muted or not.
 *
 * How emotes and sounds look is waiting on the owner's picks (/preview/emotes/ locally): until
 * then the room says it in a note at the top, "Tom: Air horn".
 */
function expressed(msg) {
  const who = room?.members[msg.s];
  if (!who) return;
  const what = msg.t === "e" ? emoteById(msg.e) : soundById(msg.k);
  if (!what) return;
  hud?.note(`${who.name}: ${what.name}`, who.colour);
  if (msg.t === "sb" && soundPlaysHere(link.you?.role, room.screens)) void sounds.play(msg.k, { from: who.name });
}

/** The blow lands a moment after the bump: both phones buzz then, the one that was hit longer. */
function feelBump(msg) {
  if (!isPlayer() || msg.to < 0) return;
  const mine = link.you.seat;
  if (msg.to === mine) setTimeout(() => buzz([70, 40, 30]), IMPACT_MS);
  else if (msg.s === mine) setTimeout(() => buzz(30), IMPACT_MS);
}

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
  stirAt = performance.now();
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
  // A screen that was away too long finds another device showing the room.
  closed(said === "seat_lost" && link.you?.role === "screen" ? "screen_lost" : said);
});

link.on("error", (err) => hud?.note(err.message));

// ---------------------------------------------------------------- keys and fingers

const canMove = () => !!pilot && room?.phase === "lobby" && !hud?.sheet && !hud?.card && !board;

function steerNow(d) {
  pilot?.steer(d, performance.now());
}

/** Which way the piece should be walking: the newest walk key or button still held, if it may move. */
const wanted = () => (canMove() && held.length ? held[held.length - 1].d : 0);

/** A walk key or button went down or up. The newest one still held decides the direction. */
function press(id, d, down) {
  const i = held.findIndex((k) => k.id === id);
  if (i !== -1) held.splice(i, 1);
  if (down) held.push({ id, d });
  steerNow(wanted());
}

function jump() {
  const now = performance.now();
  if (canMove() && pilot.jump(now)) scene.ownJump(now);
}

/** The wind-up starts the moment the button goes down; the room decides whether the blow lands. */
function bump() {
  const now = performance.now();
  if (canMove() && pilot.bump(now)) scene.ownBump(now);
}

const WALK_KEYS = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
const JUMP_KEYS = new Set([" ", "ArrowUp", "w", "W"]);
const BUMP_KEYS = new Set(["b", "B", "x", "X", "Shift"]);

addEventListener("keydown", (e) => {
  if (!scene || e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape" && board) return hideBoard();
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
  // Never negative: a clock that steps back (a test holding time still) must not throw the pieces off the floor.
  const dt = Math.max(0, Math.min(0.1, (t - (lastFrame || t)) / 1000));
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
    // Asked every frame, so a piece that was knocked down walks on by itself once it is up,
    // if the key is still held, and one that may not move stands still.
    pilot.steer(wanted(), now);
    pilot.step(now);
    hud.pad?.show({ cooling: pilot.cooling(now), down: pilot.down(now) });
  }
  board?.update(room, boardLine(now));
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
  // A blow jolts the picture for a moment (scene.jolt); the framing itself does not move.
  const jolt = scene.jolt(now);
  set(svg, { viewBox: `${(view.x + jolt.x).toFixed(2)} ${(view.y + jolt.y).toFixed(2)} ${view.width.toFixed(2)} ${view.height.toFixed(2)}` });
  scene.frame(now, dt, pilot, view);
  hud.update(room, room.vote, now, voteAt, zoom, now - stirAt);
}

// ---------------------------------------------------------------- begin

if (params.has("join") || params.has("start") || !link.resume()) showDoor();
