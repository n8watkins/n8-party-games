// Paper Masks: the leaks an independent review of #57 found, as regression tests.
//  1. The public "has guessed" ticks named the author (the last seat without a tick), and the
//     note after a timed-out card listed the author among the missing.
//  2. The last name was filled in at the second-to-last card for the one guesser left with a
//     single name: the last card's author, ticked before anyone tapped.
//  3. Card ids were raw outputs of the match's generator, so they gave away its later draws.
// And what the review of #65 found:
//  4. The deal came from the room's 32-bit seed, which one phone's view was enough to find by
//     trying every seed (about a minute): the ghost's answer and every later prompt with it.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apply, create, hashSeed, MASKS, SYSTEM, TIMERS, view } from "../rules.js";
import { QUESTION_BY_ID, QUESTIONS } from "../questions.js";
import * as atTable from "../at-table.js";
import { drawsFor } from "../../draws.js";
import { tableGame } from "../../table-game.js";
import { answerFor, createFor, must, Table, testSecret } from "./table.js";

const seatsOf = (n) => Array.from({ length: n }, (_, i) => i);

/** What everyone else may see of the guessing step: a big screen's view of it. */
const publicStep = (t) => view(t.state, -1).step;

describe("1. the public tap count never points at the author", () => {
  it("the last guesser cannot tell the author from the others still to tap", () => {
    // the reviewer's case: 4 seats, two of the three guessers have tapped
    const t = new Table(seatsOf(4), {}, 42);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const card = t.r.cards[t.r.pos];
    const others = seatsOf(4).filter((s) => s !== card.author);
    t.guessAll(undefined, others.slice(0, 2));
    const v = t.view(others[2]);
    // nothing keyed by seat; only how many are in
    expect(v.step).not.toHaveProperty("guessed");
    expect(JSON.stringify(v.step)).not.toMatch(/"\d+":(true|false)/);
    expect(v.step.taps).toBe(2);
    expect(v.step.tapsDue).toBe(4);
  });

  it("two guessers in, or one guesser and the author's decoy: the same public view", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const make = () => {
        const t = new Table(seatsOf(5), {}, seed);
        t.writeAll();
        t.do(t.r.reader, { t: "startGuessing" });
        return t;
      };
      const [a, b] = [make(), make()];
      const card = a.r.cards[a.r.pos];
      const [g1, g2] = seatsOf(5).filter((s) => s !== card.author);
      a.guessAll(undefined, [g1, g2]);
      b.guessAll(undefined, [g1, card.author]); // the author's page sends its decoy tap
      expect(b.r.decoys[card.id]).toBe(true);
      // every seat that is neither g2 nor the author sees exactly the same in both
      for (const viewer of [...seatsOf(5).filter((s) => s !== g2 && s !== card.author), -1, 99]) {
        expect(view(b.state, viewer), `seed ${seed} viewer ${viewer}`).toEqual(view(a.state, viewer));
      }
    }
  });

  it("Next waits for the author's decoy tap as for any guess", () => {
    const t = new Table(seatsOf(4), {}, 7);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const card = t.r.cards[t.r.pos];
    t.guessAll(undefined, seatsOf(4).filter((s) => s !== card.author));
    expect(publicStep(t)).toMatchObject({ taps: 3, tapsDue: 4, everyoneGuessed: false });
    expect(t.act(t.r.reader, { t: "next" }).refused).toBe("waiting_for_guesses");
    const other = seatsOf(4).find((s) => s !== card.author);
    expect(t.act(other, { t: "decoy", card: card.id }).refused).toBe("not_yours");
    t.do(card.author, { t: "decoy", card: card.id });
    t.do(card.author, { t: "decoy", card: card.id }); // again: harmless
    expect(publicStep(t)).toMatchObject({ taps: 4, tapsDue: 4, everyoneGuessed: true });
    expect(t.view(card.author).step.tapped).toBe(true);
    t.do(t.r.reader, { t: "next" });
  });

  it("the note after a timed-out card gives a count, never seats", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const card = t.r.cards[t.r.pos];
    // only one guesser taps; the author and two guessers do not
    t.guessAll(undefined, [seatsOf(4).find((s) => s !== card.author)]);
    t.tick(TIMERS.guessSoft);
    t.tick(TIMERS.guessSoft);
    const n = t.state.notes.at(-1);
    expect(n).toMatchObject({ k: "guessing_closed", how: "time", missing: 3 });
    // the host's End it now, with everyone but the author in: the author's missing decoy is a count too
    const card2 = t.r.cards[t.r.pos];
    t.guessAll(undefined, seatsOf(4).filter((s) => s !== card2.author));
    t.do(t.state.host, { t: "endStep" });
    expect(t.state.notes.at(-1)).toMatchObject({ k: "guessing_closed", how: "host", missing: 1 });
  });
});

