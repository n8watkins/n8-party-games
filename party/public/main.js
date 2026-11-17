// The Table (/party/): the party's plain waiting room, with no characters, where the party sits,
// talks and takes turns.
//
// The same party as the Floor (/lobby/, the character room): the same room on the server, the
// same socket, the same seat, resumed from the session the Floor saved in this tab. The host
// switches the whole party between the two rooms (lobby/shared/mode.js, where their names are);
// a page whose room the party is not in moves itself to the other one (lobby/public/hop.js).
//
// What is here: the party's code and QR code, who is here (the host marked, a dropped phone
// grey), the switch between the two rooms (the host's taps only), and the Table's games: a plain
// list that follows the party's size (lobby/shared/table.js), from which the host picks one.
// Everyone sees it starting for a moment, then the players' pages show the game (stage.js) and
// the big screen watches it; anyone else waits here and sees a game is on. When it ends everyone
// is back here with the result. It loads nothing of the Floor's drawing: no three.js, no pieces.
// The big screen (`as=screen`, or a wide window) gets a wide layout of the same.
import { PartyClient } from "/party-kit/client/party-client.js";
import { KEEP_ALIVE_MS, watchConnection } from "/lobby/connection.js";
import { h, icon } from "/lobby/dom.js";
import { farewellKind, goFront } from "/lobby/farewell.js";
import { watchMode } from "/lobby/hop.js";
import { MODES, MODE_NAME, modeLocked, modeTitle } from "/lobby/shared/mode.js";
import { stageStale } from "/lobby/shared/stage.js";
import { PLAY_BEAT_MS, partyFull, showsTests, tableLine, tablePlayers } from "/lobby/shared/table.js";
import { mountStage, viewerAtTable } from "/party/stage.js";

const app = document.getElementById("app");
const link = new PartyClient({ api: "/api/lobby", quietPing: { text: "ping", everyMs: KEEP_ALIVE_MS } });
const isPlayer = () => link.you?.role === "player";
// A locked phone closes its socket and opens it again when it is shown (connection.js).
watchConnection(link, { player: () => isPlayer() });
// The party is on the Floor: this page moves there (hop.js). Added before the page's own room handler.
const modeHop = watchMode(link, "turn-based");

/** A switch this device asked for and the room has not answered yet: given up after this long. */
const SWITCH_WAIT_MS = 4000;
const NOTE_MS = 4000;
/** The last game's card is shown to a page that loads this soon after it ended (a reload). */
const RESULT_FRESH_MS = 2 * 60_000;
const TV_ICON = ["M3 5h18v12H3z", "M8 21h8", "M12 17v4"];
const DOOR_ICON = ["M14 4h5v16h-5", "M10 12H3", "M7 8l-4 4 4 4"];
const PLACE = ["1st", "2nd", "3rd", "4th"];

let room = null;
let ui = null;
/** The mode this device asked for, until the room answers. */
let asked = null;
let askedTimer = null;
/** Set when this device chose to go, so the socket closing is not taken for the room ending. */
let bye = null;
/** The game's view while this page shows one (stage.js), or null. */
let stage = null;
/** Set while the game's view says its match is decided (its final screen is up): "End the game" steps aside. */
let decided = false;
/** The last game's card ({...room.last}), shown on the list until it is put away or the next game starts. */
let card = null;
/** The round of the card this page put away, so a reload does not bring it back. */
let cardDone = 0;
/** A game this host asked to start, until the room answers. */
let picked = null;
let pickedTimer = null;

// ---------------------------------------------------------------- the page

/** The big screen's layout: the room's screen, or a page opened with ?as=screen. */
const wide = () => link.you?.role === "screen" || new URLSearchParams(location.search).get("as") === "screen";

