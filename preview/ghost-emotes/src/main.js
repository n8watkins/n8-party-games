// The page: the list of emotes with their takes, stars and crosses, the colour, the picks, the notes.
import SOUNDS from "virtual:sounds";
import { CUTS, NOTES, RECS } from "./copy.js";
import { GHOST_RIG, TAKES } from "./ghost-rig.js";
import { REAL, createStage } from "./stage.js";

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const TAKE = new Map(TAKES.map((t) => [t.id, t]));
const PRESETS = [
  { name: "Blue", hex: "#2f6f8f" },
  { name: "Red", hex: "#c8382c" },
  { name: "Gold", hex: "#d9a02a" },
  { name: "Green", hex: "#3f7a4a" },
  { name: "Orange", hex: "#e07a2c" },
  { name: "Pink", hex: "#d8588c" },
  { name: "Violet", hex: "#7b55c7" },
  { name: "Sky", hex: "#58b4e0" },
];

// ---------------------------------------------------------------- what the owner has chosen (kept in this browser only)

const KEY = "ghost-emotes-r1";
const state = { on: GHOST_RIG[0].id, takes: {}, marks: {}, colour: PRESETS[0].hex, faded: false, sound: true, size: "large" };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved && typeof saved === "object") {
    for (const k of ["takes", "marks"]) if (saved[k] && typeof saved[k] === "object") state[k] = saved[k];
    if (/^#[0-9a-f]{6}$/i.test(saved.colour)) state.colour = saved.colour;
  }
} catch {
  // No storage here: the page works without it.
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ takes: state.takes, marks: state.marks, colour: state.colour }));
  } catch {
    // Nothing to do.
  }
}
const takeOf = (rig) => (rig.takes.includes(state.takes[rig.id]) ? state.takes[rig.id] : rig.takes[0]);

// ---------------------------------------------------------------- the stage

const stage = createStage({
  box: $("stage"),
  canvas: $("gl"),
  overlay: $("overlay"),
  inset: $("inset"),
  onNoGl() {
    $("nogl").hidden = false;
    for (const id of ["gl", "strip", "size-now"]) $(id).hidden = true;
  },
});

/** The target's colour: gold, unless the ghost's own colour is close to it. */
function pawnColour(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return r > 170 && g > 100 && g < 200 && b < 110 ? "#2f6f8f" : "#d9a02a";
}

// ---------------------------------------------------------------- sound: the room's own recordings, decoded once sound is unlocked

let audio = null;
let gain = null;
let voice = null;
let turn = 0;
const buffers = new Map();
function decode(id) {
  if (!buffers.has(id)) {
    const bin = atob(SOUNDS[id]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buffers.set(id, audio.decodeAudioData(bytes.buffer).catch(() => null));
  }
  return buffers.get(id);
}
function unlock() {
  if (audio || !SOUNDS) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    audio = new Ctx();
    gain = audio.createGain();
    gain.gain.value = 0.85;
    gain.connect(audio.destination);
    for (const id of Object.keys(SOUNDS)) decode(id);
  } catch {
    audio = null;
  }
}
function hush() {
  turn++;
  if (voice) {
    try {
      voice.stop();
    } catch {
      // It had already ended.
    }
    voice = null;
  }
}
function sing(id) {
  hush();
  if (!state.sound || !SOUNDS || !SOUNDS[id]) return;
  unlock();
  if (!audio) return;
  const mine = turn;
  audio.resume().catch(() => {});
  // A first play waits for its recording to be decoded; it is never dropped.
  decode(id).then((buffer) => {
    if (!buffer || mine !== turn) return;
    voice = audio.createBufferSource();
    voice.buffer = buffer;
    voice.connect(gain);
    voice.start();
  });
}

// ---------------------------------------------------------------- the rows

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const rows = new Map();

function play(rig, withSound) {
  state.on = rig.id;
  const take = takeOf(rig);
  if (stage) stage.play(rig.id, take);
  if (withSound) sing(rig.id);
  for (const [id, row] of rows) row.box.dataset.on = id === rig.id ? "1" : "0";
}

