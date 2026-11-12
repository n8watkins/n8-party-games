// Cork & Bell: boot, modes, input, the frame loop and the HUD.
//
// URL switches:
//   ?auto=1          a bot plays (this is also the attract mode); in a battle it plays this seat
//   ?seed=<n>        a repeatable solo run
//   ?t=<seconds>     freeze the picture at that round time
//   ?state=<name>    last (the fast last stretch), end (the end card), jam | moths | dark (one attack)
//   ?view=<name>     player (default), wide, mech, far, front, gun, four (four stalls side by side)
//   ?join=<pin>      open the lobby with a PIN filled in
//   ?host=1&seats=4&name=Ann   (with auto=1) make a room and start when that many are ready
//   ?screen=1        (with auto=1) make a room as the shared screen
//   ?lag=<ms>        simulated latency each way (local test rooms only)
//   ?quality=low|high
//   ?grid=row        four stalls in one row on a shared screen (the default is two rows of two)
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { PartyClient } from "../../party-kit/client/party-client.js";
import { mountLobby } from "../../party-kit/client/lobby.js";
import { Sound, buzz } from "./audio.js";
import { LocalSession, NetSession } from "./session.js";
import { ATTACK_NAMES, COUNT_IN, game } from "./shared/battle.js";
import { ROWS } from "./shared/layout.js";
import { BELL_FULL, COCK_SECONDS, ROUND_SECONDS, mech, speedAt } from "./shared/sim.js";
import { Lens, fourInARow, gridFor } from "./view/render.js";
import { StallAssets, StallView } from "./view/stall.js";

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
const P = {
  auto: params.get("auto") === "1",
  seed: num("seed", null),
  freeze: num("t", null),
  state: params.get("state"),
  view: params.get("view") ?? "player",
  join: params.get("join"),
  host: params.get("host") === "1",
  screen: params.get("screen") === "1",
  seats: num("seats", 2),
  name: params.get("name"),
  lag: num("lag", 0),
  quality: params.get("quality"),
  grid: params.get("grid"),
};
fourInARow(P.grid === "row");
const SEAT_COLOURS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"];
const $ = (id) => document.getElementById(id);
const coarse = matchMedia("(pointer: coarse)").matches;
const quality = P.quality ?? (coarse || Math.min(innerWidth, innerHeight) < 500 ? "low" : "high");

const sound = new Sound();
const lens = new Lens($("stage"), { quality });
const party = new PartyClient({ lag: P.lag });
let assets = null;
let views = []; // [{seat, view}]
let session = null;
let mode = "loading"; // attract | solo | four | battle
let wall = 0;
let frozen = false;
let lastFrame = performance.now();
let idleSince = performance.now();
let endShownAt = null;
let hadInput = false;
let pointer = { x: innerWidth / 2, y: innerHeight * 0.45, down: false, touch: false, seen: false };
const keys = new Set();
let lastTime = 0;
let lastReelScore = 0;
let flyTurn = 0;
let bannerUntil = 0;
let bannerAttack = null;
let autoStart = null;
let openedOnce = false;
const moments = [];
const botState = { bots: {}, botSkill: 0.8, delay: 0 };

// ------------------------------------------------------------------ loading

