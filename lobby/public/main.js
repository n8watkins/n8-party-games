// The party room's page. It is three things on top of each other: the way in (door.js), the
// room drawn as one picture (a room view: room-view.js), and the words and buttons over it
// (hud.js). This file joins them to the room over the kit's client and to the player's keys and fingers.
import { PartyClient } from "/party-kit/client/party-client.js";
import { openBoard } from "./board.js";
import { buzz } from "./bump-draw.js";
import { openDoor } from "./door.js";
import { h } from "./dom.js";
import { GAME_VIEWS } from "./games/views.js";
import { farewellKind, goFront } from "./farewell.js";
import { Hud } from "./hud.js";
import { TouchSpots } from "./touch.js";
import { KEEP_ALIVE_MS, watchConnection } from "./connection.js";
import { CountTick } from "./count-tick.js";
import { RoomMenu } from "./room-menu.js";
import { chosenLook, hardware3D, openRoomView, preferFlat } from "./room-view.js";
import { ScreenFit, fitVisible } from "./screen-fit.js";
import { SlowWatch } from "./slow-room.js";
import { IMPACT_MS } from "./shared/bump.js";
import { camera } from "./shared/camera.js";
import { Pilot } from "./shared/pilot.js";
import { isRoom, roomName } from "./shared/rooms.js";
import { playerLine, statusLine } from "./shared/status.js";
import { posAt } from "./shared/world.js";

const params = new URLSearchParams(location.search);
const app = document.getElementById("app");
/** Which drawing of the room this device asked for: 3D unless ?look=flat, and flat where 3D cannot be drawn well. */
const chosen = chosenLook(params);
let look = chosen.look === "3d" && !hardware3D(params) ? "flat" : chosen.look;
/** A start link may name the room the party starts in (?start&room=ship). */
const startRoom = params.has("start") && isRoom(params.get("room")) ? params.get("room") : null;
// The keep-alive is a fixed text the room answers without waking up (lobby/server/lobby-room.js).
const link = new PartyClient({ api: "/api/lobby", quietPing: { text: "ping", everyMs: KEEP_ALIVE_MS }, lag: Number(params.get("lag") ?? 0) });
// A locked phone, an offline browser and a connection that quietly died are seen at once (connection.js).
watchConnection(link, { player: () => isPlayer() });

let door = null;
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
/** The Tonight board opened large (board.js), or null. */
let board = null;
/** Rooms and the door button, and the room picker (room-menu.js). */
let menu = null;
/** The count, large, over the foot of the room (count-tick.js). */
let count = null;
/** What can be touched on the wall: the board, the posters, the join sign, the 3D room's feature (touch.js). */
let touch = null;
/** Full screen, and the way to it on an iPhone (screen-fit.js). */
let fit = null;
/** What every room view is opened with, apart from its look and skin. */
let viewBase = null;
/** The room (skin) the view on the page draws, and whether it is being swapped for another. */
let shownRoom = null;
let swapping = false;
/** The room a start link asked for, until the room has answered the pick (enter). */
let pendingRoom = null;
/** The black that comes down over the room while it changes (rooms.css). */
let dim = null;
/** Each piece as last heard of from a move, so a room view made mid-party puts it where it is now. */
const lastMoves = new Map();
/** Watches for a 3D room that stays slow on this device, and offers the simpler one once (slow-room.js). */
const slow = new SlowWatch(params.get("gl") !== "any");
/** Set when this device chose to go, so the socket closing is not taken for the room ending. */
let bye = null;
/** Which walk keys and buttons are down, newest last, so the latest one wins. */
const held = [];
/** When anyone last did anything, as far as this page knows: the room is put away after twenty idle minutes. */
let stirAt = performance.now();

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
  door = openDoor(app, link, { mode: params.has("start") ? "start" : "join", code, message, as: params.get("as") === "screen" ? "screen" : "player", small: phone(), rejoin: params.has("rejoin") });
}

function teardown() {
  hideBoard();
  door?.close();
  door = null;
  stage?.unmount();
  stage = null;
  app.classList.remove("in-game");
  for (const part of [menu, count, touch, fit]) part?.destroy();
  menu = count = touch = fit = null;
  hud?.destroy();
  hud = null;
  scene?.destroy();
  stageBox?.remove();
  dim?.remove();
  slow.stop();
  scene = pilot = stageBox = view = dim = null;
  lastMoves.clear();
  litKey = "";
  held.length = 0;
}

