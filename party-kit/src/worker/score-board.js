// The score board: one small Durable Object per game holds its ten best scores (and, for a game
// that plays runs again, each row's seed, never shown: score-logic.js).
// It wakes for one read or one write and goes back to sleep: no timer, no socket, no alarm, so
// it costs nothing while nobody plays and never touches the room budget (which counts rounds).
import { DurableObject } from "cloudflare:workers";

import { addScore, shownBoard } from "./score-logic.js";

export * from "./score-logic.js";

const STORAGE_KEY = "top";

export class ScoreBoard extends DurableObject {
  /** The board, best first, as anyone may read it. */
  async top() {
    return shownBoard(await this.ctx.storage.get(STORAGE_KEY));
  }

  /**
   * Adds a score that the Worker has already checked, with the seed of the run it played again
   * (or none, for a bare score). Returns the board as anyone may read it and where the score
   * landed (-1: not on it), and `replayed: true` when that seed is on the board already.
   */
  async submit(name, score, seed, now = Date.now()) {
    const { rows, place, replayed } = addScore(await this.ctx.storage.get(STORAGE_KEY), { name, score, at: now, seed });
    // A score that does not make the board changes nothing, so nothing is written.
    if (place >= 0) await this.ctx.storage.put(STORAGE_KEY, rows);
    return { top: shownBoard(rows), place, ...(replayed && { replayed: true }) };
  }
}

/** The board of one game, or null when this Worker has no score boards. */
export function scoreBoard(env, game) {
  return env.PARTY_SCORES ? env.PARTY_SCORES.getByName(`scores:${game}`) : null;
}
