// The party room's page. It is three things on top of each other: the way in (door.js), the
// room drawn as one picture (a room view: room-view.js), and the words and buttons over it
// (hud.js). This file joins them to the room over the kit's client and to the player's keys and fingers.
import { PartyClient } from "/party-kit/client/party-client.js";
import { DURING_PLAY, EMOTE_COOLDOWN_MS, emoteById, emoteMessage, mayEmote, soundAllowedNow, soundPlaysHere } from "/party-kit/client/emotes.js";
import { SoundBoard, defineSound, hasSound } from "/party-kit/client/sounds.js";
import { openBoard } from "./board.js";
import { buzz } from "./bump-draw.js";
import { openDoor } from "./door.js";
import { h } from "./dom.js";
import { GAME_VIEWS } from "./games/views.js";
import { farewellKind, goFront } from "./farewell.js";
import { FrameMeter, meterWanted } from "./frame-meter.js";
import { Hud } from "./hud.js";
import { TouchSpots } from "./touch.js";
import { KEEP_ALIVE_MS, watchConnection } from "./connection.js";
import { CountTick } from "./count-tick.js";
import { LookMenu } from "./look-menu.js";
import { RoomMenu } from "./room-menu.js";
import { SettingsStep } from "./settings-step.js";
import { RoomSounds, defineRoomSounds, emoteSound } from "./room-sounds.js";
import { chosenLook, hardware3D, openRoomView, preferFlat } from "./room-view.js";
import { ScreenFit, allowUpright, fitVisible } from "./screen-fit.js";
import { SlowWatch } from "./slow-room.js";
import { BUMP_COOLDOWN_MS, IMMUNE_MS, IMPACT_MS, STUN_MS } from "./shared/bump.js";
import { BOO_EARLY_MS, FADE_COOLDOWN_MS, FADE_MS, SCARE_MS, SPOOK_AGAIN_MS, SPOOK_MS, SPOOK_REACH } from "./shared/ghost.js";
import { moveOf } from "./shared/characters.js";
import { defineGhostSounds } from "./ghost-sounds.js";
import { defineMoveSounds } from "./move-sounds.js";
import { HOOK_COOLDOWN_MS, HOOK_LIFE_MS, STILT_MS } from "./shared/robot.js";
import { HOLD_MS, SHOVE_AGAIN_MS, SHOVE_MS, SHOVE_REACH } from "./shared/slime.js";
import { MOVED } from "./shared/moves.js";
import { MOVE_COOLDOWN } from "./shared/pilot.js";
import { FRAME, PHONE_FRAME, camera } from "./shared/camera.js";
import { clearOfCard, tagsTop } from "./card-clear.js";
import { Pilot } from "./shared/pilot.js";
import { isRoom, roomName } from "./shared/rooms.js";
import { watchMode } from "./hop.js";
import { stageKey, stageStale } from "./shared/stage.js";
import { playerLine, statusLine } from "./shared/status.js";
import { JUMP_HEIGHT, posAt } from "./shared/world.js";

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
// One party, two waiting rooms: when the party is in the plain one, this page moves itself there (hop.js).
const modeHop = watchMode(link, "party-games");

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
/** A player's own piece in the corner, and the sheet to choose its character and colour (look-menu.js). */
let looks = null;
/** The count, large, over the foot of the room (count-tick.js). */
let count = null;
/** The settings step after the vote, for a game that has settings (settings-step.js). */
let step = null;
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
/** The frame meter at the top left, on this device only when it asked with ?meter=1 (frame-meter.js). */
const meter = meterWanted(params) ? new FrameMeter(app) : null;
/** Set when this device chose to go, so the socket closing is not taken for the room ending. */
let bye = null;
/** Which walk keys and buttons are down, newest last, so the latest one wins. */
const held = [];
/** When anyone last did anything, as far as this page knows: the room is put away after twenty idle minutes. */
let stirAt = performance.now();

/**
 * This device's sound player (the kit's), for the emotes' sounds and the room's own
 * (room-sounds.js). The browser allows sound only after a tap or a key on the page, so every one
 * tries to unlock it; until then a sound is simply not played. The files are named here and
 * fetched only once the room is up and sound is allowed. The tests read what it did through
 * __partyRoom (they run muted).
 */
