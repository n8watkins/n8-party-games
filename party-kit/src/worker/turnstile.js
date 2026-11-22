// The bot check on new rooms: Cloudflare Turnstile. Off unless TURNSTILE_SECRET_KEY is set.
// The browser shows the widget only when TURNSTILE_SITE_KEY is set too (GET /api/party/config).
// Joining a room by PIN never asks for it.
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Turnstile tokens are at most 2,048 characters. */
export const MAX_TOKEN_LENGTH = 2048;
/** How long siteverify has to answer before the check counts as unavailable. */
export const TIMEOUT_MS = 5000;
/** The action the page names when it renders the widget (client/bot-check.js); a token for any other is refused. */
export const BOT_CHECK_ACTION = "create-room";

/** What a refused check tells the visitor: nothing about why, and that trying again is fine. */
export const BOT_CHECK_MESSAGE = "Could not check you are a person. Try again.";
export const BOT_CHECK_UNAVAILABLE_MESSAGE = "Could not check you are a person just now. Try again in a moment.";

/**
 * Cloudflare's published test secrets (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 * They answer for the hostname "example.com" and name no action, so the hostname and action are
 * not compared when one of them is the secret: only local test servers ever use them.
 */
export const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA", // always passes
  "2x0000000000000000000000000000000AA", // always fails
  "3x0000000000000000000000000000000AA", // yields "token already spent"
]);

export function botCheckEnabled(env) {
  return typeof env.TURNSTILE_SECRET_KEY === "string" && env.TURNSTILE_SECRET_KEY.length > 0;
}

/** The hostnames a token may have been made on: this site's own, and its public address. */
export function botCheckHostnames(request, env) {
  const names = new Set([new URL(request.url).hostname]);
  if (env.PARTY_PUBLIC_ORIGIN) {
    try {
      names.add(new URL(env.PARTY_PUBLIC_ORIGIN).hostname);
    } catch {
      // A malformed setting adds nothing.
    }
  }
  return names;
}

/**
 * Checks a token with Turnstile's siteverify. Returns:
 *   "ok"          the token is good, unspent, for this action and made on one of `hostnames`;
 *   "failed"      no token, a bad or spent one (siteverify refuses a token's second use), or one
 *                 made for another action or another site;
 *   "unavailable" Turnstile could not be asked (network, timeout, its own error) or refused the
 *                 secret: the caller fails closed and says so, and the visitor can try again.
 * `fetcher` and `timeoutMs` are for the tests.
 */
export async function verifyBotCheck(env, token, { remoteip = null, hostnames = [], action = BOT_CHECK_ACTION, fetcher = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return "failed";
  const body = { secret: env.TURNSTILE_SECRET_KEY, response: token };
  if (remoteip) body.remoteip = remoteip;
  let result;
  try {
    const res = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    result = await res.json();
  } catch {
    return "unavailable";
  }
  if (!result || typeof result !== "object") return "unavailable";
  if (result.success === true) {
    if (TEST_SECRETS.has(env.TURNSTILE_SECRET_KEY)) return "ok";
    if (result.action !== action || !new Set(hostnames).has(result.hostname)) {
      // Logged without the token: a token made elsewhere is worth knowing about, never worth keeping.
      console.warn("party-kit: a bot-check token for another action or site was refused", JSON.stringify({ action: result.action ?? null, hostname: result.hostname ?? null }));
      return "failed";
    }
    return "ok";
  }
  const codes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
  // A wrong or missing secret is the owner's setup, not the visitor: log it, and refuse.
  if (codes.some((c) => c === "missing-input-secret" || c === "invalid-input-secret")) {
    console.error("party-kit: the Turnstile secret was refused; check TURNSTILE_SECRET_KEY");
    return "unavailable";
  }
  return codes.includes("internal-error") ? "unavailable" : "failed";
}
