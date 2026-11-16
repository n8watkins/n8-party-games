// Paper Masks: whole matches, scoring, the end, determinism and time.
import { describe, expect, it } from "vitest";
import { QUESTION_BY_ID } from "../questions.js";
import { create, done, GHOST, GHOST_MASK, MASKS, nextDeadline, result, standings, SYSTEM, TIMERS, view } from "../rules.js";
import { answerFor, mixedPick, oraclePick, T0, Table } from "./table.js";

const seatsOf = (n) => Array.from({ length: n }, (_, i) => i);

/** An independent scorer for one finished round, from the server state. */
function referenceScores(round) {
  const cards = round.cards.filter((c) => !c.skipped);
  const key = (t) => t.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
  const out = {};
  const add = (s, f) => {
    out[s] ??= { correct: 0, fooled: 0, perfect: false };
    out[s][f]++;
  };
  for (const s of round.roster) out[s] ??= { correct: 0, fooled: 0, perfect: false };
  for (const s of round.roster) {
    const mine = round.guesses[s] ?? {};
    let right = 0;
    const due = cards.filter((c) => c.author !== s);
    for (const c of due) {
      if (!(c.id in mine)) continue;
      const group = cards.filter((d) => key(d.text) === key(c.text)).map((d) => d.author);
      if (group.includes(mine[c.id])) {
        add(s, "correct");
        right++;
      } else if (c.author !== GHOST) add(c.author, "fooled");
    }
    if (due.length && right === due.length) out[s].perfect = true;
  }
  return out;
}

