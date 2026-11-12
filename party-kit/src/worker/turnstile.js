// The bot check on new rooms: Cloudflare Turnstile. Off unless TURNSTILE_SECRET_KEY is set.
// The browser shows the widget only when TURNSTILE_SITE_KEY is set (GET /api/party/config).
// Joining a room by PIN never asks for it.
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Turnstile tokens are at most 2,048 characters. */
export const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

export function botCheckEnabled(env) {
  return typeof env.TURNSTILE_SECRET_KEY === "string" && env.TURNSTILE_SECRET_KEY.length > 0;
}

/**
 * Checks a token with Turnstile. Returns "ok", "failed" (no token, a bad token or a spent one) or
 * "unavailable" (Turnstile could not be reached: fail closed, the caller answers 503).
 * `fetcher` is injectable for tests.
 */
export async function verifyBotCheck(env, token, remoteip, fetcher = fetch) {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return "failed";
  const body = { secret: env.TURNSTILE_SECRET_KEY, response: token };
  if (remoteip) body.remoteip = remoteip;
  let result;
  try {
    const res = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    result = await res.json();
  } catch {
    return "unavailable";
  }
  if (result && result.success === true) return "ok";
  const codes = Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [];
  // A wrong or missing secret is the owner's setup, not the visitor: log it, and refuse.
  if (codes.some((c) => c === "missing-input-secret" || c === "invalid-input-secret")) {
    console.error("party-kit: the Turnstile secret was refused; check TURNSTILE_SECRET_KEY");
    return "unavailable";
  }
  return codes.includes("internal-error") ? "unavailable" : "failed";
}
