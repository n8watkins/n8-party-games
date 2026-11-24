// Paper Masks as the Table runs it (at-table.js): the waiting step with the host's choices, the
// match itself (the rules, untouched), and the curtain with the final standings. Played through
// the Table's own adapter (the kit's, n8-party-games/table), as the room plays it.
import { tableGame } from "n8-party-games/table";
import { describe, expect, it } from "vitest";
import * as atTable from "../at-table.js";
import { CURTAIN_MS, PACKS_FOR_PAGE, SETUP_MS, SYSTEM, apply, create, done, nextDeadline, result, standings, view } from "../at-table.js";
import { isRefusal } from "../rules.js";
import { QUESTIONS } from "../questions.js";

const T0 = 5_000_000;
const must = (x) => {
  if (isRefusal(x)) throw new Error(`refused: ${x.refused} (${x.message})`);
  return x;
};

/** Plays the match from whatever step it is in to the curtain, from the seats' views only. */
function playToCurtain(state, now = T0) {
  let s = state;
  const act = (seat, move) => (s = must(apply(s, seat, move, (now += 10))));
  for (let i = 0; i < 400 && s.at === "match"; i++) {
    const host = s.match.host;
    const v = (seat) => view(s, seat);
    const live = s.match.players.filter((p) => !p.left).map((p) => p.seat);
    const phase = s.match.phase;
    if (phase === "writing") {
      for (const seat of live) if (s.at === "match" && s.match.phase === "writing") act(seat, { t: "answer", text: `Answer from ${seat} in round ${s.match.round.n}` });
    } else if (phase === "reading") act(s.match.round.reader, { t: "startGuessing" });
    else if (phase === "guessing") {
      for (const seat of live) {
        const mine = v(seat).step;
        if (mine.yours) !mine.tapped && act(seat, { t: "decoy", card: mine.card.id });
        else if (mine.chips.length && mine.guess === null) act(seat, { t: "guess", card: mine.card.id, who: mine.available[0] });
      }
      act(s.match.round.reader, { t: "next" });
    } else if (phase === "reveal") act(s.match.round.reader, { t: "reveal" });
    else if (phase === "summary") act(host, { t: "nextRound" });
  }
  return s;
}