describe("whole matches", () => {
  for (const [n, seed] of [
    [3, 11],
    [5, 22],
    [8, 33],
  ]) {
    it(`plays ${n} seats from a seed to the end`, () => {
      const t = new Table(seatsOf(n), {}, seed);
      const masks = t.state.players.map((p) => p.mask);
      expect(new Set(masks).size).toBe(n);
      masks.forEach((m) => expect(MASKS).toContain(m));

      const prompts = [];
      const readers = [];
      const totals = Object.fromEntries(seatsOf(n).map((s) => [s, 0]));
      for (let i = 0; i < 20 && t.phase !== "over"; i++) {
        prompts.push(t.r.prompt.id);
        readers.push(t.r.reader);
        expect(t.r.ghost).toBe(n === 3);
        t.playRound({ pick: mixedPick });
        expect(t.phase).toBe("summary");
        const cards = t.r.cards;
        expect(cards.length).toBe(n === 3 ? 4 : n);
        expect(cards.some((c) => c.author === GHOST)).toBe(n === 3);
        // every card revealed, scores as the independent scorer has them
        expect(t.r.revealed.length).toBe(cards.length);
        const ref = referenceScores(t.r);
        for (const s of seatsOf(n)) {
          const p = t.r.points[s];
          expect({ correct: p.correct, fooled: p.fooled, perfect: p.perfect }).toEqual(ref[s]);
          expect(p.total).toBe(p.correct + p.fooled + (p.perfect ? 2 : 0));
          totals[s] += p.total;
        }
        t.do(t.state.host, { t: "nextRound" });
      }
      expect(done(t.state)).toBe(true);
      const rounds = n >= 7 ? 4 : 5;
      expect(prompts.length).toBe(rounds);
      expect(new Set(prompts).size).toBe(rounds);
      expect(readers).toEqual(seatsOf(rounds).map((i) => i % n));
      const res = result(t.state);
      expect(res.roundsPlayed).toBe(rounds);
      expect(res.early).toBe(false);
      for (const row of res.rows) expect(row.score).toBe(totals[row.seat]);
      const best = Math.max(...res.rows.map((r) => r.score));
      expect(res.winners.sort()).toEqual(res.rows.filter((r) => r.score === best).map((r) => r.seat).sort());
      expect(standings(t.state).filter((s) => s.place === 1).map((s) => s.seat).sort()).toEqual(res.winners.sort());
      expect(view(t.state, 0).result).toEqual(res);
      expect(nextDeadline(t.state)).toBe(null);
    });
  }

  it("scores a table that reads everyone perfectly: right names plus the perfect-sheet bonus", () => {
    for (const n of [3, 4, 6]) {
      const t = new Table(seatsOf(n), { rounds: 3 }, n);
      t.playRound({ pick: oraclePick });
      const cards = n === 3 ? 4 : n;
      for (const s of seatsOf(n)) expect(t.r.points[s]).toEqual({ correct: cards - 1, fooled: 0, perfect: true, total: cards - 1 + 2 });
    }
  });

  it("'everyone reads once' ends when the last player has read", () => {
    const t = new Table([2, 5, 7, 9], { rounds: "everyone" }, 5);
    const readers = [];
    while (t.phase !== "over") {
      readers.push(t.r.reader);
      t.playRound();
      t.do(t.state.host, { t: "nextRound" });
    }
    expect(readers).toEqual([2, 5, 7, 9]);
  });

  it("defaults to 4 rounds at 7 or 8 players and 5 otherwise; the host reads first", () => {
    expect(create(seatsOf(7), {}, 1).options.rounds).toBe(4);
    expect(create(seatsOf(6), {}, 1).options.rounds).toBe(5);
    const s = create([4, 1, 6], { host: 6 }, 1);
    expect(s.round.reader).toBe(6);
    expect(s.players.map((p) => p.seat)).toEqual([1, 4, 6]);
  });

  it("ties are a shared win, and both titles go to everyone who shares the top", () => {
    const t = new Table(seatsOf(4), { rounds: 3 }, 9);
    // everyone right every round: all equal
    while (t.phase !== "over") {
      t.playRound({ pick: oraclePick });
      t.do(t.state.host, { t: "nextRound" });
    }
    const res = result(t.state);
    expect(res.winners).toEqual([0, 1, 2, 3]);
    expect(res.rows.every((r) => r.place === 1)).toBe(true);
    expect(res.awards.mindReader.seats).toEqual([0, 1, 2, 3]);
    expect(res.awards.bestMask).toEqual({ seats: [], count: 0 }); // nobody fooled anybody
  });

  it("gives Best mask to whoever fooled the most and Mind reader to whoever guessed right most", () => {
    const t = new Table(seatsOf(4), { rounds: 3 }, 4);
    // seat 0 always right; the others always pin everything on seat 3 when they can
    const pick = (seat, v, table) => {
      const truth = table.authorOf(v.step.card.id);
      if (seat === 0) return v.step.available.includes(truth) ? truth : undefined;
      const wrong = v.step.available.find((c) => c !== truth);
      return wrong;
    };
    while (t.phase !== "over") {
      t.playRound({ pick });
      t.do(t.state.host, { t: "nextRound" });
    }
    const res = result(t.state);
    const byFooled = Math.max(...res.rows.map((r) => r.fooled));
    expect(res.awards.bestMask.count).toBe(byFooled);
    expect(res.awards.bestMask.seats).toEqual(res.rows.filter((r) => r.fooled === byFooled).map((r) => r.seat).sort((a, b) => a - b));
    expect(res.awards.mindReader.seats).toEqual([0]);
  });
});

