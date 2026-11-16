// Paper Masks: the leaks an independent review of #57 found, as regression tests.
//  1. The public "has guessed" ticks named the author (the last seat without a tick), and the
//     note after a timed-out card listed the author among the missing.
//  2. The last name was filled in at the second-to-last card for the one guesser left with a
//     single name: the last card's author, ticked before anyone tapped.
//  3. Card ids were raw outputs of the match's generator, so they gave away its later draws.
import { describe, expect, it } from "vitest";
import { create, apply, SYSTEM, TIMERS, view } from "../rules.js";
import { answerFor, must, Table } from "./table.js";

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
      let s = create([0, 1, 2, 3], {}, seed, 0);
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
      for (const g of [0, 1, 2, 3]) {
        const v = view(s, g);
        expect(v.step.tapped).toBe(true);
        expect(v.step.auto).toBe(g !== last.author);
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

describe("3. card ids say nothing about the generator", () => {
  /** mulberry32 from a given position, as rules.js steps it. */
  const draws = (rng, count) => {
    const out = [];
    let a = rng;
    for (let i = 0; i < count; i++) {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      out.push((t ^ (t >>> 14)) >>> 0);
    }
    return out;
  };

  it("no card id holds any of the generator's draws around writing closing", () => {
    for (const seed of [5, 6, 7, "x", "y"]) {
      const t = new Table(seatsOf(4), {}, seed);
      t.writeAll(answerFor, [0, 1, 2]);
      const near = new Set(draws(t.state.rng, 200).map((d) => d.toString(36)));
      t.writeAll(answerFor, [3]);
      for (const c of t.r.cards) {
        for (const part of [c.id, c.id.slice(0, 7), c.id.slice(7)]) expect(near.has(part.replace(/^0+/, "")), `${seed} ${c.id}`).toBe(false);
      }
    }
  });

  it("ids come from the seed, the round and the position only, not the generator's position", () => {
    // 4 and 6 seats consume the generator differently (a longer shuffle); ids by position agree
    const a = new Table(seatsOf(4), {}, "same-seed");
    const b = new Table(seatsOf(6), {}, "same-seed");
    a.writeAll();
    b.writeAll();
    expect(b.r.cards.slice(0, 4).map((c) => c.id)).toEqual(a.r.cards.map((c) => c.id));
    expect(a.state.rng).not.toBe(b.state.rng);
    // another seed, other ids
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
