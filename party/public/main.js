// The plain waiting room (/party/): the party's second waiting room, with no characters.
//
// The same party as the character room (/lobby/): the same room on the server, the same socket,
// the same seat, resumed from the session the character room saved in this tab. The host
// switches the whole party between the two rooms (lobby/shared/mode.js); a page whose room the
// party is not in moves itself to the other one (lobby/public/hop.js).
//
// What is here: the party's code and QR code, who is here (the host marked, a dropped phone
// grey), the switch between the two rooms (the host's taps only), and a word that turn-based
// games are coming. It loads nothing of the character room's drawing: no three.js, no pieces.
// The big screen (`as=screen`, or a wide window) gets a wide layout of the same.
import { PartyClient } from "/party-kit/client/party-client.js";
import { KEEP_ALIVE_MS, watchConnection } from "/lobby/connection.js";
import { h, icon } from "/lobby/dom.js";
import { farewellKind, goFront } from "/lobby/farewell.js";
import { watchMode } from "/lobby/hop.js";
import { MODES, MODE_NAME, modeLocked } from "/lobby/shared/mode.js";

const app = document.getElementById("app");
const link = new PartyClient({ api: "/api/lobby", quietPing: { text: "ping", everyMs: KEEP_ALIVE_MS } });
const isPlayer = () => link.you?.role === "player";
// A locked phone closes its socket and opens it again when it is shown (connection.js).
watchConnection(link, { player: () => isPlayer() });
// The party is in the character room: this page moves there (hop.js). Added before the page's own room handler.
const modeHop = watchMode(link, "turn-based");

/** A switch this device asked for and the room has not answered yet: given up after this long. */
const SWITCH_WAIT_MS = 4000;
const NOTE_MS = 4000;
const TV_ICON = ["M3 5h18v12H3z", "M8 21h8", "M12 17v4"];
const DOOR_ICON = ["M14 4h5v16h-5", "M10 12H3", "M7 8l-4 4 4 4"];

let room = null;
let ui = null;
/** The mode this device asked for, until the room answers. */
let asked = null;
let askedTimer = null;
/** Set when this device chose to go, so the socket closing is not taken for the room ending. */
let bye = null;

// ---------------------------------------------------------------- the page

/** The big screen's layout: the room's screen, or a page opened with ?as=screen. */
const wide = () => link.you?.role === "screen" || new URLSearchParams(location.search).get("as") === "screen";

/** Builds the page once, on the first room view. Everything after is update(). */
function build() {
  app.textContent = "";
  const screen = link.you?.role === "screen";
  if (wide()) document.documentElement.classList.add("as-screen");
  const top = h("header", "top", "", app);
  const brand = h("p", "brand", "", top);
  h("span", "brand-mark", "", brand);
  h("span", "", "n8 Party", brand);
  const status = h("p", "status", "", top);
  status.setAttribute("role", "status");
  const leave = h("button", "leave", "", top);
  leave.type = "button";
  leave.append(icon(DOOR_ICON, 18));
  h("span", "", screen ? "Stop showing" : "Leave", leave);
  leave.addEventListener("click", () => openLeave());

  const grid = h("div", "grid", "", app);

  // The switch between the two rooms. On the big screen it sits in the bar at the top, so the
  // code and everyone's names fit on the screen without scrolling.
  const rooms = h("section", "panel rooms", "", wide() ? top : grid);
  if (wide()) top.insertBefore(rooms, status);
  rooms.setAttribute("aria-label", "Waiting room");
  const toggle = h("div", "switch", "", rooms);
  toggle.setAttribute("role", "radiogroup");
  toggle.setAttribute("aria-label", "Which waiting room the party is in");
  const options = MODES.map((mode) => {
    const option = h("button", "switch-option", MODE_NAME[mode], toggle);
    option.type = "button";
    option.setAttribute("role", "radio");
    option.dataset.mode = mode;
    option.addEventListener("click", () => switchTo(mode));
    return option;
  });
  const who = h("p", "switch-who", "", rooms);
  const why = h("p", "switch-why", "", rooms);
  why.setAttribute("role", "alert");
  why.hidden = true;

  // The code, large, and the QR code.
  const code = h("section", "panel code", "", grid);
  code.setAttribute("aria-label", "The party's code");
  h("p", "kicker", "Join this party", code);
  const codeRow = h("div", "code-row", "", code);
  const digits = h("p", "digits", "----", codeRow);
  const qrTile = h("div", "qr", "", codeRow);
  const qr = h("img", "", "", qrTile);
  qr.alt = "";
  qr.width = 160;
  qr.height = 160;
  const where = h("p", "where", "Scan it, or type the code on the front page", code);

  // Who is here.
  const people = h("section", "panel people", "", grid);
  people.setAttribute("aria-label", "Who is here");
  const peopleHead = h("div", "panel-head", "", people);
  h("h2", "", "Who is here", peopleHead);
  const count = h("span", "count", "", peopleHead);
  const list = h("ul", "list", "", people);

  // What this room is for, so far.
  const soon = h("section", "panel soon", "", grid);
  h("h2", "", "Turn-based games are coming", soon);
  h("p", "", "Games you play in turns, each on your own phone, will be chosen here. Until then the party can wait here, or go back to Party games.", soon);

  const notes = h("div", "notes", "", app);
  notes.setAttribute("aria-live", "polite");
  ui = { status, options, who, why, digits, qr, where, count, list, notes, shown: "" };
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

/** Whether this device's taps switch the room: it holds the controls (the room's picker). */
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
    option.textContent = going ? "Moving..." : MODE_NAME[option.dataset.mode];
  }
  ui.options[0].parentElement.classList.toggle("locked", !host);
  const name = holder();
  ui.who.textContent = host ? "You choose the room for everyone." : name ? `${name} chooses the room for everyone.` : "The one who started the party chooses the room.";
  ui.digits.textContent = room.pin ?? "----";
  ui.digits.setAttribute("aria-label", `Code ${(room.pin ?? "").split("").join(" ")}`);
  // Who is here, in seat order, then the big screen.
  const members = room.members.filter(Boolean);
  const key = JSON.stringify([members.map((m) => [m.seat, m.name, m.colour, m.connected, m.away, m.points]), room.picker, room.screens, link.you]);
  if (key !== ui.shown) {
    ui.shown = key;
    ui.list.textContent = "";
    for (const m of members) ui.list.append(personRow(m));
    if (room.screens > 0 || room.picker?.seat === -1) ui.list.append(screenRow());
    ui.count.textContent = `${members.length} of ${room.members.length}`;
  }
}