const sounds = new SoundBoard();
defineRoomSounds();
/** The room's own sounds, while the room is on the page. */
let roomSounds = null;
globalThis.__partyRoom = { sounds, defineSound };
// The room view as drawn now, either look (the tests read its pieces' moves: move-state.js).
Object.defineProperty(globalThis.__partyRoom, "view", { get: () => scene });
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => sounds.unlock(), { capture: true, passive: true });
sounds.onChange(() => roomSounds?.warm());
/** When this player last sent an emote, by this page's clock: the room has the last word (its "wait"). */
let emoteAt = -Infinity;

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
  app.classList.remove("in-game", "staged");
  document.documentElement.classList.remove("upright");
  for (const part of [looks, menu, count, step, touch, fit, roomSounds]) part?.destroy();
  looks = menu = count = step = touch = fit = roomSounds = null;
  hud?.destroy();
  hud = null;
  scene?.destroy();
  stageBox?.remove();
  dim?.remove();
  slow.stop();
  meter?.stop();
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
  viewBase = { compact, own: isPlayer() ? link.you.seat : -1, host: new URL(joinUrl).host, qr: link.qrUrl(joinUrl), onBoard: showBoard, baked: chosen.baked, boxes: room?.boxes.length };
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
  touch = new TouchSpots(app, dim, { code: () => ({ pin: room?.pin ?? "", qr: viewBase.qr, host: viewBase.host }), scene: () => scene, tap: () => roomSounds?.play("tap", -2, { gain: 0.6 }) });
  touch.build(room);
  stageBox = h("div", "stage", "", app);
  stageBox.hidden = true;
  scene.build(room);
  roomSounds = new RoomSounds(sounds, { role: () => link.you?.role, seat: () => link.you?.seat ?? -1, screens: () => room?.screens ?? 0, playing: () => room?.phase === "playing" });
  hud = new Hud(app, {
    role: link.you.role,
    seat: link.you.seat,
    sound: sounds,
    on: {
      emote: sendEmote,
      colour: () => room?.members[link.you.seat]?.colour ?? "#c8382c",
      character: () => room?.members[link.you.seat]?.character,
      steer: (d, down) => press(`pad${d}`, d, down),
      jump,
      bump,
      unbump,
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
  menu = new RoomMenu(hud.el, { role: link.you.role, seat: link.you.seat, onPick: (id) => link.send({ t: "pick", v: id }), onMode: (v) => link.send({ t: "mode", v }), quiet: modeHop.came });
  hud.muteButton(menu.corner);
  if (menu.mine(room)) menu.hint();
  // A player's own piece, and the choice of its character and colour; the one last chosen on this device comes back.
  if (isPlayer()) {
    looks = new LookMenu(hud.bar.querySelector(".pad-left"), hud.el, {
      seat: link.you.seat,
      send: (choice) => link.send({ t: "look", ...choice }),
      // The line of words under the room carries a dot in the player's colour: it is written again.
      onChange: () => hud && (hud.last = ""),
    });
    // The first room view: draws the button, and asks for the saved piece when it can.
    looks.update(room);
  }
  count = new CountTick(hud.el, { buzz: isPlayer() ? buzz : null });
  // The one who chooses is the room's picker: a player's seat, or -1 for the room's screen.
  step = new SettingsStep(hud.el, { send: (message) => link.send(message), mine: (choosing) => (isPlayer() ? choosing.by === link.you.seat : choosing.by === -1) });
  fit = new ScreenFit(menu.corner, app);
  void keepAwake();
  slow.start(scene.look, performance.now(), simpler);
  meter?.start(scene);
  zoom = phone() ? "closer" : "room";
  apply(room);
  if (!lastFrame) requestAnimationFrame(frame);
  // The room is up: now its sounds may be fetched, once sound is allowed.
  roomSounds.warm();
  // Moved here from the plain waiting room: say who moved the party.
  if (modeHop.said) hud.note(modeHop.said);
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
  roomSounds?.play("lights-down", -1, { gain: 0.7 });
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
    meter?.start(scene);
  }
  await nextFrame();
  await nextFrame();
  dim?.classList.add("rising");
  dim?.classList.remove("on");
  roomSounds?.play("lights-up", -1, { gain: 0.7 });
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
  return { paused: true, look: "", build: nothing, setRoom: nothing, setVote: nothing, onMove: nothing, onBump: nothing, onFade: nothing, onSpook: nothing, onExpress: nothing, ownJump: nothing, ownBump: nothing, ownX: () => own, setCompact: nothing, frame: nothing, destroy: nothing };
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
  roomSounds?.play("tap", -2, { gain: 0.6 });
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
  // While players are chosen on spots a light is not a vote: the line says which player this is.
  if (room.phase === "settings" && room.choosing?.spots) return `${line.voted ? `You play as ${line.vote}` : "You are not on a spot"}. ${line.rest}.`;
  return `${line.label}: ${line.vote}. ${line.rest}.`;
}

// ---------------------------------------------------------------- what the room says

/** When the room last sent the whole room: moves heard before it are older than its positions. */
let roomSeenAt = 0;

function apply(next) {
  // Someone came in, or went: heard once, by the room (not for this device's own arrival).
  if (room && roomSounds && next.code === room.code) {
    const was = new Set(room.members.filter(Boolean).map((m) => m.seat));
    const now = new Set(next.members.filter(Boolean).map((m) => m.seat));
    if ([...now].some((seat) => !was.has(seat))) roomSounds.play("join", -1, { gain: 0.7 });
    else if ([...was].some((seat) => !now.has(seat))) roomSounds.play("leave", -1, { gain: 0.6 });
  }
  room = next;
  // Until the room answers the start link's pick, its older words do not undo it.
  if (pendingRoom) room.room = pendingRoom;
  voteAt = roomSeenAt = performance.now();
  sounds.setRoom(room.code);
  if (!scene) return;
  scene.setRoom(room, voteAt);
  menu?.update(room);
  looks?.update(room);
  step?.update(room, voteAt);
  // A page that missed a change (a drop, a sleep) catches up from the room itself.
  if (room.room !== shownRoom || look !== scene.look) void showRoom();
  const me = isPlayer() ? room.members[link.you.seat] : null;
  // Which pieces a boo cannot move just now, by the room's word (down, safe, or spooked a moment ago).
  for (const m of room.members) if (m) noBoo(m.seat, voteAt + Math.max(m.safe ?? 0, m.spooked ?? 0));
  if (me) {
    if (!pilot) {
      pilot = new Pilot({ lights: room.boxes.length, send: sendMove, x: me.x, rev: me.rev });
      focus = me.x;
      // A page that arrives in the middle (a reload) takes the room's word on its bump.
      if (me.down > 0) pilot.knock(me.x, me.rev, voteAt, me.down);
      pilot.cool(me.cool ?? 0, voteAt);
      pilot.fadeCool(me.fadeCool ?? 0, voteAt);
      // And on its robot's hook and legs, or its slime's harden (shared/robot.js, slime.js).
      pilot.hookCool(me.hookCool ?? 0, voteAt);
      if (me.hook) pilot.rootedUntil = voteAt + Math.max(0, HOOK_LIFE_MS - me.hook.in);
      pilot.stiltCool(me.stiltCool ?? 0, voteAt);
      if (me.stilts !== undefined) pilot.upUntil = voteAt + STILT_MS - me.stilts;
      pilot.slimeCool(me.slimeCool ?? 0, voteAt);
      // In the middle of its own fade: it still drifts through pieces and boos until it ends.
      if (me.faded > 0) ownFade(me.faded, voteAt);
    } else if (pilot.rev !== me.rev) pilot.place(me.x, me.rev, voteAt);
    tellLit(voteAt);
  }
  // The game is over, or this page missed its end and the next match is on (a drop across a
  // rematch): the view goes, and the next snapshot mounts the one being played (startStage).
  if (stage && stageStale(stage.key, room)) endStage();
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
  // The party is in the other waiting room: this page is on its way there, and draws nothing more.
  if (modeHop.leaving) return;
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
      if (msg.j) roomSounds?.jumped(msg.s, now);
      stirAt = now;
      break;
    case "b":
      if (msg.to >= 0) {
        lastMoves.set(msg.to, { x: msg.x, d: 0, t: now });
        noBoo(msg.to, now + STUN_MS + IMMUNE_MS);
      }
      // A kick into a faded ghost (`sc`): the kicker is scared off to where the room put it (shared/ghost.js).
      if (msg.sc !== undefined) {
        lastMoves.set(msg.s, { x: msg.x, d: 0, t: now });
        noBoo(msg.s, now + SCARE_MS + IMMUNE_MS);
      }
      scene.onBump(msg, now);
      stirAt = now;
      // Knocked: the piece lies where the room threw it, and has nothing to say until it is up.
      if (pilot && msg.to === link.you.seat) pilot.knock(msg.x, msg.rev, now);
      // Scared: the same, for as long as the start, the freeze and the scurry take.
      if (pilot && msg.sc !== undefined && msg.s === link.you.seat) pilot.knock(msg.x, msg.rev, now, SCARE_MS);
      // Bounced off a hardened slime (`bo`, shared/slime.js): the kicker is knocked back itself.
      if (msg.bo !== undefined) {
        lastMoves.set(msg.s, { x: msg.x, d: 0, t: now });
        noBoo(msg.s, now + STUN_MS + IMMUNE_MS);
        if (pilot && msg.s === link.you.seat) pilot.knock(msg.x, msg.rev, now);
        setTimeout(() => moveSound("hook-clang", msg.bo), IMPACT_MS);
      }
      feelBump(msg);
      // The swing (the viewer's own was heard when the button went down), and the blow when it lands.
      if (msg.s !== link.you.seat || !isPlayer()) roomSounds?.swung(msg.s);
      if (msg.to >= 0) setTimeout(() => roomSounds?.struck(msg.s, msg.to), IMPACT_MS);
      // The kick passes through the ghost, and the ghost says boo: feedback for both of them.
      if (msg.sc !== undefined) setTimeout(() => ghostSound("ghost-boo", msg.sc === link.you.seat ? msg.sc : msg.s), IMPACT_MS);
      break;
    case "fade":
      // A ghost faded (shared/ghost.js): see-through, untouchable and without a vote for msg.for.
      // `for: 0`: it is solid again before its time (it became another character).
      stirAt = now;
      scene.onFade(msg, now);
      if (msg.s === link.you.seat && isPlayer()) ownFade(msg.for, now);
      else if (msg.for > 0) ghostSound("ghost-fade", msg.s);
      break;
    case "fade-no":
      // The room turned down this device's fade: its word on the cooldown replaces this page's
      // guess, the fade this page began at once is taken back, and the reason is said as a note
      // (as a refused choice of piece is), unless it only came a moment early.
      pilot?.fadeCool(msg.wait ?? 0, now);
      booUntil = -Infinity;
      if (isPlayer()) scene.onFade({ s: link.you.seat, for: 0 }, now);
      if (!(msg.wait > 0 && msg.wait < 400)) hud?.note(msg.why);
      break;
    case "spook":
      // A faded ghost drifted through a piece and spooked it out of place (boo).
      lastMoves.set(msg.to, { x: msg.x, d: 0, t: now });
      noBoo(msg.to, now + Math.max(SPOOK_AGAIN_MS, SPOOK_MS + IMMUNE_MS));
      scene.onSpook(msg, now);
      stirAt = now;
      if (pilot && msg.to === link.you.seat) {
        pilot.knock(msg.x, msg.rev, now, SPOOK_MS);
        buzz(40);
      }
      ghostSound("ghost-boo", msg.to === link.you.seat ? msg.to : msg.s);
      break;
    case "boo-no":
      // The room did not find this ghost close enough to that piece (or it was spooked a moment
      // ago): nothing happened, and there is nothing to say. The ghost was only drifting by.
      break;
    case "hook":
      // A robot threw its hook (shared/robot.js): it stands still and the hook flies; the room
      // says what came of it when it lands (`hk`).
      stirAt = now;
      scene.onHook(msg, now);
      // The room stopped the robot where it throws from.
      lastMoves.set(msg.s, { x: msg.x, d: 0, t: now });
      if (msg.s !== link.you?.seat || !isPlayer()) moveSound("hook-throw", msg.s);
      break;
    case "hk": {
      stirAt = now;
      scene.onHookVerdict(msg, now);
      const mine = isPlayer() ? link.you.seat : -1;
      // The throw is over: the robot may walk again.
      if (msg.s === mine && msg.o !== "jumped" && pilot) pilot.rootedUntil = -Infinity;
      // Whoever the room moved: their piece is where it put it, and still while it slides.
      const moved = (seat, x, rev, kind) => {
        if (!Number.isFinite(x)) return;
        lastMoves.set(seat, { x, d: 0, t: now });
        noBoo(seat, now + MOVED[kind].ms + MOVED[kind].safe);
        if (pilot && seat === mine) {
          pilot.knock(x, rev, now, MOVED[kind].ms);
          buzz(kind === "pull" ? [40, 30, 40] : 50);
        }
      };
      if (msg.o === "pull") {
        moved(msg.to, msg.x, msg.rev, "pull");
        if (msg.tr) moved(msg.tr.s, msg.tr.x, msg.tr.rev, "pull");
        moveSound("hook-catch", msg.s);
      } else if (msg.o === "stuck") {
        moved(msg.s, msg.x, msg.rev, "pull");
        moveSound("slime-absorb", msg.to);
      } else if (msg.o === "scare") {
        moved(msg.s, msg.x, msg.rev, "hookscare");
        ghostSound("ghost-boo", msg.to);
      } else if (msg.o === "bonk") {
        moved(msg.s, msg.x, msg.rev, "bonk");
        moved(msg.to, msg.ox, msg.orev, "bonk");
        if (msg.to === mine) pilot?.hookCool(HOOK_COOLDOWN_MS, now);
        moveSound("robot-bonk", msg.s);
      } else if (msg.o === "clang" || msg.o === "parry") moveSound("hook-clang", msg.to);
      break;
    }
    case "hook-no":
      // The room turned down this robot's hook: its word on the cooldown, and the throw this page began is wound back.
      pilot?.hookCool(msg.wait ?? 0, now);
      if (isPlayer()) scene.ownRefused("hook", now);
      if (!(msg.wait > 0 && msg.wait < 400)) hud?.note(msg.why);
      break;
    case "stilts":
      stirAt = now;
      scene.onStilts(msg, now);
      if (msg.s !== link.you?.seat || !isPlayer()) moveSound("stilts-up", msg.s);
      setTimeout(() => moveSound("stilts-down", msg.s), Math.max(0, msg.for - 60));
      break;
    case "stilts-no":
      pilot?.stiltCool(msg.wait ?? 0, now);
      if (isPlayer()) scene.ownRefused("stilts", now);
      if (!(msg.wait > 0 && msg.wait < 400)) hud?.note(msg.why);
      break;
    case "slime":
      stirAt = now;
      scene.onSlime(msg, now);
      if (msg.s !== link.you?.seat || !isPlayer()) moveSound(msg.k === "absorb" ? "slime-absorb" : "slime-harden", msg.s);
      break;
    case "slime-no":
      // A held press the room did not turn soft (it came late) is only a harden: nothing is said.
      if (msg.k === "harden") {
        pilot?.slimeCool(msg.wait ?? 0, now);
        if (isPlayer()) scene.ownRefused("slime", now);
        if (!(msg.wait > 0 && msg.wait < 400)) hud?.note(msg.why);
      }
      break;
    case "shove":
      // A walking slime shoved a piece a step on (shared/slime.js).
      lastMoves.set(msg.to, { x: msg.x, d: 0, t: now });
      scene.onShove(msg, now);
      stirAt = now;
      if (pilot && msg.to === link.you.seat) pilot.knock(msg.x, msg.rev, now, SHOVE_MS);
      moveSound("slime-shove", msg.to);
      break;
    case "cd":
      // The room refused a bump: its word on how long is left replaces this page's guess.
      pilot?.cool(msg.in, now);
      break;
    case "fix":
      pilot?.place(msg.x, msg.rev, now);
      break;
    case "e":
      stirAt = now;
      emoted(msg);
      break;
    case "wait":
      // The room refused this player's emote: its word on how long is left replaces this page's guess.
      if (msg.in > 0) emoteAt = now - (EMOTE_COOLDOWN_MS - msg.in);
      break;
    case "vote":
      tossSounds(room.vote, msg.vote, now);
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
    case "look-no":
      // The room turned down this device's choice of character or colour: said on the sheet, or as a note.
      // One that only came a little early is sent again by itself, and nothing is said.
      if (looks && !looks.refused(msg.why, msg.wait)) hud?.note(msg.why);
      break;
    case "look-ok":
      // The room already had the piece this device asked for: nothing to wait for.
      looks?.answered();
      break;
    case "mode-no":
      // The room did not move the party to the plain waiting room: said the same way.
      if (menu?.isOpen) menu.modeRefused(msg.why);
      else hud?.note(msg.why);
      break;
    case "note":
      if (msg.k === "left") hud?.note(`${msg.name} left`, msg.colour);
      // A game that ended early because a player in it left or did not come back says why.
      else if (msg.k === "ended") hud?.note(msg.text, msg.colour);
      // The settings step ended with nobody playing: the host went back, or a player left.
      else if (msg.k === "cancelled") hud?.note(msg.text);
      break;
    case "settings-no":
      // The room turned down this device's change of settings: said on the card, or as a note.
      if (step?.isOpen) step.refused(msg.message);
      else hud?.note(msg.message);
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
 * Someone sent an emote: their piece performs it, with its word over their head (the room view
 * draws it). Its own sound plays from the big screen when the room has one and on every
 * player's device when it has none (the kit's rule), unless this device muted it or the game
 * being played does not allow it.
 */
function emoted(msg) {
  const who = room?.members[msg.s];
  const what = emoteById(msg.e);
  if (!who || !what) return;
  scene?.onExpress(msg, performance.now());
  const name = emoteSound(msg.e);
  if (hasSound(name) && soundAllowedNow(room.phase === "playing", playRules()) && soundPlaysHere(link.you?.role, room.screens)) void sounds.play(name, { from: who.name });
}

/** What the game being played allows (its manifest's lobby.emotes / lobby.emoteSounds), or the defaults. */
const playRules = () => room.boxes.find((b) => b.id === room.game?.id)?.play ?? DURING_PLAY;

/** How long until this player may send an emote (0: now), or -1 when the game being played does not allow them. */
function emoteWait(now) {
  if (!room || !isPlayer()) return -1;
  const may = mayEmote(emoteAt, now, { playing: room.phase === "playing", rules: playRules() });
  return may.ok ? 0 : may.wait;
}

/**
 * The player sent an emote (the wheel, or a number key). It shows on this device at once and goes
 * to the room, which passes it on to everybody else. Its sound plays here only where the room's
 * sounds play (no big screen in the room).
 */
function sendEmote(id) {
  const now = performance.now();
  if (!scene || emoteWait(now) !== 0 || !emoteById(id)) return false;
  emoteAt = now;
  stirAt = now;
  link.send(emoteMessage(id));
  const me = room.members[link.you.seat];
  scene.onExpress({ t: "e", s: link.you.seat, e: id }, now);
  const name = emoteSound(id);
  if (me && hasSound(name) && soundAllowedNow(room.phase === "playing", playRules()) && soundPlaysHere(link.you.role, room.screens)) void sounds.play(name, { from: me.name });
  return true;
}

/** The coin toss: the flip when it starts, and the coin landing when it comes down. */
function tossSounds(before, after, now) {
  if (!after?.toss || before?.toss) return;
  roomSounds?.play("toss-flip", -1, { gain: 0.8 });
  const at = now + after.toss.endsIn;
  setTimeout(() => roomSounds?.play("toss-land", -1), Math.max(0, at - performance.now()));
}

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
    // The match this view is for, and so who this device is in it (ctx.you): shared/stage.js.
    key: stageKey(room.game),
    events: (...args) => pass("events", args),
    snapshot: (...args) => pass("snapshot", args),
    unmount() {
      mine.gone = true;
      mine.view?.unmount();
    },
  };
  // A game laid out for an upright phone: the page lets go of sideways for the players and its
  // audience while it is on (the big screen keeps its shape), and the view is told so.
  const upright = !!room.game.upright && link.you?.role === "player";
  allowUpright(upright);
  // send(data, {id}) asks a turn-based game for an answer (a promise); inputId() makes an id no other input of this page has used.
  const ctx = { room, you: viewerOfGame(link.you, room.game), upright, snapshot, send: (data, opts) => link.sendInput(data, opts), inputId: () => link.nextInputId(), now: () => link.now(), inset: DOOR_INSET, params };
  if (ctx.you?.role === "screen" && ctx.you.seat >= 0 && room.game.late?.includes(ctx.you.seat)) hud?.note("You joined mid-game: you will see everything next match");
  viewModule(box)
    .then((module) => {
      if (mine.gone || !module?.mount) return;
      stageBox.hidden = false;
      mine.view = module.mount(stageBox, ctx);
      // Any view of a game: the room's bar and its buttons do nothing for the game, so they make
      // way for it. A view that covers everything: the room is not drawn under it either.
      app.classList.add("staged");
      app.classList.toggle("in-game", !!mine.view.full);
      for (const [method, args] of mine.waiting.splice(0)) mine.view[method](...args);
    })
    .catch((err) => hud?.note(`The game could not be shown: ${err.message}`));
}