async function load() {
  const tex = new THREE.TextureLoader();
  const [gltf, albedo, lit, dusk, hdr] = await Promise.all([
    new GLTFLoader().loadAsync("game/baked/set.glb"),
    tex.loadAsync("game/baked/set_albedo.jpg"),
    tex.loadAsync("game/baked/set_lit.jpg"),
    tex.loadAsync("game/baked/set_dusk.jpg"),
    new HDRLoader().loadAsync("game/baked/env.hdr"),
    document.fonts.load('400 40px "Abril Fatface"').catch(() => null),
    document.fonts.load('italic 700 40px "Playfair Display"').catch(() => null),
  ]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(lens.renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  assets = new StallAssets({ gltf, albedo, lit, dusk, env });
  assets.chalk.draw(bestScores());
}

// ------------------------------------------------------------------ best scores of the day

function bestScores() {
  const today = new Date().toDateString();
  try {
    const saved = JSON.parse(localStorage.getItem("cork-and-bell:best") ?? "null");
    if (saved?.day === today) return saved.rows;
  } catch {
    // No storage: the board starts from the house scores.
  }
  return [
    { name: "Mabel", score: 4120 },
    { name: "Old Tom", score: 3375 },
    { name: "Fitch", score: 2640 },
    { name: "Dolly", score: 1890 },
    { name: "You?", score: 0 },
  ];
}

function recordScore(name, score) {
  const rows = bestScores().filter((r) => r.name !== "You?");
  rows.push({ name, score });
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 5);
  try {
    localStorage.setItem("cork-and-bell:best", JSON.stringify({ day: new Date().toDateString(), rows: top }));
  } catch {
    // Not saved; it still shows for this visit.
  }
  assets.chalk.draw(top);
  return top.findIndex((r) => r.name === name && r.score === score);
}

// ------------------------------------------------------------------ sessions

function makeViews(seats, mySeat) {
  const many = seats.length > 1 && (mySeat < 0 || mode === "four");
  const shown = many ? seats : seats.filter((s) => s.seat === mySeat);
  if (views.length === shown.length && views.every((v) => v.many === many)) {
    // The same stalls, a new round: keep the pictures, so taking the gun or restarting is instant.
    views.forEach((v, i) => {
      v.seat = shown[i].seat;
      v.view.reset();
    });
  } else {
    for (const v of views) v.view.dispose();
    views = shown.map((s) => ({
      seat: s.seat,
      many,
      view: new StallView(assets, { own: s.seat === mySeat, shadows: !(quality === "low" && many), shadowSize: quality === "low" || many ? 1024 : 2048 }),
    }));
  }
  for (const v of views) v.view.setView(many ? "player" : P.view === "four" ? "player" : P.view, 1);
  if (!openedOnce) {
    // Only the very first picture: the lamps come on.
    openedOnce = true;
    for (const v of views) {
      v.view.lampsOnAt = wall;
      v.view.bulbLevel = 0;
    }
  }
  layout();
}

function startLocal(kind, { countIn = COUNT_IN } = {}) {
  session?.dispose?.();
  mode = kind;
  const seed = P.seed ?? (Math.random() * 2 ** 31) | 0;
  const seats =
    kind === "four"
      ? ["Mabel", "Old Tom", "Fitch", "Dolly"].map((name, seat) => ({ seat, name, kind: "bot" }))
      : [{ seat: 0, name: kind === "solo" ? "You" : "The house", kind: kind === "solo" ? "human" : "bot" }];
  session = new LocalSession({ seed, seats, mySeat: kind === "four" ? -1 : 0, countIn, botSkill: kind === "four" ? 0.75 : 0.95 });
  makeViews(seats, kind === "four" ? -1 : 0);
  endShownAt = null;
  lastTime = -99;
  lastReelScore = 0;
  hideCard();
  hud();
}

function startNet(msg) {
  session?.dispose?.();
  mode = "battle";
  const mySeat = party.you?.role === "player" ? party.you.seat : -1;
  session = new NetSession(party, msg.s ?? msg, mySeat);
  makeViews(session.seats, mySeat);
  endShownAt = null;
  lastTime = -99;
  hideCard();
  lobby.close();
  hud();
}

// ------------------------------------------------------------------ layout and input

function layout() {
  lens.resize(innerWidth, innerHeight, devicePixelRatio || 1);
  const n = Math.max(1, views.length);
  const [cols, rows] = gridFor(n);
  for (const v of views) {
    v.view.aspect = innerWidth / cols / (innerHeight / rows);
    v.view.updateCamera(0, wall, true); // the camera is right at once: the very first click aims through it
  }
  const names = $("names");
  names.replaceChildren();
  if (views.length > 1) {
    views.forEach((v, i) => {
      const seat = session.seats.find((s) => s.seat === v.seat);
      const el = document.createElement("span");
      el.style.left = `${(((i % cols) + 0.5) / cols) * 100}%`;
      el.style.bottom = `calc(${((rows - 1 - Math.floor(i / cols)) / rows) * 100}% + 14px)`;
      el.style.setProperty("--seat", SEAT_COLOURS[v.seat]);
      el.innerHTML = `<i></i><b>0</b><em></em>`;
      el.firstChild.textContent = seat?.name ?? "";
      names.appendChild(el);
      v.plate = el;
    });
  }
}
addEventListener("resize", layout);

function myView() {
  if (!session) return null;
  return views.find((v) => v.seat === session.mySeat) ?? null;
}

function aimFromPointer() {
  const mv = myView();
  if (!mv) return null;
  const lift = pointer.touch ? Math.min(90, innerHeight * 0.11) : 0; // the aim sits above a finger, not under it
  const [ax, ay] = mv.view.aimAt(pointer.x / innerWidth, (pointer.y - lift) / innerHeight);
  return [Math.max(-1.35, Math.min(1.35, ax)), Math.max(0.6, Math.min(2.7, ay))];
}

function takeOver() {
  hadInput = true;
  idleSince = performance.now();
  if (mode === "attract" && !P.auto) {
    startLocal("solo", { countIn: 0 });
    sound.openingBell();
    return true;
  }
  return false;
}

function fire() {
  if (!session || session.mySeat < 0 || P.auto) return;
  const mv = myView();
  if (!mv) return;
  const aim = aimFromPointer();
  if (!aim) return;
  mv.view.setAim(aim[0], aim[1]);
  if (session.fire(aim[0], aim[1])) buzz(12);
  else if (session.time() >= 0 && !session.ended) sound.empty();
}

const stage = $("stage");
stage.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.touch = e.pointerType === "touch";
  pointer.seen = true;
  if (!pointer.touch) takeOver();
  idleSince = performance.now();
});
stage.addEventListener("pointerdown", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.touch = e.pointerType === "touch";
  pointer.down = true;
  pointer.seen = true;
  stage.setPointerCapture?.(e.pointerId);
  const took = takeOver();
  if (endShownAt !== null) return;
  // A mouse fires on the click. A finger aims while it is down and fires when it lifts.
  if (!pointer.touch) fire();
  else if (took) pointer.fresh = true;
});
stage.addEventListener("pointerup", (e) => {
  pointer.down = false;
  if (e.pointerType === "touch" && endShownAt === null) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    fire();
  }
});
stage.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.key);
  takeOver();
  if (e.key === " " || e.key === "Enter") {
    if (endShownAt !== null) playAgain();
    else fire();
  }
  if (e.key === "r" || e.key === "R") playAgain();
  if (e.key === "m" || e.key === "M") toggleSound();
});
addEventListener("keyup", (e) => keys.delete(e.key));

