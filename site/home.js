// The front page: "How do you want to play?" and three doors.
//
//   In the room       the party room (the Floor): start a party there, or join one with a code.
//                     No game list: the party picks together by standing in a game's light, and
//                     the wall shown is the room's real one (/home-wall.js, made by the build).
//   Round the table   the Table's games, each with a card that explains it. Start a party at the
//                     Table (/table/), or play Who Am I? on its own site while it is not there.
//   Pass one device   Hot Potato, played on this phone or laptop.
//
// Which door is open is kept in the address (#room, #table, #device), so the back button closes
// it. Everything is drawn with DOM calls (no inline styles or scripts: the site's CSP allows none).
import { passLookup } from "/lobby/door-handoff.js";
import { CHARACTERS } from "/lobby/shared/characters.js";
import { FLOOR, TABLE } from "/home-wall.js";
import { FLOATERS, LINKS, ROOM_VOTE } from "./home-data.js";
import { gamesOf, homeModel, isLive, peekOf, playersText, tableStart } from "./home-model.js";

const model = homeModel({ FLOOR, TABLE });
const $ = (id) => document.getElementById(id);
const ART = (name) => `/art/${name}${/\.\w+$/.test(name) ? "" : ".webp"}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** This tab's sessionStorage, or null where the browser refuses it. */
const session = () => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};
const wideQuery = matchMedia("(min-width: 860px)");
const isWide = () => wideQuery.matches;

/** A new element: h("span", "chip", "text"), with children appended after. */
function h(tag, cls = "", text = "", ...kids) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  el.append(...kids);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** A small icon from its path data. */
function svg(viewBox, parts) {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of parts) {
    const p = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    el.append(p);
  }
  return el;
}
const ICON = {
  people: () =>
    svg("0 0 16 16", [
      ["circle", { cx: 5.5, cy: 5, r: 2.6, fill: "currentColor" }],
      ["circle", { cx: 11.2, cy: 5.6, r: 2.1, fill: "currentColor" }],
      ["path", { d: "M1 14c0-3 2-4.6 4.5-4.6S10 11 10 14z", fill: "currentColor" }],
      ["path", { d: "M10.6 9.6c2.3 0 4.2 1.4 4.4 4.4h-3.8c0-1.8-.4-3.2-1.4-4.3z", fill: "currentColor" }],
    ]),
  phone: () =>
    svg("0 0 16 16", [
      ["rect", { x: 4, y: 1, width: 8, height: 14, rx: 2, fill: "none", stroke: "currentColor", "stroke-width": 2 }],
      ["circle", { cx: 8, cy: 12, r: 1, fill: "currentColor" }],
    ]),
  tv: () =>
    svg("0 0 16 16", [
      ["rect", { x: 1, y: 2.5, width: 14, height: 9, rx: 1.6, fill: "none", stroke: "currentColor", "stroke-width": 2 }],
      ["path", { d: "M5 14.5h6", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" }],
    ]),
  arrow: () => svg("0 0 20 20", [["path", { d: "M4 10h11M11 5l5 5-5 5", fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" }]]),
  out: () => svg("0 0 20 20", [["path", { d: "M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" }]]),
};
const NEED = { phones: ["phone", "A phone each"], tv: ["tv", "A TV helps"], one: ["phone", "One phone or laptop"] };
const needChip = (n) => h("span", "chip", "", ICON[NEED[n][0]](), NEED[n][1]);
const kindOf = (id) => model.kinds.find((k) => k.id === id);

/** A game's square picture, or a plain plate with its first letter when it has none yet. */
function face(g, cls) {
  if (g.tile) {
    const img = h("img", cls);
    img.src = ART(g.tile);
    img.alt = "";
    img.width = 420;
    img.height = 560;
    img.loading = "lazy";
    img.style.setProperty("object-position", g.focus);
    return img;
  }
  const plate = h("span", `${cls} plain-art`, g.name.replace(/[^A-Za-z0-9]/g, "").charAt(0));
  plate.setAttribute("aria-hidden", "true");
  return plate;
}

/** The chip that says what can be done with a game. */
function stateChip(g, { room = false } = {}) {
  if (g.status === "soon") return h("span", "chip soon", "Coming soon");
  if (g.status === "own-site") return h("span", "chip live", "", "Play now on its own site");
  return h("span", "chip live", room ? "Lamp on" : "Play now");
}
/** Players, what the game needs (not on the room's wall: the room door says it once), and what can be done. */
const metaOf = (g, opts = {}) => h("span", "meta", "", h("span", "chip", "", ICON.people(), playersText(g)), ...(opts.room ? [] : kindOf(g.kind).needs.map(needChip)), stateChip(g, opts));

// ---------------------------------------------------------------- the three doors

/** Where a game that plays somewhere other than behind its door plays, in two words: only on its own site (Who Am I? until the Table has it). */
const ELSEWHERE = { "own-site": "Own site" };
const elsewhereWords = (g) => `${g.name} on its own site`;

function drawDoors() {
  const doors = $("doors");
  // The plain links the HTML holds for a page whose scripts did not run give way to the doors.
  doors.replaceChildren();
  doors.classList.remove("doors-plain");
  for (const k of model.kinds) {
    const games = gamesOf(model, k.id);
    // "Now" only for a game that plays behind this door; Who Am I? says it plays on its own site.
    const { here, elsewhere, soon } = peekOf(k.id, games);
    const soonWords = soon.length === 1 ? `${soon[0].name} soon` : soon.length ? `${soon.length} more coming` : "";
    const door = h("button", "door");
    door.type = "button";
    door.dataset.kind = k.id;
    door.setAttribute("aria-describedby", `dl-${k.id}`);

    const art = h("img", "door-art");
    art.src = ART(k.door);
    art.alt = "";
    art.width = 560;
    art.height = 315;
    art.style.setProperty("object-position", k.focus);
    const panel = h("span", "door-panel", "", h("span", "door-knob"));
    panel.setAttribute("aria-hidden", "true");
    const frame = h("span", "door-frame", "", art, panel);

    const line = h("span", "door-line", k.line);
    line.id = `dl-${k.id}`;
    const wideNeeds = h("span", "meta door-needs-wide", "", ...k.needs.map(needChip));
    wideNeeds.setAttribute("aria-hidden", "true");
    const needs = h("span", "door-needs", "", ...k.needs.map((n) => h("span", "", "", ICON[NEED[n][0]](), NEED[n][1])));

    // The games inside, for a screen reader in one sentence; on screen as chips (wide) or a line (phone).
    const said = [...here.map((g) => `${g.name}, playable now`), ...elsewhere.map((g) => `${elsewhereWords(g)}, playable now`), ...soon.map((g) => `${g.name}, coming soon`)].join("; ");
    const chips = h("span", "peek-chips");
    for (const g of here) chips.append(h("span", "peek-game", "", face(g, "peek-face"), h("span", "peek-name", g.name), h("span", "peek-state", "Now")));
    for (const g of elsewhere) chips.append(h("span", "peek-game is-elsewhere", "", face(g, "peek-face"), h("span", "peek-name", g.name), h("span", "peek-state", ELSEWHERE[g.status])));
    if (soon.length === 1) chips.append(h("span", "peek-game is-soon", "", face(soon[0], "peek-face"), h("span", "peek-name", soon[0].name), h("span", "peek-state", "Soon")));
    else if (soon.length) chips.append(h("span", "peek-game is-soon peek-more", "", h("span", "peek-name", `${soon.length} more`), h("span", "peek-state", "Soon")));
    chips.setAttribute("aria-hidden", "true");
    const names = h("span", "peek-names", here.map((g) => g.name).join(", "));
    const asides = [...elsewhere.map(elsewhereWords), soonWords].filter(Boolean);
    asides.forEach((words, i) => names.append(here.length || i ? ", " : "", h("i", "", words)));
    const compact = h("span", "peek-compact", "", h("span", "peek-faces", "", ...games.slice(0, 3).map((g) => face(g, "peek-face"))), names);
    compact.setAttribute("aria-hidden", "true");
    const peek = h("span", "peek", "", h("span", "sr", `Inside: ${said}.`), chips, compact);

    const go = h("span", "door-go", "", ICON.arrow());
    go.setAttribute("aria-hidden", "true");
    door.append(frame, h("span", "door-info", "", h("span", "door-name", k.name), line, wideNeeds, needs, peek), go);
    doors.append(door);
  }
}

// ---------------------------------------------------------------- behind the room door

/** Each character's move (lobby/shared/characters.js, `move`), as the room's button calls it. */
const MOVE = { kick: "Bump", fade: "Fade" };

function drawRoom() {
  const room = kindOf("room");
  $("roomInside").textContent = room.inside;
  $("roomNeeds").append(...room.needs.map(needChip));
  $("roomStart").href = LINKS.floorStart;
  $("roomVote").append(...ROOM_VOTE.map((s) => h("li", "", s)));
  // Coming-soon games with no picture yet are folded into one line, not shown as lettered plates.
  const folded = model.room.filter((g) => g.status === "soon" && !g.tile);
  for (const g of model.room) {
    if (folded.includes(g)) continue;
    const item = h("li", `wall-game${isLive(g.status) ? " is-live" : ""}`, "", face(g, "wall-art"), h("span", "wall-info", "", h("span", "wall-name", g.name), h("span", "wall-line", g.line), metaOf(g, { room: true })));
    $("roomWall").append(item);
  }
  if (folded.length) $("roomWall").append(h("li", "wall-more", `and ${folded.length} more on the way`));
  // The characters a player can be today, from the room's own list (lobby/shared/characters.js).
  for (const c of CHARACTERS) {
    const pic = h("img");
    pic.src = ART(`fl-${c.id}`);
    pic.alt = "";
    pic.width = 60;
    pic.height = 64;
    pic.loading = "lazy";
    pic.addEventListener("error", () => pic.remove(), { once: true });
    $("roomPieces").append(h("li", "piece", "", pic, h("span", "piece-name", c.name), h("span", "piece-move", MOVE[c.move] ?? String(c.move ?? "").replace(/^./, (l) => l.toUpperCase()))));
  }
  $("piecesNote").textContent = `Pick ${CHARACTERS.length > 1 ? "one" : "it"} and a colour as you walk in. More characters, each with a move of its own, are on the way.`;
}

// ---------------------------------------------------------------- behind the table and device doors

const kindsEl = $("kinds");
const detail = $("detail");
let gamesKind = null;
let current = null;
let lastTile = null;

function drawTableStart(kindId) {
  const strip = $("tableStart");
  strip.hidden = kindId !== "table";
  if (strip.hidden) return;
  // With no game to pick at the Table, the note leads and the start is not the main button.
  const { lead, note } = tableStart(model);
  strip.dataset.lead = lead;
  $("tableGo").classList.toggle("btn-go", lead === "start");
  $("tableGo").classList.toggle("btn-alt", lead !== "start");
  $("tableNote").textContent = note;
}

function drawGames(kindId) {
  gamesKind = kindId;
  const k = kindOf(kindId);
  const games = gamesOf(model, kindId);
  const view = $("view-games");
  view.dataset.kind = kindId;
  $("gamesTitle").textContent = k.name;
  $("gamesInside").textContent = k.inside;
  $("gamesNeeds").replaceChildren(...k.needs.map(needChip));
  drawTableStart(kindId);
  const tiles = h("div", "tiles");
  for (const g of games) {
    const tile = h("button", "tile");
    tile.type = "button";
    tile.dataset.game = g.id;
    tile.setAttribute("aria-current", "false");
    const line = h("span", "tile-line", g.line);
    line.id = `t-${g.id}-line`;
    tile.setAttribute("aria-describedby", line.id);
    tile.append(face(g, "tile-art"), h("span", "tile-info", "", h("span", "tile-name", g.name), line, metaOf(g)));
    tiles.append(tile);
  }
  const section = h("section", "kind", "", tiles);
  section.setAttribute("aria-label", `${k.name} games`);
  kindsEl.replaceChildren(section);
  current = null;
  detail.replaceChildren();
  if (isWide() && games.length) select(games[0].id, { quiet: true });
}

/** The way to play a game, for its card. */
function actionsOf(g) {
  const box = h("div", "d-actions");
  const note = (text) => box.append(h("p", "d-note", text));
  const joinButton = () => {
    const b = h("button", "btn btn-alt", "Join with a code");
    b.type = "button";
    b.dataset.join = "";
    return b;
  };
  const link = (text, href, out = false) => {
    const a = h("a", "btn btn-go", text);
    a.href = href;
    if (out) {
      a.target = "_blank";
      a.rel = "noopener";
      a.append(ICON.out(), h("span", "sr", " (opens in a new tab)"));
    }
    return a;
  };
  if (g.status === "table") {
    box.append(link("Start a party at the Table", LINKS.tableStart), joinButton());
    note("You get a code to share. Friends join on their phones, and the host picks this game.");
    // A second way to play it, where the game also has a site of its own (Who Am I?).
    if (g.site) {
      const own = link("Its own site", g.site, true);
      own.className = "btn btn-alt";
      box.insertBefore(own, box.lastChild);
    }
  } else if (g.status === "own-site") {
    const host = new URL(g.href).host;
    box.append(link("Play now", g.href, true));
    note(`Plays today on its own site, ${host}. Coming: play it here at the Table, everyone joining with one code.`);
  } else if (g.status === "page") {
    box.append(link("Play now", g.href));
    note(g.kind === "device" ? "Plays on this device. Nothing to install, nobody signs up." : "Plays on its own page of this site.");
  } else {
    const soon = h("span", "btn btn-soon", "Coming soon");
    soon.setAttribute("aria-disabled", "true");
    box.append(soon, joinButton());
    note("Not ready yet. Got a code from a friend? Join their party.");
  }
  return box;
}

function drawDetail(g) {
  detail.dataset.kind = g.kind;
  const close = h("button", "x", "×");
  close.type = "button";
  close.dataset.close = "";
  close.setAttribute("aria-label", "Close");
  const wrap = h("div", "d-art-wrap");
  if (g.wide) {
    const art = h("img", "d-art");
    art.src = ART(g.wide);
    art.alt = "";
    art.width = 720;
    art.height = 405;
    art.loading = "lazy";
    wrap.append(art);
  } else wrap.append(face({ ...g, tile: null }, "d-art"));
  if (g.piece) {
    const piece = h("img", "d-piece");
    piece.src = ART(`fl-${g.piece}`);
    piece.alt = "";
    piece.loading = "lazy";
    wrap.append(piece);
  }
  const name = h("h2", "d-name", g.name);
  name.id = "d-name";
  const body = h("div", "d-body", "", h("span", "d-kind", kindOf(g.kind).name), name, h("p", "d-about", g.about), metaOf(g));
  if (g.steps.length) body.append(h("h3", "d-h", "How a round goes"), h("ol", "d-steps", "", ...g.steps.map((s) => h("li", "", s))));
  if (g.suits) body.append(h("p", "d-suits", "", h("b", "", "Good for:"), ` ${g.suits}`));
  body.append(actionsOf(g));
  const grab = h("span", "d-grab");
  grab.setAttribute("aria-hidden", "true");
  detail.replaceChildren(grab, h("div", "d-close", "", close), wrap, body);
}

function select(id, { quiet = false } = {}) {
  const g = gamesOf(model, gamesKind).find((x) => x.id === id);
  if (!g) return;
  current = id;
  for (const t of kindsEl.querySelectorAll(".tile")) t.setAttribute("aria-current", String(t.dataset.game === id));
  drawDetail(g);
  if (!quiet) {
    detail.querySelector(".d-piece")?.classList.add("hop");
    cheer([...kindOf(g.kind).pieces, g.piece]);
  }
  if (!isWide()) openSheet();
  else detail.scrollTop = 0;
}

// The phone's sheet: a dialog over the page, which is inert behind it.
const behindSheet = () => [$("bar"), $("view-games").querySelector(".back"), $("gamesHead"), kindsEl];
function openSheet() {
  document.body.dataset.sheet = "open";
  $("sheetBack").hidden = false;
  detail.setAttribute("role", "dialog");
  detail.setAttribute("aria-modal", "true");
  for (const el of behindSheet()) el.inert = true;
  detail.scrollTop = 0;
  detail.focus({ preventScroll: true });
}
function closeSheet({ refocus = true } = {}) {
  if (document.body.dataset.sheet !== "open") return;
  document.body.dataset.sheet = "";
  $("sheetBack").hidden = true;
  detail.removeAttribute("role");
  detail.removeAttribute("aria-modal");
  for (const el of behindSheet()) el.inert = false;
  if (refocus && lastTile?.isConnected) lastTile.focus({ preventScroll: true });
}

kindsEl.addEventListener("click", (e) => {
  const t = e.target.closest(".tile");
  if (!t) return;
  lastTile = t;
  select(t.dataset.game);
});
$("sheetBack").addEventListener("click", () => closeSheet());
detail.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeSheet();
});

// ---------------------------------------------------------------- the floaters

const floatersEl = $("floaters");
function drawFloaters() {
  FLOATERS.forEach((f, i) => {
    const el = h("div", "fl");
    el.dataset.piece = f.img.replace(/^fl-|\.\w+$/g, "");
    for (const [k, v] of Object.entries({ "--x": `${f.x}%`, "--y": `${f.y}%`, "--w": `${f.w}px`, "--dx": `${f.dx}px`, "--dy": `${f.dy}px`, "--drift": `${f.drift}s`, "--bob": `${f.bob}s`, "--r": `${f.r}deg`, "--delay": `${-(i * 1.37) % f.bob}s` })) el.style.setProperty(k, v);
    const img = h("img");
    img.src = ART(f.img);
    img.alt = "";
    img.draggable = false;
    el.append(h("div", "fl-c", "", h("div", "fl-b", "", img)));
    floatersEl.append(el);
  });
}
/** The pieces that belong to what was just opened give a little hop. */
function cheer(pieces) {
  if (reduced()) return;
  for (const el of floatersEl.querySelectorAll(".fl")) {
    if (!pieces.includes(el.dataset.piece)) continue;
    const c = el.firstElementChild;
    c.classList.remove("cheer");
    void c.offsetWidth;
    c.classList.add("cheer");
  }
}
function sizeFloaters() {
  // Floaters grow with the screen, so a TV gets toys, not specks.
  const fs = Math.max(1, Math.min(1.9, Math.min(innerWidth, innerHeight * 1.4) / 620));
  document.documentElement.style.setProperty("--fs", fs.toFixed(3));
}

// ---------------------------------------------------------------- views and the address

const VIEWS = ["room", "table", "device"];
const viewFrom = (hash) => (VIEWS.includes(hash.replace(/^#/, "")) ? hash.replace(/^#/, "") : "doors");
const doorFor = (kind) => document.querySelector(`.door[data-kind="${kind}"]`);
let shown = "doors";
let swingTimer = 0;

function show(view, { focus = true } = {}) {
  clearTimeout(swingTimer);
  for (const d of document.querySelectorAll(".door.opening")) d.classList.remove("opening");
  closeSheet({ refocus: false });
  closeJoin({ refocus: false });
  const was = shown;
  shown = view;
  document.body.dataset.view = view;
  $("view-doors").hidden = view !== "doors";
  $("view-room").hidden = view !== "room";
  $("view-games").hidden = !(view === "table" || view === "device");
  if (view === "table" || view === "device") drawGames(view);
  window.scrollTo(0, 0);
  if (view !== "doors") cheer(kindOf(view).pieces);
  if (!focus) return;
  if (view === "doors") (doorFor(was) ?? $("doorsTitle")).focus();
  else $(view === "room" ? "roomTitle" : "gamesTitle").focus({ preventScroll: true });
}

/** Opens a door: a new step in the history, so the back button comes back to the doors. */
function enter(view) {
  history.pushState({ door: view }, "", `#${view}`);
  show(view);
}
/** Back to the doors: the history's own step back when the door was opened from them. */
function leave() {
  if (history.state?.door) history.back();
  else {
    history.replaceState(null, "", location.pathname + location.search);
    show("doors");
  }
}
addEventListener("popstate", () => show(viewFrom(location.hash)));
addEventListener("hashchange", () => viewFrom(location.hash) !== shown && show(viewFrom(location.hash)));