/** The room answered for the first time: draw it. */
async function enter() {
  entering = true;
  const joinUrl = await link.joinUrl("/lobby/");
  compact = phone() && isPlayer();
  viewBase = { compact, own: isPlayer() ? link.you.seat : -1, host: new URL(joinUrl).host, qr: link.qrUrl(joinUrl), onBoard: showBoard };
  // The party's room. A party started with ?room= moves there at once: its maker is the host.
  let skin = room?.room;
  if (room && startRoom && startRoom !== room.room && room.picker && (room.picker.seat === -1 ? link.you.role === "screen" : room.picker.seat === link.you.seat)) {
    link.send({ t: "pick", v: startRoom });
    // Taken as said: the room answers with the same, and nothing in between is newer.
    skin = room.room = pendingRoom = startRoom;
  }
  await quick3D();
  const made = room ? await openRoomView(app, { ...viewBase, look, skin }) : null;
  entering = false;
  stirAt = performance.now();
  if (!room) return void made?.destroy();
  door?.close();
  door = null;
  // The address is now just the room; a reload comes back to the same seat from the saved session.
  history.replaceState(null, "", "/lobby/");
  scene = made;
  shownRoom = skin;
  dim = h("div", "room-dim", "", app);
  touch = new TouchSpots(app, dim, { code: () => ({ pin: room?.pin ?? "", qr: viewBase.qr, host: viewBase.host }), scene: () => scene });
  touch.build(room);
  stageBox = h("div", "stage", "", app);
  stageBox.hidden = true;
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
        // The socket's close normally takes us to the front page at once; never wait on it long.
        setTimeout(() => closed("left"), 1500);
      },
      away: goAway,
    },
  });
  menu = new RoomMenu(hud.el, { role: link.you.role, seat: link.you.seat, onPick: (id) => link.send({ t: "pick", v: id }) });
  if (menu.mine(room)) menu.hint();
  count = new CountTick(hud.el, { buzz: isPlayer() ? buzz : null });
  fit = new ScreenFit(menu.corner, app);
  void keepAwake();
  slow.start(scene.look, performance.now(), simpler);
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

/** This device is out of the room, for whatever reason: the front page says which, with the way back in. */
function closed(reason) {
  if (closed.done) return;
  closed.done = true;
  const pin = room?.pin ?? link.session?.pin ?? null;
  const screen = link.you?.role === "screen" || link.session?.role === "screen";
  teardown();
  room = null;
  goFront(farewellKind(reason, screen), pin);
}

// ---------------------------------------------------------------- the party moves to another room

const DIM_MS = 300;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const nextFrame = () => new Promise((done) => requestAnimationFrame(() => done()));

/**
 * Makes the view on the page draw the party's room (room.room), or another look of the same
 * room. Every device hears of a change in the same message, so the lights go down, the room
 * changes and the lights come up everywhere at once. The flat drawing has one room: it only
 * notes the change. Changes that arrive meanwhile are caught up with before the lights come up.
 */
async function showRoom() {
  if (swapping || !scene || !room) return;
  if (room.room === shownRoom && look === scene.look) return;
  if (look === "flat" && scene.look === "flat") return void (shownRoom = room.room);
  swapping = true;
  dim?.classList.remove("rising");
  dim?.classList.add("on");
  await wait(DIM_MS);
  while (scene && room && (room.room !== shownRoom || look !== scene.look)) {
    const [skin, asked] = [room.room, look];
    const own = scene.ownX();
    scene.destroy();
    // While the next view loads the room carries on: moves and votes are kept here and handed over.
    scene = pause(own);
    const before = new Set(app.children);
    const made = await openRoomView(app, { ...viewBase, compact, look: asked, skin });
    // Each drawing appends itself; it belongs under the stage and the words, where the last one was.
    for (const el of [...app.children]) if (!before.has(el)) app.insertBefore(el, touch?.el ?? dim);
    if (!room || !scene?.paused) {
      made.destroy();
      break;
    }
    scene = made;
    shownRoom = skin;
    if (made.look !== asked) look = made.look;
    const now = performance.now();
    scene.build(room);
    scene.setRoom(room, now);
    for (const [s, move] of lastMoves) if (room.members[s] && move.t > roomSeenAt) scene.onMove({ s, x: posAt(move, now), d: move.d }, now);
    slow.start(scene.look, now, simpler);
  }
  await nextFrame();
  await nextFrame();
  dim?.classList.add("rising");
  dim?.classList.remove("on");
  swapping = false;
}

