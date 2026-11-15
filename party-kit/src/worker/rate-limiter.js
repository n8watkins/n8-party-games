// Fixed-window rate limiter, one Durable Object per (bucket, client IP).
// Lifted from Who Am I (src/worker/rate-limiter.ts). It slows down PIN guessing and room creation.
import { DurableObject } from "cloudflare:workers";

import { RATE_LIMITS, clientKey, nextWindow, socketClient } from "./limit-logic.js";

export * from "./limit-logic.js";

export class RateLimiter extends DurableObject {
  /** Records one attempt. Returns false when the caller is over the limit. */
  async hit(rule, now = Date.now()) {
    const current = (await this.ctx.storage.get("window")) ?? { start: now, count: 0 };
    const window = nextWindow(current, rule, now);
    await this.ctx.storage.put("window", window);
    await this.ctx.storage.setAlarm(window.start + rule.windowMs * 2);
    return window.count <= rule.limit;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

/** True when the request may go ahead. With PARTY_RATE_LIMIT="off" (local tests) it always may. */
export async function allowRequest(env, request, bucket) {
  if (env.PARTY_RATE_LIMIT === "off") return true;
  const from = request.headers.get("CF-Connecting-IP");
  // Opening a room's socket is counted by the /48, as the room shares out its waiting sockets.
  const ip = bucket === "socket" ? socketClient(from) : clientKey(from ?? "local");
  return env.PARTY_LIMITER.getByName(`${bucket}:${ip}`).hit(RATE_LIMITS[bucket]);
}