function paintRow(rig) {
  const row = rows.get(rig.id);
  const take = takeOf(rig);
  for (const b of row.takes) {
    const id = b.dataset.take;
    const mark = state.marks[`${rig.id}:${id}`];
    b.setAttribute("aria-pressed", String(id === take));
    b.textContent = TAKE.get(id).name;
    if (mark) b.dataset.mark = mark;
    else delete b.dataset.mark;
    b.setAttribute("aria-label", TAKE.get(id).name + (mark === "yes" ? ", starred" : mark === "no" ? ", crossed" : ""));
  }
  const [kind, words] = RECS[rig.id][take];
  row.rec.dataset.k = kind;
  row.rec.replaceChildren(el("b", { text: { pick: "My pick. ", ok: "Works. ", weak: "Weak. " }[kind] }), words);
  const mark = state.marks[`${rig.id}:${take}`];
  const what = `${rig.name}, ${TAKE.get(take).name}`;
  row.yes.setAttribute("aria-pressed", String(mark === "yes"));
  row.yes.setAttribute("aria-label", `${mark === "yes" ? "Remove star" : "Star, this works"}: ${what}`);
  row.no.setAttribute("aria-pressed", String(mark === "no"));
  row.no.setAttribute("aria-label", `${mark === "no" ? "Remove cross" : "Cross, this does not work"}: ${what}`);
}

function buildRows() {
  for (const rig of GHOST_RIG) {
    const rec = el("span", { class: "rec" });
    const title = el("span", { class: "t" }, rig.name, el("small", { text: `says "${rig.word}"` }));
    const playBtn = el("button", { type: "button", class: "play" }, title, rec);
    playBtn.addEventListener("click", () => play(rig, true));
    const seg = el("span", { class: "seg", role: "group", "aria-label": `${rig.name}: take` });
    const takes = rig.takes.map((id) => {
      const b = el("button", { type: "button", "data-take": id, title: TAKE.get(id).what });
      b.addEventListener("click", () => {
        state.takes[rig.id] = id;
        save();
        paintRow(rig);
        play(rig, true);
        writePicks();
      });
      seg.append(b);
      return b;
    });
    if (rig.takes.length === 1) seg.replaceChildren(el("span", { class: "hint", text: "One take: it needs no hands" }));
    const mark = (kind, icon) => {
      const b = el("button", { type: "button", class: `mark ${kind}` });
      b.innerHTML = icon;
      b.addEventListener("click", () => {
        const key = `${rig.id}:${takeOf(rig)}`;
        if (state.marks[key] === kind) delete state.marks[key];
        else state.marks[key] = kind;
        save();
        paintRow(rig);
        writePicks();
      });
      return b;
    };
    const yes = mark("yes", STAR);
    const no = mark("no", CROSS);
    const box = el("div", { class: "row", "data-id": rig.id }, playBtn, el("div", { class: "ctl" }, seg, yes, no));
    $("rows").append(box);
    rows.set(rig.id, { box, rec, takes: rig.takes.length > 1 ? takes : [], yes, no });
    paintRow(rig);
  }
  // One switch for every row at once: only the takes that every hand emote has.
  for (const id of ["float", "wisp"]) {
    const b = el("button", { type: "button", text: TAKE.get(id).name, "aria-pressed": "false" });
    b.addEventListener("click", () => {
      for (const rig of GHOST_RIG) if (rig.takes.includes(id)) state.takes[rig.id] = id;
      save();
      for (const rig of GHOST_RIG) paintRow(rig);
      const now = GHOST_RIG.find((r) => r.id === state.on);
      play(now, false);
      writePicks();
    });
    $("all-takes").append(b);
  }
}

// ---------------------------------------------------------------- colour, fade, size, sound

