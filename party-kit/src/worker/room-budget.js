// The room budget: one Durable Object adds up how long rooms were awake and says when the
// allowance for the day or the month is spent. New rooms and new rounds ask it first.
import { DurableObject } from "cloudflare:workers";

import { addRoomTime, budgetState, limitsFromEnv, rollOver } from "./budget-logic.js";

export * from "./budget-logic.js";

export const ROOM_BUDGET_NAME = "budget";
const STORAGE_KEY = "usage";

export class RoomBudget extends DurableObject {
  /** "open", "day" or "month". */
  async state(now = Date.now()) {
    return budgetState(await this.ctx.storage.get(STORAGE_KEY), limitsFromEnv(this.env), now);
  }

  /** Records that a room was awake for `ms` (and billed `requests` requests) and returns the state afterwards. */
  async spend(ms, requests = 0, now = Date.now()) {
    const usage = addRoomTime(await this.ctx.storage.get(STORAGE_KEY), ms, now, requests);
    await this.ctx.storage.put(STORAGE_KEY, usage);
    return budgetState(usage, limitsFromEnv(this.env), now);
  }

  /** For the owner: what has been used against what is allowed, in GB-seconds. */
  async report(now = Date.now()) {
    const usage = rollOver(await this.ctx.storage.get(STORAGE_KEY), now);
    return { usage, limits: limitsFromEnv(this.env), state: budgetState(usage, limitsFromEnv(this.env), now) };
  }
}

function budget(env) {
  return limitsFromEnv(env) && env.PARTY_BUDGET ? env.PARTY_BUDGET.getByName(ROOM_BUDGET_NAME) : null;
}

/** "open", "day" or "month". Always "open" when no budget is configured. */
export async function roomBudgetState(env) {
  const stub = budget(env);
  return stub ? stub.state() : "open";
}

/** Reports room time and requests. Returns the state afterwards ("open" when no budget is configured). */
export async function spendRoomTime(env, ms, requests = 0) {
  const stub = budget(env);
  return stub ? stub.spend(ms, requests) : "open";
}

/** For the owner and the measurements: usage against the limits, or null when no budget is configured. */
export async function roomBudgetReport(env) {
  const stub = budget(env);
  return stub ? stub.report() : null;
}
