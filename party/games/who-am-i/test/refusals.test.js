// Every refusal, each from the move that earns it, and the promise that a refusal leaves nothing
// behind (apply never changes the state it is given).
import { describe, expect, it } from "vitest";
import { QUESTION_MAX_LENGTH, QUESTION_RATE_LIMIT, SYSTEM, apply, create, isRefusal } from "../rules.js";
import { T0, Table } from "./table.js";

/** A match in its first turn, trade turns unless `options` say otherwise. */
function playing(options = {}, seats = [0, 1]) {
  const t = new Table(seats, { host: seats[0], ...options }, 8);
  t.begin();
  return t;
}

describe("refusals", () => {
  const seen = new Set();
  const refused = (out, code) => {
    expect(isRefusal(out), `expected ${code}`).toBe(true);
    expect(out.refused).toBe(code);
    expect(typeof out.message).toBe("string");
    expect(out.message.length).toBeGreaterThan(5);
    seen.add(code);
  };

  it("create: bad seats, bad options, a host who is not seated", () => {
    for (const seats of [[0], [0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8], [0, -1], [0, 1.5], "01", null]) refused(create(seats, {}, 1, T0), "bad_seats");
    for (const options of [{ pack: "nope" }, { timer: 30 }, { match: "first-to-9" }, { hints: "yes" }, { seed: 1 }, [], null]) refused(create([0, 1], options, 1, T0), "bad_option");
    refused(create([0, 1], { host: 5 }, 1, T0), "bad_host");
    // A secret shorter than 128 bits, or not hex, is no secret.
    for (const secret of ["", "abc", "0".repeat(31), "g".repeat(64), 12345, null]) refused(create([0, 1], {}, 1, T0, { secret }), "bad_secret");
  });

  it("moves that are not moves, and the room's own moves from a player", () => {
    const t = new Table([0, 1]);
    for (const move of [null, "begin", {}, { t: 3 }, { t: "fly" }, { t: "constructor" }]) refused(t.act(0, move), "bad_move");
    for (const t2 of ["tick", "join", "leave", "host", "presence"]) refused(t.act(0, { t: t2, seat: 1 }), "not_system");
    refused(t.act(SYSTEM, { t: "begin" }), "bad_move");
  });

  it("the setup step: only the host, only known choices, a real pick, and the table's limit", () => {
    const t = new Table([0, 1, 2], { host: 0 });
    refused(t.act(1, { t: "choose", pack: "actors" }), "not_host");
    refused(t.act(1, { t: "pick", seats: [1, 2] }), "not_host");
    refused(t.act(1, { t: "begin" }), "not_host");
    refused(t.act(0, { t: "choose", pack: "nope" }), "bad_option");
    refused(t.act(0, { t: "choose", host: 1 }), "bad_option");
    refused(t.act(0, { t: "pick", seats: [1, 1] }), "bad_pick");
    refused(t.act(0, { t: "ask", text: "Am I?" }), "not_now");
    refused(t.act(0, { t: "next" }), "not_now");
    refused(t.act(SYSTEM, { t: "host", seat: 7 }), "bad_host");
    refused(t.act(SYSTEM, { t: "leave", seat: 7 }), "not_playing");
    refused(t.act(SYSTEM, { t: "join", seat: "x" }), "bad_move");
    refused(t.act(SYSTEM, { t: "join", seat: 2 }), "already_in_game");
    const full = new Table([0, 1, 2, 3, 4, 5, 6, 7]);
    refused(full.act(SYSTEM, { t: "join", seat: 8 }), "full");
    const p = playing();
    for (const move of [{ t: "choose", pack: "actors" }, { t: "pick", seats: [0, 1] }, { t: "begin" }]) refused(p.act(0, move), "not_now");
  });

  it("a turn: who may do what", () => {
    const t = playing({}, [0, 1, 2]);
    const g = t.guesser;
    const j = t.judge;
    refused(t.act(2, { t: "hint" }), "not_playing");
    refused(t.act(j, { t: "ask", text: "Am I?" }), "not_guesser");
    refused(t.act(j, { t: "hint" }), "not_guesser");
    refused(t.act(j, { t: "guess" }), "not_your_turn");
    refused(t.act(j, { t: "skip" }), "not_your_turn");
    refused(t.act(j, { t: "pass" }), "not_your_turn");
    refused(t.act(j, { t: "confirm" }), "no_guess");
    refused(t.act(j, { t: "reject" }), "no_guess");
    refused(t.act(g, { t: "selfConfirm" }), "no_guess");
    refused(t.act(g, { t: "next" }), "not_now");
    t.do(g, { t: "guess" });
    refused(t.act(g, { t: "confirm" }), "not_judge");
    refused(t.act(g, { t: "reject" }), "not_judge");
    refused(t.act(g, { t: "guess" }), "confirming");
    refused(t.act(g, { t: "hint" }), "confirming");
    refused(t.act(g, { t: "ask", text: "Am I?" }), "confirming");
    refused(t.act(g, { t: "count" }), "confirming");
    refused(t.act(g, { t: "pass" }), "confirming");
    // The judge's phone is here: they confirm it, not the guesser, however long it waits.
    refused(t.act(g, { t: "selfConfirm" }, 60_000), "judge_here");
    refused(t.act(j, { t: "selfConfirm" }), "not_guesser");
    t.presence(j, false);
    refused(t.act(g, { t: "selfConfirm" }, 1000), "too_soon");
    refused(t.act(SYSTEM, { t: "presence", seat: "x", connected: true }), "bad_move");
    refused(t.act(0, { t: "presence", seat: 0, connected: true }), "not_system");
  });

  it("questions: text, length, one a move, waiting for the answer, spoken matches, the rate limit", () => {
    const t = playing({ turnFormat: "keep_going" });
    const g = t.guesser;
    const j = t.judge;
    refused(t.act(g, { t: "ask", text: 5 }), "not_text");
    refused(t.act(g, { t: "ask" }), "not_text");
    refused(t.act(g, { t: "ask", text: " ​\t " }), "empty");
    refused(t.act(g, { t: "ask", text: "x".repeat(QUESTION_MAX_LENGTH + 1) }), "too_long");
    refused(t.act(g, { t: "ask", text: "x".repeat(QUESTION_MAX_LENGTH * 5) }), "too_long");
    t.do(g, { t: "ask", text: "x".repeat(QUESTION_MAX_LENGTH) });
    refused(t.act(g, { t: "ask", text: "Again?" }), "question_waiting");
    const id = t.turn.log[0].id;
    refused(t.act(j, { t: "answer", id: "nope", answer: "yes" }), "no_question");
    refused(t.act(j, { t: "answer", id, answer: "maybe" }), "bad_answer");
    t.do(j, { t: "answer", id, answer: "dont_know" });
    refused(t.act(j, { t: "answer", id, answer: "yes" }), "answered");
    // The rate limit: six a minute.
    for (let i = 1; i < QUESTION_RATE_LIMIT.limit; i++) {
      t.do(g, { t: "ask", text: `Question ${i}?` }, 1000);
      t.do(j, { t: "answer", id: t.turn.log.at(-1).id, answer: "no" });
    }
    refused(t.act(g, { t: "ask", text: "One more?" }, 1000), "rate_limited");
    t.do(g, { t: "ask", text: "One more?" }, QUESTION_RATE_LIMIT.windowMs);

    const trade = playing();
    // In trade turns the counter is the guesser's one question: the judge cannot use it up.
    refused(trade.act(trade.judge, { t: "count" }), "not_guesser");
    trade.do(trade.guesser, { t: "ask", text: "Am I real?" });
    trade.do(trade.judge, { t: "answer", id: trade.turn.log.at(-1).id, answer: "yes" });
    trade.do(trade.guesser, { t: "pass" });
    trade.do(trade.guesser, { t: "count" });
    refused(trade.act(trade.guesser, { t: "ask", text: "Am I?" }), "one_question");
    refused(trade.act(trade.guesser, { t: "count" }), "one_question");

    const spoken = playing({ questions: "spoken" });
    refused(spoken.act(spoken.guesser, { t: "ask", text: "Am I?" }), "spoken_only");

    const clues = playing({ mode: "describe_it" });
    refused(clues.act(clues.guesser, { t: "count" }), "ask_mode_only");
    refused(clues.act(clues.guesser, { t: "pass" }), "not_trade");
  });

  it("hints: off, and three at most", () => {
    const off = playing({ hints: false });
    refused(off.act(off.guesser, { t: "hint" }), "hints_off");
    const t = playing();
    for (let i = 0; i < 3; i++) t.do(t.guesser, { t: "hint" });
    refused(t.act(t.guesser, { t: "hint" }), "no_hints_left");
  });

  it("the reveal: only a player or the host moves it on", () => {
    const t = playing({}, [0, 1, 2]);
    t.rightGuess();
    t.do(SYSTEM, { t: "join", seat: 5 });
    refused(t.act(5, { t: "next" }), "not_playing");
    refused(t.act(t.state.players[0].seat, { t: "guess" }), "not_now");
  });

  it("after the end: everything but the clock", () => {
    const t = playing();
    t.do(SYSTEM, { t: "leave", seat: 0 });
    for (const move of [{ t: "next" }, { t: "guess" }, { t: "choose" }]) refused(t.act(1, move), "over");
    refused(t.act(SYSTEM, { t: "join", seat: 4 }), "over");
  });

  it("covers every refusal the rules can give, and a refusal changes nothing", () => {
    expect([...seen].sort()).toEqual(
      [
        "already_in_game", "answered", "ask_mode_only", "bad_answer", "bad_host", "bad_move", "bad_option", "bad_pick", "bad_seats", "bad_secret",
        "confirming", "empty", "full", "hints_off", "judge_here", "no_guess", "no_hints_left", "no_question", "not_guesser", "not_host", "not_judge",
        "not_now", "not_playing", "not_system", "not_text", "not_trade", "not_your_turn", "one_question", "over", "question_waiting",
        "rate_limited", "spoken_only", "too_long", "too_soon",
      ].sort(),
    );
    const t = playing();
    const before = JSON.stringify(t.state);
    for (const move of [{ t: "confirm" }, { t: "ask", text: 7 }, { t: "fly" }]) expect(isRefusal(apply(t.state, t.guesser, move, t.now + 5))).toBe(true);
    expect(JSON.stringify(t.state)).toBe(before);
    const moved = apply(t.state, t.guesser, { t: "hint" }, t.now + 5);
    expect(isRefusal(moved)).toBe(false);
    expect(JSON.stringify(t.state)).toBe(before);
  });
});
