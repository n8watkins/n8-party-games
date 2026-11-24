// A test table: drives Who Am I? the way the phones and the room would. Not a test file itself
// (no ".test.js"). `secretOf` reads the server state, for tests only.
import { apply, create, isRefusal, nextDeadline, SYSTEM, view } from "../rules.js";
import { getIdentity } from "../deck.js";
import { sha256 } from "n8-party-games/table/draws";

export const T0 = 1_000_000;

export function must(x) {
  if (isRefusal(x)) throw new Error(`refused: ${x.refused} (${x.message})`);
  return x;
}

/** A match secret made from a test's number, so a test repeats (the room's adapter draws a real one). */
export function testSecret(n) {
  return Array.from(sha256(new TextEncoder().encode(`who-am-i test secret ${n}`)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class Table {
  /** `seed` picks the test's secret (testSecret); the room's seed given to `create` is a fixed 1. */
  constructor(seats = [0, 1], options = {}, seed = 1) {
    this.now = T0;
    this.state = must(create(seats, options, 1, T0, { secret: testSecret(seed) }));
    this.history = [this.state];
  }

  /** The room says a seat's phone came, went, hid or showed its page. */
  presence(seat, connected, away = false, dt = 0) {
    return this.do(SYSTEM, { t: "presence", seat, connected, away }, dt);
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

  /** Moves the clock to the next deadline and ticks there. */
  toDeadline() {
    const due = nextDeadline(this.state);
    if (due === null) throw new Error("no deadline");
    this.now = Math.max(this.now, due);
    return this.do(SYSTEM, { t: "tick" });
  }

  get phase() {
    return this.state.phase;
  }

  get turn() {
    return this.state.turn;
  }

  get guesser() {
    return this.state.turn?.seat ?? null;
  }

  get judge() {
    return this.state.round.order.find((s) => s !== this.guesser);
  }

  view(seat) {
    return view(this.state, seat);
  }

  /** The name a seat must guess this round (tests only). */
  secretOf(seat) {
    return getIdentity(this.state.round.assign[String(seat)]);
  }

  begin() {
    return this.do(this.state.host, { t: "begin" });
  }

  /** The guesser says a name; the other player confirms it. */
  rightGuess(dt = 1000) {
    const g = this.guesser;
    this.do(g, { t: "guess" }, dt);
    this.do(this.judge, { t: "confirm" }, dt);
    return g;
  }

  /**
   * Plays the current round: `script(table)` is called while the round is on and must make at
   * least one move; by default the guesser guesses right at once.
   */
  playRound(script = (t) => t.rightGuess()) {
    for (let i = 0; i < 200 && this.phase === "playing"; i++) script(this);
    if (this.phase === "playing") throw new Error("round did not end");
  }

  /** Plays to the end of the match, tapping Next after each reveal. */
  playMatch(script) {
    if (this.phase === "setup") this.begin();
    for (let i = 0; i < 64 && this.phase !== "over"; i++) {
      if (this.phase === "playing") this.playRound(script);
      if (this.phase === "reveal") this.do(this.state.players.find((p) => !p.left).seat, { t: "next" }, 500);
    }
    return this.state;
  }
}
