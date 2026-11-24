// Random matches for the property tests: every kind of move, from a seed, so a failing seed can
// be replayed. Not a test file itself (no ".test.js").
import { ANSWERS, MATCH_CHOICES, MODES, SYSTEM, TIMER_CHOICES, TURN_FORMATS } from "../rules.js";
import { PACK_IDS } from "../deck.js";
import { Table } from "./table.js";

/** Plain questions with no name in them (from the live game's suggestions). */
export const QUESTIONS = ["Am I a real person?", "Am I alive today?", "Am I fictional?", "Am I animated?", "Am I from a video game?", "Am I human?", "Am I a mascot for a product?", "Am I a hero?"];

/** The test's own generator. */
export function testRandom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickOf = (rnd, list) => list[Math.floor(rnd() * list.length)];

/**
 * Plays one match at random: the host's choices, a pick, questions, answers, hints, counts,
 * guesses, confirmations and rejections, self-confirms, passes, skips, timeouts and lapses,
 * watchers arriving and now and then a player leaving. Every state is in `table.history`.
 * Seats 0..n-1; the host is seat n-1 (so with three or more seats the host may watch).
 */
export function randomMatch(seed, nSeats = 2 + (seed % 3)) {
  const rnd = testRandom(seed * 7919 + 13);
  const seats = Array.from({ length: nSeats }, (_, i) => i);
  const host = nSeats - 1;
  const t = new Table(seats, { host }, seed);
  const tryDo = (seat, move, dt = 0) => t.act(seat, move, dt);
  if (rnd() < 0.8) {
    tryDo(host, {
      t: "choose",
      pack: pickOf(rnd, PACK_IDS),
      mode: pickOf(rnd, MODES),
      turnFormat: pickOf(rnd, TURN_FORMATS),
      timer: pickOf(rnd, TIMER_CHOICES),
      match: pickOf(rnd, MATCH_CHOICES),
      hints: rnd() < 0.8,
      questions: pickOf(rnd, ["spoken", "app", "both"]),
      difficulty: pickOf(rnd, ["easy", "medium", "hard"]),
    });
  }
  if (nSeats > 2) {
    const a = Math.floor(rnd() * nSeats);
    tryDo(host, { t: "pick", seats: [a, (a + 1 + Math.floor(rnd() * (nSeats - 1))) % nSeats] });
  }
  if (rnd() < 0.7) t.do(host, { t: "begin" }, 1000);
  else t.toDeadline();
  let late = 10;
  for (let step = 0; step < 600 && t.phase !== "over"; step++) {
    if (rnd() < 0.02 && late < 13) t.do(SYSTEM, { t: "join", seat: late++ });
    if (t.phase === "reveal") {
      if (rnd() < 0.7) t.do(pickOf(rnd, t.state.players).seat, { t: "next" }, 2000);
      else t.toDeadline();
      continue;
    }
    const g = t.guesser;
    const j = t.judge;
    const turn = t.turn;
    const pending = turn.log.find((e) => e.kind === "question" && e.answer === null);
    const x = rnd();
    if (turn.phase === "confirming") {
      if (x < 0.4) tryDo(j, { t: "confirm" }, 3000);
      else if (x < 0.75) tryDo(j, { t: "reject" }, 3000);
      else if (x < 0.85) tryDo(g, { t: "selfConfirm" }, 31_000);
      else t.toDeadline();
    } else if (pending && x < 0.6) tryDo(j, { t: "answer", id: pending.id, answer: pickOf(rnd, ANSWERS) }, 2000);
    else if (x < 0.35) tryDo(g, { t: "ask", text: pickOf(rnd, QUESTIONS) }, 2000);
    else if (x < 0.45) tryDo(g, { t: "hint" }, 1000);
    else if (x < 0.5) tryDo(pickOf(rnd, [g, j]), { t: "count" }, 1000);
    else if (x < 0.62) tryDo(g, { t: "guess" }, 1000);
    else if (x < 0.72) tryDo(g, { t: "pass" }, 1000);
    else if (x < 0.76) tryDo(g, { t: "skip" }, 1000);
    else if (x < 0.8 && rnd() < 0.05) t.do(SYSTEM, { t: "leave", seat: pickOf(rnd, [g, j]) });
    else t.toDeadline();
  }
  return t;
}
