// Paper Masks at the Table: the page every player, watcher and the big screen sees while it is
// played. The rules live on the server (party/games/paper-masks); this page only ever gets one
// seat's view of them and sends that seat's taps. The shape every Table game's view keeps
// (party-kit/GAME-CONTRACT.md, "In the browser"): mount(container, ctx) returns {snapshot,
// events, unmount}, plus room(next) for the room view as it changes (names of late joiners).
//
// The look is the owner's "Masquerade": his painted table is the stage, his cut-out masks are the
// players, the answer is a parchment card. Pictures and fonts are under paper-masks/.
//
// Secrecy, as the rules' README asks of the page:
//   - Everything people typed (answers, prompts, notes, names) is set with textContent, never as
//     HTML, and never put in an attribute.
//   - The author of the card being guessed sees the very screen a guesser sees: the same name
//     chips with the same painted masks, their own used names greyed as anyone's are (the rules'
//     view gives the author a guesser's chips). Tapping any chip sends the decoy tap instead of a
//     guess; nothing is sent on arrival or on a timer, so the public count moves only on real
//     taps. The only cue that the card is theirs is the helper line's last few words, quiet, in
//     the same place and size as the line every guesser has. Which chip the author tapped is kept
//     in memory only, never stored: after a reload the rules' view says which to show.
//   - No "Yours" box during guessing, for anyone: it would repeat the author's card on their phone.
//   - Who has tapped is a count (dots that fill in order), never names.
//   - The reader's list marks no card as the reader's own.
//   - A half-typed answer is kept on this device (localStorage), per party, seat, round and
//     prompt, while writing is open. Every other Paper Masks draft (another round, another party)
//     is dropped when the page mounts and on every snapshot, and every draft once writing closes.

// Beside this module (in its release's folder), never at a site path: site/site-path.js says why.
const CSS = new URL("./paper-masks.css", import.meta.url).href;
const ART = new URL("./paper-masks/art/", import.meta.url).href;

// The rules' timers (TIMERS, SETUP_MS and CURTAIN_MS on the server), used only to draw how much
// of a step's time is left; the deadlines themselves always come from the view.
const SPAN = { writing: 90_000, reading: 180_000, guessing: 45_000, guessingLarge: 30_000, reveal: 180_000, summary: 180_000, setup: 180_000, over: 120_000 };

const MASK_NAMES = { fox: "Fox", moon: "Moon", sun: "Sun", owl: "Owl", butterfly: "Butterfly", jester: "Jester", plume: "Plume", leaf: "Leaf", blank: "Plain" };
const GHOST = "ghost";
// Titles are set in the display face, whose figures read as Roman letters: numbers there are words.
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const ANSWER_MAX = 80;
const DEAL_MS = 5200;

function el(tag, className, text, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== "") node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

function button(className, text, parent, onClick) {
  const b = el("button", className, text, parent);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

/** A painted mask, as a picture; `big` uses the large file. Decorative: the name is always beside it in words. */
function mask(id, cls = "", parent) {
  const m = el("i", `pm-mask${cls ? ` ${cls}` : ""}`, "", parent);
  m.dataset.m = id && MASK_NAMES[id] ? id : "blank";
  m.setAttribute("aria-hidden", "true");
  return m;
}

const codePoints = (s) => [...s].length;
const tidyLength = (s) => codePoints(s.replace(/\s+/g, " ").trim());
const hasLetter = (s) => /[\p{L}\p{N}]/u.test(s);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function list(names) {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // private mode or blocked storage: the draft simply is not kept
    }
  },
  /** Removes every key that starts with `prefix`, except `keep`. */
  sweep(prefix, keep = null) {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(prefix) && k !== keep) localStorage.removeItem(k);
    } catch {
      // blocked storage holds nothing to sweep
    }
  },
};

const DRAFTS = "paper-masks:draft:";
// What an earlier version of this page kept: which chip an author tapped. Never written now.
const OLD_DECOYS = "paper-masks:decoy:";

