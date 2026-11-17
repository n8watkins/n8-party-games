// The score board: one small Durable Object per game holds its ten best scores, and the runs it
// has handed out and not yet had back (score-logic.js, "run").
// It wakes for one read or one write and goes back to sleep: no timer, no socket, no alarm, so
// it costs nothing while nobody plays and never touches the room budget (which counts rounds).
import { DurableObject } from "cloudflare:workers";

import { RUN_PREFIX, RUN_TTL_MS, addScore, cleanBoard, isRunId, runId, runTime } from "./score-logic.js";

export * from "./score-logic.js";

const STORAGE_KEY = "top";
/** At most this many runs no longer kept are dropped each time a run is handed out. */
const DROP_AT_ONCE = 64;

function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

  /**
   * Hands out a run: {run, seed}, the seed the page plays it on. Kept until it is sent back
   * (takeRun) or for RUN_TTL_MS. Runs older than that are dropped here, oldest first: their ids
   * begin with when they were handed out, so only those are read.
   */
  async startRun(now = Date.now()) {
    const run = runId(now, randomHex());
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    await this.ctx.storage.put(RUN_PREFIX + run, { seed });
    const stale = await this.ctx.storage.list({ prefix: RUN_PREFIX, end: RUN_PREFIX + runId(now - RUN_TTL_MS, ""), limit: DROP_AT_ONCE });
    if (stale.size) await this.ctx.storage.delete([...stale.keys()]);
    return { run, seed };
  }

  /** Takes a run back, once: {seed}, or null when this board never handed it out, it was taken already, or it is too old. */
  async takeRun(run, now = Date.now()) {
    if (!isRunId(run)) return null;
    const key = RUN_PREFIX + run;
    const kept = await this.ctx.storage.get(key);
    if (!kept) return null;
    await this.ctx.storage.delete(key);
    return now - runTime(run) <= RUN_TTL_MS && Number.isInteger(kept.seed) ? { seed: kept.seed } : null;
  }
}

/** The board of one game, or null when this Worker has no score boards. */
export function scoreBoard(env, game) {
  return env.PARTY_SCORES ? env.PARTY_SCORES.getByName(`scores:${game}`) : null;
}
