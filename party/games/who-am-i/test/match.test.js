// Who Am I? whole matches: the setup step, trade turns and keep-going turns, Ask and Clues, the
// reveal, match lengths and scoring, a larger table with the host's pick and watchers.
import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, HINTS_PER_TURN, SYSTEM, TIMERS, create, done, nextDeadline, result, standings, view } from "../rules.js";
import { T0, Table, must } from "./table.js";

describe("the setup step", () => {
  it("deals the seats in with the defaults, the host named by the room and the two who play", () => {
    const s = must(create([4, 1], { host: 4 }, 7, T0));
    expect(s).toMatchObject({ phase: "setup", pool: [1, 4], pick: [1, 4], host: 4, until: T0 + TIMERS.setup, players: [], options: DEFAULT_OPTIONS });
    expect(nextDeadline(s)).toBe(T0 + TIMERS.setup);
    expect(done(s)).toBe(false);
    const v = view(s, 1);
    expect(v).toMatchObject({ phase: "setup", round: 0, host: 4, you: { seat: 1, role: "player", host: false }, setup: { pool: [1, 4], pick: [1, 4] } });
    expect(v.setup.choices.packs.map((p) => p.id)).toContain("anime-cartoons");
    expect(view(s, 4).you.host).toBe(true);
    expect(view(s, -1).you).toEqual({ seat: -1, role: "screen", host: false });
  });

  it("lets the host choose before the match begins; the match uses those choices", () => {
    const t = new Table([0, 1], { host: 1 });
    t.do(1, { t: "choose", pack: "actors", difficulty: "easy", mode: "describe_it", timer: 60, match: "rounds-5", hints: false, questions: "spoken" });
    expect(t.state.options).toEqual({ pack: "actors", difficulty: "easy", mode: "describe_it", turnFormat: "trade", timer: 60, match: "rounds-5", hints: false, questions: "spoken" });
    t.begin();
    expect(t.phase).toBe("playing");
    expect(t.view(0).trade).toBe(false); // Clues always keeps going
    expect(t.secretOf(0).pack).toBe("actors");
    expect(t.secretOf(1).difficulty).toBe("easy");
    expect(t.turn.deadline).toBe(t.now + 60_000);
  });

  it("begins by itself at its deadline, with the choices as they stand", () => {
    const t = new Table([0, 1]);
    t.do(0, { t: "choose", match: "first-to-5" });
    t.now = T0 + TIMERS.setup - 1;
    t.do(SYSTEM, { t: "tick" });
    expect(t.phase).toBe("setup");
    t.toDeadline();
    expect(t.phase).toBe("playing");
    expect(t.state.options.match).toBe("first-to-5");
    expect(t.state.notes.at(-1)).toMatchObject({ k: "began", how: "time" });
  });
});

