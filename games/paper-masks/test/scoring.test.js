// Paper Masks: rounds scored by hand (rules, section 5), at 3, 4 and 8 seats, and the round choices.
import { describe, expect, it } from "vitest";
import { apply, create, DEFAULT_ROUNDS, GHOST, isRefusal, result, ROUND_CHOICES, view } from "../rules.js";
import { must, Table } from "./table.js";

const seatsOf = (n) => Array.from({ length: n }, (_, i) => i);

/** Plays round 1, every guesser pinning each author as `plan[guesser][author]` says. */
function play(seats, plan, seed) {
  let s = must(create(seats, { rounds: 3 }, seed, 0));
  for (const seat of seats) s = must(apply(s, seat, { t: "answer", text: `Words of seat ${seat}` }, 1));
  s = must(apply(s, s.round.reader, { t: "startGuessing" }, 2));
  while (s.phase === "guessing") {
    const card = s.round.cards[s.round.pos];
    for (const g of seats) {
      if (g === card.author) {
        s = must(apply(s, g, { t: "decoy", card: card.id }, 3));
        continue;
      }
      const want = plan[g][card.author];
      if (view(s, g).step.guess === want) continue; // filled in on the last card
      s = must(apply(s, g, { t: "guess", card: card.id, who: want }, 3));
    }
    s = must(apply(s, s.round.reader, { t: "next" }, 4));
  }
  while (s.phase === "reveal") s = must(apply(s, s.round.reader, { t: "reveal" }, 5));
  return { points: s.round.points, res: result(s) };
}

const totals = (points) => Object.fromEntries(Object.entries(points).map(([k, p]) => [k, p.total]));
const sorted = (xs) => [...xs].sort((a, b) => a - b);