export function mount(container, ctx) {
  const sheet = el("link");
  sheet.rel = "stylesheet";
  sheet.href = CSS;
  container.append(sheet);

  let room = ctx.room;
  const me = ctx.you?.role === "player" ? ctx.you.seat : -1;
  const names = new Map();
  const learn = (r) => {
    for (const m of r?.members ?? []) if (m?.name) names.set(m.seat, m.name);
  };
  learn(room);
  const screenLike = () => ctx.you?.role === "screen" && me === -1;
  const party = () => `${room?.pin ?? "party"}:${room?.game?.round ?? 0}`;

  const root = el("section", "pm", "", container);
  root.setAttribute("aria-label", "Paper Masks");
  root.dataset.big = screenLike() ? "screen" : "phone";
  el("div", "pm-bg", "", root).setAttribute("aria-hidden", "true");
  el("div", "pm-spot", "", root).setAttribute("aria-hidden", "true");
  const inner = el("div", "pm-in", "", root);
  const top = el("header", "pm-top", "", inner);
  const topLeft = el("span", "", "", top);
  const topRight = el("span", "", "", top);
  const timer = el("div", "pm-time", "", inner);
  const timerBar = el("span", "pm-time-bar", "", timer);
  const timerFill = el("i", "", "", timerBar);
  const timerText = el("span", "pm-time-text", "", timer);
  timerText.setAttribute("aria-live", "off");
  const body = el("div", "pm-body", "", inner);
  const say = el("p", "pm-say", "", inner);
  say.setAttribute("role", "status");
  const toast = el("p", "pm-toast", "", root);
  toast.setAttribute("aria-live", "polite");
  toast.hidden = true;

  /** The latest view, and what this page keeps of its own. */
  let v = null;
  let key = "";
  let drawnStep = "";
  let lastNote = null;
  let editing = false;
  let sending = null;
  let dealUntil = 0;
  let dealOverlay = null;
  const seenReveals = new Set();
  /** Which chip this page's author tapped on their own card (card id -> name), in memory only. */
  const decoyPicks = new Map();
  let firstReveal = true;
  let interval = null;
  let toastTimer = null;
  let sayTimer = null;

  const nameOf = (seat) => (seat === GHOST ? "The game" : (names.get(seat) ?? `Seat ${Number(seat) + 1}`));
  const playerOf = (seat) => v?.players?.find((p) => p.seat === seat) ?? null;
  const maskOf = (seat) => (seat === GHOST ? "blank" : (playerOf(seat)?.mask ?? "blank"));
  const isMe = (seat) => me >= 0 && seat === me;
  const meLeft = () => me >= 0 && !!playerOf(me)?.left;

  function tell(text) {
    say.textContent = text ?? "";
    clearTimeout(sayTimer);
    if (text) sayTimer = setTimeout(() => (say.textContent = ""), 6000);
  }

  async function send(move, what = "") {
    if (sending) return false;
    sending = what || move.t;
    root.classList.add("pm-busy");
    try {
      await ctx.send(move, { id: ctx.inputId() });
      tell("");
      return true;
    } catch (err) {
      tell(err?.message ?? "That did not go through. Try again.");
      return false;
    } finally {
      sending = null;
      root.classList.remove("pm-busy");
      draw(true);
    }
  }

  // ------------------------------------------------------------------ notes as a short line

  function noteText(n) {
    switch (n.k) {
      case "writing_closed":
        if (n.how === "all") return null;
        return n.missing?.length ? `Writing closed. ${list(n.missing.map(nameOf))} had not sent.` : n.how === "time" ? "Writing closed: time ran out." : "The host closed writing.";
      case "guessing_closed":
        return n.missing ? `Moved on with ${n.missing} ${n.missing === 1 ? "guess" : "guesses"} missing.` : "Moved on.";
      case "reading_closed":
        return "Guessing started by itself: time ran out.";
      case "step_by_time":
        return n.step === "summary" ? "The next round started by itself." : "Time ran out, so the next mask came off by itself.";
      case "skipped":
        return "The host skipped an answer. Nobody scores it.";
      case "left":
        return `${nameOf(n.seat)} left the match.`;
      case "host_passed":
        return `${nameOf(n.to)} hosts now.`;
      case "reader_passed":
        return `${nameOf(n.to)} reads now.`;
      case "joined_table":
        return `${nameOf(n.seat)} plays from this round.`;
      case "watching":
        return `${nameOf(n.seat)} joined and watches this round.`;
      case "no_answers":
        return "Nobody sent an answer this round.";
      case "deck_reshuffled":
        return "Every prompt has been played, so the deck starts again.";
      case "ended_early":
        return "Fewer than 3 players are left, so the match ends here.";
      default:
        return null;
    }
  }

  function showNotes() {
    const notes = v?.notes ?? [];
    const newest = notes.length ? notes[notes.length - 1].n : 0;
    if (lastNote === null) {
      lastNote = newest;
      return;
    }
    const fresh = notes.filter((n) => n.n > lastNote);
    lastNote = Math.max(lastNote, newest);
    const words = fresh.map(noteText).filter(Boolean);
    if (!words.length) return;
    toast.textContent = words.join(" ");
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 5000);
  }

  // ------------------------------------------------------------------ the clock

  function span() {
    const phase = v?.phase;
    if (phase === "guessing") return (v.players.filter((p) => !p.left).length >= 7 ? SPAN.guessingLarge : SPAN.guessing);
    return SPAN[phase] ?? 60_000;
  }

  function tick() {
    if (!v) return;
    const now = ctx.now();
    const { soft, hard, overdue } = v.deadline ?? {};
    const softLeft = soft !== null && soft !== undefined ? soft - now : null;
    const late = overdue || (softLeft !== null && softLeft <= 0);
    const target = !late && softLeft !== null ? soft : hard;
    if (target === null || target === undefined) {
      timer.hidden = true;
      return;
    }
    timer.hidden = false;
    const left = Math.max(0, target - now);
    const total = late && soft !== null && soft !== undefined ? Math.max(1, hard - soft) : span();
    timerFill.style.transform = `scaleX(${Math.min(1, left / total).toFixed(4)})`;
    timer.classList.toggle("late", late && soft !== null && soft !== undefined);
    timerText.textContent = timeWords(late, left);
    if (dealOverlay && now > dealUntil) closeDeal();
  }

  function timeWords(late, left) {
    const t = clock(left);
    switch (v.phase) {
      // Each says what happens by itself when the time runs out.
      case "setup":
        return `Starts in ${t}`;
      case "writing":
        return late ? `Time's up · closes in ${t}` : t;
      case "reading":
        return `Guessing in ${t}`;
      case "guessing":
        return late ? `Time's up · moves on in ${t}` : t;
      case "reveal":
        return `Next mask in ${t}`;
      case "summary":
        return `Next round in ${t}`;
      case "over":
        return `To the Table in ${t}`;
      default:
        return t;
    }
  }

  // ------------------------------------------------------------------ drawing

  function topLine() {
    const phase = v.phase;
    const reader = v.reader !== null && v.reader !== undefined ? nameOf(v.reader) : "";
    const roundWords = v.rounds === "everyone" ? `Round ${v.round}` : `Round ${v.round} of ${v.rounds}`;
    if (phase === "setup") return ["Paper Masks", v.host !== null ? `Host: ${nameOf(v.host)}` : ""];
    if (phase === "writing" || phase === "reading") return [roundWords, isMe(v.reader) ? "You read" : `${reader} reads`];
    if (phase === "guessing") return [`Answer ${v.step.index + 1} of ${v.step.of}`, isMe(v.reader) ? "You read" : `${reader} reads`];
    if (phase === "reveal") {
      const shown = v.step.cards.filter((c) => c.revealed).length;
      return ["Masks off", `${shown} of ${v.step.cards.length}`];
    }
    if (phase === "summary") return [roundWords, "Scores"];
    if (phase === "over") return ["Final curtain", `${v.result?.roundsPlayed ?? v.round} ${v.result?.roundsPlayed === 1 ? "round" : "rounds"}`];
    return ["Paper Masks", ""];
  }

  /** Draws the whole screen for the view, unless nothing it shows has changed. */
  function draw(force = false) {
    if (!v) return;
    const next = JSON.stringify([v, editing, sending, [...names]]);
    if (!force && next === key) return;
    key = next;
    root.dataset.phase = v.phase;
    root.dataset.role = meLeft() ? "left" : v.you?.role ?? "screen";
    const [l, r] = topLine();
    topLeft.textContent = l;
    topRight.textContent = r;
    // Keep the half-typed answer's box (and its focus) across redraws.
    const keep = body.querySelector(".pm-write textarea");
    const focused = keep && document.activeElement === keep;
    const scrolled = body.scrollTop;
    body.textContent = "";
    // A new step starts at the top; a redraw of the same step keeps where the page was scrolled.
    const where = `${v.phase}:${v.round}:${v.step?.card?.id ?? ""}`;
    const same = where === drawnStep;
    drawnStep = where;
    const hero = el("div", "pm-hero", "", body);
    const side = el("div", "pm-side", "", body);
    const paint = DRAW[v.phase] ?? drawWaiting;
    paint(hero, side, keep);
    hostTools(side);
    if (focused) body.querySelector(".pm-write textarea")?.focus({ preventScroll: true });
    body.scrollTop = same ? scrolled : 0;
    tick();
  }

  function seatsRow(parent, seats, { ticks = null, cls = "" } = {}) {
    const row = el("ul", `pm-seats ${cls}`, "", parent);
    for (const seat of seats) {
      const li = el("li", "", "", row);
      const wrap = el("span", "pm-seat-mask", "", li);
      mask(maskOf(seat), "", wrap);
      if (ticks) {
        const done = !!ticks[String(seat)];
        li.classList.toggle("done", done);
        el("i", "pm-ok", "", wrap).setAttribute("aria-hidden", "true");
        el("b", "", nameOf(seat), li);
        el("span", "pm-vh", done ? "has sent" : "has not sent", li);
      } else el("b", "", nameOf(seat), li);
      if (isMe(seat)) li.classList.add("me");
    }
    return row;
  }

  function promptCard(parent, cls = "") {
    const card = el("div", `pm-note pm-prompt ${cls}`, "", parent);
    el("p", "pm-q-label", "The prompt", card);
    el("p", "pm-a", v.prompt?.text ?? "", card);
    return card;
  }

  function answerCard(parent, text, { prompt = true, cls = "" } = {}) {
    const n = codePoints(text);
    const card = el("div", `pm-note ${cls}${n > 56 ? " longer" : n > 32 ? " long" : ""}`, "", parent);
    if (prompt && v.prompt?.text) el("p", "pm-q", v.prompt.text, card);
    const a = el("p", "pm-a", text, card);
    a.dir = "auto";
    return card;
  }

  // ---------------------------------------------------------------- waiting to start

  function drawWaiting(hero, side) {
    // The host's phone needs the room for the choices: the three masks bob on everyone else's.
    if (!v.you?.host) {
      const trio = el("div", "pm-trio", "", hero);
      for (const [id, cls] of [["plume", "t1"], ["moon", "t2"], ["jester", "t3"]]) mask(id, `lg ${cls}`, trio);
    }
    el("h2", "pm-title", "Paper Masks", hero);
    el("p", "pm-sub", "Answer in secret. Guess who wrote what.", hero);
    const seats = v.players.map((p) => p.seat);
    el("p", "pm-lab", `At the table, ${seats.length} of 8`, side);
    seatsRow(side, seats, { cls: "blank" });
    const host = v.you?.host;
    if (host) {
      const form = el("div", "pm-choose", "", side);
      group(form, "Rounds", v.step.choices.rounds.map((r) => [r, r === "everyone" ? "Everyone reads" : String(r)]), v.rounds, (value) => send({ t: "choose", rounds: value }, "choose"), "rounds");
      group(form, "Prompts", v.step.choices.packs.map((p) => [p.id, p.name]), v.pack, (value) => send({ t: "choose", pack: value }, "choose"), "packs");
      const toggles = el("div", "pm-toggles", "", form);
      toggle(toggles, "Family-safe prompts", v.family, (on) => send({ t: "choose", family: on }, "choose"));
      toggle(toggles, "We're on a call", v.callMode, (on) => send({ t: "choose", callMode: on }, "choose"));
      button("pm-btn", "Deal the masks", side, () => send({ t: "begin" }, "begin")).disabled = !!sending;
    } else {
      const set = el("p", "pm-set", "", side);
      el("span", "", v.rounds === "everyone" ? "Everyone reads once" : `${v.rounds} rounds`, set);
      el("span", "", `${v.step.choices.packs.find((p) => p.id === v.pack)?.name ?? "Mixed"} prompts`, set);
      if (v.family) el("span", "", "Family-safe", set);
      if (v.callMode) el("span", "", "On a call", set);
      el("p", "pm-hint", v.host !== null ? `${nameOf(v.host)} chooses, then deals the masks.` : "The host deals the masks.", side);
    }
  }

  function group(parent, label, options, value, onPick, cls = "") {
    const box = el("div", `pm-group ${cls}`, "", parent);
    box.setAttribute("role", "radiogroup");
    box.setAttribute("aria-label", label);
    el("span", "pm-lab", label, box);
    const row = el("div", "pm-opts", "", box);
    for (const [val, text] of options) {
      const b = button(`pm-opt${val === value ? " on" : ""}`, text, row, () => val !== value && onPick(val));
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(val === value));
      b.disabled = !!sending;
    }
  }

  function toggle(parent, label, on, onChange) {
    const b = button(`pm-toggle${on ? " on" : ""}`, "", parent, () => onChange(!on));
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(!!on));
    el("span", "pm-toggle-knob", "", b).setAttribute("aria-hidden", "true");
    el("span", "", label, b);
    b.disabled = !!sending;
  }

  // ---------------------------------------------------------------- writing

  const draftKey = () => `${DRAFTS}${party()}:${me}:${v.round}:${v.prompt?.id ?? ""}`;

  /** Keeps this round's draft while writing is open for this player, and nothing else of the game's. */
  function sweepStorage() {
    const writing = v?.phase === "writing" && v.you?.role === "player" && !meLeft();
    store.sweep(DRAFTS, writing ? draftKey() : null);
    store.sweep(OLD_DECOYS);
  }

  function drawWriting(hero, side, keep) {
    promptCard(hero, "big");
    const role = v.you?.role;
    const sent = v.step.sent ?? {};
    if (role === "player" && !meLeft()) {
      const mine = v.step.yours;
      if (mine !== null && !editing) {
        const yours = el("div", "pm-yours", "", side);
        el("p", "pm-lab", "Yours, as everyone will see it", yours);
        answerCard(yours, mine, { prompt: false, cls: "small" });
        const row = el("div", "pm-row", "", yours);
        el("p", "pm-hint", "Sent. Only you can see it until it is read out.", row);
        button("pm-link", "Change", row, () => {
          editing = true;
          if (!store.get(draftKey())) store.set(draftKey(), mine);
          draw(true);
        });
      } else writeBox(side, keep, mine);
    } else if (role === "watcher") {
      el("p", "pm-hint", "You joined during this round. Watch this one; you play from the next round.", side);
    } else if (meLeft()) {
      el("p", "pm-hint", "You left this match, so you no longer write or guess. The scores are still yours to watch.", side);
    }
    el("p", "pm-lab", "Sent", side);
    seatsRow(side, Object.keys(sent).map(Number), { ticks: sent, cls: "ticks" });
  }

  function writeBox(side, keep, mine) {
    const form = el("form", "pm-write", "", side);
    form.noValidate = true;
    const label = el("label", "pm-lab", "Your answer, in secret", form);
    const area = keep ?? el("textarea");
    area.name = "answer";
    area.rows = 2;
    area.setAttribute("enterkeyhint", "send");
    area.setAttribute("autocomplete", "off");
    area.setAttribute("autocapitalize", "sentences");
    area.setAttribute("spellcheck", "true");
    area.dir = "auto";
    area.id = "pm-answer";
    label.htmlFor = "pm-answer";
    if (!keep) area.value = store.get(draftKey()) ?? (editing ? (mine ?? "") : "");
    form.append(area);
    const row = el("div", "pm-row", "", form);
    const count = el("span", "pm-count", "", row);
    const go = el("button", "pm-btn small", mine !== null ? "Send the change" : "Send", row);
    go.type = "submit";
    if (mine !== null) button("pm-link", "Keep the one I sent", form, () => {
      editing = false;
      store.set(draftKey(), null);
      draw(true);
    });
    const late = v.deadline?.overdue;
    if (late) el("p", "pm-nudge", "Time's up, finish your sentence.", form);
    // The box outlives redraws (it keeps its text and focus), so its listeners look up the
    // count and the button that are on the page now.
    const update = () => {
      const now = area.closest(".pm-write");
      if (!now) return;
      const n = tidyLength(area.value);
      const c = now.querySelector(".pm-count");
      const b = now.querySelector("button[type=submit]");
      c.textContent = `${n}/${ANSWER_MAX}`;
      c.classList.toggle("over", n > ANSWER_MAX);
      b.disabled = !!sending || n > ANSWER_MAX || !hasLetter(area.value);
    };
    if (!keep) {
      area.addEventListener("input", () => {
        if (v?.phase === "writing") store.set(draftKey(), area.value || null);
        update();
      });
      area.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          area.closest("form")?.requestSubmit();
        }
      });
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      const text = area.value;
      const ok = await send({ t: "answer", text }, "answer");
      if (ok) {
        editing = false;
        store.set(draftKey(), null);
        draw(true);
      }
    });
    update();
  }

  // ---------------------------------------------------------------- reading

  function drawReading(hero, side) {
    const step = v.step;
    const reader = v.you?.reader;
    if (step.cards) {
      // The reader's list (everyone's in call mode): shuffled, numbered, all alike, none marked.
      el("p", "pm-kick", reader ? "Read them all out loud" : `${nameOf(v.reader)} reads these out`, hero);
      el("p", "pm-q pm-q-plain", v.prompt?.text ?? "", hero);
      const ol = el("ol", "pm-list", "", hero);
      step.cards.forEach((c, i) => {
        const li = el("li", "pm-note small", "", ol);
        el("span", "pm-n", String(i + 1), li);
        const a = el("p", "pm-a", c.text, li);
        a.dir = "auto";
        if (reader && v.you.host) button("pm-link", "Skip", li, () => confirmSkip(c));
        else if (reader) {
          const asked = step.asked?.includes(c.id);
          const b = button("pm-link", asked ? "Asked" : "Ask host to skip", li, () => !asked && send({ t: "askSkip", card: c.id }, "ask"));
          b.disabled = asked;
        }
      });
    } else {
      promptCard(hero, "big");
      el("p", "pm-sub", isMe(v.reader) ? "Read them out." : `${nameOf(v.reader)} is reading. Listen, and watch faces.`, hero);
    }
    if (reader) {
      el("p", "pm-hint", `${step.count} answers. Read each once, then start the guessing.`, side);
      button("pm-btn", "Start guessing", side, () => send({ t: "startGuessing" }, "start")).disabled = !!sending;
    } else {
      if (step.cards) el("p", "pm-hint", "On a call: everyone sees the list. Guessing starts when the reader is done.", side);
      else el("p", "pm-hint", `${step.count} answers tonight. Guessing starts when ${nameOf(v.reader)} has read them all.`, side);
      yoursSmall(side);
    }
  }

  function yoursSmall(parent) {
    const step = v.step;
    if (step.yourSkipped) el("p", "pm-hint", "The host skipped your answer. You still guess the others.", parent);
    // Reading only: `yours` is your card.
    const card = step.yours;
    if (!card?.text) return;
    const box = el("div", "pm-yours mini", "", parent);
    el("p", "pm-lab", "Yours", box);
    answerCard(box, card.text, { prompt: false, cls: "small" });
  }

  // ---------------------------------------------------------------- guessing

  function drawGuessing(hero, side) {
    const step = v.step;
    // Phones keep the reader and the count with the answer; the big screen gives them the other half.
    const watching = v.you?.role === "screen";
    const readerBox = el("div", "pm-reader", "", watching ? side : hero);
    mask(maskOf(v.reader), "lg", readerBox);
    el("span", "", isMe(v.reader) ? "You are reading" : `${nameOf(v.reader)} is reading`, readerBox);
    el("p", "pm-kick", "Who wrote this?", hero);
    answerCard(hero, step.card.text, { cls: "guess" });
    tapCount(watching ? side : hero);
    if (step.talkingOrder) el("p", "pm-hint", `Talking order: ${list(step.talkingOrder.map(nameOf))}`, hero);

    const role = v.you?.role;
    if (step.chips.length) {
      // One screen for guessers and for the card's author alike: the view gives both the same
      // fields. The author's tap sends the decoy instead of a guess, and which chip it was is kept
      // in memory only (after a reload the view's `guess` says which to show).
      const author = step.yours;
      const guess = author ? (step.tapped ? (decoyPicks.get(step.card.id) ?? step.guess) : null) : step.guess;
      el("p", "pm-lab", step.auto ? "Filled in for you" : guess !== null ? "Your guess" : "Tap one name", side);
      const chips = el("div", "pm-chips", "", side);
      for (const who of step.chips) {
        const used = !step.available.includes(who);
        const on = guess === who;
        const b = button(`pm-chip${on ? " sel" : ""}${used ? " used" : ""}`, "", chips, () => {
          if (on) return;
          if (!author) return send({ t: "guess", card: step.card.id, who }, "tap");
          decoyPicks.set(step.card.id, who);
          send({ t: "decoy", card: step.card.id }, "tap");
        });
        mask(maskOf(who), "", b);
        el("b", "", nameOf(who), b);
        if (on) el("i", "pm-ok", "", b).setAttribute("aria-hidden", "true");
        b.disabled = used || !!sending;
        b.setAttribute("aria-pressed", String(on));
      }
      // How many names are used, not which: the greyed chips show which, and a count reads the same
      // length on every phone with as many used (names differ in length from phone to phone).
      const used = step.chips.filter((c) => !step.available.includes(c)).length;
      const hint = el("p", "pm-hint pm-guess-hint", "", side);
      if (used && step.eachNameOnce) {
        const n = NUMBER_WORDS[used] ?? String(used);
        el("span", "", `${used === 1 ? "One name is" : `${n[0].toUpperCase()}${n.slice(1)} names are`} already on your sheet, greyed. `, hint);
      }
      if (!step.eachNameOnce) el("span", "", "An answer was skipped, so any name can be used again this round. ", hint);
      // The last words, on a line of their own: the only cue that this card is the author's, in the
      // same place and size as every guesser's own last words.
      if (role === "watcher") el("span", "", "Your guesses count towards a side score.", hint);
      else el("span", "pm-hint-tail", author ? "Yours: tap any name." : "Only you see your guess.", hint);
    } else if (role === "watcher" || role === "player") {
      el("p", "pm-hint", "Nothing to tap on this one.", side);
    }
    if (v.you?.reader) {
      const next = button("pm-btn", step.index + 1 >= step.of ? "On to the reveal" : "Next answer", side, () => send({ t: "next" }, "next"));
      next.disabled = !step.everyoneGuessed || !!sending;
      if (!step.everyoneGuessed) el("p", "pm-hint", "Next lights up when everyone has tapped.", side);
      if (!v.you.host) button("pm-link", "Ask host to skip this answer", side, () => send({ t: "askSkip", card: step.card.id }, "ask"));
    }
    // No "Yours" box here, for anyone: on the author's phone it would repeat the card being guessed.
  }

  /** The only public fact about who has tapped: how many, as dots that fill from the left. */
  function tapCount(parent) {
    const step = v.step;
    const box = el("div", "pm-taps", "", parent);
    el("span", "pm-lab", "Tapped", box);
    const dots = el("span", "pm-dots", "", box);
    for (let i = 0; i < step.tapsDue; i++) el("i", i < step.taps ? "on" : "", "", dots);
    el("span", "pm-taps-n", `${step.taps} of ${step.tapsDue}`, box);
  }

  // ---------------------------------------------------------------- the reveal

  function drawReveal(hero, side) {
    const step = v.step;
    const shown = step.cards.filter((c) => c.revealed);
    if (!shown.length) {
      const stack = el("div", "pm-stack", "", hero);
      for (let i = 0; i < Math.min(5, step.cards.length); i++) mask("blank", "lg", stack).style.setProperty("--i", String(i));
      el("h2", "pm-title", "Masks off", hero);
      el("p", "pm-sub", isMe(v.reader) ? "Reveal the authors one by one. Let each one tell the story." : `${nameOf(v.reader)} reveals who wrote what, one by one.`, hero);
    } else {
      // The latest card to come off (with any identical answer that came off with it).
      const last = shown[shown.length - 1];
      const group = shown.filter((c) => c.id === last.id || (last.sameAs ?? []).includes(c.by));
      const animate = !firstReveal && !seenReveals.has(last.id) && !reduced();
      for (const c of shown) seenReveals.add(c.id);
      revealCard(hero, side, last, group, animate);
    }
    firstReveal = false;
    if (v.you?.reader) {
      const label = step.allRevealed ? "Show the scores" : shown.length ? "Reveal the next one" : "Reveal the first one";
      button("pm-btn", label, side, () => send({ t: "reveal" }, "reveal")).disabled = !!sending;
      if (step.canRevealAll && !step.allRevealed) button("pm-link", "Reveal all the rest", side, () => send({ t: "revealAll" }, "reveal"));
    } else el("p", "pm-hint", step.allRevealed ? `${nameOf(v.reader)} shows the scores next.` : `${nameOf(v.reader)} reveals the next one.`, side);
  }

  function revealCard(hero, side, card, group, animate) {
    answerCard(hero, card.text, { prompt: false, cls: "small" });
    const un = el("div", `pm-unmask${animate ? " go" : ""}`, "", hero);
    const flw = el("div", "pm-flw", "", un);
    el("i", "pm-fl", "", flw);
    mask(card.mask, "lg big who", un);
    if (animate) mask("blank", "lg big veil", un);
    const authors = [card.by, ...(card.sameAs ?? [])];
    const title = card.by === GHOST ? "The game wrote it" : authors.length > 1 ? `Great minds: ${list(authors.map(nameOf))}` : `${nameOf(card.by)} wrote it`;
    el("h2", "pm-title", title, hero);
    if (card.yourGuess !== null && card.yourGuess !== undefined) {
      const right = authors.includes(card.yourGuess);
      el("p", `pm-sub${right ? " right" : ""}`, right ? `You said ${nameOf(card.yourGuess)}. Right!` : `You said ${nameOf(card.yourGuess)}.`, hero);
    } else if (authors.some(isMe)) el("p", "pm-sub", "That was yours.", hero);

    const right = card.right ?? [];
    el("p", "pm-lab", "Guessed right", side);
    if (right.length) {
      const chips = el("div", "pm-chips two", "", side);
      for (const seat of right) {
        const c = el("span", "pm-chip sel static", "", chips);
        mask(maskOf(seat), "", c);
        el("b", "", nameOf(seat), c);
      }
    } else el("p", "pm-hint", "Nobody this time.", side);
    const fooled = Object.entries(card.guesses ?? {}).filter(([g, who]) => !right.includes(Number(g)) && who !== undefined);
    if (fooled.length) {
      el("p", "pm-lab", "Fooled", side);
      const ul = el("ul", `pm-fooled${fooled.length > 4 ? " many" : ""}`, "", side);
      for (const [g, who] of fooled) {
        const li = el("li", "", "", ul);
        mask(maskOf(Number(g)), "", li);
        const words = el("span", "", "", li);
        el("b", "", nameOf(Number(g)), words);
        words.append(" thought it was ");
        el("b", "", nameOf(who === GHOST ? GHOST : Number(who)), words);
      }
    }
    for (const c of group) if (c !== card) answerCard(side, c.text, { prompt: false, cls: "small" });
  }

  // ---------------------------------------------------------------- the round's scores

  function reasons(p) {
    const bits = [];
    if (p.correct) bits.push(`+${p.correct} guessed right`);
    if (p.fooled) bits.push(`+${p.fooled} fooled ${p.fooled === 1 ? "someone" : `${p.fooled} people`}`);
    if (p.perfect) bits.push("+2 perfect sheet");
    return bits.length ? bits.join(", ") : "No points this round";
  }

  function drawSummary(hero, side) {
    const points = v.step?.points ?? {};
    const rows = v.players.filter((p) => p.inRound || points[String(p.seat)]).map((p) => ({ ...p, round: points[String(p.seat)] ?? { correct: 0, fooled: 0, perfect: false, total: 0 } }));
    rows.sort((a, b) => b.score - a.score || b.round.total - a.round.total || a.seat - b.seat);
    el("h2", "pm-title small", `Round ${NUMBER_WORDS[v.round] ?? v.round} scores`, hero);
    if (!v.step) el("p", "pm-sub", "Nobody sent an answer, so nobody scores this round.", hero);
    else if (v.prompt?.text) el("p", "pm-q pm-q-plain", v.prompt.text, hero);
    const ol = el("ol", "pm-scores", "", side);
    for (const p of rows) {
      const li = el("li", `${p.left ? "gone" : ""}${isMe(p.seat) ? " me" : ""}`, "", ol);
      mask(p.mask ?? "blank", "", li);
      const words = el("span", "pm-score-words", "", li);
      el("b", "", nameOf(p.seat), words);
      el("span", "", p.left ? "Left the match" : reasons(p.round), words);
      el("span", "pm-plus", `+${p.round.total}`, li);
      el("span", "pm-total", String(p.score), li);
    }
    const last = typeof v.rounds === "number" && v.round >= v.rounds;
    if (v.you?.host) button("pm-btn", last ? "Final scores" : "Next round", side, () => send({ t: "nextRound" }, "next")).disabled = !!sending;
    else el("p", "pm-hint", `${nameOf(v.host)} starts ${last ? "the final scores" : "the next round"}.`, side);
  }

  // ---------------------------------------------------------------- the end

  function drawOver(hero, side) {
    const res = v.result ?? { rows: [], winners: [], awards: {}, watchers: [] };
    const win = res.winners ?? [];
    const un = el("div", "pm-unmask win", "", hero);
    el("i", "pm-fl", "", el("div", "pm-flw", "", un));
    mask(win.length ? maskOf(win[0]) : "blank", "lg big", un);
    const title = win.length === 1 ? `${nameOf(win[0])} wins` : win.length ? `${list(win.map(nameOf))} share the win` : "The match ended";
    el("h2", "pm-title", title, hero);
    const top = res.rows.find((r) => win.includes(r.seat));
    el("p", "pm-sub", res.early ? "It ended early: fewer than 3 players were left." : top ? `${top.score} ${top.score === 1 ? "point" : "points"}. Best read of the room.` : "", hero);
    const max = Math.max(1, ...res.rows.map((r) => r.score));
    const ol = el("ol", "pm-board", "", side);
    res.rows.forEach((r, i) => {
      const li = el("li", `${r.left ? "gone" : ""}${isMe(r.seat) ? " me" : ""}`, "", ol);
      li.style.setProperty("--i", String(i));
      li.style.setProperty("--w", (r.score / max).toFixed(3));
      el("span", "pm-rk", r.place ? String(r.place) : "-", li);
      mask(r.mask ?? "blank", "", li);
      const words = el("span", "pm-board-name", "", li);
      el("b", "", nameOf(r.seat), words);
      if (r.left) el("span", "", "left", words);
      else if (r.joinedRound) el("span", "", `joined in round ${r.joinedRound}`, words);
      el("i", "pm-meter", "", li).append(el("i"));
      el("span", "pm-pts", String(r.score), li);
    });
    const aw = el("div", "pm-awards", "", hero);
    const award = (title, a, words) => {
      if (!a?.seats?.length) return;
      const d = el("div", "", "", aw);
      mask(maskOf(a.seats[0]), "", d);
      const s = el("span", "", "", d);
      el("em", "", title, s);
      el("b", "", list(a.seats.map(nameOf)), s);
      s.append(` ${words(a.count)}`);
    };
    award("Best mask", res.awards?.bestMask, (n) => `fooled ${n}`);
    award("Mind reader", res.awards?.mindReader, (n) => `${n} right`);
    if (!aw.childElementCount) aw.remove();
    if (res.watchers?.length) el("p", "pm-hint", `Watching: ${res.watchers.map((w) => `${nameOf(w.seat)} ${w.side} right`).join(", ")}`, side);
    if (v.curtain && v.you?.host) button("pm-btn", "Back to the Table", side, () => send({ t: "close" }, "close")).disabled = !!sending;
    else if (v.curtain) el("p", "pm-hint", `${nameOf(v.host)} takes everyone back to the Table.`, side);
  }

  // ---------------------------------------------------------------- the host's tools

  function hostTools(side) {
    if (!v.you?.host || v.phase === "setup" || v.phase === "over") return;
    // The reader's asks go first, where the host sees them without scrolling.
    for (const ask of [...(v.asks ?? [])].reverse()) {
      const box = el("div", "pm-ask");
      body.prepend(box);
      el("p", "pm-lab", `${nameOf(v.reader)} asks to skip`, box);
      answerCard(box, ask.text, { prompt: false, cls: "small" });
      const row = el("div", "pm-row", "", box);
      button("pm-btn small quiet", "Keep it", row, () => send({ t: "keep", card: ask.id }, "keep"));
      button("pm-btn small", "Skip it", row, () => confirmSkip(ask));
    }
    const tools = el("div", "pm-tools", "", side);
    if ((v.phase === "writing" || v.phase === "guessing") && v.deadline?.overdue) button("pm-tool", v.phase === "writing" ? "End writing now" : "End it now", tools, () => send({ t: "endStep" }, "end"));
    if (v.phase === "guessing") button("pm-tool", "Skip this answer", tools, () => confirmSkip(v.step.card));
    if (["reading", "guessing", "reveal"].includes(v.phase) && !v.you.reader) button("pm-tool", "Pass the reading", tools, () => send({ t: "passReading" }, "pass"));
    if (!tools.childElementCount) tools.remove();
  }

  function confirmSkip(card) {
    if (root.querySelector(".pm-sheet")) return;
    const back = el("div", "pm-sheet", "", root);
    const box = el("div", "pm-sheet-box", "", back);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Skip this answer");
    el("h3", "", "Skip this answer?", box);
    answerCard(box, card.text, { prompt: false, cls: "small" });
    el("p", "pm-hint", "It goes from every phone, nobody scores it, and its author is never shown.", box);
    const row = el("div", "pm-row", "", box);
    const stay = button("pm-btn small quiet", "Keep it", row, () => back.remove());
    button("pm-btn small", "Skip it", row, () => {
      back.remove();
      send({ t: "skip", card: card.id }, "skip");
    });
    stay.focus();
  }

  // ---------------------------------------------------------------- the dealt mask

  function maybeDeal() {
    if (!v || v.phase !== "writing" || v.round !== 1 || v.you?.role !== "player" || !v.you.mask) return;
    const seen = `paper-masks:dealt:${party()}:${me}`;
    if (store.get(seen)) return;
    store.set(seen, "1");
    dealUntil = ctx.now() + DEAL_MS;
    dealOverlay = el("div", `pm-deal${reduced() ? " still" : ""}`, "", root);
    dealOverlay.setAttribute("role", "dialog");
    dealOverlay.setAttribute("aria-label", "Your mask tonight");
    el("p", "pm-kick", "Your mask tonight", dealOverlay);
    const card = el("div", "pm-dealcard", "", dealOverlay);
    const flip = el("div", "pm-flip", "", card);
    el("div", "pm-face back", "", flip);
    const front = el("div", "pm-face front", "", flip);
    el("i", "pm-fl", "", front);
    mask(v.you.mask, "lg big", front);
    el("h2", "pm-title", `The ${MASK_NAMES[v.you.mask]}`, dealOverlay);
    el("p", "pm-sub", "Everyone sees your mask. Nobody sees which answer is yours.", dealOverlay);
    button("pm-btn", "Ready", dealOverlay, closeDeal).focus({ preventScroll: true });
  }

  function closeDeal() {
    dealOverlay?.remove();
    dealOverlay = null;
  }

  const DRAW = { setup: drawWaiting, writing: drawWriting, reading: drawReading, guessing: drawGuessing, reveal: drawReveal, summary: drawSummary, over: drawOver };

  // ------------------------------------------------------------------ fitting the page

  /** The stage fills the rest of the screen under the Table's bar: never more on the big screen. */
  function fit() {
    const wide = innerWidth > innerHeight;
    const big = root.dataset.big === "screen";
    const floor = big ? 300 : wide ? 360 : 440;
    const rect = root.getBoundingClientRect();
    const above = rect.top + scrollY;
    // Under the stage: the page's own bottom padding (the Table's #app), nothing else.
    const app = root.closest("#app") ?? document.body;
    const below = (parseFloat(getComputedStyle(app).paddingBottom) || 0) + 2;
    const height = Math.max(floor, Math.floor(innerHeight - above - below));
    if (Math.abs(height - rect.height) > 1) root.style.setProperty("--pm-h", `${height}px`);
  }
  const resized = () => requestAnimationFrame(fit);
  addEventListener("resize", resized);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(document.body);

  function take(s) {
    if (!s || s.game !== "paper-masks") return;
    if (v && (v.phase !== s.phase || v.round !== s.round)) {
      editing = false;
      if (v.phase === "writing" && s.phase !== "writing") store.set(draftKey(), null);
    }
    if (s.phase !== "reveal") firstReveal = false;
    v = s;
    sweepStorage();
    // At the curtain the match is decided: the Table's own "End the game" steps aside for ours.
    ctx.decided?.(v.phase === "over" && !!v.curtain);
    showNotes();
    draw();
    maybeDeal();
    fit();
  }

  take(ctx.snapshot);
  interval = setInterval(tick, 250);
  fit();
  return {
    snapshot: (s) => take(s),
    // The rules say everything in their view; there are no events to show.
    events() {},
    room(next) {
      if (!next) return;
      room = next;
      learn(next);
      draw();
    },
    unmount() {
      clearInterval(interval);
      clearTimeout(toastTimer);
      clearTimeout(sayTimer);
      removeEventListener("resize", resized);
      observer?.disconnect();
      root.remove();
      sheet.remove();
    },
  };
}
