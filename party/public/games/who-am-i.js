// Who Am I? at the Table: the page each player, a watcher and the big screen sees while it is
// played. The rules live on the server (party/games/who-am-i); this page only ever gets one seat's
// view of them and sends that seat's taps. The shape every Table game's view keeps
// (party-kit/GAME-CONTRACT.md, "In the browser"): mount(container, ctx) returns {snapshot, events,
// unmount}, plus room(next) for the room view as it changes (names of players who join).
//
// The look is the live game's own (whoami.n8builds.dev, n8watkins/who-am-i): its purple, its
// question-mark mark, Nunito, round cards, the "Answer as" headband card, chat bubbles for the
// questions and amber rows for the hints. It follows the phone's light or dark setting, as live.
//
// Secrecy, as the rules' README asks of the page:
//   - A player's view never holds their own name during a round, so this page cannot show it; it
//     shows "Your name: hidden" in its place. What it draws for a player depends only on the view,
//     never on anything kept from an earlier round.
//   - Everything people typed (questions) and every name is set with textContent, never as HTML;
//     names go into attributes only as the picture's alt text, on the phone allowed to see them.
//   - Pictures load from upload.wikimedia.org with no referrer, as live; any other address is not
//     loaded at all (initials instead).
//   - Nothing is stored on the device: no names, no hints, no questions, no draft. A half-typed
//     question lives in its box only, which survives redraws but not a reload.

const CSS = "/party/games/who-am-i.css";
const PICTURE_HOST = "https://upload.wikimedia.org/";

// The rules' timers (TIMERS on the server), used only to draw how much of a step is left; the
// deadlines themselves always come from the view.
const SPAN = { setup: 120_000, reveal: 90_000, relaxed: 300_000 };
const HINTS_PER_TURN = 3;
const QUESTION_MAX = 140;

const PACK_NAMES = {
  mixed: "Mixed",
  actors: "Actors",
  "movie-characters": "Movie Characters",
  "historical-figures": "Historical Figures",
  "video-games": "Video Games",
  "brand-mascots": "Brand Mascots",
  "anime-cartoons": "Anime & Cartoons",
};
const LEVELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const MODES = { twenty_questions: "Ask", describe_it: "Clues" };
const MODE_BLURBS = { twenty_questions: "You ask yes/no questions.", describe_it: "The other player describes you." };
const FORMATS = { trade: "Trade turns", keep_going: "Keep going" };
const FORMAT_BLURBS = {
  trade: "One question and one guess, then the other player goes. First right guess wins the round.",
  keep_going: "Your turn lasts until you get it or give up. Both players take a turn each round.",
};
const QUESTION_MODES = { spoken: "Out loud", app: "In the app", both: "Both" };
const ANSWER_LABELS = { yes: "Yes", no: "No", sort_of: "Sort of", dont_know: "Don't know" };
const ANSWER_TONES = { yes: "mint", no: "coral", sort_of: "amber", dont_know: "amber" };
const RESULTS = {
  correct: ["Guessed it", "mint", "✓"],
  skipped: ["Gave up", "neutral", "↷"],
  timed_out: ["Time ran out", "amber", "⏱"],
  beaten: ["Beaten to it", "neutral", "↷"],
  unfinished: ["Not finished", "neutral", "↷"],
};
// The live game's suggested questions: the first few always, a few more shuffled in each turn.
const SUGGESTED = [
  "Am I a real person?",
  "Am I alive today?",
  "Am I a man?",
  "Am I a woman?",
  "Am I fictional?",
  "Am I animated?",
  "Am I known for movies?",
  "Am I from a video game?",
  "Am I American?",
  "Am I human?",
  "Am I an animal?",
  "Am I a mascot for a product?",
  "Am I from before 1900?",
  "Am I from the 20th century?",
  "Am I a hero?",
  "Am I a villain?",
  "Am I known for comedy?",
  "Am I from a book?",
  "Am I British?",
  "Am I from Japan?",
  "Am I a scientist or inventor?",
  "Am I a political leader?",
  "Am I an artist or musician?",
  "Do I have superpowers or magic?",
  "Am I from a space or sci-fi story?",
  "Am I aimed at kids?",
  "Do I wear a costume or uniform?",
  "Am I connected to food or drink?",
  "Am I royalty?",
  "Do I have a famous catchphrase?",
];

const SVG = "http://www.w3.org/2000/svg";

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

/** The live game's mark: a cream disc with a purple question mark on a purple tile. Decorative. */
function logo(parent, size = 36) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("wa-logo");
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, val);
    svg.append(n);
  };
  add("rect", { width: "64", height: "64", rx: "16", fill: "#4c35b5" });
  add("circle", { cx: "32", cy: "32", r: "21", fill: "#fff6e9" });
  add("path", { d: "M25.5 26.5a6.5 6.5 0 1 1 9.4 5.8c-1.9 1-2.9 2.3-2.9 4.2v1.5", fill: "none", stroke: "#4c35b5", "stroke-width": "5", "stroke-linecap": "round" });
  add("circle", { cx: "32", cy: "45", r: "3", fill: "#ff6b4a" });
  parent.append(svg);
  return svg;
}

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const tidy = (s) => s.replace(/\s+/g, " ").trim();

