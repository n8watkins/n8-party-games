// Paper Masks: every refusal, each from the move and moment that should get it.
import { describe, expect, it } from "vitest";
import { apply, create, isRefusal, SYSTEM } from "../rules.js";
import { Table } from "./table.js";

const seatsOf = (n) => Array.from({ length: n }, (_, i) => i);
const code = (x) => (isRefusal(x) ? x.refused : "applied");

/** A 4-seat table in a given phase; seat 0 hosts and reads round 1. */
function at(phase, n = 4) {
  const t = new Table(seatsOf(n), {}, 7);
  if (phase === "writing") return t;
  t.writeAll();
  if (phase === "reading") return t;
  t.do(0, { t: "startGuessing" });
  if (phase === "guessing") return t;
  while (t.phase === "guessing") {
    t.guessAll();
    t.do(0, { t: "next" });
  }
  if (phase === "reveal") return t;
  while (t.phase === "reveal") t.do(0, { t: "reveal" });
  if (phase === "summary") return t;
  t.playMatch();
  return t;
}

describe("create refuses", () => {
  it.each([
    ["bad_seats", [0, 1], {}],
    ["bad_seats", seatsOf(9), {}],
    ["bad_seats", [0, 1, 1], {}],
    ["bad_seats", [0, 1, 2.5], {}],
    ["bad_seats", [0, 1, -2], {}],
    ["bad_seats", "0,1,2", {}],
    ["bad_rounds", [0, 1, 2], { rounds: 6 }],
    ["bad_rounds", [0, 1, 2], { rounds: 4 }],
    ["bad_pack", [0, 1, 2], { pack: "nope" }],
    ["bad_option", [0, 1, 2], { colour: "red" }],
    ["bad_option", [0, 1, 2], { family: "yes" }],
    ["bad_option", [0, 1, 2], { callMode: 1 }],
    ["bad_host", [0, 1, 2], { host: 5 }],
  ])("%s for %j %j", (expected, seats, options) => {
    expect(code(create(seats, options, 1))).toBe(expected);
  });

  it("accepts every listed option", () => {
    for (const rounds of [3, 5, 7, "everyone"]) expect(isRefusal(create([0, 1, 2], { rounds }, 1))).toBe(false);
    for (const pack of ["mixed", "this-week", "explain-yourself", "tiny-confessions", "the-group", "if-we"]) {
      expect(isRefusal(create([0, 1, 2], { pack, family: true, callMode: true }, 1))).toBe(false);
    }
  });
});

