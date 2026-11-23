// Who Am I?'s one hard rule as property tests: no view lets a player learn their own name before
// their round's reveal. Hundreds of matches, played at random from many seeds with every kind of
// move (questions, answers, hints, guesses, confirmations, passes, skips, timeouts, lapses,
// watchers arriving, the host's choices), and every view of every state checked for every viewer:
// each player, each watcher, a player who left, the big screen and an unknown seat.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { TURN_FORMATS, apply, create, isRefusal, nextDeadline, view } from "../rules.js";
import { getIdentity, normalizeName, packIdentities, pairable } from "../deck.js";
import { drawsFor, sha256 } from "../../draws.js";

const draw = drawsFor("who-am-i");
import { QUESTIONS, pickOf, randomMatch, testRandom } from "./random-match.js";
import { T0, Table, must, testSecret } from "./table.js";

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
const SECRET_KEYS = new Set(["secret", "draws", "rng", "idKey", "idSeq", "assign", "usedIds", "tracks", "sends", "seed", "slug", "aliases", "difficulty_", "seen", "idleMoves", "here", "goneSince"]);

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

  it("never holds the secret, anything drawn from it, the generator's position or the deck in any view", () => {
    for (const seed of [123456789, 987654321]) {
      const t = randomMatch(seed, 3);
      const secret = t.state.secret;
      // Every 8-hex-digit piece of the secret, and the first draws' digests as numbers and hex.
      const pieces = Array.from({ length: secret.length - 7 }, (_, i) => secret.slice(i, i + 8));
      const drawn = Array.from({ length: t.state.draws }, (_, n) => draw(secret, n));
      for (const state of t.history) {
        for (const viewer of viewersOf(state)) {
          const json = JSON.stringify(view(state, viewer));
          for (const piece of pieces) expect(json).not.toContain(piece);
          for (const x of drawn) expect(json).not.toContain(String(x).slice(2, 12));
          expect(json).not.toMatch(/"(secret|draws|rng|idKey|seed|usedIds|assign)"/);
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
  it("question and hint ids are plain counts: the same whatever the secret, the seed or the deal", () => {
    const ids = (secretNumber, roomSeed) => {
      let s = must(create([0, 1], { host: 0, turnFormat: "keep_going" }, roomSeed, T0, { secret: testSecret(secretNumber) }));
      s = must(apply(s, 0, { t: "begin" }, T0 + 1));
      const g = s.turn.seat;
      s = must(apply(s, g, { t: "ask", text: "Am I human?" }, T0 + 2));
      s = must(apply(s, g, { t: "hint" }, T0 + 3));
      const before = s.draws;
      s = must(apply(s, 1 - g, { t: "answer", id: "q1", answer: "no" }, T0 + 4));
      expect(s.draws).toBe(before); // asking and answering draw nothing
      return s.turn.log.map((e) => e.id);
    };
    expect(ids(1, 7)).toEqual(["q1", "h2"]);
    for (const [secret, seed] of [[2, 7], [3, 2 ** 32 - 1], [4, 0]]) expect(ids(secret, seed)).toEqual(["q1", "h2"]);
  });
});

/** The rules' old id: FNV-1a with a final mix, as rules.js had it (the review's attack, seed-attack.mjs). */
function oldHash(value) {
  const text = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

describe("the deal comes from the match's secret alone", () => {
  /** The first round's names by seat, and the starter, for a secret and a room seed. */
  function deal(secret, roomSeed) {
    let s = must(create([0, 1], { host: 0 }, roomSeed, T0, { secret }));
    s = must(apply(s, 0, { t: "begin" }, T0 + 1));
    return { starter: s.starter, assign: s.round.assign };
  }

  it("the review's seed attack finds nothing: no id is a function of a seed, and the room's seed does not change the deal", () => {
    // The attack: read one public entry id, search the 32-bit seed space for the seed whose old
    // id construction gives it, then replay the rules from that seed. Ids are now "q1" in every
    // match, so the search has nothing to match: a window of the old space finds no seed.
    const t = new Table([0, 1], {}, 91);
    t.begin();
    t.do(t.guesser, { t: "ask", text: "Am I real?" });
    const target = t.view(t.guesser).turn.log[0].id;
    expect(target).toBe("q1");
    let found = 0;
    for (let c = 0; c < 1 << 16; c++) {
      const a = oldHash(`who-am-i/entry-ids/a/${c}`);
      const b = oldHash(`who-am-i/entry-ids/b/${c}`);
      if (oldHash(`${a}:${b}:1:hi`).toString(36).padStart(7, "0") + oldHash(`${a}:${b}:1:lo`).toString(36).padStart(7, "0") === target) found++;
    }
    expect(found).toBe(0);
    // And a replay from any seed cannot work: with one secret, every room seed deals the same;
    // with one room seed, different secrets deal differently.
    const secret = testSecret(92);
    const base = deal(secret, 1);
    for (const seed of [0, 2, 12345, 2 ** 31, 2 ** 32 - 1]) expect(deal(secret, seed)).toEqual(base);
    const deals = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(deal(testSecret(1000 + i), 1).assign)));
    expect(deals.size).toBeGreaterThan(30);
  });

  it("a match restored from its saved state mid-match deals on exactly as the one that never stopped", () => {
    const t = new Table([0, 1], { match: "rounds-10" }, 93);
    t.begin();
    t.rightGuess();
    t.do(0, { t: "next" });
    t.rightGuess();
    // The room saves the state as JSON and wakes with it (a restart, a deploy).
    const saved = JSON.parse(JSON.stringify(t.state));
    const play = (state) => {
      let s = state;
      const names = [];
      for (let i = 0; i < 60 && s.phase !== "over"; i++) {
        if (s.phase === "reveal") s = must(apply(s, 0, { t: "next" }, s.now + 10));
        else if (s.turn.phase === "asking") s = must(apply(s, s.turn.seat, { t: "guess" }, s.now + 10));
        else s = must(apply(s, s.round.order.find((x) => x !== s.turn.seat), { t: "confirm" }, s.now + 10));
        if (s.round) names.push(JSON.stringify(s.round.assign));
      }
      return { names: [...new Set(names)], end: s };
    };
    const straight = play(t.state);
    const restored = play(saved);
    expect(restored.names).toEqual(straight.names);
    expect(restored.names.length).toBeGreaterThanOrEqual(8);
    expect(restored.end).toEqual(straight.end);
  });

  it("draws come from SHA-256 in counter mode, and the hash is SHA-256", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 200]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
      expect(Buffer.from(sha256(bytes)).toString("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    const secret = testSecret(94);
    const d = createHash("sha256").update(`who-am-i/draw/3/${secret}`).digest();
    expect(draw(secret, 3)).toBe(d.readUIntBE(0, 6) / 2 ** 48);
  });
});