/** Builds the page once, on the first room view. Everything after is update(). */
function build() {
  app.textContent = "";
  const screen = link.you?.role === "screen";
  if (wide()) document.documentElement.classList.add("as-screen");
  const top = h("header", "top", "", app);
  // The room's own name is the page's heading, and under it one plain line: who hosts
  // (tableLine), or for a few seconds what just happened (notes take its place, so they never cover
  // anything on the page).
  const title = h("div", "title", "", top);
  const brand = h("h1", "brand", "", title);
  h("span", "brand-mark", "", brand);
  h("span", "", modeTitle("turn-based"), brand);
  const line = h("p", "line", "", title);
  line.setAttribute("aria-live", "polite");
  const lineText = h("span", "line-text", "", line);
  const lineNote = h("span", "line-note", "", line);
  const status = h("p", "status", "", top);
  status.setAttribute("role", "status");
  const leave = h("button", "leave", "", top);
  leave.type = "button";
  leave.append(icon(DOOR_ICON, 18));
  h("span", "", screen ? "Stop showing" : "Leave", leave);
  leave.addEventListener("click", () => openLeave());

  // The game being played, for its players and the big screen: its own view fills the page under
  // the bar, with the code kept in the bar's line. The host can end it from here.
  const stageWrap = h("section", "stage", "", app);
  stageWrap.hidden = true;
  const stageHead = h("div", "stage-head", "", stageWrap);
  const stageName = h("h2", "stage-name", "", stageHead);
  const stop = h("button", "stop", "End the game", stageHead);
  stop.type = "button";
  stop.addEventListener("click", () => openStop());
  const stageBox = h("div", "stage-box", "", stageWrap);

  // What everyone must see without scrolling, under the bar: a game starting, a game on (for
  // whoever waits here), and the last game's card.
  const news = h("div", "news", "", app);
  const banner = h("div", "banner", "", news);
  banner.hidden = true;
  const cardBox = h("div", "card", "", news);
  cardBox.setAttribute("aria-label", "The last game");
  cardBox.hidden = true;

  const grid = h("div", "grid", "", app);

  // The switch between the two rooms, for the one who holds the controls only (update): anyone
  // else reads who hosts in the line under the heading. On the big screen it sits in the bar
  // at the top, so the code and everyone's names fit on the screen without scrolling.
  const rooms = h("section", "panel rooms", "", wide() ? top : grid);
  if (wide()) top.insertBefore(rooms, status);
  rooms.setAttribute("aria-label", "Waiting room");
  const toggle = h("div", "switch", "", rooms);
  toggle.setAttribute("role", "radiogroup");
  toggle.setAttribute("aria-label", "Which waiting room the party is in");
  const options = MODES.map((mode) => {
    const option = h("button", "switch-option", modeTitle(mode), toggle);
    option.type = "button";
    option.setAttribute("role", "radio");
    option.dataset.mode = mode;
    option.addEventListener("click", () => switchTo(mode));
    return option;
  });
  const why = h("p", "switch-why", "", rooms);
  why.setAttribute("role", "alert");
  why.hidden = true;

  // The code, large, and the QR code; when every place is taken, neither (partyFull), only that
  // the party is full.
  const code = h("section", "panel code", "", grid);
  code.setAttribute("aria-label", "The party's code");
  const kicker = h("p", "kicker", "Join this party", code);
  const codeRow = h("div", "code-row", "", code);
  const digits = h("p", "digits", "----", codeRow);
  const qrTile = h("div", "qr", "", codeRow);
  const qr = h("img", "", "", qrTile);
  qr.alt = "";
  qr.width = 160;
  qr.height = 160;
  const where = h("p", "where", "Scan it, or type the code on the front page", code);
  const fullWords = h("p", "full-words", "Every place is taken. Someone has to leave before anyone else can join.", code);
  fullWords.hidden = true;

  // The Table's games: the last game's card, what is going on (a game starting, or on), and the
  // list, which follows the party's size. Before who is here, so an upright phone shows the games
  // first (the owner's layout); wider layouts place each panel by name (party.css).
  const games = h("section", "panel games", "", grid);
  games.setAttribute("aria-label", "Games");
  const gamesHead = h("div", "panel-head", "", games);
  h("h2", "", "Games", gamesHead);
  const gamesBy = h("span", "count", "", gamesHead);
  const gameList = h("ul", "game-list", "", games);
  const playWhy = h("p", "switch-why", "", games);
  playWhy.setAttribute("role", "alert");
  playWhy.hidden = true;

  // Who is here.
  const people = h("section", "panel people", "", grid);
  people.setAttribute("aria-label", "Who is here");
  const peopleHead = h("div", "panel-head", "", people);
  h("h2", "", "Who is here", peopleHead);
  const count = h("span", "count", "", peopleHead);
  const list = h("ul", "list", "", people);

  ui = { top, status, rooms, options, line, lineText, lineNote, why, code, kicker, codeRow, fullWords, digits, qr, where, count, list, shown: "", grid, stageWrap, stageName, stageBox, stop, gamesBy, cardBox, banner, gameList, playWhy, listKey: "", cardKey: "", bannerKey: "" };
  void fillQr();
}

