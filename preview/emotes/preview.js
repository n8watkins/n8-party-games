// The emotes preview, fourth round: the page around the rig (rig.js: what every emote does, as
// data) and its flat drawing (draw.js). Inlined around it by preview/make-emotes-artifact.mjs:
// the kit's sound player (SoundBoard, defineSound) and the recordings (CLIPS, each a CC0
// recording as a data: URI, with where it came from).
/* global SoundBoard, defineSound, CLIPS, EMOTES, makeStage, drawEmote, NS, el, set, clamp */
"use strict";

const $ = (id) => document.getElementById(id);
function h(tag, cls = "", txt = "", parent = null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt) e.textContent = txt;
  if (parent) parent.append(e);
  return e;
}
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function recall(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, or a host that forbids it: kept for this visit only.
  }
}
const byId = (id) => EMOTES.find((e) => e.id === id);

/** Cut in this round or before: drawn, tried, and left out. Not in the list. */
const CUT = [
  "White flag, Ten out of ten, the Perfect 10 and Harsh 2 paddles, Huh? as a shrug (the owner's cut, fourth round)",
  "The detailed floating hands, slow clap included (\"kind of creepy\"): every limb is now a stick arm in the piece's colour",
  "Shame bell; Huh?, Love it and Shh as signs (third round)",
  "Sobbing, a magnifying glass, cry more with tissues, bored with a pillow, rolling on the floor laughing (failed the across-the-room test)",
];

/** What each level of limbs means, for the row's tag and the notes. */
const LIMBS = { none: "No arms", mitten: "Mitten", hands: "Small hands" };

// ---------------------------------------------------------------- sound: the recordings, A/B/C per emote

/** When in the emote its sound starts, in ms: on the beat it belongs to. */
const SOUND_AT = { violin: 250, popcorn: 900, slowclap: 700, pointlaugh: 200, redcard: 220, hurry: 200, confetti: 520, thumbsup: 380, boo: 200, trophy: 420, shush: 450, lighter: 760, scratch: 300 };
/** The takes the owner picked (fourth round): chosen to begin with, and marked. */
const PICKED = { violin: "A", popcorn: "B", slowclap: "C", redcard: "B", lighter: "C" };

const board = new SoundBoard({ room: "preview-v4" });
/** For the checks in preview/shoot-emotes.mjs (they run muted): what the player is doing. */
globalThis.__preview = { board, current: () => current.id };
let soundOn = true;
let warmed = false;
function unlock() {
  board.unlock();
  // Once sound is allowed, every recording is decoded ahead, so a first play is never late.
  if (!warmed && board.unlocked) {
    warmed = true;
    void board.warm(CLIPS.map((c) => `${c.emote}-${c.label}`));
  }
}
addEventListener("pointerdown", unlock, { capture: true, passive: true });
addEventListener("keydown", unlock, { capture: true, passive: true });
for (const c of CLIPS) defineSound(`${c.emote}-${c.label}`, c.uri);
const takesOf = (id) => CLIPS.filter((c) => c.emote === id);
/** The take chosen for each emote: "A", "B", "C", or "none". Kept on the device. */
const takes = recall("pv4:takes", { ...PICKED });
const takeFor = (id) => {
  const list = takesOf(id);
  if (takes[id] === "none") return "none";
  return list.some((c) => c.label === takes[id]) ? takes[id] : list[0]?.label ?? "none";
};
let soundTimer = 0;
/** The pawn's sound for this emote: whatever was playing from it stops first, with a short fade. */
function playSound(e) {
  clearTimeout(soundTimer);
  board.stopAll("me");
  const take = takeFor(e.id);
  if (!soundOn || take === "none") return;
  soundTimer = setTimeout(() => void board.play(`${e.id}-${take}`, { from: "me" }), calm() ? 0 : SOUND_AT[e.id] ?? 200);
}

// ---------------------------------------------------------------- the stage

const stage = makeStage($("stage"));
let current = byId("violin");
let startedAt = -1;
let running = false;
let treatment = recall("pv4:treatment", "B");