function endStage() {
  stage?.unmount();
  stage = null;
  app.classList.remove("in-game", "staged");
  if (stageBox) stageBox.hidden = true;
  if (document.documentElement.classList.contains("upright")) allowUpright(false);
}

/**
 * Who this device is to the game's view: as the room decides it (LobbyCore.viewerOf, by the kit's
 * viewerFor), from the room view's game. A member who is not in a game that takes an audience
 * watches as `{role: "audience", seat}`, unless it joined in the middle of the match (`game.late`):
 * then it watches as the big screen does, `{role: "screen", seat}`. Any other game is told the
 * device's own identity, as before.
 */
function viewerOfGame(you, game) {
  if (you?.role !== "player" || !game?.audience || !Array.isArray(game.seats) || game.seats.includes(you.seat)) return you;
  return { role: game.late?.includes(you.seat) ? "screen" : "audience", seat: you.seat };
}

/** While a count runs for a game with a view of its own, its files are fetched ahead of the start. */
function warmUp(vote) {
  if (!vote?.count || vote.leaders.length !== 1) return;
  const box = room.boxes.find((b) => b.id === vote.leaders[0]);
  if (box?.view) void viewModule(box).then((module) => module?.preload?.()).catch(() => {});
}

link.on("start", (msg) => {
  // The count's chime is the start; a game that starts with no count (a reload) gets its own.
  if (performance.now() - countGoAt > 2000) roomSounds?.play("game-start", -1, { gain: 0.8 });
  apply(msg.room);
  startStage(msg.s);
});
link.on("events", (events) => stage?.events(events));
link.on("snapshot", (snapshot, now, full) => (stage ? stage.snapshot(snapshot, now, full) : startStage(snapshot)));
link.on("end", (msg) => {
  stirAt = performance.now();
  endStage();
  apply(msg.room);
  // A game ended early with nobody placed has no card to show: the room's note says why it ended.
  if (msg.last.rows.length || !msg.last.early) hud?.result(msg.last);
  roomSounds?.play("result", -1, { gain: 0.8 });
});

