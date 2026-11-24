// Paper Masks: the secrecy rules (PAPER-MASKS-RULES.md, section 8) as property tests.
// For every phase and every viewer (each player, a watcher, a big screen, an unknown seat), the
// serialised view never holds another seat's answer before that seat may see it, never a card's
// author before its reveal, never another seat's guesses before the reveal, and never the seed.
import { describe, expect, it } from "vitest";
import { GHOST, SYSTEM, view } from "../rules.js";
import { answerFor, mixedPick, Table } from "./table.js";

const seatsOf = (n) => Array.from({ length: n }, (_, i) => i);
const SECRET_KEYS = new Set(["rng", "idKey", "decoys", "seed", "deck", "deckPos", "ghostPool", "answers", "author", "authors", "match", "masksFree", "assignedReader", "hasRead"]);
// (a view's own `step.auto` is a yes/no about the viewer's own guess, not the state's map of them)

function walk(value, visit, path = []) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, i]));
  else if (value && typeof value === "object") {
    visit(value, path);
    for (const [k, v] of Object.entries(value)) walk(v, visit, [...path, k]);
  }
}

/** Checks every rule that can be checked from one state and one viewer. */
function checkView(state, viewer, texts) {
  const v = view(state, viewer);
  const json = JSON.stringify(v);
  const r = state.round;
  const where = `round ${r.n}, ${state.phase}, viewer ${String(viewer)}`;

  walk(v, (obj, path) => {
    for (const k of Object.keys(obj)) if (SECRET_KEYS.has(k)) throw new Error(`${where}: secret key "${k}" at ${path.join(".")}`);
    // authors and everybody's guesses only on cards whose reveal has come
    if ("by" in obj || "guesses" in obj || "right" in obj || "sameAs" in obj || "mask" in obj && "text" in obj) {
      if (obj.revealed !== true || !r.revealed.includes(obj.id)) throw new Error(`${where}: author or guesses on an unrevealed card ${obj.id}`);
    }
  });

  const isPlayer = r.roster.includes(viewer) && state.players.some((p) => p.seat === viewer && !p.left);
  const isReader = isPlayer && r.reader === viewer;
  const callMode = state.options.callMode;
  const visible = r.cards.filter((c) => !c.skipped);
  const pos = state.phase === "guessing" ? visible.indexOf(r.cards[r.pos]) : -1;

  // Rule 3, 5 and 8: when another seat's text may be in this view
  for (const [seat, text] of Object.entries(texts)) {
    if (Number(seat) === viewer && isPlayer) continue;
    const author = seat === GHOST ? GHOST : Number(seat);
    const card = r.cards.find((c) => c.author === author && c.text === text);
    let allowed;
    if (state.phase === "writing") allowed = false;
    else if (card && viewer === state.host && isPlayer && r.asks.includes(card.id)) allowed = true; // rule 13
    else if (!card || card.skipped) allowed = false;
    else if (state.phase === "reading") allowed = isReader || callMode;
    else if (state.phase === "guessing") allowed = isReader || callMode || visible.indexOf(card) <= pos;
    else allowed = state.phase !== "over" || r.guessed;
    if (!allowed && json.includes(text)) throw new Error(`${where}: sees seat ${seat}'s answer "${text}"`);
  }

  // Rule 2 and 14: only a writer's own card is marked as theirs; watchers and screens get no marker
  if (!isPlayer && v.step) {
    expect(v.step.yours ?? null, where).toBeFalsy();
    expect(v.step.yourCard ?? null, where).toBe(null);
    expect(v.step.yourSkipped ?? false, where).toBe(false);
  }
  if (isPlayer && state.phase === "guessing") {
    const card = r.cards[r.pos];
    expect(v.step.yours, where).toBe(card.author === viewer);
  }

  // Rule 9 (as changed, see the README): own guesses only; about the others, only a count of taps
  // in, the author's decoy tap counted like a guess, and nothing keyed by seat
  if (state.phase === "guessing") {
    const card = r.cards[r.pos];
    const active = r.roster.filter((s) => state.players.some((p) => p.seat === s && !p.left));
    const tapped = active.filter((s) => (s === card.author ? !!r.decoys[card.id] : card.id in (r.guesses[s] ?? {})));
    expect(v.step.taps, where).toBe(tapped.length);
    expect(v.step.tapsDue, where).toBe(active.length);
    expect(v.step.everyoneGuessed, where).toBe(tapped.length === active.length);
    expect(v.step, where).not.toHaveProperty("guessed");
  }
  for (const n of v.notes) expect(Array.isArray(n.missing) && n.k === "guessing_closed", where).toBe(false);

  // Rule 4: during writing, a yes/no per player and nothing else about the others
  if (state.phase === "writing") {
    Object.values(v.step.sent).forEach((x) => expect(typeof x).toBe("boolean"));
  }

  // Rule 13: the host gets the asked card's id and text only
  for (const ask of v.asks ?? []) expect(Object.keys(ask).sort()).toEqual(["id", "text"]);
  return v;
}

const viewersOf = (state) => [...state.players.map((p) => p.seat), ...state.watchers.map((w) => w.seat), 99, -1, SYSTEM, undefined];