/** How long the way in waits for the 3D look's files before showing the flat room instead. */
const SLOW_LOAD_MS = 2500;

/**
 * On a slow connection the 3D look's files (about 780 KB, most of it three.js) can take a while.
 * Nobody waits at the way in for them: if they are not here in a moment the room opens flat, and
 * changes to 3D (lights down and up, as for a change of room) when they arrive.
 */
async function quick3D() {
  if (look !== "3d") return;
  const ready = import("./look3d/room3d.js").then(
    () => true,
    () => false,
  );
  if (await Promise.race([ready, wait(SLOW_LOAD_MS).then(() => null)])) return;
  look = "flat";
  void ready.then((ok) => {
    // Unless the device has asked for the simpler room meanwhile.
    if (!ok || chosenLook(new URLSearchParams()).look === "flat") return;
    look = "3d";
    void showRoom();
  });
}

/** A stand-in for the room view while the next one loads: it hears everything and draws nothing. */
function pause(own) {
  const nothing = () => {};
  return { paused: true, look: "", build: nothing, setRoom: nothing, setVote: nothing, onMove: nothing, onBump: nothing, ownJump: nothing, ownBump: nothing, ownX: () => own, setCompact: nothing, frame: nothing, destroy: nothing };
}

/** "Simpler room": this device draws the flat room from now on, and remembers it. */
function simpler() {
  preferFlat();
  look = "flat";
  void showRoom();
}

// ---------------------------------------------------------------- the Tonight board, large

/**
 * Opens the board large. The piece stops where it is and stays there, so its vote carries on.
 * Opening adds a step to the browser's history, so a phone's back gesture closes it.
 */
function showBoard() {
  if (board || !room || room.phase !== "lobby") return;
  letGo();
  touch?.pressBoard();
  touch?.closeCard();
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

/** When the room last sent the whole room: moves heard before it are older than its positions. */
let roomSeenAt = 0;

function apply(next) {
  room = next;
  // Until the room answers the start link's pick, its older words do not undo it.
  if (pendingRoom) room.room = pendingRoom;
  voteAt = roomSeenAt = performance.now();
  if (!scene) return;
  scene.setRoom(room, voteAt);
  menu?.update(room);
  // A page that missed a change (a drop, a sleep) catches up from the room itself.
  if (room.room !== shownRoom || look !== scene.look) void showRoom();
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
  if (pendingRoom) room.room = pendingRoom;
  if (!entering) void enter();
});