link.on("status", (status) => {
  hud?.link(status === "reconnecting" ? "Reconnecting..." : "");
  // Back after a drop: the room stood the piece still, so say again where it is going.
  if (status === "open" && pilot) pilot.dirty = true;
  // An answer to a choice of piece lost with the drop never comes: a tap on it again is sent again.
  if (status === "open") looks?.forget();
});

link.on("closed", (why, reason) => {
  // A seat let go because its person left from another device of theirs says so ("left").
  const said = bye ?? (why === "seat_lost" ? (reason === "left" ? "left" : "seat_lost") : reason || "room_closed");
  bye = null;
  // Also a saved session whose room is gone (a reload after it closed): the front page says so.
  closed(said);
});

// An error with an id is the late answer to a game's input that no longer waits for it: not for the room's notes.
link.on("error", (err) => err.id === undefined && hud?.note(err.message));

// ---------------------------------------------------------------- keys and fingers

// The pieces walk in the lobby, and while a game's players are chosen on its spots (bumping stays the lobby's).
const canMove = () => !!pilot && (room?.phase === "lobby" || !!room?.choosing?.spots) && !hud?.sheet && !hud?.card && !board && !menu?.isOpen && !looks?.isOpen;

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
  // A robot's jump is its stilt legs (shared/robot.js): they go up on this phone at once, and the
  // room says so to everybody, or takes them back (stilts-no).
  if (ownMove() === "hook") {
    if (canMove() && pilot.stilts(now)) {
      scene.ownStilts(now);
      moveSound("stilts-up", link.you.seat);
    }
    return;
  }
  if (canMove() && pilot.jump(now)) {
    scene.ownJump(now);
    roomSounds?.jumped(link.you.seat, now);
  }
}