describe("moves refuse", () => {
  it("bad_move and not_system", () => {
    const t = at("writing");
    expect(code(t.act(0, null))).toBe("bad_move");
    expect(code(t.act(0, {}))).toBe("bad_move");
    expect(code(t.act(0, { t: "fly" }))).toBe("bad_move");
    expect(code(t.act(0, { t: "constructor" }))).toBe("bad_move");
    expect(code(t.act(0, { t: "toString" }))).toBe("bad_move");
    expect(code(t.act(SYSTEM, { t: "answer", text: "Hi" }))).toBe("bad_move");
    expect(code(t.act(SYSTEM, { t: "join", seat: "x" }))).toBe("bad_move");
    for (const m of ["tick", "join", "leave", "host"]) expect(code(t.act(0, { t: m, seat: 9 }))).toBe("not_system");
  });

  it("over", () => {
    const t = at("over");
    expect(t.phase).toBe("over");
    expect(code(t.act(0, { t: "answer", text: "Hi" }))).toBe("over");
    expect(code(t.act(SYSTEM, { t: "join", seat: 9 }))).toBe("over");
    expect(code(t.act(SYSTEM, { t: "tick" }, 10 ** 9))).toBe("applied"); // a tick is always harmless
  });

  it("not_now: each move outside its phase", () => {
    const cases = [
      ["reading", 0, { t: "answer", text: "Late" }],
      ["writing", 0, { t: "startGuessing" }],
      ["writing", 1, { t: "guess", card: "x", who: 0 }],
      ["reading", 0, { t: "next" }],
      ["reading", 0, { t: "endStep" }],
      ["guessing", 0, { t: "reveal" }],
      ["writing", 0, { t: "revealAll" }],
      ["reveal", 0, { t: "nextRound" }],
      ["writing", 0, { t: "passReading" }],
      ["summary", 0, { t: "passReading" }],
      ["reveal", 1, { t: "askSkip", card: "x" }],
      ["reveal", 0, { t: "skip", card: "x" }],
      ["summary", 0, { t: "keep", card: "x" }],
    ];
    for (const [phase, seat, move] of cases) expect(code(at(phase).act(seat, move)), `${move.t} in ${phase}`).toBe("not_now");
  });

  it("not_playing: watchers and screens cannot write; screens and leavers cannot guess", () => {
    const t = at("writing");
    t.do(SYSTEM, { t: "join", seat: 9 });
    expect(code(t.act(9, { t: "answer", text: "Hi" }))).toBe("not_playing");
    expect(code(t.act(42, { t: "answer", text: "Hi" }))).toBe("not_playing");
    const g = at("guessing");
    const card = g.r.cards[g.r.pos].id;
    expect(code(g.act(42, { t: "guess", card, who: 1 }))).toBe("not_playing");
    expect(code(g.act(SYSTEM, { t: "leave", seat: 42 }))).toBe("not_playing");
  });

  it("not_reader: only the reader turns the reader's pages", () => {
    expect(code(at("reading").act(1, { t: "startGuessing" }))).toBe("not_reader");
    const g = at("guessing");
    g.guessAll();
    expect(code(g.act(1, { t: "next" }))).toBe("not_reader");
    expect(code(g.act(1, { t: "askSkip", card: g.r.cards[g.r.pos].id }))).toBe("not_reader");
    expect(code(at("reveal").act(2, { t: "reveal" }))).toBe("not_reader");
    expect(code(at("reveal").act(2, { t: "revealAll" }))).toBe("not_reader");
  });

  it("not_host: only the host ends steps, skips, keeps, passes the reading and starts rounds", () => {
    expect(code(at("writing").act(1, { t: "endStep" }))).toBe("not_host");
    expect(code(at("summary").act(1, { t: "nextRound" }))).toBe("not_host");
    expect(code(at("reading").act(1, { t: "passReading" }))).toBe("not_host");
    const r = at("reading");
    expect(code(r.act(1, { t: "skip", card: r.r.cards[0].id }))).toBe("not_host");
    expect(code(r.act(1, { t: "keep", card: r.r.cards[0].id }))).toBe("not_host");
  });

  it("not_text, too_long, empty", () => {
    const t = at("writing");
    expect(code(t.act(0, { t: "answer", text: 42 }))).toBe("not_text");
    expect(code(t.act(0, { t: "answer" }))).toBe("not_text");
    expect(code(t.act(0, { t: "answer", text: "a".repeat(81) }))).toBe("too_long");
    expect(code(t.act(0, { t: "answer", text: "a".repeat(5000) }))).toBe("too_long");
    expect(code(t.act(0, { t: "answer", text: "   " }))).toBe("empty");
    expect(code(t.act(0, { t: "answer", text: "?!" }))).toBe("empty");
    expect(code(t.act(0, { t: "answer", text: "\u{1F600}\u{1F389}" }))).toBe("empty");
    expect(code(t.act(0, { t: "answer", text: "a".repeat(80) }))).toBe("applied");
  });

  it("guess: not_current, own_card, not_a_choice, name_used", () => {
    const t = at("guessing");
    const card = t.r.cards[t.r.pos];
    const author = card.author;
    const guesser = [0, 1, 2, 3].find((s) => s !== author);
    expect(code(t.act(guesser, { t: "guess", card: t.r.cards[t.r.pos + 1].id, who: author }))).toBe("not_current");
    expect(code(t.act(author, { t: "guess", card: card.id, who: guesser }))).toBe("own_card");
    expect(code(t.act(guesser, { t: "guess", card: card.id, who: guesser }))).toBe("not_a_choice");
    expect(code(t.act(guesser, { t: "guess", card: card.id, who: 7 }))).toBe("not_a_choice");
    expect(code(t.act(guesser, { t: "guess", card: card.id, who: "ghost" }))).toBe("not_a_choice"); // no ghost at 4
    t.do(guesser, { t: "guess", card: card.id, who: author });
    expect(code(t.act(guesser, { t: "guess", card: card.id, who: author }))).toBe("applied"); // changing is fine
    t.guessAll();
    t.do(0, { t: "next" });
    const next = t.r.cards[t.r.pos];
    if (next.author !== guesser) {
      expect(code(t.act(guesser, { t: "guess", card: next.id, who: author }))).toBe("name_used");
    }
  });

  it("waiting_for_guesses", () => {
    const t = at("guessing");
    expect(code(t.act(0, { t: "next" }))).toBe("waiting_for_guesses");
  });

  it("no_card, not_current, use_skip, not_asked", () => {
    const r = at("reading");
    expect(code(r.act(0, { t: "skip", card: "nope" }))).toBe("no_card");
    expect(code(r.act(0, { t: "askSkip", card: r.r.cards[0].id }))).toBe("use_skip"); // the host reads round 1
    expect(code(r.act(0, { t: "keep", card: r.r.cards[0].id }))).toBe("not_asked");
    r.do(0, { t: "passReading" });
    expect(code(r.act(1, { t: "askSkip", card: "nope" }))).toBe("no_card");
    r.do(0, { t: "skip", card: r.r.cards[0].id });
    expect(code(r.act(0, { t: "skip", card: r.r.cards[0].id }))).toBe("no_card"); // already skipped
    r.do(1, { t: "startGuessing" });
    const later = r.r.cards.at(-1).id;
    expect(code(r.act(1, { t: "askSkip", card: later }))).toBe("not_current");
  });

  it("too_few_for_reveal_all", () => {
    expect(code(at("reveal").act(0, { t: "revealAll" }))).toBe("too_few_for_reveal_all");
  });

  it("join and leave: already_in_game, left; host: bad_host", () => {
    const t = at("writing");
    expect(code(t.act(SYSTEM, { t: "join", seat: 1 }))).toBe("already_in_game");
    t.do(SYSTEM, { t: "join", seat: 9 });
    expect(code(t.act(SYSTEM, { t: "join", seat: 9 }))).toBe("already_in_game");
    t.do(SYSTEM, { t: "leave", seat: 3 });
    expect(code(t.act(SYSTEM, { t: "join", seat: 3 }))).toBe("left");
    expect(code(t.act(SYSTEM, { t: "leave", seat: 3 }))).toBe("left");
    expect(code(t.act(SYSTEM, { t: "host", seat: 3 }))).toBe("bad_host");
    expect(code(t.act(SYSTEM, { t: "host", seat: 9 }))).toBe("bad_host");
    t.do(SYSTEM, { t: "leave", seat: 9 }); // a watcher may leave
    expect(t.state.watchers).toEqual([]);
  });

  it("a refusal leaves the state exactly as it was", () => {
    const t = at("guessing");
    const before = JSON.stringify(t.state);
    const out = apply(t.state, 0, { t: "next" }, t.now + 5000);
    expect(isRefusal(out)).toBe(true);
    expect(typeof out.message).toBe("string");
    expect(JSON.stringify(t.state)).toBe(before);
  });
});