/** Runs a match, checking every view of every viewer after every move. */
function checkedMatch(seats, options, seed, { pick = mixedPick, join = false, leave = false, skip = false } = {}) {
  const t = new Table(seats, options, seed);
  const texts = () => Object.fromEntries(t.state.players.map((p) => [p.seat, answerFor(p.seat, t.r.n)]));
  const checkAll = () => {
    const tx = texts();
    if (t.r.ghost && t.r.cards.length) tx.ghost = t.r.cards.find((c) => c.author === GHOST)?.text;
    for (const viewer of viewersOf(t.state)) checkView(t.state, viewer, tx);
  };
  const orig = t.act.bind(t);
  t.act = (seat, move, dt) => {
    const out = orig(seat, move, dt);
    checkAll();
    return out;
  };
  checkAll();
  if (join) t.do(SYSTEM, { t: "join", seat: 40 });
  for (let i = 0; i < 40 && t.phase !== "over"; i++) {
    if (t.phase === "writing") t.writeAll();
    if (leave && t.r.n === 2 && t.phase === "reading") t.do(SYSTEM, { t: "leave", seat: seats.at(-1) });
    if (t.phase === "reading") {
      if (skip && t.state.host !== t.r.reader) {
        const card = t.r.cards.find((c) => !c.skipped);
        t.do(t.r.reader, { t: "askSkip", card: card.id });
        t.do(t.state.host, { t: "skip", card: card.id });
      }
      t.do(t.r.reader, { t: "startGuessing" });
    }
    while (t.phase === "guessing") {
      t.guessAll(pick);
      t.do(t.r.reader, { t: "next" });
    }
    while (t.phase === "reveal") t.do(t.r.reader, { t: "reveal" });
    if (t.phase === "summary") t.do(t.state.host, { t: "nextRound" });
  }
  expect(t.phase).toBe("over");
  return t;
}

describe("secrecy: every view of every viewer after every move", () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    it(`${n} seats, room mode`, () => {
      checkedMatch(seatsOf(n), { rounds: 3 }, `room-${n}`, { join: n < 8 });
    });
  }
  it("call mode", () => {
    checkedMatch(seatsOf(5), { rounds: 3, callMode: true }, "call");
  });
  it("with skips, a player leaving and a late joiner", () => {
    checkedMatch(seatsOf(6), { rounds: 5 }, "skips", { skip: true, leave: true, join: true });
  });
  it("with timeouts at every step", () => {
    const t = new Table(seatsOf(4), { rounds: 3 }, "slow");
    const texts = () => Object.fromEntries(t.state.players.map((p) => [p.seat, answerFor(p.seat, t.r.n)]));
    while (t.phase !== "over") {
      if (t.phase === "writing" && !Object.keys(t.r.answers).length) t.writeAll(answerFor, [0, 2]);
      t.now = (t.state.deadline.soft !== null && !t.state.overdue ? t.state.deadline.soft : t.state.deadline.hard) ?? t.now;
      t.do(SYSTEM, { t: "tick" });
      for (const viewer of viewersOf(t.state)) checkView(t.state, viewer, texts());
    }
  });
});

/**
 * The strongest check: two matches whose only difference is that seats A and B swapped what they
 * wrote. Until a card by A or B is revealed, no other viewer can tell the two matches apart: their
 * views are identical. A and B never guess (their guesses would differ), and the host closes each
 * guessing step. With the host skipping every card by A or B as it comes up, the two matches stay
 * identical to every other viewer to the very end: a skipped card's author is never sent.
 */