/** Plays an emote on the stage at once: the one before it stops, its sound too. */
function play(e) {
  current = e;
  startedAt = performance.now();
  playSound(e);
  drawNow();
  for (const row of document.querySelectorAll(".row")) row.classList.toggle("playing", row.dataset.id === e.id);
  if (calm()) return drawEmote(stage, e, e.hold, treatment, true);
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}
function tick() {
  const t = performance.now() - startedAt;
  drawEmote(stage, current, Math.min(t, current.dur), treatment, calm());
  if (t < current.dur) requestAnimationFrame(tick);
  else running = false;
}

/** Under the stage: what is playing and its take (chosen on its row). */
function drawNow() {
  const box = $("now");
  box.replaceChildren();
  h("span", "name", current.name, box);
  const take = takeFor(current.id);
  const clip = takesOf(current.id).find((c) => c.label === take);
  h("span", "what", clip ? `sound ${take}: ${clip.source.author}, CC0` : "no sound", box);
}

// ---------------------------------------------------------------- the list: every candidate, at its real size

/**
 * A picture of the held pose at the size a piece really is: on a phone held sideways showing
 * the whole room a piece is about 58 CSS pixels tall; on a 1080p big screen about 141. Tall
 * enough for what is held up and the sticker over it.
 */
function thumbnail(e, size, aimedWide = e.aimed) {
  const px = size === "screen" ? 141 : 58;
  const s = px / 141;
  const h0 = Math.round(270 * s);
  const w0 = Math.round((aimedWide ? 350 : 200) * s);
  const svg = document.createElementNS(NS, "svg");
  const vw = w0 / s;
  const vh = h0 / s;
  const cx = aimedWide ? 400 : 318;
  set(svg, { width: w0, height: h0, viewBox: `${(cx - vw / 2).toFixed(1)} ${(272 - vh).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`, "aria-hidden": "true" });
  const r = makeStage(svg);
  drawEmote(r, e, e.hold, treatment, true);
  if (!aimedWide) set(r.other.root, { display: "none" });
  set(r.other2.root, { display: "none" });
  return svg;
}

const stars = new Set(recall("pv4:stars", []));
let size = "phone";
function drawRows() {
  const box = $("rows");
  box.replaceChildren();
  for (const e of EMOTES) {
    const row = h("div", "row" + (e === current ? " playing" : ""), "", box);
    row.dataset.id = e.id;
    const playBtn = h("button", "play", "", row);
    playBtn.type = "button";
    playBtn.setAttribute("aria-label", `Play ${e.name}`);
    const th = h("span", "thumb", "", playBtn);
    const pic = thumbnail(e, size);
    th.style.width = `${pic.getAttribute("width")}px`;
    th.style.height = `${pic.getAttribute("height")}px`;
    th.append(pic);
    const words = h("span", "words", "", playBtn);
    const nm = h("span", "nm", e.name, words);
    if (e.kept) h("span", "tag kept", "KEPT", nm);
    if (wheel.includes(e.id)) h("span", "tag wheel", "WHEEL", nm);
    h("span", "tag", LIMBS[e.limbs].toUpperCase(), nm);
    h("span", "ln", e.line, words);
    playBtn.addEventListener("click", () => play(e));
    // The row's own controls: its sound takes and its star.
    const tools = h("div", "tools", "", row);
    const list = takesOf(e.id);
    const choices = [...list.map((c) => c.label), "none"];
    for (const label of choices) {
      const b = h("button", "take" + (PICKED[e.id] === label ? " picked" : ""), label === "none" ? "no sound" : PICKED[e.id] === label ? `${label} · picked` : label, tools);
      b.type = "button";
      const clip = list.find((c) => c.label === label);
      b.setAttribute("aria-label", clip ? `${e.name}, sound ${label}: ${clip.source.title} by ${clip.source.author}` : `${e.name} without a sound`);
      b.setAttribute("aria-pressed", String(takeFor(e.id) === label));
      b.addEventListener("click", () => {
        takes[e.id] = label;
        remember("pv4:takes", takes);
        for (const x of tools.querySelectorAll(".take")) x.setAttribute("aria-pressed", String(x === b));
        writePicks();
        play(e);
      });
    }
    const st = h("button", "star", "★", tools);
    st.type = "button";
    st.setAttribute("aria-label", `Favourite: ${e.name}`);
    st.setAttribute("aria-pressed", String(stars.has(e.id)));
    st.addEventListener("click", () => {
      if (stars.has(e.id)) stars.delete(e.id);
      else stars.add(e.id);
      remember("pv4:stars", [...stars]);
      st.setAttribute("aria-pressed", String(stars.has(e.id)));
      writePicks();
    });
  }
}