describe("two players, trade turns (the default)", () => {
  it("plays a whole match to first to 3, alternating who guesses first, and places the winner", () => {
    const t = new Table([2, 5], {}, 42);
    t.begin();
    const first = t.guesser;
    const second = first === 2 ? 5 : 2;
    expect(t.state.round.order).toEqual([first, second]);
    // Round 1: the first guesser gets it at once and wins the round.
    expect(t.rightGuess()).toBe(first);
    expect(t.phase).toBe("reveal");
    let v = t.view(first);
    expect(v.reveal.round).toBe(1);
    expect(v.reveal.entries.map((e) => [e.seat, e.result])).toEqual([
      [first, "correct"],
      [second, "beaten"],
    ]);
    expect(v.reveal.matchOver).toBe(false);
    expect(v.players.find((p) => p.seat === first).score).toBe(1);
    t.do(second, { t: "next" });
    // Round 2: the other player guesses first.
    expect(t.state.round.n).toBe(2);
    expect(t.guesser).toBe(second);
    t.playMatch();
    expect(done(t.state)).toBe(true);
    const rows = result(t.state);
    expect(rows[0].score).toBe(3);
    expect(rows[0].place).toBe(1);
    expect(rows[1].place).toBe(2);
    expect(standings(t.state)).toEqual(rows.map((r) => ({ seat: r.seat, place: r.place })));
    expect(t.state.ended).toEqual({ how: "decided", by: null });
    expect(nextDeadline(t.state)).toBeNull();
    v = t.view(-1);
    expect(v.phase).toBe("over");
    expect(v.result).toEqual(rows);
    expect(v.reveal.matchOver).toBe(true);
  });

  it("is one question and one guess per move, the other player's answers, a pass, a wrong guess", () => {
    const t = new Table([0, 1], {}, 3);
    t.begin();
    const a = t.guesser;
    const b = t.judge;
    t.do(a, { t: "ask", text: "  Am I   a real\tperson? " });
    const q = t.view(b).turn.log[0];
    expect(q).toMatchObject({ kind: "question", text: "Am I a real person?", answer: null });
    expect(t.view(a).turn.questionWaiting).toBe(true);
    expect(t.act(a, { t: "ask", text: "Again?" })).toMatchObject({ refused: "question_waiting" });
    expect(t.act(a, { t: "pass" })).toMatchObject({ refused: "question_waiting" });
    expect(t.act(a, { t: "guess" })).toMatchObject({ refused: "question_waiting" });
    expect(t.act(a, { t: "answer", id: q.id, answer: "yes" })).toMatchObject({ refused: "not_judge" });
    t.do(b, { t: "answer", id: q.id, answer: "yes" });
    expect(t.act(b, { t: "answer", id: q.id, answer: "no" })).toMatchObject({ refused: "answered" });
    expect(t.act(a, { t: "ask", text: "Am I alive?" })).toMatchObject({ refused: "one_question" });
    expect(t.act(a, { t: "count" })).toMatchObject({ refused: "one_question" });
    t.do(a, { t: "pass" });
    // b's move; a's log and count are kept for a's next move.
    expect(t.guesser).toBe(b);
    expect(t.turn.log).toEqual([]);
    t.do(b, { t: "count" });
    expect(t.turn.questionCount).toBe(1);
    t.do(b, { t: "guess" });
    t.do(a, { t: "reject" });
    // A wrong guess uses up the move.
    expect(t.guesser).toBe(a);
    expect(t.turn.log).toHaveLength(1);
    expect(t.turn.log[0].answer).toBe("yes");
    expect(t.turn.questionCount).toBe(1);
    expect(t.turn.moveAsked).toBe(false);
    t.rightGuess();
    expect(t.state.summary.entries.find((e) => e.seat === a)).toMatchObject({ result: "correct", questions: 1 });
    expect(t.state.summary.entries.find((e) => e.seat === b)).toMatchObject({ result: "beaten", questions: 1 });
  });

  it("gives up to three hints about your own name, free, shown in the turn log", () => {
    const t = new Table([0, 1], {}, 9);
    t.begin();
    const a = t.guesser;
    const mine = t.secretOf(a);
    for (let i = 0; i < HINTS_PER_TURN; i++) t.do(a, { t: "hint" });
    expect(t.act(a, { t: "hint" })).toMatchObject({ refused: "no_hints_left" });
    expect(t.view(a).turn.log.map((e) => [e.kind, e.index, e.text])).toEqual(mine.hints.map((h, i) => ["hint", i + 1, h]));
    expect(t.view(a).turn.hintsLeft).toBe(0);
    t.rightGuess();
    expect(t.state.summary.entries.find((e) => e.seat === a).hints).toBe(3);
    expect(t.state.players.find((p) => p.seat === a).hintsUsed).toBe(3);
  });

  it("goes on with the other player when one gives up, and scores nobody when both do", () => {
    const t = new Table([0, 1], {}, 5);
    t.begin();
    const a = t.guesser;
    const b = t.judge;
    t.do(a, { t: "skip" });
    expect(t.guesser).toBe(b);
    t.do(b, { t: "pass" }); // a is out of the round, so b moves again
    expect(t.guesser).toBe(b);
    t.do(b, { t: "skip" });
    expect(t.phase).toBe("reveal");
    expect(t.state.summary.entries.map((e) => e.result)).toEqual(["skipped", "skipped"]);
    expect(t.state.players.map((p) => p.score)).toEqual([0, 0]);
    expect(t.state.players.map((p) => p.skips)).toEqual([1, 1]);
  });
});