function personRow(m) {
  const li = h("li", `person${m.connected ? "" : " gone"}`);
  const dot = h("span", "dot", "", li);
  dot.style.background = m.connected ? m.colour : "#6f655b";
  const words = h("span", "person-words", "", li);
  h("span", "person-name", m.name, words);
  const me = isPlayer() && m.seat === link.you.seat;
  const state = !m.connected ? "Reconnecting" : m.away ? "Away" : "";
  if (me || state) h("span", "person-sub", [me ? "You" : "", state].filter(Boolean).join(" · "), words);
  if (room.picker?.seat === m.seat) h("span", "tag host", "Host", li);
  if (m.points > 0) h("span", "tag points", `${m.points} pt${m.points === 1 ? "" : "s"}`, li);
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

/** A short line at the foot of the page that goes by itself. */
function note(text) {
  if (!ui || !text) return;
  const el = h("p", "note", text, ui.notes);
  setTimeout(() => el.classList.add("going"), NOTE_MS);
  setTimeout(() => el.remove(), NOTE_MS + 400);
  while (ui.notes.children.length > 3) ui.notes.firstChild.remove();
}

/** Why a tap on the switch did nothing, under it, for a moment. */
function refuse(text) {
  if (!ui) return;
  ui.why.textContent = text;
  ui.why.hidden = false;
  ui.why.classList.remove("nudge");
  void ui.why.offsetWidth;
  ui.why.classList.add("nudge");
  clearTimeout(refuse.timer);
  refuse.timer = setTimeout(() => (ui.why.hidden = true), 5000);
}

// ---------------------------------------------------------------- the switch

function switchTo(mode) {
  if (!room || asked) return;
  if (mode === room.mode) return;
  if (!mine()) {
    const name = holder();
    return refuse(name ? `Only ${name} can switch rooms: the one who started the party.` : "Only the one who started the party can switch rooms.");
  }
  const locked = modeLocked(room);
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

// ---------------------------------------------------------------- leaving

function openLeave() {
  if (app.querySelector(".confirm-back")) return;
  const screen = link.you?.role === "screen";
  const back = h("div", "confirm-back", "", app);
  const box = h("div", "confirm", "", back);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", screen ? "Stop showing the party" : "Leave the party");
  h("h2", "", screen ? "Stop showing the party?" : "Leave the party?", box);
  h("p", "", screen ? "Only this screen. The party carries on." : "Only you. The party carries on without you.", box);
  const go = h("button", "button", screen ? "Stop showing" : "Leave", box);
  go.type = "button";
  const stay = h("button", "button quiet", screen ? "Keep showing it" : "Stay", box);
  stay.type = "button";
  const close = () => back.remove();
  stay.addEventListener("click", close);
  back.addEventListener("click", (e) => e.target === back && close());
  go.addEventListener("click", () => {
    close();
    bye = "left";
    link.leave();
    // The socket's close normally takes us to the front page at once; never wait on it long.
    setTimeout(() => closed("left"), 1500);
  });
  stay.focus();
}

function closed(reason) {
  if (closed.done) return;
  closed.done = true;
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
  } else if (before) {
    // Someone came in: said once, by name. Leaving is said by the room's own note.
    const was = new Set(before.members.filter(Boolean).map((m) => m.seat));
    for (const m of room.members) if (m && !was.has(m.seat)) note(`${m.name} joined`);
  }
  if (asked && room.mode === asked) answered("");
  update();
});

link.on("message", (msg) => {
  switch (msg.t) {
    case "mode-no":
      answered(msg.why);
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
  h("p", "", "Start a party, or join one with its code, and you will land here when the party is in Turn-based.", box);
  const go = h("a", "button", "Start or join a party", box);
  go.href = "/";
}

if (link.resume()) h("p", "connecting", "Connecting to the party...", app);
else noParty();