/** What the player's own character's move button does (shared/characters.js): "kick", "fade", "hook" or "harden". */
const ownMove = () => moveOf(room?.members[link.you?.seat]?.character);

/** When the move button went down and is still held (a slime's hold turns its harden soft), or null. */
let pressedAt = null;

/**
 * The move button. A kick: the wind-up starts the moment the button goes down; the room decides
 * whether the blow lands. A fade (a ghost's move): it fades on this phone at once, and the room
 * says so to everybody, or takes it back (fade-no). A hook (a robot's): it winds up at once and
 * the room judges where it lands. A harden (a slime's): it hardens at once; held, it goes soft
 * (frame: absorb).
 */
function bump() {
  const now = performance.now();
  pressedAt = now;
  const move = ownMove();
  if (move === "fade") return fadeNow(now);
  if (!canMove() || room.phase !== "lobby") return;
  if (move === "hook") {
    if (pilot.hook(now)) {
      scene.ownHook(now);
      moveSound("hook-throw", link.you.seat);
    }
    return;
  }
  if (move === "harden") {
    if (pilot.slime("harden", now)) {
      scene.ownSlime("harden", now);
      moveSound("slime-harden", link.you.seat);
    }
    return;
  }
  if (pilot.bump(now)) {
    scene.ownBump(now);
    roomSounds?.swung(link.you.seat);
  }
}

