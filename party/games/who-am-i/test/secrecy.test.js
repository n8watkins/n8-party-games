// Who Am I?'s one hard rule as property tests: no view lets a player learn their own name before
// their round's reveal. Hundreds of matches, played at random from many seeds with every kind of
// move (questions, answers, hints, guesses, confirmations, passes, skips, timeouts, lapses,
// watchers arriving, the host's choices), and every view of every state checked for every viewer:
// each player, each watcher, a player who left, the big screen and an unknown seat.
import { describe, expect, it } from "vitest";
import { TURN_FORMATS, apply, isRefusal, nextDeadline, view } from "../rules.js";
import { getIdentity, normalizeName, packIdentities, pairable } from "../deck.js";
import { QUESTIONS, pickOf, randomMatch, testRandom } from "./random-match.js";
import { Table, must } from "./table.js";

/** Whole words of a normalised text, padded so a word can be looked for with spaces round it. */
const words = (text) => ` ${normalizeName(text)} `;

/** Everything about a name that would give it away: its name, aliases, id, slug and picture. */
function giveaways(id) {
  const i = getIdentity(id);
  return {
    exact: [i.id, `"${i.slug}"`, ...(i.picture ? [i.picture.imageUrl, i.picture.filePage] : [])],
    words: [i.name, ...i.aliases].map(normalizeName).filter((w) => w.length >= 2),
  };
}

function holds(v, id) {
  const json = JSON.stringify(v);
  const g = giveaways(id);
  if (g.exact.some((s) => json.includes(s))) return true;
  // Names are looked for in the view's text values, as whole words (so "Link" is not found in "linked").
  const texts = [];
  JSON.parse(json, (k, val) => {
    if (typeof val === "string") texts.push(val);
    return val;
  });
  const all = words(texts.join(" | "));
  return g.words.some((w) => all.includes(` ${w} `));
}

// (`hints` is not here: a result row's count of hints used is called that.)
const SECRET_KEYS = new Set(["rng", "idKey", "idSeq", "assign", "usedIds", "tracks", "sends", "seed", "slug", "aliases", "difficulty_", "acted", "idleMoves"]);

function walk(value, visit, path = []) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, i]));
  else if (value && typeof value === "object") {
    visit(value, path);
    for (const [k, v] of Object.entries(value)) walk(v, visit, [...path, k]);
  }
}

/** Every rule that can be checked from one state and one viewer. */
function checkView(state, viewer, where) {
  const v = view(state, viewer);
  walk(v, (obj, path) => {
    for (const k of Object.keys(obj)) if (SECRET_KEYS.has(k)) throw new Error(`${where}, viewer ${viewer}: secret key "${k}" at ${path.join(".")}`);
  });
  if (state.phase !== "playing") return v;
  const r = state.round;
  const player = state.players.find((p) => p.seat === viewer && !p.left);
  for (const seat of r.order) {
    const id = r.assign[String(seat)];
    // A player sees exactly the other player's name; nobody else sees either.
    const allowed = !!player && seat !== viewer;
    if (holds(v, id) !== allowed) {
      throw new Error(`${where}, viewer ${viewer}: ${allowed ? "does not see" : "SEES"} seat ${seat}'s name ${getIdentity(id).name}`);
    }
  }
  if (player) expect(v.opponent.seat).not.toBe(viewer);
  else expect(v).not.toHaveProperty("opponent");
  return v;
}

function viewersOf(state) {
  return [...new Set([...state.players.map((p) => p.seat), ...state.watchers, ...state.pool, -1, 99, 10, 11, 12])];
}

describe("no view ever holds the viewer's own name before the reveal", () => {
  it("the check finds a name hidden anywhere: as text, in a sentence, as an alias, as a picture address", () => {
    const t = new Table([0, 1], {}, 3);
    t.begin();
    const mine = t.secretOf(t.guesser);
    const id = mine.id;
    expect(holds(t.view(t.guesser), id)).toBe(false);
    expect(holds(t.view(t.judge), id)).toBe(true);
    expect(holds({ a: { b: [mine.name.toUpperCase()] } }, id)).toBe(true);
    expect(holds({ note: `Is it ${mine.name}?` }, id)).toBe(true);
    expect(holds({ x: id }, id)).toBe(true);
    const link = getIdentity("video-games.link");
    expect(holds({ q: "Am I Link?" }, link.id)).toBe(true);
    expect(holds({ q: "a linked list" }, link.id)).toBe(false);
    const withPicture = packIdentities("actors").find((i) => i.picture);
    expect(holds({ src: withPicture.picture.imageUrl }, withPicture.id)).toBe(true);
  });

  it("across 300 random matches, every state, every viewer", () => {
    let states = 0;
    let rounds = 0;
    let hints = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const t = randomMatch(seed);
      for (const [i, state] of t.history.entries()) {
        for (const viewer of viewersOf(state)) checkView(state, viewer, `seed ${seed}, state ${i} (${state.phase}, round ${state.round?.n})`);
        states++;
        if (state.round?.hints && Object.keys(state.round.hints).length) hints++;
      }
      rounds += t.state.summary?.n ?? 0;
    }
    // The walk really covered matches, rounds and hints.
    expect(states).toBeGreaterThan(10_000);
    expect(rounds).toBeGreaterThan(300);
    expect(hints).toBeGreaterThan(500);
  }, 120_000);

  it("never holds a seed, the generator or the deck in any view", () => {
    for (const seed of [123456789, 987654321]) {
      const t = randomMatch(seed, 3);
      for (const state of t.history) {
        for (const viewer of viewersOf(state)) {
          const json = JSON.stringify(view(state, viewer));
          expect(json).not.toContain(String(seed));
          expect(json).not.toContain(String(state.rng));
          expect(json).not.toMatch(/"(rng|idKey|seed|usedIds|assign)"/);
        }
      }
    }
  });
});