describe("the waiting step", () => {
  it("deals the seats in and starts from the defaults, with the host the room named", () => {
    const s = must(create([4, 1, 2], { host: 2 }, 99, T0));
    expect(s).toMatchObject({ at: "setup", seats: [1, 2, 4], host: 2, options: { rounds: 5, pack: "mixed", family: false, callMode: false }, until: T0 + SETUP_MS, match: null });
    expect(nextDeadline(s)).toBe(T0 + SETUP_MS);
    expect(done(s)).toBe(false);
    const v = view(s, 1);
    expect(v).toMatchObject({ phase: "setup", round: 0, rounds: 5, pack: "mixed", host: 2, you: { seat: 1, role: "player", host: false }, deadline: { soft: null, hard: T0 + SETUP_MS } });
    expect(view(s, 2).you.host).toBe(true);
    expect(view(s, -1).you).toMatchObject({ role: "screen", host: false });
    expect(v.players.map((p) => p.seat)).toEqual([1, 2, 4]);
    expect(v.step.choices.rounds).toEqual([3, 5, 7, "everyone"]);
    expect(v.step.choices.packs).toEqual(PACKS_FOR_PAGE);
  });

  it("refuses bad seats and a host who is not seated, as the rules do", () => {
    expect(create([1, 2], {}, 1, T0)).toMatchObject({ refused: "bad_seats" });
    expect(create([0, 1, 2, 3, 4, 5, 6, 7, 8], {}, 1, T0)).toMatchObject({ refused: "bad_seats" });
    expect(create([1, 1, 2], {}, 1, T0)).toMatchObject({ refused: "bad_seats" });
    expect(create([1, 2, 3], { host: 9 }, 1, T0)).toMatchObject({ refused: "bad_host" });
  });

  it("lets only the host choose, and only the choices the rules know", () => {
    const s = must(create([0, 1, 2], { host: 0 }, 1, T0));
    expect(apply(s, 1, { t: "choose", rounds: 3 }, T0)).toMatchObject({ refused: "not_host" });
    expect(apply(s, 0, { t: "choose", rounds: 4 }, T0)).toMatchObject({ refused: "bad_rounds" });
    expect(apply(s, 0, { t: "choose", pack: "nope" }, T0)).toMatchObject({ refused: "bad_pack" });
    expect(apply(s, 0, { t: "choose", family: "yes" }, T0)).toMatchObject({ refused: "bad_option" });
    expect(apply(s, 0, { t: "choose", seed: 7 }, T0)).toMatchObject({ refused: "bad_option" });
    expect(apply(s, 0, { t: "answer", text: "hi" }, T0)).toMatchObject({ refused: "not_now" });
    expect(apply(s, 0, { t: "tick" }, T0)).toMatchObject({ refused: "not_system" });
    const t = must(apply(s, 0, { t: "choose", rounds: "everyone", pack: "the-group", family: true, callMode: true }, T0 + 5));
    expect(t.options).toEqual({ rounds: "everyone", pack: "the-group", family: true, callMode: true });
    expect(s.options.rounds).toBe(5); // the state given is never changed
    expect(view(t, 2)).toMatchObject({ rounds: "everyone", pack: "the-group", family: true, callMode: true });
  });

  it("begins the match with the host's choices on the host's tap, and never shows the seed", () => {
    let s = must(create([0, 1, 2, 3], { host: 1 }, 12345, T0));
    s = must(apply(s, 1, { t: "choose", rounds: 3, family: true }, T0 + 1));
    expect(apply(s, 0, { t: "begin" }, T0 + 2)).toMatchObject({ refused: "not_host" });
    s = must(apply(s, 1, { t: "begin" }, T0 + 2));
    expect(s.at).toBe("match");
    expect(s).not.toHaveProperty("seed");
    expect(s.match.options).toMatchObject({ rounds: 3, family: true });
    expect(s.match.host).toBe(1);
    expect(s.match.round.reader).toBe(1);
    expect(QUESTIONS.find((q) => q.id === s.match.round.prompt.id).family).toBe(true);
    expect(nextDeadline(s)).toBe(s.match.deadline.soft);
    for (const seat of [0, 1, 2, 3, -1, 9]) {
      const json = JSON.stringify(view(s, seat));
      expect(json).not.toContain("12345");
      expect(json).not.toContain(s.match.secret);
      expect(json).not.toMatch(/"(seed|secret|draws|rng|idKey|deck|ghostPool)"/);
    }
  });

  it("keeps the match's secret (never the room's seed) until the match begins, and hands it to the rules", () => {
    const secret = "5e".repeat(32);
    const s = must(create([0, 1, 2], { host: 0 }, 12345, T0, { secret }));
    expect(s).not.toHaveProperty("seed");
    expect(s.secret).toBe(secret);
    for (const seat of [0, 1, 2, -1]) expect(JSON.stringify(view(s, seat))).not.toContain(secret);
    const on = must(apply(s, 0, { t: "begin" }, T0 + 1));
    expect(on).not.toHaveProperty("secret");
    expect(on.match.secret).toBe(secret);
  });

  it("restores from storage in the waiting step and goes on as if nothing happened", () => {
    let s = must(create([0, 1, 2, 3], { host: 1 }, 5, T0, { secret: "ab".repeat(32) }));
    s = must(apply(s, 1, { t: "choose", rounds: 3, pack: "the-group" }, T0 + 1));
    const restored = JSON.parse(JSON.stringify(s));
    expect(restored).toEqual(s);
    const a = must(apply(s, 1, { t: "begin" }, T0 + 2));
    const b = must(apply(restored, 1, { t: "begin" }, T0 + 2));
    expect(b).toEqual(a);
    expect(b.match.options).toMatchObject({ rounds: 3, pack: "the-group" });
  });

  it("a restore mid-match continues the same deal", () => {
    let s = must(create([0, 1, 2, 3, 4], { host: 0, rounds: 5 }, 5, T0, { secret: "cd".repeat(32) }));
    s = must(apply(s, 0, { t: "begin" }, T0));
    const straight = playToCurtain(s);
    // the same match, saved and restored after its first move (as the room saves every change)
    let half = must(apply(s, 0, { t: "answer", text: "Answer from 0 in round 1" }, T0 + 10));
    half = JSON.parse(JSON.stringify(half));
    const after = playToCurtain(half, T0 + 10);
    expect(after.match.deck).toEqual(straight.match.deck);
    expect(after.match.players.map((p) => p.mask)).toEqual(straight.match.players.map((p) => p.mask));
    expect(after.match.draws).toBe(straight.match.draws);
    expect(result(after)).toEqual(result(straight));
  });

  it("begins by itself at its deadline, with the choices as they stand", () => {
    let s = must(create([0, 1, 2], { host: 0 }, 3, T0));
    s = must(apply(s, 0, { t: "choose", rounds: 7 }, T0 + 10));
    s = must(apply(s, SYSTEM, { t: "tick" }, T0 + SETUP_MS - 1));
    expect(s.at).toBe("setup");
    s = must(apply(s, SYSTEM, { t: "tick" }, T0 + SETUP_MS));
    expect(s.at).toBe("match");
    expect(s.match.options.rounds).toBe(7);
    expect(nextDeadline(s)).toBeGreaterThan(T0 + SETUP_MS);
  });

  it("deals in someone who arrives (up to 8), drops a seat that goes, and follows the host", () => {
    let s = must(create([0, 1, 2], { host: 0 }, 3, T0));
    s = must(apply(s, SYSTEM, { t: "join", seat: 5 }, T0));
    expect(s.seats).toEqual([0, 1, 2, 5]);
    expect(apply(s, SYSTEM, { t: "join", seat: 5 }, T0)).toMatchObject({ refused: "already_in_game" });
    for (const seat of [3, 4, 6, 7]) s = must(apply(s, SYSTEM, { t: "join", seat }, T0));
    expect(s.seats).toHaveLength(8);
    expect(apply(s, SYSTEM, { t: "join", seat: 8 }, T0)).toMatchObject({ refused: "full" });
    s = must(apply(s, SYSTEM, { t: "leave", seat: 0 }, T0));
    expect(s.host).toBe(1);
    s = must(apply(s, SYSTEM, { t: "host", seat: 6 }, T0));
    expect(s.host).toBe(6);
    expect(apply(s, SYSTEM, { t: "host", seat: 0 }, T0)).toMatchObject({ refused: "bad_host" });
    s = must(apply(s, 6, { t: "begin" }, T0 + 1));
    expect(s.match.players.map((p) => p.seat)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.match.round.reader).toBe(6);
  });

  it("ends with no points when too few are left to begin", () => {
    let s = must(create([0, 1, 2], { host: 0 }, 3, T0));
    s = must(apply(s, SYSTEM, { t: "leave", seat: 2 }, T0 + 1));
    expect(done(s)).toBe(true);
    expect(nextDeadline(s)).toBeNull();
    expect(standings(s)).toEqual([]);
    expect(result(s)).toMatchObject({ early: true, roundsPlayed: 0, rows: [], winners: [] });
    expect(view(s, 0)).toMatchObject({ phase: "over", result: { early: true } });
    expect(apply(s, 0, { t: "begin" }, T0 + 2)).toMatchObject({ refused: "over" });
  });
});