describe("2. the last name is filled in on the last card only, for everyone at once", () => {
  it("over 40 seeds, nothing is filled in before the last card, and the count never moves by itself early", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = createFor([0, 1, 2, 3], {}, seed, 0);
      for (const seat of [0, 1, 2, 3]) s = apply(s, seat, { t: "answer", text: `Answer number ${seat} here` }, 1);
      s = apply(s, s.round.reader, { t: "startGuessing" }, 2);
      const n = s.round.cards.length;
      const tapsAtStart = [];
      for (let k = 0; k < n - 1; k++) {
        const card = s.round.cards[s.round.pos];
        // as each card comes up, before anyone taps: no taps, nothing filled in
        expect(Object.keys(s.round.auto), `seed ${seed} card ${k}`).toEqual([]);
        tapsAtStart.push(view(s, -1).step.taps);
        for (const g of [0, 1, 2, 3]) {
          if (g === card.author) continue;
          s = must(apply(s, g, { t: "guess", card: card.id, who: view(s, g).step.available[0] }, 3));
        }
        s = must(apply(s, s.host, { t: "endStep" }, 4)); // the host moves on (no decoy needed for that)
      }
      // the last card: every guesser has one name left and is filled in, the author's decoy with them
      expect(tapsAtStart, `seed ${seed}`).toEqual(Array(n - 1).fill(0));
      const last = s.round.cards[n - 1];
      expect(s.round.pos).toBe(n - 1);
      expect(view(s, -1).step).toMatchObject({ taps: 4, tapsDue: 4, everyoneGuessed: true });
      // every phone, the author's too, reads the same: one name left, filled in
      for (const g of [0, 1, 2, 3]) {
        const v = view(s, g);
        expect(v.step.tapped).toBe(true);
        expect(v.step.auto, `seed ${seed} seat ${g}`).toBe(true);
        expect(v.step.chips.length).toBe(3);
        expect(v.step.available.length).toBe(1);
        expect(v.step.guess).toBe(v.step.available[0]);
      }
    }
  });

  it("a guesser whose own card is last taps their single name at the second-to-last card", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = new Table(seatsOf(4), {}, seed);
      t.writeAll();
      t.do(t.r.reader, { t: "startGuessing" });
      const lastAuthor = t.r.cards.at(-1).author;
      while (t.r.pos < t.r.cards.length - 2) {
        t.guessAll();
        t.do(t.r.reader, { t: "next" });
      }
      const v = t.view(lastAuthor);
      expect(v.step.available.length).toBe(1);
      expect(v.step.guess).toBe(null);
      expect(v.step.auto).toBe(false);
    }
  });
});

describe("3. card ids say nothing about the draws", () => {
  /** The hex of draw n's whole digest, as party/games/draws.js makes it. */
  const drawHex = (secret, n) => createHash("sha256").update(`paper-masks/draw/${n}/${secret}`).digest("hex");

  it("no card id is, or is part of, any of the draws around writing closing", () => {
    for (const seed of [5, 6, 7, "x", "y"]) {
      const t = new Table(seatsOf(4), {}, seed);
      t.writeAll(answerFor, [0, 1, 2]);
      const near = Array.from({ length: t.state.draws + 200 }, (_, n) => drawHex(t.state.secret, n));
      t.writeAll(answerFor, [3]);
      for (const c of t.r.cards) {
        expect(c.id).toMatch(/^[0-9a-f]{16}$/);
        for (const d of near) expect(d.includes(c.id.slice(0, 8)) || d.includes(c.id.slice(8)), `${seed} ${c.id}`).toBe(false);
      }
    }
  });

  it("ids come from the secret, the round and the position only, not from how far the draws have gone", () => {
    // 4 and 6 seats use the draws differently (a longer shuffle); ids by position agree
    const a = new Table(seatsOf(4), {}, "same-seed");
    const b = new Table(seatsOf(6), {}, "same-seed");
    a.writeAll();
    b.writeAll();
    expect(b.r.cards.slice(0, 4).map((c) => c.id)).toEqual(a.r.cards.map((c) => c.id));
    expect(a.state.draws).not.toBe(b.state.draws);
    // another secret, other ids
    const c = new Table(seatsOf(4), {}, "other-seed");
    c.writeAll();
    for (const card of c.r.cards) expect(a.r.cards.map((x) => x.id)).not.toContain(card.id);
  });

  it("ids are unique across a whole match", () => {
    const t = new Table(seatsOf(8), { rounds: 7 }, "unique");
    const seen = new Set();
    while (t.phase !== "over") {
      t.playRound();
      for (const c of t.r.cards) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
      t.do(t.state.host, { t: "nextRound" });
    }
    expect(seen.size).toBe(56);
  });
});