describe("the ghost (3 players) and identical answers", () => {
  it("adds a ghost card from the prompt's own two, chip 'ghost', which scores and fools nobody", () => {
    const t = new Table([0, 1, 2], {}, 7);
    t.writeAll();
    const ghostCard = t.r.cards.find((c) => c.author === GHOST);
    expect(QUESTION_BY_ID[t.r.prompt.id].ghosts).toContain(ghostCard.text);
    t.do(t.r.reader, { t: "startGuessing" });
    // seat 0 pins the ghost card on seat 1, and seat 1's card on the ghost
    const pick = (seat, v, table) => {
      const truth = table.authorOf(v.step.card.id);
      if (seat !== 0) return undefined;
      if (truth === GHOST && v.step.available.includes(1)) return 1;
      if (truth === 1 && v.step.available.includes(GHOST)) return GHOST;
      return undefined;
    };
    const notAuthor = [0, 1, 2].find((s) => s !== t.authorOf(t.view(0).step.card.id));
    expect(t.view(notAuthor).step.chips).toContain(GHOST);
    while (t.phase === "guessing") {
      t.guessAll(pick);
      t.do(t.r.reader, { t: "next" });
    }
    while (t.phase === "reveal") t.do(t.r.reader, { t: "reveal" });
    const ref = referenceScores(t.r);
    for (const s of [0, 1, 2]) {
      expect(t.r.points[s]).toMatchObject(ref[s]);
      // a seat is fooled only by wrong guesses on its own card: pins of the ghost's card earn nothing,
      // and pinning a friend's card on the game counts as fooled
      const own = t.r.cards.find((c) => c.author === s);
      const wrong = Object.values(t.r.guesses).filter((m) => own.id in m && m[own.id] !== s).length;
      expect(t.r.points[s].fooled).toBe(wrong);
    }
    expect(t.r.guesses[0][ghostCard.id]).toBeDefined();
    const ghostReveal = t.view(2).step.cards.find((c) => c.id === ghostCard.id);
    expect(ghostReveal).toMatchObject({ by: GHOST, mask: GHOST_MASK });
  });

  it("turns the ghost on from the next round when 4 players drop to 3", () => {
    const t = new Table(seatsOf(4), {}, 3);
    expect(t.r.ghost).toBe(false);
    t.do(SYSTEM, { t: "leave", seat: 3 });
    expect(t.r.ghost).toBe(false);
    t.playRound();
    t.do(t.state.host, { t: "nextRound" });
    expect(t.r.ghost).toBe(true);
    t.writeAll();
    expect(t.r.cards.length).toBe(4);
  });

  it("keeps identical answers as two cards; either author is right for either; the reveal shows both", () => {
    const t = new Table(seatsOf(4), {}, 12);
    const texts = { 0: "Pizza, obviously", 1: "pizza obviously!", 2: "Soup", 3: "Toast" };
    t.writeAll((s) => texts[s]);
    const [a, b] = [t.r.cards.find((c) => c.author === 0), t.r.cards.find((c) => c.author === 1)];
    expect(a.id).not.toBe(b.id);
    expect(a.text).toBe("Pizza, obviously");
    expect(b.text).toBe("Pizza obviously!");
    t.do(t.r.reader, { t: "startGuessing" });
    // seat 2 puts 1 on card a and 0 on card b: both right; seat 3 puts 2 on card a: fooled by 0
    const pick = (seat, v) => {
      const id = v.step.card.id;
      if (seat === 2 && id === a.id && v.step.available.includes(1)) return 1;
      if (seat === 2 && id === b.id && v.step.available.includes(0)) return 0;
      if (seat === 2 && id !== a.id && id !== b.id) return 3;
      if (seat === 3 && id === a.id && v.step.available.includes(2)) return 2;
      return undefined;
    };
    while (t.phase === "guessing") {
      t.guessAll(pick);
      t.do(t.r.reader, { t: "next" });
    }
    expect(t.r.guesses[2][a.id]).toBe(1);
    t.do(t.r.reader, { t: "reveal" });
    const cards = t.view(3).step.cards.filter((c) => c.revealed);
    const first = t.r.cards.find((c) => c.id === t.r.revealed[0]);
    if (first.id === a.id || first.id === b.id) {
      // the pair is revealed together, "Great minds"
      expect(cards.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
      expect(cards.find((c) => c.id === a.id).sameAs).toEqual([1]);
    }
    while (t.phase === "reveal") t.do(t.r.reader, { t: "reveal" });
    expect(t.r.points[2].correct).toBeGreaterThanOrEqual(2);
    expect(t.r.points[0].fooled).toBeGreaterThanOrEqual(t.r.guesses[3][a.id] === 2 ? 1 : 0);
    const ref = referenceScores(t.r);
    for (const s of [0, 1, 2, 3]) expect(t.r.points[s]).toMatchObject(ref[s]);
  });
});

describe("guessing rules", () => {
  it("each name once, and the last one is filled in", () => {
    const t = new Table(seatsOf(5), {}, 31);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const seen = [];
    while (t.phase === "guessing") {
      const v = t.view(2);
      if (!v.step.yours) {
        seen.push(v.step.available.length);
        if (v.step.available.length === 1) {
          expect(v.step.auto).toBe(true);
          expect(v.step.guess).toBe(v.step.available[0]);
        }
      }
      t.guessAll();
      t.do(t.r.reader, { t: "next" });
    }
    expect(seen).toEqual([4, 3, 2, 1]);
    const placed = Object.values(t.r.guesses[2]);
    expect(new Set(placed).size).toBe(4);
  });

  it("the reader writes and guesses too; Next waits for everyone", () => {
    const t = new Table(seatsOf(4), {}, 2);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const v = t.view(t.r.reader);
    if (!v.step.yours) expect(v.step.chips.length).toBe(3);
    const others = t.guessers().filter((s) => s !== 1);
    t.guessAll(undefined, others);
    const card = t.r.cards[t.r.pos];
    if (card.author !== 1) expect(t.act(t.r.reader, { t: "next" }).refused).toBe("waiting_for_guesses");
    t.guessAll();
    t.do(t.r.reader, { t: "next" });
  });
});

describe("determinism", () => {
  it("the same seed and moves give the same states; another seed gives another order", () => {
    const run = (seed) => {
      const t = new Table(seatsOf(6), { rounds: 3 }, seed);
      t.playMatch({ pick: mixedPick });
      return t.history;
    };
    const a = run("seed-a");
    const b = run("seed-a");
    expect(b).toEqual(a);
    const c = run("seed-b");
    expect(c.at(-1)).not.toEqual(a.at(-1));
  });

  it("every state is plain JSON that comes back the same", () => {
    const t = new Table(seatsOf(3), { rounds: 3 }, 5);
    t.playMatch({ pick: mixedPick });
    for (const s of t.history) expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("apply never changes the state it is given", () => {
    const t = new Table(seatsOf(4), {}, 5);
    const before = JSON.stringify(t.state);
    const kept = t.state;
    t.do(0, { t: "answer", text: "Hello" });
    expect(JSON.stringify(kept)).toBe(before);
  });
});

describe("time: a round never stalls", () => {
  it("with nobody tapping at all, ticking at each deadline still reaches the end", () => {
    for (const n of [3, 5, 8]) {
      const t = new Table(seatsOf(n), {}, n);
      let ticks = 0;
      while (t.phase !== "over") {
        const at = nextDeadline(t.state);
        expect(at).toBeGreaterThan(t.now - 1);
        t.now = at;
        t.do(SYSTEM, { t: "tick" });
        const after = nextDeadline(t.state);
        if (after !== null) expect(after).toBeGreaterThan(at); // the deadline always moves on
        expect(++ticks).toBeLessThan(200);
      }
      expect(t.state.ended.early).toBe(false);
      expect(t.state.notes.some((x) => x.k === "no_answers" || x.k === "ended")).toBe(true);
    }
  });

  it("with answers but no guesses or taps, every step times out in order", () => {
    const t = new Table(seatsOf(4), { rounds: 3 }, 8);
    t.writeAll();
    while (t.phase !== "over") {
      if (t.phase === "writing") t.writeAll();
      t.now = nextDeadline(t.state);
      t.do(SYSTEM, { t: "tick" });
    }
    expect(result(t.state).roundsPlayed).toBe(3);
  });

  it("writing: a soft nudge, then the host may end it, then it closes by itself", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll(answerFor, [0, 1, 2]);
    expect(nextDeadline(t.state)).toBe(T0 + TIMERS.writeSoft);
    t.tick(TIMERS.writeSoft);
    expect(t.state.overdue).toBe(true);
    expect(t.view(1).deadline.overdue).toBe(true);
    expect(t.state.notes.at(-1)).toMatchObject({ k: "time_up", step: "writing" });
    expect(nextDeadline(t.state)).toBe(T0 + TIMERS.writeSoft + TIMERS.writeGrace);
    t.tick(TIMERS.writeGrace);
    expect(t.phase).toBe("reading");
    expect(t.state.notes.find((x) => x.k === "writing_closed")).toMatchObject({ how: "time", missing: [3] });
    t.do(t.r.reader, { t: "startGuessing" });
    const v = t.view(3);
    expect(v.step.chips).not.toContain(3);
    expect(v.step.chips.length).toBe(3); // seat 3 still guesses the others
  });

  it("writing: the host's End writing closes it at once", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll(answerFor, [1, 2]);
    expect(t.act(1, { t: "endStep" }).refused).toBe("not_host");
    t.do(0, { t: "endStep" });
    expect(t.phase).toBe("reading");
    expect(t.r.cards.length).toBe(2);
    expect(t.state.notes.at(-1)).toMatchObject({ k: "writing_closed", how: "host", missing: [0, 3] });
  });

  it("reading: a quiet reader is moved on by time, or the host passes the reading", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll();
    t.do(0, { t: "passReading" });
    expect(t.r.reader).toBe(1);
    expect(t.view(1).step.cards.length).toBe(4);
    expect(t.view(0).step.cards).toBe(null);
    t.tick(TIMERS.readHard);
    expect(t.phase).toBe("guessing");
    expect(t.state.notes.some((x) => x.k === "reading_closed")).toBe(true);
  });

  it("guessing: a missing guess times out with a note naming everyone without a tick", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    const card = t.r.cards[t.r.pos];
    const silent = [0, 1, 2, 3].find((s) => s !== card.author);
    t.guessAll(undefined, t.guessers().filter((s) => s !== silent));
    t.tick(TIMERS.guessSoft);
    expect(t.state.overdue).toBe(true);
    t.tick(TIMERS.guessSoft);
    const n = t.state.notes.at(-1);
    expect(n.k).toBe("guessing_closed");
    expect(n.how).toBe("time");
    // the author has no tick either while someone is missing, so the note does not give them away
    expect(n.missing.sort()).toEqual([silent, card.author].sort());
    expect(t.r.pos).toBeGreaterThan(0);
  });

  it("guessing: 45 seconds per answer, 30 at 7 or 8 players", () => {
    const small = new Table(seatsOf(6), {}, 1);
    small.writeAll();
    small.do(small.r.reader, { t: "startGuessing" });
    expect(small.state.deadline.soft - small.now).toBe(45_000);
    const large = new Table(seatsOf(7), {}, 1);
    large.writeAll();
    large.do(large.r.reader, { t: "startGuessing" });
    expect(large.state.deadline.soft - large.now).toBe(30_000);
  });

  it("reveal and summary: time moves them on with a note", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    while (t.phase === "guessing") {
      t.guessAll();
      t.do(t.r.reader, { t: "next" });
    }
    expect(t.phase).toBe("reveal");
    t.tick(TIMERS.revealHard);
    expect(t.r.revealed.length).toBe(1);
    for (let i = 0; i < 4; i++) t.tick(TIMERS.revealHard);
    expect(t.phase).toBe("summary");
    t.tick(TIMERS.summaryHard);
    expect(t.phase).toBe("writing");
    expect(t.r.n).toBe(2);
    expect(t.state.notes.some((x) => x.k === "step_by_time" && x.step === "summary")).toBe(true);
  });

  it("a tick before its deadline changes nothing but the clock", () => {
    const t = new Table(seatsOf(4), {}, 1);
    const before = { ...t.state, now: 0 };
    t.tick(1000);
    expect({ ...t.state, now: 0 }).toEqual(before);
  });
});