describe("scoring by hand", () => {
  it("4 players", () => {
    // seats 1 and 3 read everyone; seat 0 swaps 2 and 3; seat 2 swaps 0 and 1
    const plan = {
      0: { 1: 1, 2: 3, 3: 2 },
      1: { 0: 0, 2: 2, 3: 3 },
      2: { 0: 1, 1: 0, 3: 3 },
      3: { 0: 0, 1: 1, 2: 2 },
    };
    for (const seed of [1, 2, 3, 99]) {
      const { points, res } = play(seatsOf(4), plan, seed);
      expect(totals(points)).toEqual({ 0: 2, 1: 6, 2: 2, 3: 6 });
      expect([points[0].perfect, points[1].perfect, points[2].perfect, points[3].perfect]).toEqual([false, true, false, true]);
      expect(sorted(res.winners)).toEqual([1, 3]);
      expect(Object.fromEntries(res.rows.map((r) => [r.seat, r.place]))).toEqual({ 0: 3, 1: 1, 2: 3, 3: 1 });
      expect(res.awards.mindReader).toEqual({ seats: [1, 3], count: 3 });
      expect({ ...res.awards.bestMask, seats: sorted(res.awards.bestMask.seats) }).toEqual({ seats: [0, 1, 2, 3], count: 1 });
    }
  });

  it("3 players with the ghost", () => {
    const plan = {
      0: { 1: GHOST, 2: 2, [GHOST]: 1 },
      1: { 0: 0, 2: GHOST, [GHOST]: 2 },
      2: { 0: 0, 1: 1, [GHOST]: GHOST },
    };
    for (const seed of [1, 2, 3, 99]) {
      const { points, res } = play(seatsOf(3), plan, seed);
      // 0: right on 2 only (+1). 1: right on 0 (+1), fooled 0 (+1). 2: all right (+3, +2 perfect),
      // fooled 1 (+1). Pins of the ghost's card fool nobody.
      expect(totals(points)).toEqual({ 0: 1, 1: 2, 2: 6 });
      expect(res.winners).toEqual([2]);
      expect(res.awards.mindReader).toEqual({ seats: [2], count: 3 });
      expect({ ...res.awards.bestMask, seats: sorted(res.awards.bestMask.seats) }).toEqual({ seats: [1, 2], count: 1 });
    }
  });

  it("8 players", () => {
    // seats 0-3 read everyone; 4 swaps authors 0 and 1, 5 swaps 2 and 3, 6 swaps 0 and 2, 7 swaps 4 and 5
    const right = (g) => Object.fromEntries(seatsOf(8).filter((a) => a !== g).map((a) => [a, a]));
    const swap = (g, x, y) => ({ ...right(g), [x]: y, [y]: x });
    const plan = { 0: right(0), 1: right(1), 2: right(2), 3: right(3), 4: swap(4, 0, 1), 5: swap(5, 2, 3), 6: swap(6, 0, 2), 7: swap(7, 4, 5) };
    // correct: 7 for 0-3, 5 for 4-7; fooled: 0 by 4 and 6, 1 by 4, 2 by 5 and 6, 3 by 5, 4 and 5 by 7
    // perfect: 0-3 (+2)
    for (const seed of [1, 2, 3]) {
      const { points, res } = play(seatsOf(8), plan, seed);
      expect(totals(points)).toEqual({ 0: 11, 1: 10, 2: 11, 3: 10, 4: 6, 5: 6, 6: 5, 7: 5 });
      expect(seatsOf(8).map((s) => points[s].fooled)).toEqual([2, 1, 2, 1, 1, 1, 0, 0]);
      expect(seatsOf(8).map((s) => points[s].perfect)).toEqual([true, true, true, true, false, false, false, false]);
      expect(sorted(res.winners)).toEqual([0, 2]);
      expect(Object.fromEntries(res.rows.map((r) => [r.seat, r.place]))).toEqual({ 0: 1, 2: 1, 1: 3, 3: 3, 4: 5, 5: 5, 6: 7, 7: 7 });
      // the titles list tied seats in result order (best score first), so compare them sorted
      expect({ ...res.awards.mindReader, seats: sorted(res.awards.mindReader.seats) }).toEqual({ seats: [0, 1, 2, 3], count: 7 });
      expect({ ...res.awards.bestMask, seats: sorted(res.awards.bestMask.seats) }).toEqual({ seats: [0, 2], count: 2 });
    }
  });

  it("a full 8-seat match plays to the end with every round scored", () => {
    const t = new Table(seatsOf(8), {}, "eight");
    let rounds = 0;
    while (t.phase !== "over") {
      t.playRound();
      expect(t.r.cards.length).toBe(8);
      expect(Object.keys(t.r.points).length).toBe(8);
      rounds++;
      t.do(t.state.host, { t: "nextRound" });
    }
    expect(rounds).toBe(DEFAULT_ROUNDS);
    expect(result(t.state).rows.every((r) => r.place !== null)).toBe(true);
  });
});

describe("the rules' numbers", () => {
  it("rounds are 3, 5, 7 or everyone; 5 by default at any size", () => {
    expect(ROUND_CHOICES).toEqual([3, 5, 7, "everyone"]);
    expect(create(seatsOf(3), { rounds: 4 }, 1)).toMatchObject({ refused: "bad_rounds" });
    for (const n of [3, 4, 6, 7, 8]) expect(create(seatsOf(n), {}, 1).options.rounds).toBe(5);
  });

  it("a perfect sheet is every answer you placed was right, even with one missed by the timer", () => {
    const t = new Table(seatsOf(5), {}, 21);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    // seat 0 misses the first card it could guess (the host ends that step); everything else is right
    let missed = false;
    while (t.phase === "guessing") {
      const card = t.r.cards[t.r.pos];
      const skipZero = !missed && card.author !== 0;
      if (skipZero) missed = true;
      const seats = t.guessers().filter((s) => !(skipZero && s === 0));
      t.guessAll((seat, v, table) => {
        const truth = table.authorOf(v.step.card.id);
        return v.step.available.includes(truth) ? truth : undefined;
      }, seats);
      if (skipZero) t.do(t.state.host, { t: "endStep" });
      else t.do(t.r.reader, { t: "next" });
    }
    while (t.phase === "reveal") t.do(t.r.reader, { t: "reveal" });
    expect(Object.keys(t.r.guesses[0]).length).toBe(3);
    expect(t.r.points[0]).toEqual({ correct: 3, fooled: 0, perfect: true, total: 5 });
    expect(isRefusal(t.state)).toBe(false);
  });
});