/** The move button came up: a slime's press was a tap. */
function unbump() {
  pressedAt = null;
}

/** A slime's move button held past HOLD_MS: the harden just begun turns soft (absorb). */
function holdMove(now) {
  if (pressedAt === null || now - pressedAt < HOLD_MS || ownMove() !== "harden" || !pilot || !canMove()) return;
  pressedAt = null;
  if (pilot.slime("absorb", now)) {
    scene.ownSlime("absorb", now);
    moveSound("slime-absorb", link.you.seat);
  }
}

/** seat -> until when (this page's clock) this slime does not tell the room it touched that piece again. */
const shovedAt = new Map();

/**
 * The heavy slime, on this player's own slime: walking into a piece, it tells the room, which
 * judges it (shove, or nothing). Looked at only while it walks and is neither hard nor soft. A
 * piece this page can see would not be shoved (a slime, a robot up on its legs, a faded ghost, one
 * down or just up) is not asked about.
 */
function heavy(now) {
  if (!pilot || pilot.d === 0 || pilot.down(now) || ownMove() !== "harden") return;
  const me = room.members[link.you.seat];
  if (me?.hard > 0 && now - voteAt < me.hard) return;
  const own = scene.pieces?.get(link.you.seat);
  if (own?.goo) return;
  const x = pilot.x;
  for (const other of piecesNow(now)) {
    if (other.seat === link.you.seat) continue;
    const ahead = (other.x - x) * pilot.d;
    if (ahead < 0 || ahead > SHOVE_REACH) continue;
    if (now < (shovedAt.get(other.seat) ?? -Infinity) || now < (booless.get(other.seat) ?? -Infinity)) continue;
    const them = scene.pieces?.get(other.seat);
    const character = room.members[other.seat]?.character;
    if (moveOf(character) === "harden" || them?.stilt || now < (them?.fadeUntil ?? 0)) continue;
    shovedAt.set(other.seat, now + SHOVE_AGAIN_MS + 40);
    link.send({ t: "shove", to: other.seat });
  }
}