/** The QR code and the address under the code, once the join link is known. */
async function fillQr() {
  const url = await link.joinUrl("/lobby/");
  if (!ui) return;
  ui.qr.src = link.qrUrl(url);
  ui.qr.alt = `QR code to join party ${room?.pin ?? ""}`.trim();
  ui.where.textContent = `Scan it, or type the code at ${new URL(url).host}`;
}

/** Whether this device's taps switch the room and pick the game: it holds the controls (the room's picker). */
function mine() {
  const p = room?.picker;
  if (!p) return false;
  return p.seat === -1 ? link.you?.role === "screen" : isPlayer() && p.seat === link.you.seat;
}

/** Who holds the controls, as words. */
function holder() {
  const p = room?.picker;
  if (!p) return null;
  return p.seat === -1 ? "the room's screen" : (room.members[p.seat]?.name ?? null);
}

const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** Whether this page shows the game being played: a player in it, or the big screen. Anyone else waits at the Table. */
function showsGame() {
  if (room?.phase !== "playing" || !room.game) return false;
  const viewer = viewerAtTable(link.you, room.game);
  return viewer.role === "player" || link.you?.role === "screen";
}

function update() {
  if (!ui || !room) return;
  // The switch: the party's room is the one pressed in; only the host's taps do anything.
  const host = mine();
  for (const option of ui.options) {
    const here = option.dataset.mode === room.mode;
    const going = option.dataset.mode === asked;
    option.classList.toggle("here", here);
    option.classList.toggle("going", going);
    option.setAttribute("aria-checked", String(here));
    option.setAttribute("aria-disabled", String(!host || here));
    option.textContent = going ? "Moving..." : modeTitle(option.dataset.mode);
  }
  // Only the one who holds the controls gets the switch; it looks flat while it cannot be used.
  ui.rooms.hidden = !host;
  document.documentElement.classList.toggle("holds-controls", host);
  ui.options[0].parentElement.classList.toggle("locked", !!modeLocked(room) || !!room.starting);
  const name = holder();
  const staged = showsGame();
  const full = partyFull(room);
  // Who hosts; while a game fills the page the code stays in the line, so the party can still be joined.
  ui.lineText.textContent = tableLine({ staged, host, name, pin: room.pin, full });
  ui.digits.textContent = room.pin ?? "----";
  ui.digits.setAttribute("aria-label", `Code ${(room.pin ?? "").split("").join(" ")}`);
  // A full party shows no way in: no code, no QR code, only that it is full.
  ui.code.classList.toggle("full", full);
  ui.code.setAttribute("aria-label", full ? "The party is full" : "The party's code");
  ui.kicker.textContent = full ? "This party is full" : "Join this party";
  ui.codeRow.hidden = full;
  ui.where.hidden = full;
  ui.fullWords.hidden = !full;
  // Who is here, in seat order, then the big screen.
  const members = room.members.filter(Boolean);
  const key = JSON.stringify([members.map((m) => [m.seat, m.name, m.colour, m.connected, m.away, m.points]), room.picker, room.screens, link.you, room.game?.seats ?? null]);
  if (key !== ui.shown) {
    ui.shown = key;
    ui.list.textContent = "";
    // Everyone here, in seat order, then one row for the places still free, so the list shows how
    // many more can join without a column of empty rows (the Table has eight).
    for (const m of members) ui.list.append(personRow(m));
    const free = room.members.length - members.length;
    if (free > 0) ui.list.append(freeRow(free));
    if (room.screens > 0 || room.picker?.seat === -1) ui.list.append(screenRow());
    ui.count.textContent = `${members.length} of ${room.members.length}`;
  }
  // The game, or the Table.
  document.documentElement.classList.toggle("staged", staged);
  ui.stageWrap.hidden = !staged;
  ui.grid.hidden = staged;
  ui.stop.hidden = !host || decided;
  if (staged) ui.stageName.textContent = room.game.name;
  updateGames(host);
}