function toggleSound() {
  const b = $("sound");
  if (sound.on) {
    sound.disable();
    b.textContent = "Enable sound";
    b.setAttribute("aria-pressed", "false");
  } else if (sound.enable()) {
    b.textContent = "Sound on";
    b.setAttribute("aria-pressed", "true");
    sound.openingBell(1);
  }
}
$("sound").addEventListener("click", toggleSound);

function playAgain() {
  if (mode === "battle") {
    if (session.over && party.you?.role === "player") {
      party.setReady(true);
      $("again").disabled = true;
      $("again").textContent = "Waiting for the others";
    } else if (session.over) party.start();
    return;
  }
  if (mode === "four") return startLocal("four");
  startLocal("solo", { countIn: 1.2 });
  sound.openingBell();
}
$("again").addEventListener("click", playAgain);

// ------------------------------------------------------------------ the lobby (the party kit's)

const lobby = mountLobby(document.body, party, {
  title: "Cork & Bell",
  joinPath: location.pathname,
  onOpen: () => document.body.classList.add("pointer"),
  onClose: () => document.body.classList.remove("pointer"),
  // The lobby toy and character slots are left empty on purpose: see party-kit/README.md.
});
const openLobby = () => lobby.open({ pin: P.join ?? "" });
$("battle").addEventListener("click", openLobby);
$("card-battle").addEventListener("click", openLobby);

party.on("start", (msg) => startNet(msg));
party.on("snapshot", (s, now, full) => {
  // Joined or came back while a round is on.
  if (full && (mode !== "battle" || !session || session.kind !== "net")) startNet(s);
});
party.on("end", (msg) => {
  if (session?.kind === "net") session.finish(msg.result);
});
party.on("room", (room) => {
  if (mode === "battle" && room.phase === "lobby") {
    // Back in the waiting room: the room was restarted, or everyone else left.
    startLocal("attract", { countIn: 1 });
    lobby.open();
  }
  if (P.auto && (P.host || P.screen) && room.phase === "lobby" && !autoStart) {
    const humans = room.seats.filter((s) => s && s.kind === "human" && s.connected);
    // A short pause, so the full waiting room can be seen (and photographed) before the round.
    if (humans.length >= P.seats && room.canStart) autoStart = setTimeout(() => ((autoStart = null), party.start()), 3000);
  }
});
party.on("status", (status) => {
  const net = $("net");
  net.hidden = status === "open" || status === "idle" || status === "closed";
  net.textContent = status === "reconnecting" ? "Connection lost. Getting your stall back." : "Connecting";
});
party.on("closed", () => {
  if (mode === "battle") startLocal("attract");
});

