// The score board: one small Durable Object per game holds its ten best scores.
// It wakes for one read or one write and goes back to sleep: no timer, no socket, no alarm, so
// it costs nothing while nobody plays and never touches the room budget (which counts rounds).
import { DurableObject } from "cloudflare:workers";

import { addScore, cleanBoard } from "./score-logic.js";

export * from "./score-logic.js";

const STORAGE_KEY = "top";

export class ScoreBoard extends DurableObject {
  /** The board, best first. */
  async top() {
    return cleanBoard(await this.ctx.storage.get(STORAGE_KEY));
  }

  /** Adds a score that the Worker has already checked. Returns the board and where the score landed (-1: not on it). */
  async submit(name, score, now = Date.now()) {
    const { rows, place } = addScore(await this.ctx.storage.get(STORAGE_KEY), { name, score, at: now });
    // A score that does not make the board changes nothing, so nothing is written.
    if (place >= 0) await this.ctx.storage.put(STORAGE_KEY, rows);
    return { top: rows, place };
  }
}

/** The board of one game, or null when this Worker has no score boards. */
export function scoreBoard(env, game) {
  return env.PARTY_SCORES ? env.PARTY_SCORES.getByName(`scores:${game}`) : null;
}