describe("keep-going turns and Clues", () => {
  it("gives each player a whole turn, and both may score in a round", () => {
    const t = new Table([0, 1], { turnFormat: "keep_going" }, 11);
    t.begin();
    const [a, b] = t.state.round.order;
    t.do(a, { t: "ask", text: "Am I fictional?" });
    t.do(b, { t: "answer", id: t.turn.log[0].id, answer: "no" });
    t.do(a, { t: "ask", text: "Am I an actor?" }); // no one-question limit
    expect(t.act(a, { t: "pass" })).toMatchObject({ refused: "not_trade" });
    t.do(b, { t: "answer", id: t.turn.log[1].id, answer: "sort_of" });
    t.do(a, { t: "guess" });
    t.do(b, { t: "reject" });
    expect(t.guesser).toBe(a); // a wrong guess does not end a keep-going turn
    t.rightGuess();
    expect(t.guesser).toBe(b);
    t.rightGuess();
    expect(t.state.summary.entries.map((e) => e.result)).toEqual(["correct", "correct"]);
    expect(t.state.players.map((p) => p.score)).toEqual([1, 1]);
  });

  it("counts a turn that runs out as timed out, and moves on", () => {
    const t = new Table([0, 1], { turnFormat: "keep_going", timer: 60 }, 12);
    t.begin();
    const [a, b] = t.state.round.order;
    expect(nextDeadline(t.state)).toBe(t.now + 60_000);
    t.toDeadline();
    expect(t.state.round.results).toEqual({ [a]: "timed_out" });
    expect(t.guesser).toBe(b);
    expect(t.state.notes.at(-1)).toMatchObject({ k: "timed_out", seat: a });
    t.rightGuess();
    expect(t.state.summary.entries.map((e) => e.result)).toEqual(["timed_out", "correct"]);
  });

  it("plays Clues: no question counter, typed questions still allowed unless spoken only", () => {
    const t = new Table([0, 1], { mode: "describe_it" }, 13);
    t.begin();
    const a = t.guesser;
    expect(t.act(a, { t: "count" })).toMatchObject({ refused: "ask_mode_only" });
    expect(t.act(a, { t: "pass" })).toMatchObject({ refused: "not_trade" });
    t.do(a, { t: "ask", text: "Am I from a film?" });
    const s = new Table([0, 1], { questions: "spoken" }, 13);
    s.begin();
    expect(s.act(s.guesser, { t: "ask", text: "Hm?" })).toMatchObject({ refused: "spoken_only" });
    s.do(s.guesser, { t: "count" });
  });
});