/** A copy of `state` with some seats dealt other names (that clash with nothing else dealt). */
function redeal(state, seats, rnd) {
  const copy = JSON.parse(JSON.stringify(state));
  const r = copy.round;
  for (const seat of seats) {
    const others = r.order.filter((s) => s !== seat).map((s) => getIdentity(r.assign[String(s)]));
    const now = getIdentity(r.assign[String(seat)]);
    const choices = packIdentities(copy.options.pack).filter((c) => c.id !== now.id && others.every((o) => pairable(o, c)));
    r.assign[String(seat)] = pickOf(rnd, choices).id;
  }
  return copy;
}

describe("a view is the same whatever name the viewer was dealt", () => {
  it("a player's view does not change when their own name is swapped (before they ask for a hint)", () => {
    let compared = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rnd = testRandom(seed);
      const t = randomMatch(seed);
      for (const state of t.history) {
        if (state.phase !== "playing") continue;
        for (const p of state.players) {
          if (state.round.hints[String(p.seat)]) continue; // a hint about your own name is the point of a hint
          const swapped = redeal(state, [p.seat], rnd);
          expect(view(swapped, p.seat)).toEqual(view(state, p.seat));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(2_000);
  }, 60_000);

  it("a watcher's and the big screen's views do not change when both names are swapped", () => {
    let compared = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rnd = testRandom(seed + 1);
      const t = randomMatch(seed, 3);
      for (const state of t.history) {
        if (state.phase !== "playing" || Object.keys(state.round.hints).length) continue;
        const swapped = redeal(state, state.round.order, rnd);
        for (const viewer of [...state.watchers, -1, 99]) {
          expect(view(swapped, viewer)).toEqual(view(state, viewer));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(2_000);
  }, 60_000);

  it("the whole rest of a match looks the same to a player whatever they were dealt, until the reveal", () => {
    // Two copies of a match, dealt different names for seat 0, played with the same moves: seat 0
    // sees the same thing at every step (no hints asked, which are about your own name by design).
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = testRandom(seed);
      const a = new Table([0, 1], { turnFormat: pickOf(rnd, TURN_FORMATS) }, seed);
      a.begin();
      let b = redeal(a.state, [0], rnd);
      const moves = [];
      for (let i = 0; i < 30 && a.phase === "playing"; i++) {
        const g = a.guesser;
        const pending = a.turn.log.find((e) => e.kind === "question" && e.answer === null);
        const move =
          a.turn.phase === "confirming" ? [a.judge, { t: rnd() < 0.5 ? "reject" : "confirm" }] : pending ? [a.judge, { t: "answer", id: pending.id, answer: "no" }] : rnd() < 0.5 ? [g, { t: "ask", text: pickOf(rnd, QUESTIONS) }] : [g, { t: rnd() < 0.5 ? "guess" : "pass" }];
        moves.push(move);
        const outA = a.act(move[0], move[1], 1500);
        const outB = apply(b, move[0], move[1], a.now);
        expect(isRefusal(outB)).toBe(isRefusal(outA));
        if (!isRefusal(outB)) b = outB;
        expect(nextDeadline(b)).toBe(nextDeadline(a.state));
        if (a.phase === "playing") expect(view(b, 0)).toEqual(a.view(0));
      }
    }
  });
});

describe("ids and order say nothing", () => {
  it("question and hint ids do not come from the generator, and are the same whoever was dealt what", () => {
    const t = new Table([0, 1], { turnFormat: "keep_going" }, 77);
    t.begin();
    const g = t.guesser;
    const other = JSON.parse(JSON.stringify(t.state));
    other.rng = 12345; // a different generator position
    const asked = must(apply(t.state, g, { t: "ask", text: "Am I human?" }, t.now + 1));
    const askedOther = must(apply(other, g, { t: "ask", text: "Am I human?" }, t.now + 1));
    expect(asked.turn.log[0].id).toBe(askedOther.turn.log[0].id);
    expect(asked.rng).toBe(t.state.rng); // asking draws nothing
    expect(asked.turn.log[0].id).toMatch(/^[0-9a-z]{14}$/);
  });

  it("a different seed gives different ids, so ids cannot be guessed across matches", () => {
    const id = (seed) => {
      const t = new Table([0, 1], {}, seed);
      t.begin();
      t.do(t.guesser, { t: "ask", text: "Am I human?" });
      return t.turn.log[0].id;
    };
    expect(id(1)).not.toBe(id(2));
  });
});