describe("the room is never stalled by a missing decoy", () => {
  it("an author whose page never sends the decoy is closed by the hard deadline like a slow guesser", () => {
    const t = new Table(seatsOf(4), {}, 3);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const card = t.r.cards[t.r.pos];
    t.guessAll(undefined, seatsOf(4).filter((s) => s !== card.author));
    t.tick(TIMERS.guessSoft);
    t.tick(TIMERS.guessSoft);
    expect(t.r.pos).toBe(1);
    expect(t.state.notes.at(-1)).toMatchObject({ k: "guessing_closed", missing: 1 });
    expect(t.act(SYSTEM, { t: "tick" })).not.toHaveProperty("refused");
  });
});

describe("4. the deal comes from the match's secret, never from the room's seed", () => {
  // The reviewer's attack (review of #65): rebuild the deal from a 32-bit seed with the generator
  // the rules used to start from it, and keep a seed whose deal matches what seat 0's phone sees
  // (every seat's mask and the first prompt); from it the ghost's answer and every later prompt
  // follow. Here it is given the true seed outright, which no brute force could beat.
  const mulberry = (seed) => {
    let a = hashSeed(seed) || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const shuffle = (next, list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  /** What the old rules dealt from `seed`: the masks in seat order, the deck, and the ghost's answer. */
  function seedDeal(seed, players) {
    const next = mulberry(seed);
    const masks = shuffle(next, [...MASKS]).slice(0, players);
    const first = shuffle(next, QUESTIONS.map((q) => q.id));
    const taken = new Set(first);
    const deck = [...first, ...shuffle(next, QUESTIONS.filter((q) => !taken.has(q.id)).map((q) => q.id))];
    const ghosts = QUESTION_BY_ID[deck[0]].ghosts;
    return { masks, deck, ghost: ghosts[Math.floor(next() * ghosts.length)] };
  }
  /** A three-player match from the Table's waiting step to the reading of round 1, as the room plays it. */
  function dealt(seed, secret) {
    let s = must(atTable.create([0, 1, 2], { host: 0 }, seed, 1000, { secret }));
    s = must(atTable.apply(s, 0, { t: "begin" }, 2000));
    for (const seat of [0, 1, 2]) s = must(atTable.apply(s, seat, { t: "answer", text: `Words of seat ${seat}` }, 3000));
    return s;
  }

  it("given the very seed, the reviewer's attack finds nothing: no mask deal, prompt or ghost answer of it is the match's", () => {
    let ghostHits = 0;
    for (let k = 0; k < 24; k++) {
      const seed = (hashSeed(`room seed ${k}`) >>> 0) || 7; // a 32-bit room seed, as the room's
      const s = dealt(seed, testSecret(`attack ${k}`));
      const seen = atTable.view(s, 0); // all the attacker has: seat 0's own view
      const guess = seedDeal(seed, 3);
      const matches = seen.players.map((p) => p.mask).join() === guess.masks.join() && seen.prompt.id === guess.deck[0];
      expect(matches, `seed ${seed}`).toBe(false);
      expect(s.match.deck.slice(1, 5), `seed ${seed}`).not.toEqual(guess.deck.slice(1, 5));
      if (s.match.round.cards.some((c) => c.author === "ghost" && c.text === guess.ghost)) ghostHits += 1;
    }
    expect(ghostHits).toBeLessThan(12); // chance, at most: a prompt has 3 to 6 ghost answers
  });

  it("the same 32-bit seed with different secrets deals different masks, decks and card ids", () => {
    const decks = new Set();
    const masks = new Set();
    const ids = new Set();
    for (let k = 0; k < 8; k++) {
      const s = dealt(424242, testSecret(`same seed ${k}`));
      decks.add(s.match.deck.slice(0, 6).join());
      masks.add(s.match.players.map((p) => p.mask).join());
      for (const c of s.match.round.cards) ids.add(c.id);
    }
    expect(decks.size).toBe(8);
    expect(masks.size).toBeGreaterThanOrEqual(7); // 336 ways to deal three masks
    expect(ids.size).toBe(32);
  });

  it("the seed decides nothing: the same secret deals the same match whatever the seed", () => {
    const a = dealt(1, testSecret("one secret"));
    const b = dealt(4294967295, testSecret("one secret"));
    expect(b.match).toEqual(a.match);
  });

  it("refuses a secret under 128 bits, here and in the waiting step", () => {
    for (const secret of ["", "abc", "0".repeat(31), "g".repeat(32), 12345, null]) {
      expect(create([0, 1, 2], {}, 1, 0, { secret })).toMatchObject({ refused: "bad_secret" });
      expect(atTable.create([0, 1, 2], {}, 1, 0, { secret })).toMatchObject({ refused: "bad_secret" });
    }
    expect(create([0, 1, 2], {}, 1, 0, { secret: "a".repeat(32) })).not.toHaveProperty("refused");
  });

  it("the Table's adapter gives each match a fresh secret: one seed, two matches, two deals", () => {
    const game = tableGame(atTable);
    const make = () => {
      const state = game.create({ seats: [{ seat: 0 }, { seat: 1 }, { seat: 2 }], seed: 99, now: 0, host: 0 });
      expect(state).not.toHaveProperty("seed");
      expect(state.secret).toMatch(/^[0-9a-f]{64}$/);
      game.input(state, 0, { t: "begin" }, 1);
      return state.match;
    };
    const [a, b] = [make(), make()];
    expect(b.deck).not.toEqual(a.deck);
  });

  it("no view holds the secret, or any draw made from it, from the waiting step to the curtain", () => {
    const secret = testSecret("views");
    const draw = drawsFor("paper-masks");
    let s = must(atTable.create([0, 1, 2, 3], { host: 0, rounds: 3 }, 77, 0, { secret }));
    const looks = [];
    const look = () => {
      for (const seat of [0, 1, 2, 3, -1, 9]) looks.push(JSON.stringify(atTable.view(s, seat)));
    };
    look();
    s = must(atTable.apply(s, 0, { t: "begin" }, 1));
    let now = 2;
    for (let i = 0; i < 400 && s.at === "match"; i++) {
      look();
      const m = s.match;
      const act = (seat, move) => (s = must(atTable.apply(s, seat, move, (now += 10))));
      if (m.phase === "writing") for (const seat of [0, 1, 2, 3]) s.match.phase === "writing" && act(seat, { t: "answer", text: `Seat ${seat} round ${m.round.n}` });
      else if (m.phase === "reading") act(m.round.reader, { t: "startGuessing" });
      else if (m.phase === "guessing") {
        for (const seat of [0, 1, 2, 3]) {
          const v = atTable.view(s, seat).step;
          if (v.yours) !v.tapped && act(seat, { t: "decoy", card: v.card.id });
          else if (v.guess === null && v.available.length) act(seat, { t: "guess", card: v.card.id, who: v.available[0] });
        }
        act(s.match.round.reader, { t: "next" });
      } else if (m.phase === "reveal") act(m.round.reader, { t: "reveal" });
      else if (m.phase === "summary") act(m.host, { t: "nextRound" });
    }
    look();
    expect(s.at).toBe("curtain");
    const used = s.match.draws;
    expect(used).toBeGreaterThan(20);
    const values = new Set(Array.from({ length: used }, (_, n) => draw(secret, n)));
    const digests = Array.from({ length: used }, (_, n) => createHash("sha256").update(`paper-masks/draw/${n}/${secret}`).digest("hex").slice(0, 12));
    for (const json of looks) {
      expect(json).not.toContain(secret);
      expect(json).not.toContain(secret.slice(0, 16));
      expect(json).not.toMatch(/"(secret|draws|seed|rng|idKey)"/);
      for (const d of digests) expect(json).not.toContain(d);
      JSON.parse(json, (k, val) => {
        if (typeof val === "number") expect(values.has(val), `${k}: ${val}`).toBe(false);
        return val;
      });
    }
  });
});

describe("5. the author's guessing view is a guesser's (review of #65)", () => {
  /** The names a guesser in `seat` would get: every author but `seat`, and the game when it wrote one. */
  const namesFor = (t, seat) => [...t.r.authors.filter((s) => s !== seat), ...(t.r.cards.some((c) => c.author === "ghost") ? ["ghost"] : [])];
  /** The names `seat` placed on other unskipped cards this round. */
  const placed = (t, seat, card) => t.r.cards.filter((c) => !c.skipped && c.id !== card.id && c.id in (t.r.guesses[seat] ?? {})).map((c) => t.r.guesses[seat][c.id]);

  /** Plays round 1 card by card; `onCard(t, card, author, guesser)` looks before anyone taps; `skipAt` skips that card. */
  function play(n, seed, onCard, { skipAt = null } = {}) {
    const t = new Table(seatsOf(n), { rounds: 3 }, seed);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    let k = 0;
    while (t.phase === "guessing") {
      const card = t.r.cards[t.r.pos];
      if (k++ === skipAt) {
        t.do(t.state.host, { t: "skip", card: card.id });
        continue;
      }
      onCard(t, card);
      t.guessAll();
      onCard(t, card, true);
      t.do(t.r.reader, { t: "next" });
    }
    return t;
  }

  for (const n of [3, 4, 5, 8]) {
    for (const skipAt of [null, 0, 1]) {
      it(`${n} players${skipAt === null ? "" : `, card ${skipAt + 1} skipped`}: the same chips, greyed the same way, the same fields`, () => {
        for (const seed of [1, 2, 3]) {
          let looked = 0;
          play(
            n,
            seed,
            (t, card, after = false) => {
              if (card.author === "ghost") return;
              const a = t.view(card.author).step;
              const guesser = t.guessers().find((s) => s !== card.author);
              const g = t.view(guesser).step;
              const where = `seed ${seed} card ${t.r.pos} ${after ? "after" : "before"} the taps`;
              expect(a.yours, where).toBe(true);
              expect(Object.keys(a).sort(), where).toEqual(Object.keys(g).sort());
              // exactly the chips a guesser in the author's seat would have: as many as anyone's
              expect(a.chips, where).toEqual(namesFor(t, card.author));
              expect(a.chips.length, where).toBe(g.chips.length);
              // their own used names greyed as anyone's are (the last card aside: see below)
              const free = t.r.skippedAny ? a.chips : a.chips.filter((c) => !placed(t, card.author, card).includes(c));
              if (free.length) expect(a.available, where).toEqual(free);
              else expect(a.available.length, where).toBe(1);
              expect(a.eachNameOnce).toBe(g.eachNameOnce);
              if (after) {
                expect(a.tapped, where).toBe(true);
                expect(a.available, where).toContain(a.guess);
              } else if (!a.tapped) expect(a.guess, where).toBe(null);
              looked++;
            },
            { skipAt },
          );
          expect(looked).toBeGreaterThan(0);
        }
      });
    }
  }

  it("after a skip, the author's row is as long as everyone's (the reviewer's 4-player case)", () => {
    const t = new Table(seatsOf(4), { rounds: 3 }, 9);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    t.do(t.state.host, { t: "skip", card: t.r.cards[t.r.pos].id });
    const card = t.r.cards[t.r.pos];
    const lengths = seatsOf(4).map((s) => t.view(s).step.chips.length);
    expect(new Set(lengths).size).toBe(1);
    expect(t.view(card.author).step.chips.length).toBe(3);
    expect(t.view(card.author).step.of).toBe(3);
  });

  it("the chip shown as the author's tap after a reload comes from the card's id alone", () => {
    for (const seed of [1, 2, 3, 4]) {
      const a = new Table(seatsOf(5), {}, seed);
      a.writeAll();
      a.do(a.r.reader, { t: "startGuessing" });
      const card = a.r.cards[a.r.pos];
      a.do(card.author, { t: "decoy", card: card.id });
      const first = a.view(card.author).step.guess;
      expect(a.view(card.author).step.available).toContain(first);
      // the same view, every time: nothing about it is kept anywhere but the card's id
      expect(a.view(card.author).step.guess).toBe(first);
      expect(a.state.round.decoys[card.id]).toBe(true);
    }
  });
});
