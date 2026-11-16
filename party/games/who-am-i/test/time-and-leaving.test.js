// Who Am I? never waits for ever: every step has a deadline the room's alarm brings, and a seat
// that leaves (on purpose, or its phone gone past the room's grace) ends the match fairly.
import { describe, expect, it } from "vitest";
import { SYSTEM, TIMERS, apply, done, isRefusal, nextDeadline, result, standings, view } from "../rules.js";
import { T0, Table } from "./table.js";

describe("turn timers", () => {
  it("ends only the move in trade turns when time runs out", () => {
    const t = new Table([0, 1], { timer: 60 }, 31);
    t.begin();
    const [a, b] = t.state.round.order;
    expect(t.view(b).turn).toMatchObject({ seat: a, deadline: t.now + 60_000, timed: true });
    t.now += 59_999;
    t.do(SYSTEM, { t: "tick" }); // early: nothing
    expect(t.guesser).toBe(a);
    t.toDeadline();
    expect(t.guesser).toBe(b);
    expect(t.state.round.results).toEqual({});
    expect(t.state.notes.at(-1)).toMatchObject({ k: "timed_out", seat: a });
    expect(nextDeadline(t.state)).toBe(t.now + 60_000);
  });

  it("has a five-minute backstop when the host chose no timer", () => {
    const t = new Table([0, 1], { timer: 0 }, 32);
    t.begin();
    expect(t.view(0).turn).toMatchObject({ timed: false, deadline: t.now + TIMERS.relaxedTurn });
  });

  it("pauses the turn while a guess waits; lets the guesser confirm it after 30 s; lapses it after 2 minutes", () => {
    const t = new Table([0, 1], { turnFormat: "keep_going", timer: 90 }, 33);
    t.begin();
    const [a, b] = t.state.round.order;
    t.now += 20_000;
    t.do(a, { t: "guess" });
    expect(t.turn).toMatchObject({ phase: "confirming", deadline: null, paused: 70_000 });
    expect(nextDeadline(t.state)).toBe(t.now + TIMERS.confirmLapse);
    expect(t.view(b).turn).toMatchObject({ selfConfirmAt: t.now + 30_000, lapseAt: t.now + 120_000 });
    for (const move of ["ask", "hint", "count", "pass"]) expect(t.act(a, { t: move, text: "x" }).refused, move).toBeTruthy();
    expect(t.act(a, { t: "selfConfirm" }, 29_999)).toMatchObject({ refused: "too_soon" });
    expect(t.act(b, { t: "selfConfirm" })).toMatchObject({ refused: "not_guesser" });
    // Nobody answers: the guess lapses as if rejected, and the paused time comes back.
    t.toDeadline();
    expect(t.turn).toMatchObject({ seat: a, phase: "asking", deadline: t.now + 70_000, paused: null });
    expect(t.state.notes.at(-1)).toMatchObject({ k: "guess_lapsed", seat: a });
    // This time the other phone is quiet for 30 s and the guesser confirms it.
    t.do(a, { t: "guess" });
    t.do(a, { t: "selfConfirm" }, 30_000);
    expect(t.state.round.results).toEqual({ [a]: "correct" });
    expect(t.state.notes.at(-1)).toMatchObject({ k: "self_confirmed", seat: a });
    expect(t.guesser).toBe(b);
  });

  it("moves on from the reveal by itself, and ends a decided match by itself", () => {
    const t = new Table([0, 1], { match: "first-to-3" }, 34);
    t.begin();
    t.rightGuess();
    expect(nextDeadline(t.state)).toBe(t.now + TIMERS.reveal);
    t.toDeadline();
    expect(t.phase).toBe("playing");
    expect(t.state.round.n).toBe(2);
    while (t.phase !== "over") {
      if (t.phase === "playing") t.rightGuess();
      else t.toDeadline();
    }
    expect(t.state.ended.how).toBe("decided");
    expect(standings(t.state)).toHaveLength(2);
  });

  /** Ticks at each deadline until the end; `act(t, ticks)` may make a move between ticks. */
  function runOnDeadlines(t, act = () => {}) {
    let ticks = 0;
    while (!done(t.state)) {
      const before = nextDeadline(t.state);
      expect(before).not.toBeNull();
      t.toDeadline();
      ticks++;
      // The contract: a tick at the deadline moves the deadline on.
      if (!done(t.state)) expect(nextDeadline(t.state)).toBeGreaterThan(before);
      act(t, ticks);
      expect(ticks).toBeLessThan(2_000);
    }
    return ticks;
  }

  it("never stalls: a table nobody touches begins, plays one silent round and ends with no points", () => {
    for (const options of [{}, { turnFormat: "keep_going" }, { mode: "describe_it", timer: 0 }, { match: "rounds-5" }]) {
      const t = new Table([0, 1, 2], options, 35);
      runOnDeadlines(t);
      expect(t.state.ended.how, JSON.stringify(options)).toBe("idle");
      expect(t.state.summary.n).toBe(1);
      expect(t.state.summary.entries.map((e) => e.result)).toEqual(["timed_out", "timed_out"]);
      expect(standings(t.state)).toEqual([]);
      expect(result(t.state).every((r) => r.place === null)).toBe(true);
    }
  });

  it("never stalls: players who only guess wrong now and then reach the end of a rounds match on deadlines", () => {
    for (const options of [{ match: "rounds-5" }, { match: "rounds-5", turnFormat: "keep_going" }, { match: "rounds-5", mode: "describe_it" }]) {
      const t = new Table([0, 1], options, 36);
      runOnDeadlines(t, (tb, ticks) => {
        // A wrong guess on some turns (so lapses are in it too), giving up on some, nothing on the
        // others. (Players who keep trying in trade turns play on: that is a game, not a stall.)
        if (tb.phase !== "playing" || tb.turn.phase !== "asking") return;
        if (ticks % 5 === 0) tb.do(tb.guesser, { t: "skip" });
        else if (ticks % 2 === 0) tb.do(tb.guesser, { t: "guess" });
      });
      expect(t.state.ended.how, JSON.stringify(options)).toBe("decided");
      expect(t.state.summary.n).toBe(5);
      expect(standings(t.state).map((s) => s.place)).toEqual([1, 1]);
    }
  });
});