async function autoBattle() {
  try {
    if (P.screen) await party.create({ as: "screen" });
    else if (P.host) await party.create({ nickname: P.name ?? "Host" });
    else if (P.join) await party.join(P.join, { nickname: P.name ?? "Bot" });
    else return;
    lobby.open();
    if (!P.screen) {
      const ready = () => party.setReady(true);
      party.on("room", (room) => {
        const me = room.seats[party.you?.seat ?? -1];
        if (me && !me.ready && room.phase !== "playing") setTimeout(ready, room.phase === "ended" ? 6000 : 200);
      });
    }
  } catch (err) {
    console.error("auto battle:", err.message);
  }
}

// ------------------------------------------------------------------ events from the round

function showBanner(title, text, { good = false, seconds = 1.6, attack = null } = {}) {
  const b = $("banner");
  b.hidden = false;
  b.className = good ? "good" : "";
  b.innerHTML = `<b></b><span></span>${attack ? '<span class="bar"><i></i></span>' : ""}`;
  b.children[0].textContent = title;
  b.children[1].textContent = text;
  bannerUntil = wall + seconds;
  bannerAttack = attack;
}

function pop(view, e, text, sub, big) {
  const i = views.indexOf(view);
  const [u, v] = view.view.project(e.x, e.y, e.z);
  const el = document.createElement("span");
  if (big) el.className = "big";
  el.textContent = text;
  if (sub) {
    const s = document.createElement("small");
    s.textContent = sub;
    el.appendChild(s);
  }
  const [cols, rows] = gridFor(views.length);
  el.style.left = `${(((i % cols) + u) / cols) * 100}%`;
  el.style.top = `${((Math.floor(i / cols) + v) / rows) * 100}%`;
  $("pops").appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function nameOf(seat) {
  return session.seats.find((s) => s.seat === seat)?.name ?? "A rival";
}

function onEvent(e) {
  const shared = views.length > 1;
  const v = views.find((x) => x.seat === (e.seat ?? e.to ?? -9));
  const mine = e.seat === session.mySeat || (shared && e.seat !== undefined) || session.seats.length === 1;
  switch (e.k) {
    case "fire":
      v?.view.onEvent(e);
      if (mine) sound.shot();
      break;
    case "hit":
      v?.view.onEvent(e);
      if (mine) sound.hit(e);
      if (v && !frozen) {
        const notes = [];
        if (e.rung) notes.push("the bell");
        else if (e.perfect) notes.push("dead centre");
        if (e.ricochet) notes.push("ricochet");
        if (e.mult > 1) notes.push(`${e.mult} times`);
        pop(v, e, `+${e.pts}`, notes.join(", "), e.pts >= 100);
      }
      if (e.seat === session.mySeat) {
        buzz(e.rung ? [30, 40, 30, 40, 60] : 22);
        if (e.bell >= BELL_FULL && !e.rung && e.target !== "bell" && !session.bellCalled) {
          session.bellCalled = true;
          showBanner("The bell is live", session.seats.length > 1 ? "Ring it to put a rival's lamps out." : "Ring it for a hundred.", { good: true, seconds: 2.2 });
        }
        if (e.rung) session.bellCalled = false;
      }
      break;
    case "bounce":
      v?.view.onEvent(e);
      if (mine) sound.bounce(e);
      break;
    case "rest":
      if (mine) sound.rest();
      break;
    case "reset":
      v?.view.onEvent(e);
      if (mine) sound.camLift(e.any);
      break;
    case "unjam":
      if (e.seat === session.mySeat && e.shot) showBanner("Shot loose", "The front row is running again.", { good: true });
      if (mine) sound.cleared();
      break;
    case "atk": {
      const target = views.find((x) => x.seat === e.to);
      if (target) {
        const fromIndex = views.findIndex((x) => x.seat === e.from);
        const toIndex = views.indexOf(target);
        target.view.incoming.push({ id: e.id, type: e.type, at: e.at, from: e.from, side: fromIndex >= 0 && fromIndex < toIndex ? -1 : 1 });
      }
      if (e.to === session.mySeat) {
        moments.push({ k: "warning", type: e.type, id: e.id });
        showBanner(`Incoming: ${ATTACK_NAMES[e.type]}`, e.returned ? `${nameOf(e.from)} sent it back.` : `From ${nameOf(e.from)}. Hit dead centre to send it back.`, { seconds: Math.max(0.6, e.at - session.time()), attack: e });
        sound.warning(e.type);
        buzz([40, 50, 40]);
      } else if (e.from === session.mySeat) {
        showBanner(`Sent ${ATTACK_NAMES[e.type]}`, `To ${nameOf(e.to)}.`, { good: true, seconds: 1.3 });
        sound.sent();
      } else if (shared) sound.sent();
      break;
    }
    case "block": {
      for (const x of views) x.view.incoming = x.view.incoming.filter((a) => a.id !== e.id);
      const bv = views.find((x) => x.seat === e.by);
      if (bv) {
        bv.view.chaseUntil = bv.view.time + 1.4;
        bv.view.chaseKind = 2;
      }
      if (e.by === session.mySeat) {
        moments.push({ k: "blocked", id: e.id });
        showBanner("Blocked", "Sent straight back.", { good: true, seconds: 1.5 });
        buzz([15, 30, 15]);
      }
      if (e.by === session.mySeat || shared) sound.block();
      break;
    }
    case "fizz":
      if (e.from === session.mySeat) showBanner("Fizzled", `${nameOf(e.to)} already has two to deal with.`, { seconds: 1.2 });
      break;
    case "out":
      if (e.seat === session.mySeat) showBanner("Out of corks", "Your stall has stopped scoring.", { seconds: 2.5 });
      break;
    case "time":
      sound.end(false);
      break;
    default:
      break;
  }
}

/** Attacks whose warning has run out: the thing arrives. */
function landIncoming() {
  for (const v of views) {
    const t = session.seatTime(v.seat);
    for (let i = v.view.incoming.length - 1; i >= 0; i--) {
      const a = v.view.incoming[i];
      if (t < a.at) continue;
      v.view.incoming.splice(i, 1);
      if (v.seat === session.mySeat || views.length > 1) sound.landed(a.type);
      if (v.seat === session.mySeat) {
        const text = { jam: ["Front row jammed", "Shoot the cork loose, on the right of the row."], moths: ["Moths", "Four seconds of wings across your sights."], dark: ["Lamps out", "Three seconds in the dark."] }[a.type];
        showBanner(text[0], text[1], { seconds: 1.8 });
        moments.push({ k: "landed", type: a.type, id: a.id });
        buzz(80);
      }
    }
  }
}

// ------------------------------------------------------------------ the HUD

function fmtTime(t) {
  const left = Math.max(0, Math.ceil(ROUND_SECONDS - Math.max(0, t)));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function hud() {
  if (!session) return;
  const playing = mode === "solo" || (mode === "battle" && session.mySeat >= 0);
  $("tally").hidden = !playing && mode !== "attract";
  $("battle").hidden = mode === "battle";
  const hint = $("hint");
  if (mode === "attract") hint.textContent = coarse ? "Drag to aim, let go to fire. Touch to begin." : "The house is playing. Move the pointer and click to take the gun.";
  else if (mode === "four") hint.textContent = "Four stalls, side by side: a battle as the shared screen shows it.";
  else if (mode === "battle" && session.mySeat < 0) hint.textContent = "Shared screen. Players join on their phones with the PIN.";
  else if (mode === "battle") hint.textContent = "Three in a row jams a rival. Tap a rival to choose who.";
  else hint.textContent = coarse ? "Drag to aim, let go to fire. Aim higher for the far row." : "Click to fire. The cork drops: aim higher for the far row.";
  const rivals = $("rivals");
  rivals.hidden = !(mode === "battle" && session.mySeat >= 0);
  if (!rivals.hidden && rivals.childElementCount !== session.seats.length - 1) {
    rivals.replaceChildren();
    for (const s of session.seats) {
      if (s.seat === session.mySeat) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.seat = s.seat;
      b.style.setProperty("--seat", SEAT_COLOURS[s.seat]);
      b.innerHTML = `<span class="token"></span><span class="who"><span class="name"></span><b>0</b><span class="state"></span></span>`;
      b.querySelector(".token").textContent = s.name.slice(0, 1).toUpperCase();
      b.querySelector(".name").textContent = s.name;
      b.setAttribute("aria-label", `Send attacks to ${s.name}`);
      b.addEventListener("click", () => {
        const now = session.pickSeat === s.seat ? -1 : s.seat;
        session.pickSeat = now;
        session.pick(now);
        buzz(10);
      });
      rivals.appendChild(b);
    }
  }
}

function hudFrame(t) {
  const sim = session.sims[session.mySeat >= 0 ? session.mySeat : session.seats[0].seat];
  $("time").textContent = fmtTime(t);
  $("time").classList.toggle("late", t > ROUND_SECONDS - 10);
  $("score").textContent = sim.score;
  $("run").textContent = sim.streak;
  $("run-cell").classList.toggle("hot", sim.streak >= 4);
  $("corks").textContent = sim.corksLeft;
  if (mode === "battle" && session.mySeat >= 0) {
    let lead = -1;
    for (const s of session.seats) if (s.seat !== session.mySeat && (lead < 0 || session.sims[s.seat].score > session.sims[lead].score)) lead = s.seat;
    for (const b of $("rivals").children) {
      const seat = Number(b.dataset.seat);
      const rs = session.sims[seat];
      b.querySelector("b").textContent = rs.score;
      const target = (session.pickSeat ?? -1) === seat || ((session.pickSeat ?? -1) === -1 && seat === lead);
      b.classList.toggle("picked", target);
      const rt = session.seatTime(seat);
      b.querySelector(".state").textContent = rt < rs.jamUntil ? "jammed" : rt < rs.darkUntil ? "lamps out" : rt < rs.mothsUntil ? "moths" : rs.over ? "no corks" : target ? "target" : "";
    }
  }
  for (const v of views) {
    if (!v.plate) continue;
    const rs = session.sims[v.seat];
    const rt = session.seatTime(v.seat);
    v.plate.children[1].textContent = rs.score;
    v.plate.children[2].textContent = rt < rs.jamUntil ? "jammed" : rt < rs.darkUntil ? "lamps out" : rt < rs.mothsUntil ? "moths" : rs.over ? "out of corks" : rs.streak >= 4 ? `run of ${rs.streak}` : "";
  }
  // The count-in.
  const count = $("count");
  if (t < 0 && t > -COUNT_IN - 0.1 && mode !== "attract") {
    const n = Math.ceil(-t);
    count.hidden = false;
    count.className = "";
    if (count.textContent !== String(n)) {
      count.textContent = String(n);
      sound.countTick(false);
    }
  } else if (!count.hidden && count.className === "") {
    count.hidden = true;
    if (t >= 0 && t < 0.5) sound.openingBell();
  }
  if (!$("banner").hidden) {
    if (bannerAttack) {
      const left = Math.max(0, (bannerAttack.at - session.time()) / 1.5);
      const bar = $("banner").querySelector(".bar i");
      if (bar) bar.style.transform = `scaleX(${Math.min(1, left)})`;
    }
    if (wall > bannerUntil) $("banner").hidden = true;
  }
  const ret = $("reticle");
  const show = pointer.seen && session.mySeat >= 0 && !P.auto && (mode === "solo" || mode === "battle") && endShownAt === null && lobby.root.hidden && (!pointer.touch || pointer.down);
  ret.classList.toggle("on", show);
  if (show) {
    const lift = pointer.touch ? Math.min(90, innerHeight * 0.11) : 0;
    ret.style.transform = `translate(${pointer.x}px, ${pointer.y - lift}px)`;
    ret.classList.toggle("cocking", t - sim.lastFire < COCK_SECONDS);
  }
}

function showCard() {
  const rows = session.result();
  const card = $("card");
  const list = $("card-rows");
  list.replaceChildren();
  const solo = session.seats.length === 1;
  let note = "";
  if (solo) {
    const r = rows[0];
    const place = mode === "solo" ? recordScore("You", r.score) : -1;
    $("card-title").textContent = "Time, ladies and gentlemen";
    const li = document.createElement("li");
    li.className = "me";
    li.innerHTML = `<span class="place">1</span><span>Your score<small></small></span><b></b>`;
    li.querySelector("small").textContent = `${r.hits} hits from ${r.shots} corks, best run ${r.best}`;
    li.querySelector("b").textContent = r.score;
    list.appendChild(li);
    note = place === 0 ? "Top of the board today. It is chalked up on the left wall." : place > 0 ? `Number ${place + 1} on today's board.` : "Not on the board yet. The far row pays best.";
  } else {
    const win = rows[0];
    $("card-title").textContent = win.seat === session.mySeat ? "You take the prize" : `${win.name} takes the prize`;
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      if (r.seat === session.mySeat) li.className = "me";
      li.style.setProperty("--seat", SEAT_COLOURS[r.seat]);
      li.innerHTML = `<span class="place"></span><span><span class="n"></span><small></small></span><b></b>`;
      li.querySelector(".place").textContent = i + 1;
      li.querySelector(".n").textContent = r.name + (r.seat === session.mySeat ? " (you)" : "");
      li.querySelector("small").textContent = `${r.hits} hits from ${r.shots} corks, best run ${r.best}`;
      li.querySelector("b").textContent = r.score;
      list.appendChild(li);
    });
    note = mode === "battle" ? (session.mySeat >= 0 ? "The rematch starts the moment everyone taps Rematch." : "Players tap Rematch on their phones.") : "";
  }
  $("card-note").textContent = note;
  const again = $("again");
  again.disabled = false;
  again.hidden = mode === "battle" && session.mySeat < 0 && false;
  again.textContent = mode === "battle" ? (session.mySeat >= 0 ? "Rematch" : "Start the rematch") : "Play again";
  $("card-battle").hidden = mode === "battle";
  card.hidden = false;
  document.body.classList.add("pointer");
  endShownAt = performance.now();
}