function personRow(m) {
  const li = h("li", `person${m.connected ? "" : " gone"}`);
  const dot = h("span", "dot", "", li);
  dot.style.background = m.connected ? m.colour : "#6f655b";
  const words = h("span", "person-words", "", li);
  h("span", "person-name", m.name, words);
  const me = isPlayer() && m.seat === link.you.seat;
  const playing = room.phase === "playing" && room.game?.seats?.includes(m.seat);
  const state = !m.connected ? "Reconnecting" : m.away ? "Away" : playing ? "Playing" : "";
  if (me || state) h("span", "person-sub", [me ? "You" : "", state].filter(Boolean).join(" · "), words);
  if (room.picker?.seat === m.seat) h("span", "tag host", "Host", li);
  if (m.points > 0) h("span", "tag points", `${m.points} pt${m.points === 1 ? "" : "s"}`, li);
  return li;
}

function freeRow(n) {
  const li = h("li", "person free");
  h("span", "dot", "", li);
  h("span", "person-name", n === 1 ? "One more can join" : `${n} more can join`, h("span", "person-words", "", li));
  return li;
}

function screenRow() {
  const li = h("li", `person screen${room.screens > 0 ? "" : " gone"}`);
  h("span", "screen-icon", "", li).append(icon(TV_ICON, 18));
  const words = h("span", "person-words", "", li);
  h("span", "person-name", "The big screen", words);
  const me = link.you?.role === "screen";
  if (me || !room.screens) h("span", "person-sub", me ? "This screen" : "Reconnecting", words);
  if (room.picker?.seat === -1) h("span", "tag host", "Host", li);
  return li;
}

// ---------------------------------------------------------------- the games