describe("the curtain", () => {
  it("rises when the rules say the match is over, shows the final standings, and closes on the host's tap", () => {
    let s = must(create([0, 1, 2, 3], { host: 0, rounds: 3 }, 77, T0));
    s = must(apply(s, 0, { t: "begin" }, T0));
    s = playToCurtain(s);
    expect(s.at).toBe("curtain");
    expect(done(s)).toBe(false);
    expect(nextDeadline(s)).toBe(s.until);
    const v = view(s, 2);
    expect(v).toMatchObject({ phase: "over", curtain: true, host: 0, you: { host: false }, deadline: { soft: null, hard: s.until } });
    expect(v.result.rows).toHaveLength(4);
    expect(v.result.roundsPlayed).toBe(3);
    expect(view(s, 0).you.host).toBe(true);
    // Nobody new is dealt in now; a seat that goes changes nothing.
    expect(apply(s, SYSTEM, { t: "join", seat: 6 }, s.now)).toMatchObject({ refused: "over" });
    expect(must(apply(s, SYSTEM, { t: "leave", seat: 3 }, s.now)).at).toBe("curtain");
    expect(apply(s, 1, { t: "close" }, s.now)).toMatchObject({ refused: "not_host" });
    expect(apply(s, 1, { t: "guess" }, s.now)).toMatchObject({ refused: "over" });
    const shut = must(apply(s, 0, { t: "close" }, s.now + 1));
    expect(done(shut)).toBe(true);
    expect(standings(shut).length).toBe(4);
    expect(result(shut).rows.map((r) => r.seat).sort()).toEqual([0, 1, 2, 3]);
  });

  it("closes by itself at its deadline, and the host's controls follow the room", () => {
    let s = must(create([0, 1, 2], { host: 0, rounds: 3 }, 8, T0));
    s = playToCurtain(must(apply(s, 0, { t: "begin" }, T0)));
    s = must(apply(s, SYSTEM, { t: "host", seat: 2 }, s.now));
    expect(view(s, 2).you.host).toBe(true);
    expect(must(apply(s, SYSTEM, { t: "tick" }, s.until - 1)).at).toBe("curtain");
    expect(done(must(apply(s, SYSTEM, { t: "tick" }, s.until)))).toBe(true);
    expect(s.until - s.now).toBe(CURTAIN_MS);
  });

  it("rises too when the match ends early (fewer than 3 left), with the scores so far", () => {
    let s = must(create([0, 1, 2], { host: 0 }, 8, T0));
    s = must(apply(s, 0, { t: "begin" }, T0));
    s = must(apply(s, SYSTEM, { t: "leave", seat: 1 }, T0 + 5));
    expect(s.at).toBe("curtain");
    expect(view(s, 0).result).toMatchObject({ early: true });
  });

  it("the host's controls at the curtain go only to a player of the match who is still here", () => {
    let s = must(create([0, 1, 2, 3], { host: 0, rounds: 3 }, 77, T0));
    s = playToCurtain(must(apply(s, 0, { t: "begin" }, T0)));
    expect(s.host).toBe(0);
    // the big screen (-1), a seat that never played, a non-number: refused; the host stays
    for (const seat of [-1, 9, null, "0"]) expect(apply(s, SYSTEM, { t: "host", seat }, s.now), String(seat)).toMatchObject({ refused: "bad_host" });
    s = must(apply(s, SYSTEM, { t: "host", seat: 2 }, s.now));
    expect(s.host).toBe(2);
    // the host leaves: the controls pass on, so someone can always tap Back to the Table
    s = must(apply(s, SYSTEM, { t: "leave", seat: 2 }, s.now));
    expect(s.host).toBe(0);
    expect(view(s, 0).you.host).toBe(true);
    expect(apply(s, SYSTEM, { t: "host", seat: 2 }, s.now)).toMatchObject({ refused: "bad_host" });
    const shut = must(apply(s, 0, { t: "close" }, s.now + 1));
    expect(done(shut)).toBe(true);
    expect(standings(shut)).toHaveLength(4); // a seat that went after the match was decided keeps its place
  });

  it("when the host's leaving ends the match early, the curtain's controls go to one who stayed", () => {
    let s = must(create([0, 1, 2], { host: 1 }, 8, T0));
    s = must(apply(s, 1, { t: "begin" }, T0));
    s = must(apply(s, SYSTEM, { t: "leave", seat: 1 }, T0 + 5));
    expect(s.at).toBe("curtain");
    expect(s.host).toBe(0);
    expect(view(s, 0).you.host).toBe(true);
    expect(must(apply(s, 0, { t: "close" }, T0 + 6)).at).toBe("closed");
  });

  it("restores from storage at the curtain, with its deadline and its host", () => {
    let s = must(create([0, 1, 2], { host: 0, rounds: 3 }, 8, T0));
    s = playToCurtain(must(apply(s, 0, { t: "begin" }, T0)));
    s = must(apply(s, SYSTEM, { t: "host", seat: 2 }, s.now));
    const back = JSON.parse(JSON.stringify(s));
    expect(back).toEqual(s);
    expect(nextDeadline(back)).toBe(s.until);
    expect(view(back, 2)).toEqual(view(s, 2));
    expect(apply(back, 0, { t: "close" }, s.now)).toMatchObject({ refused: "not_host" });
    expect(done(must(apply(back, SYSTEM, { t: "tick" }, s.until)))).toBe(true);
  });

  it("says the match is decided while the curtain is up, and only then", () => {
    let s = must(create([0, 1, 2], { host: 0, rounds: 3 }, 8, T0));
    expect(atTable.decided(s)).toBe(false);
    s = must(apply(s, 0, { t: "begin" }, T0));
    expect(atTable.decided(s)).toBe(false);
    s = playToCurtain(s);
    expect(atTable.decided(s)).toBe(true);
    expect(standings(s)).toHaveLength(3);
    expect(atTable.decided(must(apply(s, 0, { t: "close" }, s.now)))).toBe(false);
    const game = tableGame(atTable);
    expect(game.decided(s)).toBe(true);
  });
});

