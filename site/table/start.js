// Starting a party at the Table (/table/), from the front page's "Round the table" door.
//
// A new party always starts on the Floor (lobby/shared/mode.js, DEFAULT_MODE), and the host
// moves it to the Table. This page does both in one go: it shows the party room's own way in
// (lobby/public/door.js, the same form /lobby/?start shows), and once the new party's room
// answers, it asks for the Table, as the host's switch does, and moves to /party/, which resumes
// the same seat from the session this tab keeps. It replaces itself on the way, so the back
// button from the Table goes to the front page, not to this form.
//
// Someone who uses the form's "Join with a code instead" joins a party as it is: they go to
// whichever room that party is in, and nothing is switched for them.
import { PartyClient } from "/party-kit/client/party-client.js";
import { openDoor } from "/lobby/door.js";
import { MODE_PAGE, hopNow, modeOf } from "/lobby/shared/mode.js";

const TABLE = "turn-based";
/** How long the room has to answer the switch before this page says so. */
const SWITCH_WAIT_MS = 6000;

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const link = new PartyClient({ api: "/api/lobby" });
const storage = (() => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
})();

// Whether this page made the party (and so holds its controls), rather than joined one.
let created = false;
const create = link.create.bind(link);
link.create = async (...args) => {
  const made = await create(...args);
  created = true;
  return made;
};

let door = openDoor(app, link, { mode: "start", as: params.get("as") === "screen" ? "screen" : "player", small: Math.min(innerWidth, innerHeight) < 520 });
let asked = false;
let gone = false;
let timer = null;

function go(path) {
  if (gone) return;
  gone = true;
  clearTimeout(timer);
  hopNow(path, { storage, force: true });
}

/** The switch did not happen: say why, and offer the party where it is. */
function stuck(why) {
  if (gone) return;
  clearTimeout(timer);
  door?.close();
  door = null;
  app.textContent = "";
  const box = document.createElement("main");
  box.className = "door-card";
  const title = document.createElement("h1");
  title.className = "door-title";
  title.textContent = "Your party is on the Floor";
  const sub = document.createElement("p");
  sub.className = "door-sub";
  sub.textContent = `${why} The host can move it to the Table from the room.`;
  const on = document.createElement("a");
  on.className = "button";
  on.href = MODE_PAGE[modeOf(link.room)];
  on.textContent = "Go to the party";
  box.append(title, sub, on);
  const wrap = document.createElement("div");
  wrap.className = "door";
  wrap.append(box);
  app.append(wrap);
  on.focus();
}

link.on("room", (room) => {
  const mode = modeOf(room);
  if (!created || mode === TABLE) return go(MODE_PAGE[mode]);
  if (asked) return;
  asked = true;
  link.send({ t: "mode", v: TABLE });
  timer = setTimeout(() => stuck("The room did not answer in time."), SWITCH_WAIT_MS);
});
link.on("message", (msg) => {
  if (msg?.t === "mode-no") stuck(typeof msg.why === "string" ? msg.why : "The switch did not go through.");
});