$("doors").addEventListener("click", (e) => {
  const d = e.target.closest(".door");
  if (!d || d.classList.contains("opening")) return;
  if (reduced()) return enter(d.dataset.kind);
  // The door swings open, then the room behind it shows.
  d.classList.add("opening");
  swingTimer = setTimeout(() => enter(d.dataset.kind), 520);
});
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-back]")) leave();
});
$("logoHome").addEventListener("click", (e) => {
  e.preventDefault();
  if (shown !== "doors") leave();
  else $("doorsTitle").focus();
});

// ---------------------------------------------------------------- joining with a code

const joinPop = $("joinPop");
const joinCode = $("joinCode");
const joinErr = $("joinErr");
const joinGo = $("joinGo");
let joinFrom = null;
function openJoin(from) {
  joinFrom = from ?? $("joinOpen");
  joinPop.hidden = false;
  $("joinOpen").setAttribute("aria-expanded", "true");
  joinErr.textContent = "";
  joinCode.focus();
}
function closeJoin({ refocus = true } = {}) {
  if (joinPop.hidden) return;
  joinPop.hidden = true;
  $("joinOpen").setAttribute("aria-expanded", "false");
  if (refocus && joinFrom?.isConnected) joinFrom.focus({ preventScroll: true });
}
$("joinOpen").addEventListener("click", () => (joinPop.hidden ? openJoin() : closeJoin()));
$("joinClose").addEventListener("click", () => closeJoin());
joinCode.addEventListener("input", () => {
  joinCode.value = joinCode.value.replace(/\D/g, "").slice(0, 4);
  joinErr.textContent = "";
});
$("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = joinCode.value;
  const fail = (text) => {
    joinErr.textContent = text;
    joinCode.focus();
  };
  if (!/^\d{4}$/.test(code)) return fail(code ? "A code is four digits. Check your friend's screen." : "Type the four digits from your friend's screen.");
  // Asked once, so a mistyped code or a full party is said here, not after a name is typed for
  // nothing. The answer goes along to the party room's way in, which then does not ask again:
  // every look-up counts against the limit on guessing codes that friends on one Wi-Fi share
  // (lobby/public/door-handoff.js). If the room does not answer, the way in asks it itself.
  joinGo.disabled = true;
  let res = null;
  let data = null;
  try {
    res = await fetch(`/api/lobby/join/${code}`);
    data = await res.json().catch(() => null);
  } catch {
    // No answer: the way in tries.
  }
  joinGo.disabled = false;
  if (data?.error === "not_found" || res?.status === 404) return fail("No party has that code right now. Check the four digits.");
  if (data?.error === "rate_limited") return fail(typeof data.message === "string" ? data.message : "Too many tries. Wait a few minutes and try again.");
  if (data?.preview?.full) return fail("This party is full: every seat is taken. Start a party of your own, or ask the host.");
  if (data?.preview) passLookup(session(), code, data.preview);
  location.assign(LINKS.join(code));
});
document.addEventListener("click", (e) => {
  const j = e.target.closest("[data-join]");
  if (!j) return;
  // From the phone's sheet, the sheet closes and focus later goes back to the game's tile.
  const inSheet = document.body.dataset.sheet === "open" && detail.contains(j);
  closeSheet({ refocus: false });
  openJoin(inSheet ? lastTile : j);
});
document.addEventListener("pointerdown", (e) => {
  if (!joinPop.hidden && !joinPop.contains(e.target) && !e.target.closest("#joinOpen, [data-join]")) closeJoin({ refocus: false });
});
// Tabbing out of the code box closes it, as a click outside does: backwards to the page behind
// it, or forwards past its last button, from where the page's order goes on after "Join".
joinPop.addEventListener("focusout", (e) => {
  const to = e.relatedTarget;
  if (to && !joinPop.contains(to) && !to.closest("#joinOpen")) closeJoin({ refocus: false });
});
joinPop.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.shiftKey || e.target !== $("joinClose")) return;
  closeJoin({ refocus: false });
  // Not prevented: the Tab itself then moves on from the button that opened the box.
  $("joinOpen").focus({ preventScroll: true });
});
// Escape closes what is on top: the code box, then a game's card, then the open door.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!joinPop.hidden) closeJoin();
  else if (document.body.dataset.sheet === "open") closeSheet();
  else if (shown !== "doors") leave();
});

// ---------------------------------------------------------------- wide or narrow

wideQuery.addEventListener("change", () => {
  if (isWide()) {
    closeSheet({ refocus: false });
    if (!current && gamesKind && shown === gamesKind) {
      const first = gamesOf(model, gamesKind)[0];
      if (first) select(first.id, { quiet: true });
    }
  }
});
addEventListener("resize", sizeFloaters, { passive: true });

// ---------------------------------------------------------------- start

if (LINKS.howItWorks) {
  $("howItWorks").href = LINKS.howItWorks;
  $("howItWorks").hidden = false;
}
$("getCode").href = LINKS.code;
drawDoors();
drawRoom();
drawFloaters();
sizeFloaters();
show(viewFrom(location.hash), { focus: false });
document.body.dataset.ready = "";