describe("match lengths and places", () => {
  it("ends a rounds match after its rounds, and a tie shares first place", () => {
    const t = new Table([0, 1], { match: "rounds-5", turnFormat: "keep_going" }, 21);
    // Both get it every round: 5 to 5.
    t.playMatch((tb) => tb.rightGuess());
    expect(t.state.summary.n).toBe(5);
    expect(result(t.state).map((r) => [r.score, r.place])).toEqual([
      [5, 1],
      [5, 1],
    ]);
    expect(standings(t.state).map((s) => s.place)).toEqual([1, 1]);
  });

  it("first to 5 needs five right guesses", () => {
    const t = new Table([0, 1], { match: "first-to-5" }, 22);
    t.playMatch();
    // The first guesser of each round gets it, and the first guesser alternates: 5 to 4 after 9 rounds.
    expect(result(t.state).map((r) => [r.score, r.place])).toEqual([
      [5, 1],
      [4, 2],
    ]);
    expect(t.state.summary.n).toBe(9);
  });

  it("does not let the same name come back in a match until the pack runs out", () => {
    const t = new Table([0, 1], { match: "rounds-10", pack: "brand-mascots", difficulty: "hard" }, 23);
    t.begin();
    const seen = [];
    for (let i = 0; i < 40 && t.phase !== "over"; i++) {
      if (t.phase === "playing") {
        if (!t.state.round.reshuffled) seen.push(...Object.values(t.state.round.assign));
        else seen.length = 0;
        expect(new Set(seen).size).toBe(seen.length);
        t.rightGuess();
      } else t.do(0, { t: "next" });
    }
    expect(t.phase).toBe("over");
  });
});

describe("a larger table: the host picks the two, everyone else watches", () => {
  it("picks the host and the next seat by default, and the host may pick anyone", () => {
    let t = new Table([0, 3, 5, 6], { host: 5 });
    expect(t.state.pick).toEqual([5, 6]);
    t = new Table([0, 3, 5, 6], { host: 6 });
    expect(t.state.pick).toEqual([0, 6]);
    expect(t.act(6, { t: "pick", seats: [3, 3] })).toMatchObject({ refused: "bad_pick" });
    expect(t.act(6, { t: "pick", seats: [3, 9] })).toMatchObject({ refused: "bad_pick" });
    expect(t.act(6, { t: "pick", seats: [3] })).toMatchObject({ refused: "bad_pick" });
    expect(t.act(3, { t: "pick", seats: [3, 5] })).toMatchObject({ refused: "not_host" });
    t.do(6, { t: "pick", seats: [5, 0] });
    expect(t.view(0).setup.pick).toEqual([0, 5]);
    t.begin();
    expect(t.state.players.map((p) => p.seat)).toEqual([0, 5]);
    expect(t.state.watchers).toEqual([3, 6]);
    expect(t.view(6).you).toEqual({ seat: 6, role: "watcher", host: true });
    expect(t.view(3).you.role).toBe("watcher");
    expect(t.view(0).you.role).toBe("player");
  });

  it("plays a match with two watchers and a big screen; watchers cannot play, the host may move the reveal on", () => {
    const t = new Table([0, 1, 2, 3], { host: 2 });
    t.do(2, { t: "pick", seats: [0, 1] });
    t.begin();
    for (const w of [2, 3]) {
      for (const move of [{ t: "ask", text: "Am I?" }, { t: "count" }, { t: "hint" }, { t: "guess" }, { t: "confirm" }, { t: "skip" }]) {
        expect(t.act(w, move), JSON.stringify(move)).toMatchObject({ refused: "not_playing" });
      }
    }
    t.rightGuess();
    expect(t.act(3, { t: "next" })).toMatchObject({ refused: "not_playing" });
    t.do(2, { t: "next" }); // the host, though watching
    t.playMatch();
    expect(standings(t.state).map((s) => s.seat).sort()).toEqual([0, 1]);
    for (const seat of [2, 3, -1]) expect(view(t.state, seat).result).toHaveLength(2);
  });

  it("takes someone who arrives during setup onto the table, and someone who arrives later as a watcher", () => {
    const t = new Table([0, 1]);
    t.do(SYSTEM, { t: "join", seat: 4 });
    expect(t.state.pool).toEqual([0, 1, 4]);
    expect(t.view(4).you.role).toBe("player");
    t.do(0, { t: "pick", seats: [1, 4] });
    t.begin();
    expect(t.state.watchers).toEqual([0]);
    t.do(SYSTEM, { t: "join", seat: 6 });
    expect(t.state.watchers).toEqual([0, 6]);
    expect(t.view(6).you.role).toBe("watcher");
    expect(t.view(6)).not.toHaveProperty("opponent");
  });
});