function hideCard() {
  $("card").hidden = true;
  if (lobby.root.hidden) document.body.classList.remove("pointer");
  endShownAt = null;
}

// ------------------------------------------------------------------ the frame

let slow = 0;
let fast = 0;
const perf = { frames: 0, ms: 0, fps: 0, worst: 0 };

function govern(ms) {
  if (frozen) return;
  // Resolution gives way before the frame rate does; then the live shadows.
  if (ms > 20) slow++;
  else slow = Math.max(0, slow - 1);
  if (ms < 12.5) fast++;
  else fast = 0;
  if (slow > 40 && lens.scale > 0.5) {
    lens.scale = Math.max(0.5, lens.scale - 0.15);
    slow = 0;
    layout();
  } else if (slow > 40 && lens.scale <= 0.5 && !perf.noShadows) {
    perf.noShadows = true;
    for (const v of views) v.view.key.castShadow = false;
    slow = 0;
  } else if (fast > 600 && lens.scale < 1) {
    lens.scale = Math.min(1, lens.scale + 0.15);
    fast = 0;
    layout();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const ms = now - lastFrame;
  lastFrame = now;
  let dt = Math.min(0.05, ms / 1000);
  if (frozen) dt = 0;
  wall += dt;
  perf.frames++;
  perf.ms += ms;
  perf.worst = Math.max(perf.worst, ms);

  if (session) {
    // Keys aim too: arrows move the aim, space fires.
    if (keys.size && session.mySeat >= 0 && !P.auto) {
      const step = 520 * dt;
      if (keys.has("ArrowLeft")) pointer.x -= step;
      if (keys.has("ArrowRight")) pointer.x += step;
      if (keys.has("ArrowUp")) pointer.y -= step;
      if (keys.has("ArrowDown")) pointer.y += step;
      pointer.x = Math.max(0, Math.min(innerWidth, pointer.x));
      pointer.y = Math.max(0, Math.min(innerHeight, pointer.y));
      pointer.seen = true;
      pointer.touch = false;
    }
    if (P.auto && mode === "battle" && session.mySeat >= 0 && !session.ended) {
      // ?auto=1 in a battle: the same bot the room uses plays this seat, through the same inputs.
      botState.seed = session.seed;
      botState.stalls = session.sims;
      botState.startAt = session.startAt;
      if (botState.round !== session.startAt) {
        botState.round = session.startAt;
        botState.bots = {};
      }
      for (const input of game.bot(botState, session.mySeat, party.now())) {
        myView()?.view.setAim(input.f[1], input.f[2]);
        session.fire(input.f[1], input.f[2]);
      }
    }
    const events = frozen ? [] : session.advance(dt);
    for (const e of events) onEvent(e);
    landIncoming();
    if (session.rebuilt) {
      session.rebuilt = false;
      for (const v of views) v.view.restedShown = 0;
    }
    const tMine = session.time();
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      const sim = session.sims[v.seat];
      const t = session.seatTime(v.seat);
      const human = v.seat === session.mySeat && !P.auto && mode !== "attract" && mode !== "four";
      if (human) {
        const aim = aimFromPointer();
        if (aim && pointer.seen && (!pointer.touch || pointer.down)) v.view.setAim(aim[0], aim[1]);
      } else if (sim.lastAim) v.view.setAim(sim.lastAim[0], sim.lastAim[1]);
      v.view.update(sim, t, dt, wall);
      lens.focus[i] = v.view.focus;
    }
    // Sound of the machine: the reels ticking over and the belt joint coming round.
    const mine = session.sims[session.mySeat >= 0 ? session.mySeat : session.seats[0].seat];
    if (mine.score !== lastReelScore) {
      if (Math.floor(wall * 22) !== Math.floor((wall - dt) * 22)) {
        sound.reelTick();
        lastReelScore += Math.sign(mine.score - lastReelScore) * Math.max(1, Math.round(Math.abs(mine.score - lastReelScore) / 6));
        if (Math.abs(mine.score - lastReelScore) < 3) lastReelScore = mine.score;
      }
    }
    const turn = Math.floor((mech(tMine) * 0.42) / 0.9);
    if (turn !== flyTurn && tMine > 0 && !session.ended) {
      flyTurn = turn;
      sound.flywheel(speedAt(tMine));
    }
    hudFrame(tMine);
    lastTime = tMine;

    // The end of the round.
    if (session.over && endShownAt === null && !frozen) {
      if (mode === "attract") {
        if (!session.restartAt) session.restartAt = wall + 2.5;
        else if (wall > session.restartAt) startLocal("attract", { countIn: 1 });
      } else if (mode === "four") {
        showCard();
      } else showCard();
    }
    if (mode === "four" && endShownAt !== null && performance.now() - endShownAt > 7000) startLocal("four");
    // Left alone on the end card, the house takes the stall back.
    if (mode === "solo" && endShownAt !== null && performance.now() - endShownAt > 25000) startLocal("attract", { countIn: 1 });
    if (mode === "solo" && !P.auto && endShownAt === null && performance.now() - idleSince > 60000 && session.time() > 5) startLocal("attract", { countIn: 1 });
  }
  if (views.length) lens.render(views.map((v) => v.view), wall);
  govern(ms);
}