describe("through the Table's adapter", () => {
  it("is the kit's turn-based game: create from the room's seats and host, moves as inputs, the room's hooks as SYSTEM moves", () => {
    const game = tableGame(atTable);
    expect(game).toMatchObject({ id: "paper-masks", minSeats: 3, maxSeats: 8, tickHz: 0 });
    const state = game.create({ seats: [{ seat: 0 }, { seat: 1 }, { seat: 3 }], seed: 4242, now: T0, host: 3 });
    expect(state.host).toBe(3);
    expect(game.snapshot(state, T0, { role: "player", seat: 0 })).toMatchObject({ phase: "setup", you: { role: "player" } });
    expect(game.snapshot(state, T0, { role: "screen", seat: -1 })).toMatchObject({ phase: "setup", you: { role: "screen" } });
    expect(game.input(state, 0, { t: "begin" }, T0)).toMatchObject({ ok: false, error: "not_host" });
    expect(game.join(state, 5, T0)).toMatchObject({ ok: true });
    expect(state.seats).toEqual([0, 1, 3, 5]);
    expect(game.input(state, 3, { t: "begin" }, T0 + 1)).toMatchObject({ ok: true });
    expect(game.snapshot(state, T0, { role: "player", seat: 5 })).toMatchObject({ phase: "writing", you: { role: "player" } });
    expect(game.nextDeadline(state)).toBe(state.match.deadline.soft);
    expect(game.leave(state, 0, T0 + 2)).toMatchObject({ ok: true });
    expect(game.isOver(state)).toBe(false);
  });
});