/**
 * The robot's and the slime's own sounds (move-sounds.js), made on this device the first time one
 * of them does anything: a party with neither never builds them.
 */
function moveSound(name, seat) {
  defineMoveSounds();
  roomSounds?.play(name, seat, { gain: 0.75 });
}

/** Seats this fade has already said it drifted through: each is told to the room once (boo). */
let booSent = new Set();
/**
 * Until when this page may tell the room it drifted through a piece, by this page's clock: set
 * only by the room's own word that this ghost is faded (its `fade`, or the room view after a
 * reload), and ending BOO_EARLY_MS before that fade does, so a boo never reaches the room after
 * the fade is over there (shared/ghost.js: the room counts such boos against the socket).
 */
let booUntil = -Infinity;
/** seat -> until when (this page's clock) a boo cannot move that piece: down, safe, or spooked a moment ago. */
const booless = new Map();

function noBoo(seat, until) {
  if (until > (booless.get(seat) ?? -Infinity)) booless.set(seat, until);
}

/** The room says this player's own ghost is faded for `left` more milliseconds (0: it is solid now). */
function ownFade(left, now) {
  if (left > 0 && now >= booUntil) booSent = new Set();
  booUntil = left > 0 ? now + left - BOO_EARLY_MS : -Infinity;
}

function fadeNow(now) {
  if (!canMove() || room.phase !== "lobby") return;
  // The room refuses a fade during the count or the toss (shared/ghost.js): said here at once, and nothing is sent.
  if (room.vote.count || room.vote.toss) return void hud?.note(room.vote.count ? "Not during the count." : "Not during the coin toss.");
  if (!pilot.fade(now)) return;
  booSent = new Set();
  scene.onFade({ s: link.you.seat, for: FADE_MS }, now);
  ghostSound("ghost-fade", link.you.seat);
}

/**
 * Boo, on this player's own faded ghost: drifting through another piece, it tells the room once
 * per piece per fade, and the room judges it (spook or boo-no). Looked at only while the room
 * has this ghost faded and it is walking: nothing at all otherwise. A piece this page can see a
 * boo would not move (another ghost, one down or just up, one spooked a moment ago) is not asked.
 */
function drift(now) {
  if (now >= booUntil || !pilot || pilot.d === 0 || pilot.down(now)) return;
  const x = pilot.x;
  for (const other of piecesNow(now)) {
    if (other.seat === link.you.seat || booSent.has(other.seat) || Math.abs(other.x - x) > SPOOK_REACH) continue;
    // A ghost does not spook a ghost, and a piece on the floor, just up or just spooked is not spooked: not asked.
    if (moveOf(room.members[other.seat]?.character) === "fade" || now < (booless.get(other.seat) ?? -Infinity)) continue;
    booSent.add(other.seat);
    link.send({ t: "boo", to: other.seat });
  }
}

/**
 * The ghost's own sounds (ghost-sounds.js), made on this device the first time a ghost does
 * anything: a party with no ghost never builds them. Played as the room's sounds are (room-sounds.js).
 */
function ghostSound(name, seat) {
  defineGhostSounds();
  roomSounds?.play(name, seat, { gain: 0.8 });
}

const WALK_KEYS = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
const JUMP_KEYS = new Set([" ", "ArrowUp", "w", "W"]);
const BUMP_KEYS = new Set(["b", "B", "x", "X", "Shift"]);

