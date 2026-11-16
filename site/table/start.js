// Starting a party at the Table (/table/), from the front page's "Round the table" door.
//
// A new party always starts on the Floor (lobby/shared/mode.js, DEFAULT_MODE), and the host
// moves it to the Table. This page does both in one go: it shows the party room's own way in
// (lobby/public/door.js, the same form /lobby/?start shows, in the Table's words and the front
// page's look), and once the new party's room answers, it asks for the Table, as the host's
// switch does, and moves to /party/, which resumes the same seat from the session this tab
// keeps. It replaces itself on the way, so the back button from the Table goes to the front page,
// not to this form.
//
// A reload while the party is being moved (the form sent, the Table not reached yet) comes back
// to that party, not to a new form: the party this tab made is kept by its code until the page
// moves on, and the saved session is picked up again instead of a second party being made.
//
// Someone who uses the form's "Join with a code instead" joins a party as it is: they go to
// whichever room that party is in, and nothing is switched for them.
import { PartyClient } from "/party-kit/client/party-client.js";
import { openDoor } from "/lobby/door.js";
import { MODE_PAGE, hopNow, modeOf } from "/lobby/shared/mode.js";

const TABLE = "turn-based";
/** How long the room has to answer the switch before this page says so. */
const SWITCH_WAIT_MS = 6000;
/** The code of the party this tab made here and has not yet taken to its room. */
const MADE_KEY = "n8games:table-made";

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
const read = (key) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private browsing: a reload shows the form again.
  }
};

// Whether this page made the party (and so holds its controls), rather than joined one.
let created = false;
const create = link.create.bind(link);
link.create = async (...args) => {
  const made = await create(...args);
  created = true;
  write(MADE_KEY, made.code);
  return made;
};

let door = null;
let asked = false;
let gone = false;
let timer = null;

const openForm = () => openDoor(app, link, { mode: "start", as: params.get("as") === "screen" ? "screen" : "player", small: Math.min(innerWidth, innerHeight) < 520, room: TABLE });

/** A card in the way in's look, with a title, a line and, when given, one way on. */
function card(titleText, subText, action = null) {
  app.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "door";
  wrap.dataset.room = TABLE;
  const box = document.createElement("main");
  box.className = "door-card";
  const title = document.createElement("h1");
  title.className = "door-title";
  title.textContent = titleText;
  const sub = document.createElement("p");
  sub.className = "door-sub";
  sub.textContent = subText;
  box.append(title, sub);
  if (action) box.append(action);
  wrap.append(box);
  app.append(wrap);
}

function go(path) {
  if (gone) return;
  gone = true;
  clearTimeout(timer);
  write(MADE_KEY, null);
  hopNow(path, { storage, force: true });
}

/** The switch did not happen: say why, and offer the party where it is. */
function stuck(why) {
  if (gone) return;
  clearTimeout(timer);
  door?.close();
  door = null;
  const on = document.createElement("a");
  on.className = "button";
  on.href = MODE_PAGE[modeOf(link.room)];
  on.textContent = "Go to the party";
  // Replaces this page, so the back button from the party does not come back to the form.
  on.addEventListener("click", (e) => {
    e.preventDefault();
    go(on.getAttribute("href"));
  });
  card("Your party is on the Floor", `${why} The host can move it to the Table from the room.`, on);
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
// The party this tab made has gone before it reached its room (it closed, or the seat was let
// go): nothing to come back to, so the form again.
link.on("closed", () => {
  if (gone) return;
  write(MADE_KEY, null);
  created = asked = false;
  clearTimeout(timer);
  door?.close();
  app.textContent = "";
  door = openForm();
});

/** The session this tab keeps for the party room, as the kit's client saved it. */
function savedSession() {
  try {
    return JSON.parse(read(link.storeKey) ?? "null");
  } catch {
    return null;
  }
}

// Back after a reload, with the party this tab made here still on its way: pick it up again.
const made = read(MADE_KEY);
if (made && savedSession()?.code === made && link.resume()) {
  created = true;
  card("Taking your party to the Table", "One moment.");
} else {
  write(MADE_KEY, null);
  door = openForm();
}