describe("leaving", () => {
  it("a player who leaves mid-round forfeits: the one who stayed is first, and the round's names are shown", () => {
    const t = new Table([0, 1, 2], { host: 0 }, 41);
    t.do(0, { t: "pick", seats: [0, 1] });
    t.begin();
    t.rightGuess();
    t.do(0, { t: "next" });
    const leaver = t.guesser;
    const stayer = t.judge;
    const leaverName = t.secretOf(leaver).name;
    t.do(SYSTEM, { t: "leave", seat: leaver });
    expect(done(t.state)).toBe(true);
    expect(t.state.ended).toEqual({ how: "forfeit", by: leaver });
    expect(standings(t.state)).toEqual([{ seat: stayer, place: 1 }]);
    const rows = result(t.state);
    expect(rows[0]).toMatchObject({ seat: stayer, place: 1 });
    expect(rows[1]).toMatchObject({ seat: leaver, place: null, left: true, forfeit: true });
    const v = view(t.state, 2);
    expect(v.reveal.round).toBe(2);
    expect(v.reveal.entries.map((e) => e.result)).toEqual(["unfinished", "unfinished"]);
    expect(v.reveal.entries.find((e) => e.seat === leaver).name).toBe(leaverName);
    expect(t.view(leaver).you.role).toBe("watcher");
    expect(nextDeadline(t.state)).toBeNull();
  });

  it("a player who leaves while a guess waits, or on a reveal before the match is decided, forfeits too", () => {
    const t = new Table([0, 1], {}, 42);
    t.begin();
    const a = t.guesser;
    t.do(a, { t: "guess" });
    t.do(SYSTEM, { t: "leave", seat: t.judge });
    expect(standings(t.state)).toEqual([{ seat: a, place: 1 }]);

    const u = new Table([0, 1], {}, 43);
    u.begin();
    const winner = u.rightGuess();
    u.do(SYSTEM, { t: "leave", seat: winner });
    expect(u.state.ended.how).toBe("forfeit");
    expect(standings(u.state)).toEqual([{ seat: winner === 0 ? 1 : 0, place: 1 }]);
  });

  it("a player who leaves once the match is decided keeps the real places", () => {
    const t = new Table([0, 1], { match: "first-to-3" }, 44);
    t.begin();
    while (!t.state.summary?.matchOver) {
      if (t.phase === "playing") t.rightGuess();
      else t.do(0, { t: "next" });
    }
    const [best, other] = result(t.state);
    t.do(SYSTEM, { t: "leave", seat: best.seat });
    expect(t.state.ended.how).toBe("decided");
    expect(standings(t.state)).toEqual([
      { seat: best.seat, place: 1 },
      { seat: other.seat, place: 2 },
    ]);
    expect(result(t.state)[0]).toMatchObject({ seat: best.seat, left: true, place: 1 });
    expect(result(t.state)[0]).not.toHaveProperty("forfeit");
  });

  it("before the match: the table goes on without the seat, and ends with no points below two", () => {
    const t = new Table([0, 1, 2], { host: 1 });
    expect(t.state.pick).toEqual([1, 2]);
    t.do(SYSTEM, { t: "leave", seat: 1 });
    expect(t.state.pool).toEqual([0, 2]);
    expect(t.state.host).toBe(0);
    expect(t.state.pick).toEqual([0, 2]);
    expect(t.state.notes.at(-1)).toMatchObject({ k: "host_passed", to: 0 });
    t.do(SYSTEM, { t: "leave", seat: 2 });
    expect(done(t.state)).toBe(true);
    expect(t.state.ended.how).toBe("too_few");
    expect(standings(t.state)).toEqual([]);
    expect(result(t.state)).toEqual([]);
    expect(view(t.state, 0)).toMatchObject({ phase: "over", result: [] });
    expect(nextDeadline(t.state)).toBeNull();
  });

  it("a watcher who leaves just goes; a host who was watching passes the controls to a player", () => {
    const t = new Table([0, 1, 2, 3], { host: 3 });
    t.do(3, { t: "pick", seats: [0, 1] });
    t.begin();
    t.do(SYSTEM, { t: "leave", seat: 2 });
    expect(t.state.watchers).toEqual([3]);
    t.do(SYSTEM, { t: "leave", seat: 3 });
    expect(t.state.watchers).toEqual([]);
    expect(t.state.host).toBe(0);
    expect(done(t.state)).toBe(false);
    expect(t.act(SYSTEM, { t: "leave", seat: 9 })).toMatchObject({ refused: "not_playing" });
  });

  it("follows the room's host to any seat at the table, players and watchers alike", () => {
    const t = new Table([0, 1, 2], { host: 0 });
    t.do(0, { t: "pick", seats: [0, 1] });
    t.begin();
    t.do(SYSTEM, { t: "host", seat: 2 });
    expect(t.view(2).you.host).toBe(true);
    expect(t.act(SYSTEM, { t: "host", seat: 7 })).toMatchObject({ refused: "bad_host" });
  });

  it("does not take back a seat that left, and takes nothing once the match is over", () => {
    const t = new Table([0, 1], {}, 45);
    t.begin();
    const a = t.guesser;
    t.do(SYSTEM, { t: "leave", seat: a });
    for (const move of [{ t: "join", seat: a }, { t: "join", seat: 5 }, { t: "leave", seat: a }, { t: "host", seat: 1 }]) {
      expect(t.act(SYSTEM, move)).toMatchObject({ refused: "over" });
    }
    // A tick after the end changes nothing.
    const after = apply(t.state, SYSTEM, { t: "tick" }, T0 + 10 ** 9);
    expect(isRefusal(after)).toBe(false);
    expect(after).toEqual({ ...t.state, now: T0 + 10 ** 9 });
  });

  it("refuses the same seat twice, and a seat that already left", () => {
    const t = new Table([0, 1, 2], { host: 0 });
    t.do(0, { t: "pick", seats: [0, 1] });
    t.begin();
    expect(t.act(SYSTEM, { t: "join", seat: 2 })).toMatchObject({ refused: "already_in_game" });
    expect(t.act(SYSTEM, { t: "join", seat: 0 })).toMatchObject({ refused: "already_in_game" });
    expect(t.act(SYSTEM, { t: "join", seat: -1 })).toMatchObject({ refused: "bad_move" });
  });
});