link.on("message", (msg) => {
  // A change of room is kept even while the room is still being drawn for the first time.
  if (msg.t === "pick" || msg.t === "pick-no") {
    pendingRoom = null;
    if (room) room.room = msg.v;
  }
  if (!scene) return;
  const now = performance.now();
  switch (msg.t) {
    case "m":
      lastMoves.set(msg.s, { x: msg.x, d: msg.d, t: now });
      scene.onMove(msg, now);
      stirAt = now;
      break;
    case "b":
      if (msg.to >= 0) lastMoves.set(msg.to, { x: msg.x, d: 0, t: now });
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
    case "vote":
      room.vote = msg.vote;
      voteAt = now;
      scene.setVote(msg.vote, now);
      menu?.update(room);
      warmUp(msg.vote);
      tellLit(now);
      break;
    case "pick": {
      // The host moved the party to another room: everyone's lights go down together.
      room.room = msg.v;
      const by = msg.by === -1 ? "The room's screen" : room.members[msg.by]?.name;
      hud?.note(`${by ? `${by} picked` : "Now in"} ${roomName(msg.v).replace(/^The /, "the ")}`, room.members[msg.by]?.colour);
      menu?.update(room);
      menu?.picked(msg.v);
      void showRoom();
      break;
    }
    case "pick-no":
      // Said in the picker when it is open, as a note over the room when it is not.
      if (menu?.isOpen) menu.refused(msg.why);
      else hud?.note(msg.why);
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

/** The blow lands a moment after the bump: both phones buzz then, the one that was hit longer. */
function feelBump(msg) {
  if (!isPlayer() || msg.to < 0) return;
  const mine = link.you.seat;
  if (msg.to === mine) setTimeout(() => buzz([70, 40, 30]), IMPACT_MS);
  else if (msg.s === mine) setTimeout(() => buzz(30), IMPACT_MS);
}

// A game: the room page shows the game's own view while it is on, and the result when it ends.
// A view comes from this repository (GAME_VIEWS: the test game) or from the game's own files, at
// the address its box carries (`view`, from the manifest's `lobby.view`). A game's module is
// fetched when it is first needed, so `stage` stands in for the view at once and hands on
// whatever the room says in the meantime.

/** How much of the top right corner the door button takes: a game's own buttons stand clear of it. */
const DOOR_INSET = { top: 56, right: 56 };

/** The view module of a game that opens inside the room, by box. Loaded once. */
const viewModules = new Map();
function viewModule(box) {
  if (GAME_VIEWS[box.id]) return Promise.resolve({ mount: GAME_VIEWS[box.id] });
  if (!box.view) return Promise.resolve(null);
  if (!viewModules.has(box.id)) {
    // Only ever a module of this site: the address comes from the room's wall, and is checked anyway.
    const address = new URL(box.view, location.href);
    viewModules.set(box.id, address.origin === location.origin ? import(address.href) : Promise.resolve(null));
  }
  return viewModules.get(box.id);
}

function startStage(snapshot) {
  if (stage || !room?.game || !stageBox) return;
  const box = room.boxes.find((b) => b.id === room.game.id);
  if (!box) return;
  steerNow(0);
  held.length = 0;
  const mine = { view: null, waiting: [], gone: false };
  const pass = (method, args) => (mine.view ? mine.view[method](...args) : mine.waiting.push([method, args]));
  stage = {
    events: (...args) => pass("events", args),
    snapshot: (...args) => pass("snapshot", args),
    unmount() {
      mine.gone = true;
      mine.view?.unmount();
    },
  };
  const ctx = { room, you: link.you, snapshot, send: (data) => link.sendInput(data), now: () => link.now(), inset: DOOR_INSET, params };
  viewModule(box)
    .then((module) => {
      if (mine.gone || !module?.mount) return;
      stageBox.hidden = false;
      mine.view = module.mount(stageBox, ctx);
      // A view that covers everything: the room's bars are put away and the room is not drawn under it.
      app.classList.toggle("in-game", !!mine.view.full);
      for (const [method, args] of mine.waiting.splice(0)) mine.view[method](...args);
    })
    .catch((err) => hud?.note(`The game could not be shown: ${err.message}`));
}

function endStage() {
  stage?.unmount();
  stage = null;
  app.classList.remove("in-game");
  if (stageBox) stageBox.hidden = true;
}

/** While a count runs for a game with a view of its own, its files are fetched ahead of the start. */
function warmUp(vote) {
  if (!vote?.count || vote.leaders.length !== 1) return;
  const box = room.boxes.find((b) => b.id === vote.leaders[0]);
  if (box?.view) void viewModule(box).then((module) => module?.preload?.()).catch(() => {});
}

link.on("start", (msg) => {
  apply(msg.room);
  startStage(msg.s);
});
link.on("events", (events) => stage?.events(events));
link.on("snapshot", (snapshot, now, full) => (stage ? stage.snapshot(snapshot, now, full) : startStage(snapshot)));
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
  // Also a saved session whose room is gone (a reload after it closed): the front page says so.
  closed(said);
});

link.on("error", (err) => hud?.note(err.message));

// ---------------------------------------------------------------- keys and fingers

const canMove = () => !!pilot && room?.phase === "lobby" && !hud?.sheet && !hud?.card && !board && !menu?.isOpen;

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
  if (down) {
    menu?.fold();
    touch?.closeCard();
  }
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
  if (e.key === "Escape" && menu?.isOpen) return menu.close();
  if (e.key === "Escape" && touch?.card) return touch.closeCard();
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
    zoom = phone() ? "closer" : "room";
    scene.setCompact(compact, room, now);
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
  touch?.place(view, scene);
  // Under a game that covers everything the room is not drawn.
  if (!app.classList.contains("in-game") && !swapping) {
    scene.frame(now, dt, pilot, view);
    slow.frame(now, dt);
  }
  hud.update(room, room.vote, now, voteAt, zoom, now - stirAt);
  count?.update(room, room.vote.count ? Math.max(0, room.vote.count.endsIn - (now - voteAt)) : null);
}

// ---------------------------------------------------------------- begin

// The room is laid out against what is really visible, whatever the browser's bars are doing.
fitVisible();
if (params.has("join") || params.has("start") || !link.resume()) showDoor();