describe("drops, leaving and joining", () => {
  it("a player who leaves before sending has no answer; the last unsent leaving closes writing", () => {
    const t = new Table(seatsOf(5), {}, 1);
    t.writeAll(answerFor, [0, 1, 2, 3]);
    t.do(SYSTEM, { t: "leave", seat: 4 });
    expect(t.phase).toBe("reading");
    expect(t.r.cards.length).toBe(4);
    expect(t.r.authors).toEqual([0, 1, 2, 3]);
  });

  it("a player who leaves after sending stays a mystery, keeps a chip, cannot guess, is revealed", () => {
    const t = new Table(seatsOf(5), {}, 1);
    t.writeAll();
    t.do(SYSTEM, { t: "leave", seat: 4 });
    t.do(t.r.reader, { t: "startGuessing" });
    const v = t.view(0);
    if (!v.step.yours) expect(v.step.chips).toContain(4);
    expect(t.act(4, { t: "guess", card: v.step.card.id, who: 0 }).refused).toBe("not_playing");
    expect(t.view(4).you.role).toBe("screen");
    expect(t.view(0).players.find((p) => p.seat === 4).left).toBe(true);
    while (t.phase === "guessing") {
      t.guessAll();
      t.do(t.r.reader, { t: "next" });
    }
    while (t.phase === "reveal") t.do(t.r.reader, { t: "reveal" });
    expect(t.view(0).step.cards.find((c) => c.by === 4)).toBeTruthy();
  });

  it("a player who leaves keeps a greyed score and cannot win or take a title", () => {
    const t = new Table(seatsOf(4), { rounds: 3 }, 1);
    t.playRound({ pick: oraclePick });
    t.do(t.state.host, { t: "nextRound" });
    t.do(SYSTEM, { t: "leave", seat: 2 });
    t.playMatch();
    const res = result(t.state);
    const gone = res.rows.find((r) => r.seat === 2);
    expect(gone).toMatchObject({ left: true, place: null });
    expect(gone.score).toBeGreaterThan(0);
    expect(res.winners).not.toContain(2);
    expect(standings(t.state).map((s) => s.seat)).not.toContain(2);
  });

  it("the reader leaving passes the reading; the host leaving passes the host", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.writeAll();
    expect(t.r.reader).toBe(0);
    t.do(SYSTEM, { t: "leave", seat: 0 });
    expect(t.r.reader).toBe(1);
    expect(t.state.host).toBe(1);
    expect(t.view(1).step.cards.length).toBe(4);
    t.do(1, { t: "startGuessing" });
  });

  it("dropping below 3 players ends the match with the scores so far", () => {
    const t = new Table(seatsOf(3), {}, 1);
    t.playRound();
    t.do(t.state.host, { t: "nextRound" });
    t.writeAll(answerFor, [0]);
    t.do(SYSTEM, { t: "leave", seat: 1 });
    expect(t.phase).toBe("over");
    const res = result(t.state);
    expect(res.early).toBe(true);
    expect(res.roundsPlayed).toBe(1);
    expect(view(t.state, 0).step).toBe(null); // the unfinished round shows no cards
  });

  it("a late joiner watches this round, may guess for a side score, plays from the next", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.do(SYSTEM, { t: "join", seat: 6 });
    expect(t.view(6).you.role).toBe("watcher");
    expect(t.act(6, { t: "answer", text: "Me too" }).refused).toBe("not_playing");
    t.writeAll();
    t.do(t.r.reader, { t: "startGuessing" });
    expect(t.view(6).step.chips.length).toBe(4);
    t.playRound({ pick: oraclePick });
    expect(t.state.watchers[0].side).toBe(4);
    expect(t.r.points[0].fooled).toBe(0); // a watcher's guesses never count as fooling
    t.do(t.state.host, { t: "nextRound" });
    const p = t.state.players.find((x) => x.seat === 6);
    expect(p).toMatchObject({ joinedRound: 2, score: 0, left: false });
    expect(MASKS).toContain(p.mask);
    expect(new Set(t.state.players.map((x) => x.mask)).size).toBe(5);
    expect(t.r.roster).toContain(6);
    expect(t.view(6).you.role).toBe("player");
  });

  it("a late joiner at a full table of 8 stays a watcher", () => {
    const t = new Table(seatsOf(8), {}, 1);
    t.do(SYSTEM, { t: "join", seat: 8 });
    t.playRound();
    t.do(t.state.host, { t: "nextRound" });
    expect(t.state.watchers.map((w) => w.seat)).toEqual([8]);
    expect(t.r.roster).not.toContain(8);
  });

  it("the room may name a new host", () => {
    const t = new Table(seatsOf(4), {}, 1);
    t.do(SYSTEM, { t: "host", seat: 2 });
    expect(t.state.host).toBe(2);
    expect(t.view(2).you.host).toBe(true);
  });
});