function swapRun(n, seed, A, B, { skipAB, abTap = false }) {
  const tables = [0, 1].map(() => new Table(seatsOf(n), { rounds: 3 }, seed));
  const textOf = (k) => (seat, round) => {
    const s = k === 1 && seat === A ? B : k === 1 && seat === B ? A : seat;
    return answerFor(s, round);
  };
  const others = (t) => [...t.state.players.map((p) => p.seat).filter((s) => s !== A && s !== B), ...t.state.watchers.map((w) => w.seat), 99, undefined];
  const compared = { steps: 0 };
  const strip = (v) => {
    const c = JSON.parse(JSON.stringify(v));
    if (!skipAB) for (const p of c.players) delete p.score;
    return c;
  };
  const compare = () => {
    const [t0, t1] = tables;
    const abRevealed = (t) => t.r.revealed.some((id) => [A, B].includes(t.authorOf(id)));
    if (!skipAB && (t0.phase === "summary" || t0.phase === "over" || (t0.phase === "reveal" && abRevealed(t0)))) return;
    for (const viewer of others(t0)) expect(strip(view(t1.state, viewer)), `${t0.phase} r${t0.r.n} viewer ${viewer}`).toEqual(strip(view(t0.state, viewer)));
    compared.steps++;
  };
  const both = (fn) => {
    tables.forEach((t, k) => fn(t, k));
    compare();
  };
  both((t) => t.do(SYSTEM, { t: "join", seat: 30 }));
  while (tables[0].phase !== "over") {
    const t0 = tables[0];
    if (t0.phase === "writing") for (const seat of [...t0.r.roster]) both((t, k) => t.do(seat, { t: "answer", text: textOf(k)(seat, t.r.n) }));
    else if (t0.phase === "reading") both((t) => t.do(t.r.reader, { t: "startGuessing" }));
    else if (t0.phase === "guessing") {
      const card = t0.r.cards[t0.r.pos];
      const cardIsAB = (t) => [A, B].includes(t.authorOf(t.r.cards[t.r.pos].id));
      expect(cardIsAB(tables[1])).toBe(cardIsAB(t0)); // the same card is A's or B's in both
      if (skipAB && cardIsAB(t0)) {
        both((t) => t.do(t.state.host, { t: "skip", card: card.id }));
        continue;
      }
      for (const seat of t0.guessers().filter((s) => s !== A && s !== B)) {
        both((t) => {
          const v = t.view(seat);
          if (!v.step.yours && v.step.chips.length && v.step.guess === null) t.do(seat, { t: "guess", card: v.step.card.id, who: v.step.available[0] });
        });
      }
      // A and B tap too: on a card by one of them, its author sends the decoy and the other
      // guesses, so in one match it is A who decoys and in the other B. Nobody else can tell.
      if (abTap) {
        for (const seat of [A, B]) {
          both((t) => {
            const v = t.view(seat);
            if (v.step.tapped) return;
            if (v.step.yours) t.do(seat, { t: "decoy", card: v.step.card.id });
            else if (v.step.available.length) t.do(seat, { t: "guess", card: v.step.card.id, who: v.step.available[0] });
          });
        }
      }
      both((t) => t.do(t.state.host, { t: "endStep" }));
    } else if (t0.phase === "reveal") both((t) => t.do(t.r.reader, { t: "reveal" }));
    else if (t0.phase === "summary") both((t) => t.do(t.state.host, { t: "nextRound" }));
  }
  return compared.steps;
}

describe("secrecy: swapping two authors changes nothing anyone else can see", () => {
  for (const [n, A, B] of [
    [3, 1, 2],
    [4, 1, 3],
    [5, 2, 4],
    [8, 1, 6],
  ]) {
    it(`${n} seats, seats ${A} and ${B} swap, until their cards are revealed`, () => {
      for (const seed of ["s1", "s2", "s3"]) expect(swapRun(n, seed, A, B, { skipAB: false })).toBeGreaterThan(10);
    });
    it(`${n} seats, seats ${A} and ${B} swap and tap (decoy on their own card): identical until revealed`, () => {
      for (const seed of ["s1", "s2", "s3"]) expect(swapRun(n, seed, A, B, { skipAB: false, abTap: true })).toBeGreaterThan(10);
    });
    it(`${n} seats, seats ${A} and ${B} swap and their cards are skipped: identical to the end`, () => {
      for (const seed of ["s1", "s2"]) expect(swapRun(n, seed, A, B, { skipAB: true })).toBeGreaterThan(10);
    });
  }
});

describe("secrecy: what the shuffle does not depend on", () => {
  it("card order and ids depend only on the texts, not on who wrote them or when they sent", () => {
    const t0 = new Table(seatsOf(5), {}, "order");
    const t1 = new Table(seatsOf(5), {}, "order");
    t0.writeAll(answerFor, [0, 1, 2, 3, 4]);
    t1.writeAll(answerFor, [4, 2, 0, 3, 1]);
    expect(t1.r.cards.map((c) => [c.id, c.text])).toEqual(t0.r.cards.map((c) => [c.id, c.text]));
  });

  it("over many seeds a card's position is spread evenly, whatever its author's seat", () => {
    const n = 5;
    const counts = Array.from({ length: n }, () => Array(n).fill(0));
    const runs = 1500;
    for (let i = 0; i < runs; i++) {
      const t = new Table(seatsOf(n), {}, `spread-${i}`);
      t.writeAll();
      t.r.cards.forEach((c, pos) => counts[c.author][pos]++);
    }
    // each author lands in each position about runs / n times (300); allow a generous band
    for (const row of counts) for (const c of row) expect(Math.abs(c - runs / n)).toBeLessThan(75);
  });

  it("card ids are fresh each round and not seat numbers", () => {
    const t = new Table(seatsOf(4), {}, "ids");
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      t.playRound();
      for (const c of t.r.cards) {
        expect(seen.has(c.id)).toBe(false);
        expect(/^\d$/.test(c.id)).toBe(false);
        seen.add(c.id);
      }
      t.do(0, { t: "nextRound" });
    }
  });

  it("the ghost card looks like any other card in every payload", () => {
    const t = new Table(seatsOf(3), {}, "ghost");
    t.writeAll();
    const v = t.view(t.r.reader);
    for (const c of v.step.cards) expect(Object.keys(c).sort()).toEqual(["id", "text"]);
    t.do(t.r.reader, { t: "startGuessing" });
    expect(Object.keys(t.view(0).step.card).sort()).toEqual(["id", "text"]);
  });

  it("a page never needs the ghost answers: the page list has none", async () => {
    const { promptsForPage } = await import("../questions.js");
    expect(JSON.stringify(promptsForPage())).not.toContain("ghosts");
  });
});