// The bot's aim, for the gun in stalls nobody on this screen is holding.
function trackAims(e) {
  if (e.k === "fire" && session.sims[e.seat]) session.sims[e.seat].lastAim = [e.ax, e.ay];
}
const baseOnEvent = onEvent;
// eslint-disable-next-line no-func-assign
onEvent = function (e) {
  trackAims(e);
  baseOnEvent(e);
};

// ------------------------------------------------------------------ go

async function main() {
  lens.resize(innerWidth, innerHeight, devicePixelRatio || 1);
  await load();
  $("loading").classList.add("gone");
  if (P.view === "four") startLocal("four");
  else startLocal(P.auto || !P.state || P.state === "end" || P.state === "last" ? "attract" : "solo", { countIn: P.state ? 0 : 1 });
  if (P.state === "last") session.advance(72 + session.time() * -1);
  if (P.state === "end") {
    session.advance(ROUND_SECONDS + 2 - session.time());
    for (const e of []) onEvent(e);
  }
  if (["jam", "moths", "dark"].includes(P.state)) {
    session.advance(2);
    onEvent(session.inflict(P.state));
  }
  if (P.freeze !== null) {
    // Play forward to the asked-for moment, then hold it.
    const events = session.advance(Math.max(0, P.freeze - session.time()));
    for (const e of events) {
      trackAims(e);
      const v = views.find((x) => x.seat === e.seat);
      if (e.k === "atk") onEvent(e);
      else v?.view.onEvent(e);
    }
    wall = P.freeze + 10;
    frozen = true;
    for (const v of views) v.view.update(session.sims[v.seat], session.seatTime(v.seat), 0, wall);
  }
  if (P.state === "end" && mode === "attract") {
    mode = "solo";
    showCard();
  }
  if (P.auto && (P.host || P.join || P.screen)) autoBattle();
  else if (P.join) openLobby();
  else if (!P.auto && party.resume()) {
    // An earlier visit left a seat in a room: go back to it.
  }
  requestAnimationFrame((t) => {
    lastFrame = t;
    frame(t);
  });
  // For the playtests.
  window.__cab = {
    get mode() { return mode; },
    get session() { return session; },
    get views() { return views; },
    party,
    lens,
    perf,
    moments,
    lobby,
    params: P,
    fps() {
      const f = perf.frames ? 1000 / (perf.ms / perf.frames) : 0;
      const out = { fps: Math.round(f * 10) / 10, worstMs: Math.round(perf.worst), scale: lens.scale, size: [lens.width, lens.height], calls: lens.renderer.info.render.calls, triangles: lens.renderer.info.render.triangles };
      perf.frames = 0;
      perf.ms = 0;
      perf.worst = 0;
      return out;
    },
    gpu() {
      const gl = lens.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    },
    summary() {
      if (!session) return null;
      return { mode, t: Math.round(session.time() * 100) / 100, over: session.over, round: session.round ?? 1, phase: party.room?.phase ?? null, mySeat: session.mySeat, stalls: session.seats.map((s) => ({ name: s.name, ...session.sims[s.seat].summary() })) };
    },
  };
}

main().catch((err) => {
  console.error(err);
  $("loading").textContent = "The stall would not open. Reload the page.";
});