/** The names of seats, as people say them: "Ann", "Ann and Bo", "Ann, Bo and Cy". */
function names(seats) {
  const list = seats.map((seat) => room.members[seat]?.name ?? "someone");
  return list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/** The Table's games panel: the card, what is going on, and the list. */
function updateGames(host) {
  const dev = showsTests(location.hash);
  const entries = (room.table ?? []).filter((e) => !e.test || dev);
  const name = holder();
  const playing = room.phase === "playing" && room.game;
  const free = room.phase === "lobby" && !room.starting && !picked;
  ui.gamesBy.textContent = host ? "You pick" : name ? `${capital(name)} picks` : "";

  // The last game's card, until it is put away or the next game starts.
  const cardKey = JSON.stringify([card, room.members.map((m) => m?.name ?? null)]);
  if (cardKey !== ui.cardKey) {
    ui.cardKey = cardKey;
    drawCard();
  }

  // What is going on: a game starting (everyone), or a game on (whoever waits here).
  const banner = room.starting ? ["starting", room.starting.id, room.starting.name] : playing ? ["on", room.game.id, room.game.round, room.game.seats ?? [], host] : null;
  const bannerKey = JSON.stringify(banner);
  if (bannerKey !== ui.bannerKey) {
    ui.bannerKey = bannerKey;
    drawBanner(host);
  }

  // The list: a button for the host when the game can be played now, a plain row otherwise.
  const listKey = JSON.stringify([entries, host, free, dev]);
  if (listKey === ui.listKey) return;
  ui.listKey = listKey;
  ui.gameList.textContent = "";
  for (const entry of entries) {
    const li = h("li", `game${entry.why ? " off" : ""}${entry.test ? " test" : ""}`, "", ui.gameList);
    const can = host && free && !entry.why;
    const row = h(can ? "button" : "div", "game-row", "", li);
    if (can) {
      row.type = "button";
      row.addEventListener("click", () => pick(entry));
    }
    const tile = h("span", "game-tile", "", row);
    if (entry.art) {
      const img = h("img", "", "", tile);
      img.src = entry.art;
      img.alt = "";
    } else h("span", "game-mono", entry.name.replace(/[^A-Za-z]/g, "").slice(0, 1), tile);
    const words = h("span", "game-words", "", row);
    const title = h("span", "game-name", entry.name, words);
    if (entry.test) h("span", "tag test", "Test", title);
    h("span", "game-meta", `${tablePlayers(entry)} · ${entry.pitch}`, words);
    // The reason sits under the words, so the line about the game keeps the row's width.
    if (entry.why) h("span", "game-why", entry.why, words);
    else if (can) h("span", "game-go", "Play", row);
  }
  if (!entries.length) h("li", "game-none", "No games yet.", ui.gameList);
}

/** The card of the game that just ended: who came where, or why it ended early. */
function drawCard() {
  const box = ui.cardBox;
  box.textContent = "";
  box.hidden = !card;
  if (!card) return;
  const head = h("div", "card-head", "", box);
  h("h3", "", card.rows.length ? `${card.name}: ${card.rows[0].name} won` : `${card.name} ended`, head);
  const done = h("button", "card-done", "Done", head);
  done.type = "button";
  done.addEventListener("click", () => {
    cardDone = card.round;
    card = null;
    update();
  });
  if (card.early) h("p", "card-early", card.early.text, box);
  if (card.rows.length) {
    const rows = h("ol", "card-rows", "", box);
    for (const r of card.rows) {
      const li = h("li", "", "", rows);
      h("span", "card-place", PLACE[r.place - 1] ?? `${r.place}th`, li);
      const dot = h("span", "dot", "", li);
      dot.style.background = r.colour;
      h("span", "card-name", r.name, li);
      h("span", "tag points", `+${r.points}`, li);
    }
  }
}

/** A game starting (everyone sees it), or a game on (shown to whoever waits at the Table). */
function drawBanner(host) {
  const box = ui.banner;
  box.textContent = "";
  box.className = "banner";
  if (room.starting) {
    box.hidden = false;
    box.classList.add("starting");
    h("p", "banner-title", `${room.starting.name} is starting`, box);
    const by = room.starting.by >= 0 ? room.members[room.starting.by]?.name : null;
    h("p", "banner-sub", by ? `${by} picked it. Get your phone ready.` : "Get your phone ready.", box);
    const bar = h("span", "banner-bar", "", box);
    const fill = h("span", "", "", bar);
    // The bar runs down over the time left, as the room said it.
    fill.style.animationDuration = `${Math.max(0, room.starting.in ?? PLAY_BEAT_MS)}ms`;
    return;
  }
  if (room.phase === "playing" && room.game) {
    box.hidden = false;
    box.classList.add("on");
    h("p", "banner-title", `${room.game.name} is on`, box);
    const seats = room.game.seats ?? [];
    h("p", "banner-sub", seats.length ? `${names(seats)} ${seats.length === 1 ? "is" : "are"} playing. You can play the next one.` : "You can play the next one.", box);
    if (host) {
      const stop = h("button", "button quiet stop-here", "End the game", box);
      stop.type = "button";
      stop.addEventListener("click", () => openStop());
    }
    return;
  }
  box.hidden = true;
}

/** The host taps a game: the room says no (play-no), or everyone sees it starting. */
function pick(entry) {
  if (!room || picked || room.starting || room.phase !== "lobby") return;
  picked = entry.id;
  ui.playWhy.hidden = true;
  link.send({ t: "play", id: entry.id });
  update();
  pickedTimer = setTimeout(() => pickAnswered("The room did not answer. Check the connection and try again."), SWITCH_WAIT_MS);
}

function pickAnswered(why) {
  clearTimeout(pickedTimer);
  picked = null;
  update();
  if (why) refuse(why, ui.playWhy);
}

// ---------------------------------------------------------------- the stage

function startStage(snapshot) {
  if (stage || !showsGame()) return;
  // A new game: the last card has had its moment.
  card = null;
  decided = false;
  update();
  stage = mountStage(ui.stageBox, {
    link,
    room,
    snapshot,
    onError: (err) => note(`The game could not be shown: ${err.message}`),
    onDecided: (on) => {
      if (on === decided) return;
      decided = on;
      update();
    },
  });
}

function endStage() {
  stage?.unmount();
  stage = null;
  decided = false;
}

// ---------------------------------------------------------------- notes and refusals

/**
 * A short note ("Cy joined") in the line under the heading for a few seconds, in place of who
 * hosts: it takes no space of its own, so it never covers anything.
 */
function note(text) {
  if (!ui || !text) return;
  ui.lineNote.textContent = text;
  ui.line.classList.add("noting");
  clearTimeout(note.timer);
  note.timer = setTimeout(() => ui.line.classList.remove("noting"), NOTE_MS);
}

/** Why a tap did nothing, under it, for a moment. */
function refuse(text, where = ui?.why) {
  if (!where) return;
  where.textContent = text;
  where.hidden = false;
  where.classList.remove("nudge");
  void where.offsetWidth;
  where.classList.add("nudge");
  clearTimeout(where.timer);
  where.timer = setTimeout(() => (where.hidden = true), 5000);
}

// ---------------------------------------------------------------- the switch

function switchTo(mode) {
  if (!room || asked) return;
  if (mode === room.mode) return;
  if (!mine()) {
    const name = holder();
    return refuse(name ? `Only ${name} can switch rooms: the one who started the party.` : "Only the one who started the party can switch rooms.");
  }
  const locked = modeLocked(room) ?? (room.starting ? "A game is starting. You can switch when it ends." : null);
  if (locked) return refuse(locked);
  asked = mode;
  ui.why.hidden = true;
  link.send({ t: "mode", v: mode });
  update();
  // On a yes this page moves (hop.js); no answer at all means the connection is down.
  askedTimer = setTimeout(() => answered("The room did not answer. Check the connection and try again."), SWITCH_WAIT_MS);
}

/** The room answered this device's switch with a no (or did not answer). */
function answered(why) {
  clearTimeout(askedTimer);
  asked = null;
  update();
  if (why) refuse(why);
}

// ---------------------------------------------------------------- leaving, ending a game

/** A small sheet with a question and two answers. */
function confirmSheet({ label, title, body, yes, no, onYes }) {
  if (app.querySelector(".confirm-back")) return;
  const back = h("div", "confirm-back", "", app);
  const box = h("div", "confirm", "", back);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", label);
  h("h2", "", title, box);
  h("p", "", body, box);
  const go = h("button", "button", yes, box);
  go.type = "button";
  const stay = h("button", "button quiet", no, box);
  stay.type = "button";
  const close = () => back.remove();
  stay.addEventListener("click", close);
  back.addEventListener("click", (e) => e.target === back && close());
  go.addEventListener("click", () => {
    close();
    onYes();
  });
  stay.focus();
}

function openLeave() {
  const screen = link.you?.role === "screen";
  confirmSheet({
    label: screen ? "Stop showing the party" : "Leave the party",
    title: screen ? "Stop showing the party?" : "Leave the party?",
    body: screen ? "Only this screen. The party carries on." : room?.phase === "playing" && room.game?.seats?.includes(link.you?.seat) ? `Only you. ${room.game.name} ends for everyone, and the party carries on without you.` : "Only you. The party carries on without you.",
    yes: screen ? "Stop showing" : "Leave",
    no: screen ? "Keep showing it" : "Stay",
    onYes: () => {
      bye = "left";
      link.leave();
      // The socket's close normally takes us to the front page at once; never wait on it long.
      setTimeout(() => closed("left"), 1500);
    },
  });
}

/** The host ends the game for everyone: nobody scores, and everyone is back at the Table. */
function openStop() {
  if (!room?.game) return;
  confirmSheet({
    label: "End the game",
    title: `End ${room.game.name}?`,
    body: "For everyone. Nobody scores, and the party is back at the Table.",
    yes: "End the game",
    no: "Keep playing",
    onYes: () => link.send({ t: "stop" }),
  });
}

function closed(reason) {
  if (closed.done) return;
  closed.done = true;
  endStage();
  const pin = room?.pin ?? link.session?.pin ?? null;
  const screen = link.you?.role === "screen" || link.session?.role === "screen";
  goFront(farewellKind(reason, screen), pin);
}

// ---------------------------------------------------------------- what the room says

link.on("room", (next) => {
  if (modeHop.leaving) return;
  const before = room;
  room = next;
  if (!ui) {
    build();
    if (modeHop.said) note(modeHop.said);
    // A page that loads just after a game ended (a reload) still gets its card.
    if (room.phase === "lobby" && room.last && room.last.ago < RESULT_FRESH_MS && room.last.round !== cardDone) card = room.last;
  } else if (before) {
    // Someone came in: said once, by name. Leaving is said by the room's own note.
    const was = new Set(before.members.filter(Boolean).map((m) => m.seat));
    for (const m of room.members) if (m && !was.has(m.seat)) note(`${m.name} joined`);
  }
  if (asked && room.mode === asked) answered("");
  if (picked && (room.starting || room.phase === "playing")) pickAnswered("");
  // The view on show belongs to a game that is over, or to another one (a reconnect across games).
  if (stage && (stageStale(stage.key, room) || !showsGame())) endStage();
  stage?.room(room);
  update();
});

link.on("start", (msg) => startStage(msg.s));
link.on("snapshot", (snapshot, now, full) => (stage ? stage.snapshot(snapshot, now, full) : startStage(snapshot)));
link.on("events", (events, now) => stage?.events(events, now));
link.on("end", (msg) => {
  endStage();
  // A game ended early with nobody placed and nothing to say has no card: the room's note said why.
  if (msg.last?.rows?.length || msg.last?.early) card = msg.last;
  update();
});

link.on("message", (msg) => {
  switch (msg.t) {
    case "mode-no":
      answered(msg.why);
      break;
    case "play-no":
      pickAnswered(msg.message);
      break;
    case "stop-no":
      note(msg.message);
      break;
    case "note":
      if (msg.k === "left") note(`${msg.name} left`);
      else if (msg.k === "ended" || msg.k === "cancelled") note(msg.text);
      break;
    default:
      break;
  }
});

link.on("status", (status) => {
  if (ui) ui.status.textContent = status === "reconnecting" ? "Reconnecting..." : "";
});

link.on("closed", (why, reason) => {
  const said = bye ?? (why === "seat_lost" ? (reason === "left" ? "left" : "seat_lost") : reason || "room_closed");
  bye = null;
  closed(said);
});

link.on("error", (err) => err.id === undefined && note(err.message));

// Test games show only with #dev in the address: typing it in shows them at once.
addEventListener("hashchange", () => update());

// Coming back with the browser's back button can show the page as it was left: load it afresh.
addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});

// ---------------------------------------------------------------- begin

/** No party in this tab: this page is a party's waiting room, so it sends people to the way in. */
function noParty() {
  app.textContent = "";
  const box = h("section", "panel empty", "", app);
  const brand = h("p", "brand", "", box);
  h("span", "brand-mark", "", brand);
  h("span", "", "n8 Party", brand);
  h("h1", "", "This is a party's waiting room", box);
  h("p", "", `Start a party, or join one with its code, and you will land here when the party is at ${MODE_NAME["turn-based"]}.`, box);
  const go = h("a", "button", "Start or join a party", box);
  go.href = "/";
}

if (link.resume()) h("p", "connecting", "Connecting to the party...", app);
else noParty();