// ---------------------------------------------------------------- the wheel and its loadout

const STARTER = ["violin", "popcorn", "slowclap", "pointlaugh", "redcard", "thumbsup"];
let wheel = recall("pv4:wheel", STARTER).filter((id) => byId(id));
while (wheel.length < 6) wheel.push(STARTER.find((id) => !wheel.includes(id)));
let slotPicked = 0;
function drawLoadout() {
  const box = $("loadout");
  box.replaceChildren();
  wheel.forEach((id, i) => {
    const b = h("button", "slot" + (i === slotPicked ? " sel" : ""), "", box);
    b.type = "button";
    h("div", "k", `key ${i + 1}`, b);
    h("div", "", byId(id).name, b);
    b.addEventListener("click", () => {
      slotPicked = i;
      drawLoadout();
    });
  });
}
$("put").addEventListener("click", () => {
  wheel[slotPicked] = current.id;
  remember("pv4:wheel", wheel);
  toast(`${current.name} is on slot ${slotPicked + 1}`);
  slotPicked = (slotPicked + 1) % 6;
  drawLoadout();
  drawRows();
  writePicks();
});
$("reset").addEventListener("click", () => {
  wheel = [...STARTER];
  remember("pv4:wheel", wheel);
  drawLoadout();
  drawRows();
  writePicks();
});