addEventListener("keydown", (e) => {
  if (!scene || e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape" && hud?.wheel?.isOpen) return hud.wheel.close();
  if (e.key === "Escape" && hud?.loadoutSheet?.el.isConnected) return hud.loadoutSheet.close();
  if (e.key === "Escape" && board) return hideBoard();
  if (e.key === "Escape" && menu?.isOpen) return menu.close();
  if (e.key === "Escape" && looks?.isOpen) return looks.close();
  if (e.key === "Escape" && touch?.card) return touch.closeCard();
  if (e.key === "Escape") return hud?.sheet ? hud.sheet.click() : hud?.openSheet();
  if (e.key in WALK_KEYS) {
    if (!e.repeat) press(e.key.toLowerCase(), WALK_KEYS[e.key], true);
  } else if (JUMP_KEYS.has(e.key)) {
    if (!e.repeat) jump();
  } else if (BUMP_KEYS.has(e.key)) {
    if (!e.repeat) bump();
  } else if (/^[1-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && hud?.wheel && !hud.sheet && !hud.loadoutSheet?.el.isConnected && !board) {
    if (!e.repeat) hud.wheel.fire(Number(e.key) - 1);
  } else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => {
  if (e.key in WALK_KEYS) press(e.key.toLowerCase(), WALK_KEYS[e.key], false);
  else if (BUMP_KEYS.has(e.key)) unbump();
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
    // The move button is the player's character's own: the kick, a ghost's fade, a robot's hook, a slime's harden.
    pilot.move = ownMove();
    hud.pad?.setMove(pilot.move);
    hud.pad?.show({ cooling: pilot.cooling(now), down: pilot.down(now), of: MOVE_COOLDOWN[pilot.move] ?? BUMP_COOLDOWN_MS });
    if (pilot.move === "fade") drift(now);
    if (pilot.move === "harden") {
      holdMove(now);
      heavy(now);
    }
  }
  if (hud.wheel) {
    const wait = emoteWait(now);
    hud.wheel.show(Math.max(0, wait), wait !== -1);
  }
  board?.update(room, boardLine(now));
  const mine = isPlayer() ? scene.ownX() : 960;
  focus += (mine - focus) * Math.min(1, dt * 7);
  // While a count or a coin toss is on, a phone pulls back to the whole room: that is where it happens.
  const drama = room.phase === "lobby" && (room.vote.count || room.vote.toss);
  const bar = hud.barHeight();
  let aim = camera({ w: innerWidth, h: innerHeight, bar, mode: isPlayer() && !drama ? zoom : "room", focusX: focus, phone: phone(), boxes: room.boxes.length });
  // While the spot card lies over the top of a phone's screen, the room is framed so that no name
  // tag, stacked or mid-jump, goes under it (card-clear.js).
  const cardBottom = phone() ? step?.cardBottom() : null;
  if (cardBottom != null && view) aim = clearOfCard(aim, { cardBottom, top: drawnTagsTop(), w: innerWidth, h: innerHeight, bar, jump: JUMP_HEIGHT, bottom: PHONE_FRAME.bottom, room: FRAME });
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
    meter?.frame(t);
  }
  hud.update(room, room.vote, now, voteAt, zoom, now - stirAt);
  const left = room.vote.count ? Math.max(0, room.vote.count.endsIn - (now - voteAt)) : null;
  count?.update(room, left);
  step?.frame(now);
  // The count's end: a chime, once, as the game starts.
  if (left !== null && left <= 0 && countLeft > 0 && room.phase === "lobby") {
    countGoAt = now;
    roomSounds?.play("count-go", -1, { gain: 0.85 });
  }
  countLeft = left ?? Infinity;
  roomSounds?.frame(piecesNow(now), room.boxes.length, now);
}

/** The highest any piece's name tag can be, in world units, from the tags as last drawn (card-clear.js). */
function drawnTagsTop() {
  const tags = [];
  for (const p of scene?.pieces?.values() ?? []) {
    const el = p.tag?.el ?? p.tag;
    if (!el?.getBoundingClientRect || p.leaving) continue;
    const r = el.getBoundingClientRect();
    tags.push({ top: r.top, height: r.height, up: p.up ?? 0 });
  }
  return tagsTop(tags, { y: view.y, scale: innerWidth / view.width });
}

/** When the count last ran out, and how much it had left a frame ago. */
let countGoAt = -Infinity;
let countLeft = Infinity;

/** Where every piece is now, as far as this page knows: the player's own from its Pilot, the others from their last move. */
function piecesNow(now) {
  const out = [];
  for (const m of room.members) {
    if (!m?.connected) continue;
    const own = isPlayer() && m.seat === link.you.seat && pilot;
    const move = lastMoves.get(m.seat);
    out.push({ seat: m.seat, x: own ? scene.ownX() : move && move.t > roomSeenAt ? posAt(move, now) : posAt({ x: m.x, d: m.d, t: roomSeenAt }, now) });
  }
  return out;
}

// ---------------------------------------------------------------- begin

// The room is laid out against what is really visible, whatever the browser's bars are doing.
fitVisible();
if (params.has("join") || params.has("start") || !link.resume()) showDoor();
