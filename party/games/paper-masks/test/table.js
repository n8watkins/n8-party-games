// A test table: drives Paper Masks the way the phones and the room would, using only each seat's
// view to decide what to tap. Not a test file itself (no ".test.js").
import { apply, create, isRefusal, SYSTEM, view } from "../rules.js";

export const T0 = 1_000_000;
const LETTERS = "abcdefghijklmnop";

export function must(x) {
  if (isRefusal(x)) throw new Error(`refused: ${x.refused} (${x.message})`);
  return x;
}

/** A distinct answer per seat and round, that tidying leaves as it is. */
export const answerFor = (seat, round) => `Answer ${LETTERS[seat]}${round} plum`;

export class Table {
  constructor(seats, options = {}, seed = 1) {
    this.now = T0;
    this.state = must(create(seats, options, seed, T0));
    this.history = [this.state];
  }

  /** Applies a move; returns the refusal or the new state (kept). */
  act(seat, move, dt = 0) {
    this.now += dt;
    const out = apply(this.state, seat, move, this.now);
    if (!isRefusal(out)) {
      this.state = out;
      this.history.push(out);
    }
    return out;
  }

  do(seat, move, dt = 0) {
    return must(this.act(seat, move, dt));
  }

  tick(dt) {
    return this.do(SYSTEM, { t: "tick" }, dt);
  }

  get r() {
    return this.state.round;
  }

  get phase() {
    return this.state.phase;
  }

  view(seat) {
    return view(this.state, seat);
  }

  /** Seats that may guess now: the round's players still here and any watchers. */
  guessers() {
    const s = this.state;
    return [...s.round.roster.filter((x) => s.players.find((p) => p.seat === x && !p.left)), ...s.watchers.map((w) => w.seat)];
  }

  /** Who really wrote a card (tests only: reads the server state). */
  authorOf(cardId) {
    return this.r.cards.find((c) => c.id === cardId).author;
  }

  /**
   * Every seat that may guess the current card and has not, guesses: `pick(seat, view, table)`
   * returns a chip, or undefined to take the first one available.
   */
  guessAll(pick = () => undefined, only = null) {
    for (const seat of only ?? this.guessers()) {
      const v = this.view(seat);
      if (!v.step.chips.length || v.step.guess !== null) continue;
      const who = pick(seat, v, this) ?? v.step.available[0];
      this.do(seat, { t: "guess", card: v.step.card.id, who });
    }
  }

  writeAll(text = answerFor, seats = null) {
    const round = this.r.n;
    for (const seat of seats ?? [...this.r.roster]) {
      if (this.phase !== "writing") break;
      if (this.state.players.find((p) => p.seat === seat)?.left) continue;
      this.do(seat, { t: "answer", text: text(seat, round) });
    }
  }

  /** Plays the current round from writing to the summary. */
  playRound({ text = answerFor, pick } = {}) {
    if (this.phase === "writing") this.writeAll(text);
    if (this.phase === "reading") this.do(this.r.reader, { t: "startGuessing" });
    while (this.phase === "guessing") {
      this.guessAll(pick);
      this.do(this.r.reader, { t: "next" });
    }
    while (this.phase === "reveal") this.do(this.r.reader, { t: "reveal" });
  }

  /** Plays to the end of the match. */
  playMatch(opts) {
    for (let i = 0; i < 64 && this.phase !== "over"; i++) {
      this.playRound(opts);
      if (this.phase === "summary") this.do(this.state.host, { t: "nextRound" });
    }
    return this.state;
  }
}

/** A guessing policy: even seats guess right when they can, odd seats take the first name left. */
export const mixedPick = (seat, v, table) => {
  if (seat % 2) return undefined;
  const truth = table.authorOf(v.step.card.id);
  return v.step.available.includes(truth) ? truth : undefined;
};

/** Everyone guesses right whenever the name is still available. */
export const oraclePick = (seat, v, table) => {
  const truth = table.authorOf(v.step.card.id);
  return v.step.available.includes(truth) ? truth : undefined;
};