const wheelBox = $("wheel");
const veil = $("veil");
let press = null;
let hot = -1;
let coolUntil = 0;
let wedges = [];
function buildWheel() {
  wheelBox.replaceChildren();
  const svg = el("svg", { viewBox: "-150 -150 300 300" }, wheelBox);
  wedges = [];
  for (let i = 0; i < 6; i++) {
    const a0 = ((i - 0.5) / 6) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.5) / 6) * Math.PI * 2 - Math.PI / 2;
    const p = (rr, a) => `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
    const w = el("path", { class: "wedge", d: `M${p(46, a0)} L${p(142, a0)} A142,142 0 0 1 ${p(142, a1)} L${p(46, a1)} A46,46 0 0 0 ${p(46, a0)} Z` }, svg);
    const mid = (a0 + a1) / 2;
    const cx = Math.cos(mid) * 95;
    const cy = Math.sin(mid) * 95;
    const e = byId(wheel[i]);
    const pic = thumbnail(e, "phone", false);
    set(pic, { x: cx - 24, y: cy - 44, width: 48, height: 64 });
    svg.append(pic);
    el("text", { class: "label", x: cx, y: cy + 30 }, svg).textContent = e.name.split(" (")[0].split(" ").slice(0, 2).join(" ");
    w.addEventListener("click", () => wheelBox.classList.contains("tap") && fire(i));
    wedges.push(w);
  }
  el("circle", { class: "hub", r: 40 }, svg);
  el("text", { class: "hubtext", y: 4 }, svg).textContent = "flick";
}
function openWheel(x, y, tapMode) {
  buildWheel();
  wheelBox.style.left = clamp(x, 158, innerWidth - 158) + "px";
  wheelBox.style.top = clamp(y - 60, 158, innerHeight - 158) + "px";
  wheelBox.classList.add("open");
  wheelBox.classList.toggle("tap", tapMode);
  veil.classList.toggle("open", tapMode);
}
function closeWheel() {
  wheelBox.classList.remove("open", "tap");
  veil.classList.remove("open");
  press = null;
  setHot(-1);
}
function setHot(i) {
  hot = i;
  wedges.forEach((w, n) => w.classList.toggle("hot", n === i));
}
function fire(i) {
  closeWheel();
  const now = performance.now();
  if (now < coolUntil) return toast("Cooling down: the ring shows when it is ready");
  coolUntil = now + 1500;
  play(byId(wheel[i]));
  const sweep = $("emote-sweep");
  const step = () => {
    const left = Math.max(0, coolUntil - performance.now());
    sweep.setAttribute("stroke-dasharray", `${(100 * (1 - left / 1500)).toFixed(1)} 100`);
    if (left > 0) requestAnimationFrame(step);
  };
  step();
}
const btn = $("emote-btn");
btn.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  try {
    btn.setPointerCapture(ev.pointerId);
  } catch {
    // A pointer the browser no longer knows: the wheel still reads it while it is over the button.
  }
  btn.classList.add("held");
  press = { x: ev.clientX, y: ev.clientY, at: performance.now(), id: ev.pointerId };
  openWheel(ev.clientX, ev.clientY, false);
});
btn.addEventListener("pointermove", (ev) => {
  if (!press || ev.pointerId !== press.id) return;
  const dx = ev.clientX - press.x;
  const dy = ev.clientY - press.y;
  if (Math.hypot(dx, dy) < 22) return setHot(-1);
  const a = Math.atan2(dy, dx) + Math.PI / 2;
  setHot(((Math.round((a / (Math.PI * 2)) * 6) % 6) + 6) % 6);
});
btn.addEventListener("pointerup", (ev) => {
  if (!press || ev.pointerId !== press.id) return;
  btn.classList.remove("held");
  const quick = performance.now() - press.at < 300 && hot === -1;
  if (hot >= 0) fire(hot);
  else if (quick) {
    press = null;
    wheelBox.classList.add("tap");
    veil.classList.add("open");
  } else closeWheel();
});
btn.addEventListener("pointercancel", () => {
  btn.classList.remove("held");
  closeWheel();
});
veil.addEventListener("click", closeWheel);
addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeWheel();
  if (/^[1-6]$/.test(ev.key) && !(ev.target instanceof HTMLTextAreaElement)) fire(Number(ev.key) - 1);
});
// Turning the phone closes an open wheel: it was placed for the other shape of screen.
addEventListener("resize", () => wheelBox.classList.contains("open") && closeWheel());

// ---------------------------------------------------------------- tabs and switches

for (const tab of document.querySelectorAll(".tabs button")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll(".pane")) p.hidden = p.id !== `pane-${tab.dataset.pane}`;
  });
}
function segment(id, onPick, initial) {
  const box = $(id);
  const sync = (v) => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    sync(b.dataset.v);
    onPick(b.dataset.v);
  });
  sync(initial);
}
segment(
  "treatment",
  (v) => {
    treatment = v;
    remember("pv4:treatment", v);
    drawRows();
    writePicks();
    play(current);
  },
  treatment,
);
segment(
  "sizes",
  (v) => {
    size = v;
    drawRows();
  },
  size,
);
$("sound-on").addEventListener("click", () => {
  soundOn = !soundOn;
  $("sound-on").classList.toggle("on", soundOn);
  $("sound-on").setAttribute("aria-pressed", String(soundOn));
  $("sound-on").textContent = soundOn ? "Sound on" : "Sound off";
  if (!soundOn) {
    clearTimeout(soundTimer);
    board.stopAll();
  }
});

// ---------------------------------------------------------------- notes and sources

const NOTES = [
  "<strong>Arms again.</strong> Every limb is a stick arm from the shoulder, as in the second round, in the piece's own colour (red here; in the room each piece's own). The detailed hands are gone. There are three levels, chosen by what the action needs, and each row says which:",
  "<strong>No arms</strong>: the body does it alone. Fuming.",
  "<strong>Mitten</strong>: a simple rounded mitten for holding, waving or pointing (one finger out). Popcorn, point and laugh, red card, hurry up, confetti, GG, lighter up.",
  "<strong>Small hands</strong>: a small cartoon hand with stubby fingers, only where the hand's own action is the point. The violin's pinch and bow, the slow clap's flat palms, thumbs up, boo's thumbs down, the finger to the lips, the head scratch.",
  "<strong>The violin</strong> is now comically tiny, pinched at the chin with a toothpick bow; a glint at the start makes sure it is seen.",
  "<strong>Your sound picks</strong> are chosen and marked \"picked\" on their rows: violin A, popcorn B, slow clap C, red card B, lighter C. The other takes are still there. Huh? has three short \"hmm\" takes to choose from.",
  "<strong>Starter wheel (already set):</strong> violin, popcorn, slow clap, point and laugh, red card, thumbs up. The WHEEL tag follows your wheel when you change it.",
];
{
  const box = $("notes");
  for (const n of NOTES) h("p", "", "", h("div", "note", "", box)).innerHTML = n;
  h("p", "", "", h("div", "note", "", box)).innerHTML = `<strong>Cut:</strong> ${CUT.join("; ")}.`;
}
{
  const box = $("sources");
  h("p", "", "Every sound here is a recording from Freesound that its own page marks Creative Commons 0 (public domain: may be copied, changed and shared, even commercially, without asking). Each was trimmed, made mono and brought to the same loudness. Nothing is in the repository until you pick.", box);
  const table = h("table", "", "", box);
  const head = h("tr", "", "", table);
  for (const t of ["Emote", "Take", "Recording", "Licence"]) h("th", "", t, head);
  for (const c of CLIPS.filter((x) => byId(x.emote))) {
    const tr = h("tr", "", "", table);
    h("td", "", byId(c.emote).name, tr);
    h("td", "", `${c.label} · ${c.seconds.toFixed(1)} s`, tr);
    const td = h("td", "", "", tr);
    const a = h("a", "", `${c.source.title} by ${c.source.author}`, td);
    a.href = c.source.page;
    a.target = "_blank";
    a.rel = "noopener";
    h("div", "src", `Freesound #${c.source.freesoundId}${c.edit ? ` · edited here: ${c.edit}` : ""}`, td);
    h("td", "", c.source.licence, tr);
  }
}