function paintColour() {
  for (const b of $("swatches").querySelectorAll(".sw")) b.setAttribute("aria-pressed", String(b.dataset.hex === state.colour));
  $("free-colour").value = state.colour;
  if (stage) stage.setColours(state.colour, pawnColour(state.colour));
}
function buildControls() {
  for (const p of PRESETS) {
    const b = el("button", { type: "button", class: "sw", "data-hex": p.hex, "aria-label": p.name, title: p.name, style: `--c:${p.hex}` });
    b.addEventListener("click", () => {
      state.colour = p.hex;
      save();
      paintColour();
      writePicks();
    });
    $("swatches").append(b);
  }
  $("free-colour").addEventListener("input", (e) => {
    state.colour = e.target.value;
    save();
    paintColour();
    writePicks();
  });
  $("faded").addEventListener("click", () => {
    state.faded = !state.faded;
    $("faded").setAttribute("aria-pressed", String(state.faded));
    if (stage) stage.setFaded(state.faded);
  });
  $("sound").addEventListener("click", () => {
    state.sound = !state.sound;
    $("sound").setAttribute("aria-pressed", String(state.sound));
    if (state.sound) unlock();
    else hush();
  });
  if (!SOUNDS) $("sound").hidden = true;
  // The numbers behind the two real sizes are in the notes; on the stage a long label would sit on the pieces.
  const sizeWords = { large: "", tv: "TV size", phone: "Phone size" };
  $("size-now").title = `A pawn is ${REAL.tv} px tall at TV size and ${REAL.phone} px at phone size`;
  const paintSize = () => {
    for (const b of $("sizes").children) b.setAttribute("aria-pressed", String(b.dataset.v === state.size));
    $("size-now").textContent = sizeWords[state.size];
    $("size-now").hidden = state.size === "large";
  };
  for (const b of $("sizes").children)
    b.addEventListener("click", () => {
      state.size = b.dataset.v;
      if (stage) stage.setMode(state.size);
      paintSize();
    });
  paintSize();
  // The first touch anywhere unlocks sound and decodes every recording ahead of its first play.
  window.addEventListener("pointerdown", () => state.sound && unlock(), { once: true, capture: true });
}

// ---------------------------------------------------------------- picks

function picksText() {
  const lines = { yes: [], no: [], none: [] };
  for (const rig of GHOST_RIG) {
    const by = { yes: [], no: [], none: [] };
    for (const id of rig.takes) by[state.marks[`${rig.id}:${id}`] || "none"].push(TAKE.get(id).name);
    const one = rig.takes.length === 1;
    for (const k of ["yes", "no"]) if (by[k].length) lines[k].push(`- ${rig.name}${one ? "" : `: ${by[k].join(", ")}`}`);
    if (!by.yes.length && !by.no.length) lines.none.push(`- ${rig.name}`);
  }
  const part = (title, list) => (list.length ? [title, ...list, ""] : []);
  return ["Ghost emotes, round 1", "", ...part("WORKS", lines.yes), ...part("DOES NOT WORK", lines.no), ...part("NOT MARKED YET", lines.none), `Colour on the stage: ${state.colour}`].join("\n");
}
function writePicks() {
  $("picks-text").textContent = picksText();
}
function buildPicks() {
  $("copy").addEventListener("click", async () => {
    const text = picksText();
    try {
      await navigator.clipboard.writeText(text);
      $("copy-state").textContent = "Copied.";
    } catch {
      // Some app views refuse the clipboard: select the text so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents($("picks-text"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      $("copy-state").textContent = "Could not copy here. The text is selected: copy it by hand.";
    }
  });
}

// ---------------------------------------------------------------- notes, tabs

function buildNotes() {
  const list = (items) => el("ul", {}, ...items.map(([head, words]) => el("li", {}, el("b", { text: head }), ` ${words}`)));
  const box = $("notes");
  for (const [title, items] of NOTES) {
    if (title === "CUTS") box.append(el("section", {}, el("h3", { text: "What I cut before you saw it, and why" }), list(CUTS)));
    else box.append(el("section", {}, el("h3", { text: title }), typeof items === "string" ? el("p", { text: items }) : list(items)));
  }
}
function buildTabs() {
  const tabs = [...document.querySelectorAll(".tabs button")];
  for (const tab of tabs)
    tab.addEventListener("click", () => {
      for (const t of tabs) {
        t.setAttribute("aria-selected", String(t === tab));
        $(`pane-${t.dataset.pane}`).hidden = t !== tab;
      }
    });
}

buildRows();
buildControls();
buildPicks();
buildNotes();
buildTabs();
paintColour();
writePicks();
play(GHOST_RIG.find((r) => r.id === state.on), false);
window.__ghostEmotes = { stage, state };
document.documentElement.dataset.ready = "1";