function matchWords(match) {
  const [kind, n] = String(match).split(/-to-|-/);
  return kind === "first" ? `First to ${n}` : `${n} rounds`;
}

/** The suggestions for one turn: the live game's first five and three more, shuffled in. */
function pickSuggestions() {
  const rest = SUGGESTED.slice(5);
  const out = [];
  while (out.length < 3 && rest.length) out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  return [...SUGGESTED.slice(0, 5), ...out];
}

export function mount(container, ctx) {
  const sheet = el("link");
  sheet.rel = "stylesheet";
  sheet.href = CSS;
  container.append(sheet);

  let room = ctx.room;
  // A player's own seat; -1 for anyone who watches (a late joiner keeps their seat number in
  // ctx.you, but the rules give them the big screen's view, which has no seat).
  const me = ctx.you?.role === "player" ? ctx.you.seat : -1;
  const bigScreen = ctx.you?.role === "screen" && !(ctx.you.seat >= 0);
  const names = new Map();
  const learn = (r) => {
    for (const m of r?.members ?? []) if (m?.name) names.set(m.seat, m.name);
  };
  learn(room);

  const root = el("section", "wa", "", container);
  root.setAttribute("aria-label", "Who Am I?");
  root.dataset.big = bigScreen ? "screen" : "phone";
  const bar = el("header", "wa-bar", "", root);
  const main = el("div", "wa-main", "", root);
  const act = el("div", "wa-act", "", root);
  act.setAttribute("role", "region");
  act.setAttribute("aria-label", "Turn actions");
  const status = el("p", "wa-vh", "", root);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  // Beside the stage, not in it: fixed to the screen (the stage is a container, which would hold it).
  const toast = el("p", "wa-toast", "", container);
  toast.setAttribute("aria-live", "polite");
  toast.hidden = true;

  /** The latest view, and what this page keeps of its own (in memory only). */
  let v = null;
  let key = "";
  let lastNote = null;
  let sending = null;
  let error = "";
  let suggestions = pickSuggestions();
  let suggestionsFor = "";
  let logCount = 0;
  let interval = null;
  let toastTimer = null;
  let errorTimer = null;
  /** The question box, kept across redraws so a half-typed question and its focus survive. */
  let askBox = null;

  const nameOf = (seat) => names.get(seat) ?? `Seat ${Number(seat) + 1}`;
  const playerOf = (seat) => v?.players?.find((p) => p.seat === seat) ?? null;
  const isMe = (seat) => me >= 0 && seat === me;
  const amPlayer = () => v?.you?.role === "player" && me >= 0;
  const other = (seat) => v?.players?.find((p) => p.seat !== seat)?.seat ?? null;
  const who = (seat) => (isMe(seat) ? "You" : nameOf(seat));

  function say(text) {
    error = text ?? "";
    clearTimeout(errorTimer);
    if (text) errorTimer = setTimeout(() => {
      error = "";
      draw(true);
    }, 6000);
  }

  async function send(move, what = "") {
    if (sending) return false;
    sending = what || move.t;
    root.classList.add("wa-busy");
    draw(true);
    try {
      await ctx.send(move, { id: ctx.inputId() });
      say("");
      return true;
    } catch (err) {
      say(err?.message ?? "That did not go through. Try again.");
      return false;
    } finally {
      sending = null;
      root.classList.remove("wa-busy");
      draw(true);
    }
  }

  // ------------------------------------------------------------------ notes as a short line

  function noteText(n) {
    switch (n.k) {
      case "reshuffled":
        return "Every name in this pack has been played, so it starts again.";
      case "timed_out":
        return `Time ran out for ${who(n.seat) === "You" ? "you" : nameOf(n.seat)}.`;
      case "guess_lapsed":
        return isMe(n.seat) ? "Nobody confirmed your guess in time, so it counts as wrong." : `Nobody confirmed ${nameOf(n.seat)}'s guess in time, so it counts as wrong.`;
      case "self_confirmed":
        return isMe(n.seat) ? "You confirmed your own guess." : `${nameOf(n.seat)} confirmed their own guess: the other phone was away.`;
      case "watching":
        return `${nameOf(n.seat)} joined and watches.`;
      case "left":
        return `${nameOf(n.seat)} left the match.`;
      case "host_passed":
        return `${nameOf(n.to)} hosts now.`;
      case "began":
        return n.how === "time" ? "The game started by itself with the choices as they were." : null;
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

  /** Clocks on the page: each `.wa-clock` counts down to its data-at, in its data-words. */
  function tick() {
    if (!v) return;
    const now = ctx.now();
    for (const c of root.querySelectorAll("[data-at]")) {
      const at = Number(c.dataset.at);
      const words = c.dataset.words ?? "{t}";
      c.textContent = words.replace("{t}", clock(at - now));
      if (c.dataset.low) c.classList.toggle("low", at - now <= Number(c.dataset.low));
      const fill = c.dataset.span ? c.parentElement?.querySelector(".wa-meter i") : null;
      if (fill) fill.style.transform = `scaleX(${Math.min(1, Math.max(0, (at - now) / Number(c.dataset.span))).toFixed(4)})`;
    }
    // The guesser's own way to confirm appears the moment the rules allow it.
    if (v.phase === "playing" && selfReady() !== drawnSelfReady) draw(true);
  }

  const selfReady = () => {
    const at = v?.turn?.selfConfirmAt;
    return at !== null && at !== undefined && ctx.now() >= at;
  };
  let drawnSelfReady = false;

  function countdown(parent, at, words, { cls = "", span = 0, low = 0 } = {}) {
    const c = el("span", `wa-clock ${cls}`.trim(), "", parent);
    c.dataset.at = String(at);
    c.dataset.words = words;
    if (span) c.dataset.span = String(span);
    if (low) c.dataset.low = String(low);
    c.textContent = words.replace("{t}", clock(at - ctx.now()));
    return c;
  }

  // ------------------------------------------------------------------ drawing

  function draw(force = false) {
    if (!v) return;
    const next = JSON.stringify([v, sending, error, [...names], selfReady()]);
    if (!force && next === key) return;
    key = next;
    drawnSelfReady = selfReady();
    root.dataset.phase = v.phase;
    root.dataset.role = bigScreen ? "screen" : amPlayer() ? "player" : "watcher";
    root.dataset.wide = "";
    const focused = askBox && document.activeElement === askBox;
    bar.textContent = "";
    main.textContent = "";
    act.textContent = "";
    drawBar();
    (DRAW[v.phase] ?? drawSetup)();
    if (error) el("p", "wa-error", error, act).setAttribute("role", "alert");
    act.hidden = !act.childElementCount;
    if (focused && askBox?.isConnected) askBox.focus({ preventScroll: true });
    status.textContent = statusLine();
    // A new entry in the log: bring it into view (above the action bar on a phone).
    const count = v.turn?.log?.length ?? 0;
    if (count > logCount && !bigScreen) main.querySelector(".wa-log li:last-child")?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    logCount = count;
    fit();
    tick();
  }

  function statusLine() {
    if (v.phase === "playing") {
      const t = v.turn;
      const g = who(t.seat);
      if (t.phase === "confirming") return isMe(t.seat) ? "Waiting for your guess to be confirmed." : `${g} thinks they got it.`;
      return isMe(t.seat) ? "Your turn to guess." : `${g} is guessing.`;
    }
    if (v.phase === "reveal") return v.reveal?.matchOver ? "The match is over." : `Round ${v.round} is over.`;
    return "";
  }

  // ---------------------------------------------------------------- the bar: round, scores, timer

  function drawBar() {
    logo(bar, 32);
    if (v.phase === "setup") {
      el("span", "wa-bar-title", "Who Am I?", bar);
      if (v.until) countdown(el("span", "wa-bar-end", "", bar), v.until, "Starts in {t}", { cls: "wa-pill" });
      return;
    }
    const round = el("span", "wa-round", `R${v.round}`, bar);
    round.setAttribute("aria-label", v.match?.rounds ? `Round ${v.round} of ${v.match.rounds}` : `Round ${v.round}`);
    if (v.match?.rounds) el("span", "wa-of", `/${v.match.rounds}`, round).setAttribute("aria-hidden", "true");
    const scores = el("span", "wa-scores", "", bar);
    scores.setAttribute("role", "group");
    scores.setAttribute("aria-label", "Scores");
    // A player's own score first, as live ("You 1 : 0 Bo"); a watcher sees the two in seat order.
    const order = [...v.players].sort((a, b) => Number(isMe(b.seat)) - Number(isMe(a.seat)) || a.seat - b.seat);
    order.forEach((p, i) => {
      if (i === 1) el("span", "wa-colon", ":", scores).setAttribute("aria-hidden", "true");
      const s = el("span", `wa-score${i === 0 ? " first" : ""}${v.turn?.seat === p.seat ? " active" : ""}`, "", scores);
      const n = el("b", "", String(p.score));
      const name = el("span", "wa-score-name", who(p.seat));
      if (i === 0) s.append(name, n);
      else s.append(n, name);
      s.setAttribute("aria-label", `${who(p.seat)} ${isMe(p.seat) ? "have" : "has"} ${plural(p.score, "point")}`);
    });
    const end = el("span", "wa-bar-end", "", bar);
    const t = v.turn;
    if (v.phase === "playing" && v.options.mode === "twenty_questions") {
      const q = el("span", "wa-asked", "", end);
      el("b", "", String(t.questionCount), q);
      q.append(" asked");
    }
    if (v.phase === "playing" && t.timed) {
      if (t.phase === "confirming") {
        const p = el("span", "wa-pill wa-timer paused", `Paused ${clock(t.paused ?? 0)}`, end);
        p.setAttribute("role", "timer");
        p.setAttribute("aria-label", `Timer paused at ${Math.ceil((t.paused ?? 0) / 1000)} seconds`);
      } else {
        const p = countdown(end, t.deadline, "⏱ {t}", { cls: "wa-pill wa-timer", low: 10_000 });
        p.setAttribute("role", "timer");
      }
    }
  }

  // ---------------------------------------------------------------- setup: the host's choices

  function drawSetup() {
    const hero = el("div", "wa-hero", "", main);
    logo(hero, 64);
    el("h2", "wa-title", "Who Am I?", hero);
    el("p", "wa-sub", "Ask yes/no questions and guess who you are. Your phone shows the other player's name, never your own.", hero);
    const pick = v.setup?.pick ?? [];
    const pool = v.setup?.pool ?? [];
    const playing = el("div", "wa-card wa-who", "", main);
    el("p", "wa-lab", pick.length === 2 ? "Playing" : "At the table", playing);
    const row = el("div", "wa-who-row", "", playing);
    for (const seat of pick.length ? pick : pool) el("span", `wa-chip${isMe(seat) ? " me" : ""}`, `${nameOf(seat)}${isMe(seat) ? " (you)" : ""}`, row);
    if (!bigScreen && me >= 0) el("p", "wa-note", "Keep your phone to yourself: it will show the other player's name.", playing);
    if (v.you?.host) hostForm();
    else {
      const set = el("div", "wa-card wa-set", "", main);
      el("p", "wa-lab", "The game", set);
      const chips = el("div", "wa-who-row", "", set);
      for (const words of summary()) el("span", "wa-chip quiet", words, chips);
      el("p", "wa-note", v.host !== null && v.host !== undefined ? `${nameOf(v.host)} chooses, then starts the game.` : "The host starts the game.", set);
    }
  }

  function summary() {
    const o = v.options;
    const ask = o.mode === "twenty_questions";
    return [
      PACK_NAMES[o.pack] ?? o.pack,
      LEVELS[o.difficulty],
      MODES[o.mode],
      ...(ask ? [FORMATS[o.turnFormat], `Questions: ${QUESTION_MODES[o.questions].toLowerCase()}`] : []),
      matchWords(o.match),
      o.timer ? `${o.timer} s turns` : "No timer",
      o.hints ? "Hints on" : "No hints",
    ];
  }

  function hostForm() {
    const o = v.options;
    const c = v.setup.choices;
    const form = el("div", "wa-card wa-form", "", main);
    const choose = (field) => (value) => send({ t: "choose", [field]: value }, "choose");
    group(form, "Category", c.packs.map((p) => [p.id, p.name]), o.pack, choose("pack"), "packs");
    group(form, "Level", c.difficulty.map((d) => [d, LEVELS[d]]), o.difficulty, choose("difficulty"));
    group(form, "Mode", c.mode.map((m) => [m, MODES[m]]), o.mode, choose("mode"), "", MODE_BLURBS[o.mode]);
    if (o.mode === "twenty_questions") {
      group(form, "Turns", c.turnFormat.map((f) => [f, FORMATS[f]]), o.turnFormat, choose("turnFormat"), "", FORMAT_BLURBS[o.turnFormat]);
      group(form, "Questions", c.questions.map((q) => [q, QUESTION_MODES[q]]), o.questions, choose("questions"));
    }
    group(form, "Match", c.match.map((m) => [m, matchWords(m)]), o.match, choose("match"));
    group(form, "Timer", [...c.timer].sort((a, b) => (a || 999) - (b || 999)).map((t) => [t, t ? `${t} s` : "No timer"]), o.timer, choose("timer"));
    group(form, "Hints", [[true, "On"], [false, "Off"]], o.hints, choose("hints"));
    const pool = v.setup.pool;
    if (pool.length > 2) {
      // A table of more than two (the rules take up to eight): the host picks the two who play.
      el("p", "wa-lab", "Who plays", form);
      const row = el("div", "wa-opts", "", form);
      const pick = v.setup.pick;
      for (const seat of pool) {
        const on = pick.includes(seat);
        const b = button(`wa-opt${on ? " on" : ""}`, nameOf(seat), row, () => {
          if (on) return;
          send({ t: "pick", seats: [pick[1], seat] }, "pick");
        });
        b.setAttribute("aria-pressed", String(on));
        b.disabled = !!sending;
      }
    }
    const go = button("wa-btn lg block", "Start the game", act, () => send({ t: "begin" }, "begin"));
    go.disabled = !!sending;
  }

  function group(parent, label, options, value, onPick, cls = "", blurb = "") {
    const box = el("div", `wa-group ${cls}`.trim(), "", parent);
    box.setAttribute("role", "radiogroup");
    box.setAttribute("aria-label", label);
    el("span", "wa-lab", label, box);
    const row = el("div", "wa-opts", "", box);
    for (const [val, text] of options) {
      const b = button(`wa-opt${val === value ? " on" : ""}`, text, row, () => val !== value && onPick(val));
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(val === value));
      b.disabled = !!sending;
    }
    if (blurb) el("p", "wa-note", blurb, box);
  }

  // ---------------------------------------------------------------- pictures

  /** The picture of a name this phone may see, or its initials; never loads from another host. */
  function picture(parent, who, cls) {
    const pic = who.picture;
    const frame = el("span", `wa-pic ${cls}`, "", parent);
    if (pic && typeof pic.imageUrl === "string" && pic.imageUrl.startsWith(PICTURE_HOST)) {
      const img = el("img", "", "", frame);
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.loading = "eager";
      img.draggable = false;
      img.alt = `Picture of ${who.name}`;
      img.addEventListener("load", () => {
        // Portrait pictures close to the frame's 4:5 fill it; anything else is shown whole (as live).
        const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
        img.classList.toggle("cover", ratio >= 0.62 && ratio <= 0.9);
      });
      img.addEventListener("error", () => {
        img.remove();
        initials(frame, who);
      });
      img.src = pic.imageUrl;
    } else initials(frame, who);
    return frame;
  }

  function initials(frame, who) {
    frame.classList.add("initials");
    frame.dataset.pack = who.pack ?? "mixed";
    const letters = String(who.name ?? "?")
      .split(/\s+/)
      .filter((w) => /^[\p{L}\p{N}]/u.test(w))
      .slice(0, 2)
      .map((w) => [...w][0].toUpperCase())
      .join("");
    el("b", "", letters || "?", frame).setAttribute("aria-hidden", "true");
  }

  /** "Picture: Author · CC BY-SA 4.0" or "Image: © its owner, via Wikipedia", to the file's page. */
  function credit(parent, who) {
    const pic = who.picture;
    if (!pic || typeof pic.filePage !== "string" || !/^https:\/\/(en\.wikipedia|commons\.wikimedia)\.org\//.test(pic.filePage)) return;
    const a = el("a", "wa-credit", "", parent);
    a.href = pic.filePage;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.referrerPolicy = "no-referrer";
    a.textContent = pic.free ? `Picture: ${[pic.author, pic.license].filter(Boolean).join(" · ")}` : "Image: © its owner, via Wikipedia";
  }

  function resultPill(parent, result) {
    const [text, tone, mark] = RESULTS[result] ?? RESULTS.unfinished;
    const p = el("span", `wa-tag ${tone}`, "", parent);
    el("span", "", mark, p).setAttribute("aria-hidden", "true");
    p.append(text);
    return p;
  }

  // ---------------------------------------------------------------- playing

  function drawPlaying() {
    const t = v.turn;
    const mine = isMe(t.seat);
    const guesser = t.seat;
    const judge = v.order.find((s) => s !== guesser);
    const ask = v.options.mode === "twenty_questions";
    const appOn = ask && v.options.questions !== "spoken";
    const spokenOn = ask && v.options.questions !== "app";
    const waiting = t.log.find((e) => e.kind === "question" && e.answer === null) ?? null;
    root.dataset.wide = bigScreen ? "two" : "";

    const top = el("div", "wa-top", "", main);
    if (amPlayer()) {
      const opp = v.opponent;
      const myResult = v.results?.[String(me)];
      const oppResult = v.results?.[String(opp.seat)];
      if (mine) {
        // My turn: the other player's name stays on my phone, small, as live.
        const card = el("div", "wa-card wa-opp small", "", top);
        picture(card, opp, "sm");
        const words = el("p", "wa-opp-line", "", card);
        words.append(`${nameOf(opp.seat)} is `);
        el("b", "wa-name", opp.name, words);
        if (oppResult) resultPill(words, oppResult);
        else words.append(", up next");
        credit(card, opp);
      } else {
        // The headband card: the name I answer as, big, with its picture.
        const card = el("div", "wa-card wa-opp", "", top);
        picture(card, opp, "lg");
        const words = el("div", "wa-opp-words", "", card);
        el("p", "wa-lab", "Answer as", words);
        el("p", "wa-name big", opp.name, words);
        credit(words, opp);
        if (myResult) {
          const r = el("p", "wa-note", "Your turn: ", words);
          resultPill(r, myResult);
        }
      }
      const self = el("p", "wa-self", "", top);
      el("span", "wa-self-q", "?", self).setAttribute("aria-hidden", "true");
      const words = el("span", "", "Your name: ", self);
      el("b", "", "hidden", words);
      words.append(" until the reveal. Keep your phone to yourself.");
    } else {
      // A watcher and the big screen: whose turn it is, never a name.
      const card = el("div", "wa-card wa-turn", "", top);
      logo(card, bigScreen ? 72 : 48);
      const words = el("div", "", "", card);
      el("p", "wa-lab", `Round ${v.round}`, words);
      el("p", "wa-name", `${nameOf(guesser)} is guessing`, words);
      el("p", "wa-note", ask ? `${nameOf(judge)} answers yes or no.` : `${nameOf(judge)} gives clues.`, words);
      const done = Object.entries(v.results ?? {});
      for (const [seat, result] of done) {
        const line = el("p", "wa-note", `${nameOf(Number(seat))}: `, words);
        resultPill(line, result);
      }
      if (!bigScreen) el("p", "wa-note quiet", "You are watching: both names show at the end of each round.", words);
    }

    drawLog(t, mine, guesser);
    // The big screen has room for the scores beside the log, as the reveal shows them.
    if (bigScreen) scoreboard(main);

    // What this phone can do now.
    if (!amPlayer()) return watcherActions(t, guesser, judge, waiting);
    if (t.phase === "confirming") return mine ? confirmWait(t, judge) : judgeConfirm(t, guesser);
    if (mine) guesserActions(t, judge, { ask, appOn, spokenOn, waiting });
    else judgeActions(t, guesser, { ask, spokenOn, waiting });
  }

  function drawLog(t, mine, guesser) {
    const box = el("div", "wa-logbox", "", main);
    if (!t.log.length) {
      const ask = v.options.mode === "twenty_questions";
      const g = nameOf(guesser);
      const j = nameOf(other(guesser));
      let words;
      if (!amPlayer()) words = ask ? `${g} asks yes/no questions to find out who they are.` : `${j} describes ${g}'s name without saying it.`;
      else if (mine) words = ask ? (v.trade ? `Ask ${j} one yes/no question, then guess or pass.` : `Ask ${j} yes/no questions about who you are.`) : `${j} is describing you. Say your guess out loud.`;
      else words = ask ? `Answer ${g}'s yes/no questions.` : `Give ${g} clues without saying the name.`;
      el("p", "wa-empty", words, box);
      return;
    }
    const ol = el("ol", "wa-log", "", box);
    ol.setAttribute("aria-label", "Questions and hints");
    const asker = mine ? "You" : nameOf(guesser);
    for (const e of t.log) {
      if (e.kind === "hint") {
        const li = el("li", "wa-hint", "", ol);
        el("b", "", `Hint ${e.index}: `, li);
        el("span", "", e.text, li);
        continue;
      }
      const li = el("li", `wa-q${mine ? " mine" : ""}`, "", ol);
      const bubble = el("span", "wa-bubble", "", li);
      el("span", "wa-vh", `${asker} asked: `, bubble);
      const q = el("span", "wa-qtext", e.text, bubble);
      q.dir = "auto";
      const a = el("span", "wa-a", "", li);
      if (e.answer) {
        const pill = el("span", `wa-tag ${ANSWER_TONES[e.answer]}`, "", a);
        el("span", "wa-vh", "Answer: ", pill);
        pill.append(ANSWER_LABELS[e.answer]);
      } else el("span", "wa-tag", "Waiting", a);
    }
  }

  function guesserActions(t, judge, { ask, appOn, spokenOn, waiting }) {
    const j = nameOf(judge);
    const moveDone = v.trade && t.moveAsked && !waiting;
    if (moveDone) el("p", "wa-act-line", `Make your guess, or pass to ${j}.`, act);
    else if (waiting) el("p", "wa-wait", `Waiting for ${j} to answer...`, act).setAttribute("role", "status");
    else if (appOn) askPanel(t, spokenOn);
    else if (spokenOn) {
      const b = button("wa-btn secondary block", "+1 question", act, () => send({ t: "count" }, "count"));
      b.setAttribute("aria-label", "+1 question, count one more question asked out loud");
      b.disabled = !!sending;
    } else if (!ask) el("p", "wa-act-line", `${j} is describing you. Say your guess out loud.`, act);
    const row = el("div", "wa-row", "", act);
    if (v.options.hints) {
      const left = HINTS_PER_TURN - t.hintsUsed;
      const h = button("wa-btn secondary", "", row, () => send({ t: "hint" }, "hint"));
      h.append("Hint ");
      el("span", "wa-num", String(left), h);
      h.setAttribute("aria-label", `Get a hint, ${left} of ${HINTS_PER_TURN} left`);
      h.disabled = !!sending || left <= 0;
    }
    const pass = button("wa-btn ghost", v.trade ? "Pass" : "Give up", row, () => send(v.trade ? { t: "pass" } : { t: "skip" }, "pass"));
    pass.disabled = !!sending || (v.trade && !!waiting);
    const g = button("wa-btn lg grow", "I Guessed It", row, () => send({ t: "guess" }, "guess"));
    g.disabled = !!sending || (v.trade && !!waiting);
    if (v.trade) button("wa-textbtn", "Give up this round", act, () => send({ t: "skip" }, "skip")).disabled = !!sending;
  }

  function askPanel(t, spokenOn) {
    const turnKey = `${v.round}:${t.seat}`;
    if (suggestionsFor !== turnKey) {
      suggestions = pickSuggestions();
      suggestionsFor = turnKey;
    }
    const chips = el("div", "wa-suggest", "", act);
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Suggested questions");
    for (const q of suggestions) button("wa-sq", q, chips, () => send({ t: "ask", text: q }, "ask")).disabled = !!sending;
    const form = el("form", "wa-ask", "", act);
    form.noValidate = true;
    const label = el("label", "wa-vh", "Type your own yes/no question", form);
    label.htmlFor = "wa-ask-input";
    if (!askBox) {
      askBox = el("input");
      askBox.id = "wa-ask-input";
      askBox.type = "text";
      askBox.maxLength = QUESTION_MAX;
      askBox.placeholder = "Type a question";
      askBox.autocomplete = "off";
      askBox.setAttribute("enterkeyhint", "send");
      askBox.setAttribute("autocapitalize", "sentences");
      askBox.dir = "auto";
      askBox.addEventListener("input", () => {
        const b = askBox.closest("form")?.querySelector("button[type=submit]");
        if (b) b.disabled = !!sending || !tidy(askBox.value);
      });
    }
    form.append(askBox);
    const go = el("button", "wa-btn", "Send", form);
    go.type = "submit";
    go.disabled = !!sending || !tidy(askBox.value);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = tidy(askBox.value);
      if (!text) return;
      if (await send({ t: "ask", text }, "ask")) askBox.value = "";
      draw(true);
    });
    if (spokenOn && !(v.trade && t.moveAsked)) {
      const b = button("wa-textbtn", "+1 asked out loud", act, () => send({ t: "count" }, "count"));
      b.setAttribute("aria-label", "+1, count one more question asked out loud");
      b.disabled = !!sending;
    }
  }

  function confirmWait(t, judge) {
    const j = nameOf(judge);
    el("p", "wa-act-line", `Waiting for ${j} to confirm your guess...`, act).setAttribute("role", "status");
    if (t.selfConfirmAt !== null && t.selfConfirmAt !== undefined) {
      if (selfReady()) {
        el("p", "wa-note", `${j}'s phone is away. Say your guess to them, then confirm it yourself.`, act);
        button("wa-btn block", "Confirm it myself", act, () => send({ t: "selfConfirm" }, "self")).disabled = !!sending;
      } else {
        const line = el("p", "wa-note", `${j}'s phone is away. `, act);
        countdown(line, t.selfConfirmAt, "You can confirm it yourself in {t}.");
      }
    }
    if (t.lapseAt) countdown(el("p", "wa-note quiet", "", act), t.lapseAt, "Unconfirmed, the guess counts as wrong in {t}.");
    if (!v.trade) button("wa-btn secondary block", "Give up instead", act, () => send({ t: "skip" }, "skip")).disabled = !!sending;
  }

  function judgeConfirm(t, guesser) {
    const p = el("p", "wa-act-line big", `${nameOf(guesser)} thinks they got it. Did they say `, act);
    el("b", "wa-brand", v.opponent?.name ?? "", p);
    p.append("?");
    const row = el("div", "wa-row two", "", act);
    button("wa-btn secondary lg", "Not quite", row, () => send({ t: "reject" }, "reject")).disabled = !!sending;
    button("wa-btn success lg", "Yes, correct", row, () => send({ t: "confirm" }, "confirm")).disabled = !!sending;
    if (t.lapseAt) countdown(el("p", "wa-note quiet", "", act), t.lapseAt, "Unanswered, it counts as wrong in {t}.");
  }

  function judgeActions(t, guesser, { ask, spokenOn, waiting }) {
    const g = nameOf(guesser);
    if (waiting) {
      const box = el("div", "wa-answer", "", act);
      el("p", "wa-lab wa-lab-brand", `${g} asks`, box);
      const q = el("p", "wa-question", waiting.text, box);
      q.dir = "auto";
      const row = el("div", "wa-row four", "", box);
      for (const answer of ["yes", "no", "sort_of", "dont_know"]) {
        button(`wa-btn ${answer === "yes" ? "success" : "secondary"}`, ANSWER_LABELS[answer], row, () => send({ t: "answer", id: waiting.id, answer }, "answer")).disabled = !!sending;
      }
      return;
    }
    const row = el("div", "wa-row spread", "", act);
    el("p", "wa-act-line", v.trade ? `It's ${g}'s move.` : ask ? `${g} is guessing. They will tap I Guessed It when they have it.` : `${g} says the guess out loud and taps I Guessed It.`, row);
    // In trade turns the counter is the guesser's own question; otherwise either may tap it.
    if (spokenOn && !v.trade) {
      const b = button("wa-btn secondary", "+1", row, () => send({ t: "count" }, "count"));
      b.setAttribute("aria-label", "+1, count one more question");
      b.disabled = !!sending;
    }
  }

  function watcherActions(t, guesser, judge, waiting) {
    const g = nameOf(guesser);
    const j = nameOf(judge);
    if (t.phase === "confirming") el("p", "wa-act-line", `${g} thinks they got it. ${j} is checking.`, act);
    else if (waiting) el("p", "wa-act-line", `${g} asked. Waiting for ${j} to answer.`, act);
    else el("p", "wa-act-line", `${g} is guessing. ${j} answers.`, act);
  }

  // ---------------------------------------------------------------- the reveal and the end

  function winners(rows) {
    const top = Math.max(...rows.map((p) => p.score));
    return rows.filter((p) => p.score === top);
  }

  function drawReveal() {
    const r = v.reveal;
    const head = el("div", "wa-head", "", main);
    if (r.matchOver) {
      const won = winners(v.players);
      el("p", "wa-kick", "Match over", head);
      el("h2", "wa-title", won.length > 1 ? "It's a tie!" : won[0] && isMe(won[0].seat) ? "You win!" : `${nameOf(won[0]?.seat)} wins!`, head);
    } else {
      el("p", "wa-kick", `Round ${r.round} complete`, head);
      el("h2", "wa-title", "The big reveal", head);
    }
    if (v.until) countdown(el("p", "wa-note", "", head), v.until, r.matchOver ? "Back to the Table by itself in {t}." : "The next round starts by itself in {t}.");
    revealCards(r, main);
    scoreboard(main);
    if (amPlayer() || v.you?.host) {
      const b = button("wa-btn lg block", r.matchOver ? "Back to the Table" : "Next round", act, () => send({ t: "next" }, "next"));
      b.disabled = !!sending;
      el("p", "wa-note center", r.matchOver ? "Either player can go back." : "Either player can continue.", act);
    } else el("p", "wa-act-line", r.matchOver ? "The players go back to the Table." : "The players start the next round.", act);
  }

  function revealCards(r, parent) {
    const grid = el("div", "wa-reveal", "", parent);
    // A player's own card first, as live.
    const entries = [...r.entries].sort((a, b) => Number(isMe(b.seat)) - Number(isMe(a.seat)));
    for (const e of entries) {
      const card = el("div", `wa-card wa-rev${isMe(e.seat) ? " me" : ""}${reduced() ? "" : " pop"}`, "", grid);
      const top = el("div", "wa-rev-top", "", card);
      picture(top, e, "md");
      const words = el("div", "wa-rev-words", "", top);
      el("p", "wa-lab", isMe(e.seat) ? "You were" : `${nameOf(e.seat)} was`, words);
      el("p", "wa-name", e.name, words);
      credit(words, e);
      const foot = el("div", "wa-rev-foot", "", card);
      resultPill(foot, e.result);
      el("span", "wa-note", `${e.hints === 0 ? "No hints" : plural(e.hints, "hint")}${v.options.mode === "twenty_questions" ? `, ${plural(e.questions, "question")}` : ""}`, foot);
    }
  }

  function scoreboard(parent) {
    const grid = el("div", "wa-board", "", parent);
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Scores");
    for (const p of v.players) {
      const box = el("div", `wa-board-row${isMe(p.seat) ? " me" : ""}`, "", grid);
      const words = el("div", "wa-board-words", "", box);
      el("b", "", nameOf(p.seat), words);
      el("span", "", p.left ? "Left" : isMe(p.seat) ? "You" : `${plural(p.correct, "right guess")}`.replace("right guesss", "right guesses"), words);
      const n = el("span", "wa-board-n", String(p.score), box);
      n.setAttribute("aria-label", `${nameOf(p.seat)} has ${plural(p.score, "point")}`);
    }
  }

  function drawOver() {
    const ended = [...(v.notes ?? [])].reverse().find((n) => n.k === "ended");
    const rows = v.result ?? [];
    const head = el("div", "wa-head", "", main);
    el("p", "wa-kick", "Match over", head);
    let title = "The match ended";
    let sub = "";
    if (ended?.how === "forfeit") {
      const stayer = rows.find((r) => r.place === 1);
      title = stayer ? (isMe(stayer.seat) ? "You win!" : `${nameOf(stayer.seat)} wins!`) : title;
      sub = `${nameOf(ended.seat)} left the match.`;
    } else if (ended?.how === "decided") {
      const won = rows.filter((r) => r.place === 1);
      title = won.length > 1 ? "It's a tie!" : won[0] ? (isMe(won[0].seat) ? "You win!" : `${nameOf(won[0].seat)} wins!`) : title;
    } else if (ended?.how === "abandoned") sub = "Both players were gone, so nobody wins.";
    else if (ended?.how === "idle") sub = "Nobody was playing for a whole round, so nobody scores.";
    else if (ended?.how === "too_few") sub = "Too few players were left to start.";
    el("h2", "wa-title", title, head);
    if (sub) el("p", "wa-sub", sub, head);
    if (v.reveal) revealCards(v.reveal, main);
    if (v.players.length) scoreboard(main);
  }

  const DRAW = { setup: drawSetup, playing: drawPlaying, reveal: drawReveal, over: drawOver };

  // ------------------------------------------------------------------ fitting the page

  /**
   * The big screen fills the rest of the screen under the Table's bar and never scrolls; a phone's
   * page scrolls as a page does, with the turn's buttons kept in view at the bottom.
   */
  function fit() {
    if (!bigScreen) {
      root.style.removeProperty("--wa-h");
      root.style.setProperty("--wa-act-h", `${act.hidden ? 0 : act.offsetHeight}px`);
      return;
    }
    const rect = root.getBoundingClientRect();
    const above = rect.top + scrollY;
    const app = root.closest("#app") ?? document.body;
    const below = (parseFloat(getComputedStyle(app).paddingBottom) || 0) + 2;
    const height = Math.max(320, Math.floor(innerHeight - above - below));
    if (Math.abs(height - rect.height) > 1) root.style.setProperty("--wa-h", `${height}px`);
  }
  const resized = () => requestAnimationFrame(fit);
  addEventListener("resize", resized);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(document.body);
  observer?.observe(act);

  function take(s) {
    if (!s || s.game !== "who-am-i") return;
    // A new round or turn: the half-typed question was for the last one.
    if (v && askBox && (v.phase !== s.phase || v.round !== s.round || v.turn?.seat !== s.turn?.seat)) askBox.value = "";
    v = s;
    // On the reveal that decided the match the Table's own "End the game" steps aside for ours.
    ctx.decided?.(v.phase === "reveal" && v.reveal?.matchOver === true);
    showNotes();
    draw();
  }

  take(ctx.snapshot);
  interval = setInterval(tick, 250);
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
      clearTimeout(errorTimer);
      removeEventListener("resize", resized);
      observer?.disconnect();
      root.remove();
      toast.remove();
      sheet.remove();
    },
  };
}