// ---------------------------------------------------------------- picks

function writePicks() {
  const em = EMOTES.filter((e) => stars.has(e.id));
  const takeText = (e) => (takeFor(e.id) === "none" ? "no sound" : `sound ${takeFor(e.id)}`);
  const lines = [
    "Emotes v4: my picks",
    "",
    "Starred: " + (em.length ? em.map((e) => `${e.name} (${takeText(e)})`).join(", ") : "(none starred)"),
    "My wheel: " + wheel.map((id) => `${byId(id).name} (${takeText(byId(id))})`).join(", "),
    "Display: " + { A: "the body only", B: "body + sticker", C: "body + sticker + screen card" }[treatment],
  ];
  $("picks").value = lines.join("\n");
}
$("copy").addEventListener("click", async () => {
  const area = $("picks");
  try {
    await navigator.clipboard.writeText(area.value);
    return toast("Copied");
  } catch {
    // No clipboard here: fall back to selecting it.
  }
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  toast(ok ? "Copied" : "Selected: copy it with your device's Copy");
});
$("clear").addEventListener("click", () => {
  stars.clear();
  remember("pv4:stars", []);
  drawRows();
  writePicks();
});
let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------- begin, and stills for the screenshots

/** #still=<id>&look=A|B|C[&t=ms]: the stage alone, frozen at the held pose. #size=screen: the big pictures. */
const still = /still=([\w-]+)/.exec(location.hash);
if (/size=screen/.test(location.hash)) {
  size = "screen";
  for (const b of $("sizes").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === "screen"));
}
drawRows();
drawLoadout();
writePicks();
if (still && byId(still[1])) {
  document.documentElement.classList.add("still-mode");
  current = byId(still[1]);
  const at = Number(/[&#]t=(\d+)/.exec(location.hash)?.[1] ?? current.hold);
  drawEmote(stage, current, at, /look=([ABC])/.exec(location.hash)?.[1] ?? treatment, true);
} else {
  drawEmote(stage, current, current.hold, treatment, true);
  drawNow();
}
document.documentElement.dataset.ready = "1";