describe("skipping an answer", () => {
  it("the reader asks, the host sees only the text, and Skip removes it for good", () => {
    const t = new Table(seatsOf(5), {}, 4);
    t.writeAll();
    t.do(0, { t: "passReading" }); // the host hands the list to seat 1, so the reader is not the host
    const target = t.r.cards.find((c) => c.author === 3);
    t.do(1, { t: "askSkip", card: target.id });
    const hostView = t.view(0);
    expect(hostView.asks).toEqual([{ id: target.id, text: target.text }]);
    expect(t.view(2).asks).toBeUndefined();
    t.do(0, { t: "skip", card: target.id });
    const skipAt = t.history.length - 1;
    expect(t.view(0).asks).toEqual([]);
    for (const s of [0, 1, 2, 3, 4, 99]) expect(JSON.stringify(t.view(s))).not.toContain(target.text);
    expect(t.view(3).step).toMatchObject({ yours: null, yourSkipped: true });
    expect(t.view(1).step.cards.length).toBe(4);

    t.do(1, { t: "startGuessing" });
    const v = t.view(0);
    expect(v.step.of).toBe(4);
    expect(v.step.eachNameOnce).toBe(false);
    if (!v.step.yours) expect(v.step.chips).toContain(3); // the skipped author's name stays
    const autos = [];
    while (t.phase === "guessing") {
      t.guessAll((seat, view) => view.step.chips[0]); // each name once is off: the same name may repeat
      autos.push(...Object.values(t.r.auto).flatMap((a) => Object.keys(a)));
      t.do(1, { t: "next" });
    }
    expect(autos).toEqual([]); // nothing is filled in after a skip
    while (t.phase === "reveal") t.do(1, { t: "reveal" });
    const cards = t.view(2).step.cards;
    expect(cards.length).toBe(4);
    expect(cards.some((c) => c.by === 3 || c.id === target.id)).toBe(false);
    for (const p of Object.values(t.r.points)) expect(p.total).toBe(p.correct + p.fooled + (p.perfect ? 2 : 0));
    const ref = referenceScores(t.r);
    for (const s of [0, 1, 2, 3, 4]) expect(t.r.points[s]).toMatchObject(ref[s]);
    expect(t.state.notes.some((x) => x.k === "skipped" && x.card === target.id)).toBe(true);
    t.playMatch();
    for (const s of t.history.slice(skipAt)) for (const seat of [0, 1, 2, 3, 4]) expect(JSON.stringify(view(s, seat))).not.toContain(target.text);
  });

  it("the host may skip the answer being guessed; guesses on it are thrown away", () => {
    const t = new Table(seatsOf(4), {}, 4);
    t.writeAll();
    t.do(0, { t: "startGuessing" });
    const first = t.r.cards[t.r.pos];
    t.guessAll();
    const second = t.r.cards[t.r.pos + 1];
    expect(t.act(0, { t: "skip", card: second.id }).refused).toBe("not_current");
    t.do(0, { t: "skip", card: first.id });
    expect(t.r.cards[t.r.pos].id).toBe(second.id);
    for (const g of Object.values(t.r.guesses)) expect(first.id in g).toBe(false);
  });

  it("the host may keep an answer the reader asked about", () => {
    const t = new Table(seatsOf(4), {}, 4);
    t.writeAll();
    t.do(0, { t: "passReading" });
    const card = t.r.cards[0];
    t.do(1, { t: "askSkip", card: card.id });
    t.do(0, { t: "keep", card: card.id });
    expect(t.view(0).asks).toEqual([]);
    expect(card.skipped).toBe(false);
  });

  it("Reveal all, at 7 or 8 players", () => {
    const t = new Table(seatsOf(7), {}, 4);
    t.writeAll();
    t.do(0, { t: "startGuessing" });
    while (t.phase === "guessing") {
      t.guessAll();
      t.do(0, { t: "next" });
    }
    t.do(0, { t: "reveal" });
    t.do(0, { t: "revealAll" });
    expect(t.view(3).step.allRevealed).toBe(true);
    t.do(0, { t: "reveal" });
    expect(t.phase).toBe("summary");
  });
});

describe("call mode", () => {
  it("shows every phone the list while reading, and a talking order per answer", () => {
    const t = new Table(seatsOf(4), { callMode: true }, 4);
    t.writeAll();
    expect(t.view(2).step.cards.length).toBe(4);
    t.do(0, { t: "startGuessing" });
    const orders = [];
    while (t.phase === "guessing") {
      orders.push(t.view(1).step.talkingOrder);
      t.guessAll();
      t.do(0, { t: "next" });
    }
    expect(orders.map((o) => o[0])).toEqual([0, 1, 2, 3]);
    for (const o of orders) expect([...o].sort()).toEqual([0, 1, 2, 3]);
  });
});
