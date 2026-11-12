// The Worker side of the party kit: the HTTP API under /api/party and the four Durable Objects.
//
//   import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, handlePartyApi } from "party-kit/src/worker/index.js";
//   export const PartyRoom = createPartyRoom(myGame);
//   export { PinDirectory, RateLimiter, RoomBudget };
//   export default { fetch: (req, env) => handlePartyApi(req, env) ?? env.ASSETS.fetch(req) };
//
// Bindings the kit expects: PARTY_ROOMS, PARTY_PINS, PARTY_LIMITER and, for a room budget,
// PARTY_BUDGET (Durable Objects). For score boards: PARTY_SCORES (export ScoreBoard too) and
// handlePartyApi(req, env, { scores: { "my-game": { max: <the most a round can score> } } }).
import { generate } from "lean-qr";
import { toSvgSource } from "lean-qr/extras/svg";
import { cleanName } from "../core/room-core.js";
import { API_HEADERS, CODE_ALPHABET, CODE_LENGTH, allowedOrigins, error, isCode, isJoinLink, json, originAllowed, readBody } from "./http.js";
import { isPin, PIN_DIRECTORY_NAME } from "./pin-logic.js";
import { allowRequest } from "./rate-limiter.js";
import { fullMessage, roomBudgetState } from "./room-budget.js";
import { MAX_SCORE_BODY_BYTES, cleanInitials, scoreBoard, validScore } from "./score-board.js";
import { botCheckEnabled, verifyBotCheck } from "./turnstile.js";

export { createPartyRoom } from "./room.js";
export { PinDirectory } from "./pin-directory.js";
export { RateLimiter } from "./rate-limiter.js";
export { RoomBudget } from "./room-budget.js";
export { ScoreBoard } from "./score-board.js";

export const API_PREFIX = "/api/party";
const CODE_ATTEMPTS = 8;

function randomCode() {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  const bytes = new Uint8Array(CODE_LENGTH * 2);
  let code = "";
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < limit && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return code;
}

/** PIN or room code -> room code, or null. Every miss looks the same to the caller. */
async function resolveRoom(env, value) {
  if (isPin(value)) return env.PARTY_PINS.getByName(PIN_DIRECTORY_NAME).resolve(value);
  const code = String(value ?? "").toUpperCase();
  return isCode(code) ? code : null;
}

/**
 * Answers every request under /api/party. Returns null for any other path, so the caller can
 * fall through to its static assets.
 *
 *   POST /api/party/rooms              {nickname, as?: "player" | "screen", turnstile?}  -> {code, pin, token, seat, role}
 *   GET  /api/party/join/:pinOrCode                                                      -> {preview}
 *   POST /api/party/join/:pinOrCode    {nickname, as?}                                   -> {code, pin, token, seat, role}
 *   GET  /api/party/rooms/:code/ws?token=...[&lag=ms]                                    WebSocket
 *   GET  /api/party/qr.svg?text=<this site's join link>                                  a QR code as SVG
 *   GET  /api/party/config                                                               {publicOrigin, simLatency, turnstileSiteKey}
 *   GET  /api/party/scores/:game                                                         -> {top: [{name, score, at}]}
 *   POST /api/party/scores/:game       {name: "ABC", score}                              -> {top, place}
 *
 * `options.scores` names the games that have a score board and the most one round can score.
 *
 * A site with a second kind of room (the party site's lobby) calls this once more with
 * `options.prefix` (its own path, "/api/lobby"), `options.rooms` (that room class's binding) and
 * `options.fullMessage` (what a spent budget reads like there). The room class answers the same
 * calls as the kit's: create, preview, join and fetch. Every guard here applies to both.
 */
export async function handlePartyApi(request, env, options = {}) {
  const url = new URL(request.url);
  const prefix = options.prefix ?? API_PREFIX;
  if (!url.pathname.startsWith(prefix + "/")) return null;
  // Pages on other sites may not use the API (or open sockets) through a visitor's browser.
  if (!originAllowed(request, env)) return error("forbidden_origin", "This page cannot use these rooms.");
  try {
    return await route(request, env, url, { ...options, prefix, rooms: options.rooms ?? env.PARTY_ROOMS });
  } catch (err) {
    console.error("party-kit: unhandled error", err instanceof Error ? err.message : "unknown");
    return error("internal", "Something went wrong.");
  }
}

async function route(request, env, url, options) {
  const parts = url.pathname.slice(options.prefix.length).split("/").filter(Boolean);
  const rooms = options.rooms;
  const method = request.method;

  if (parts[0] === "config" && parts.length === 1 && method === "GET") {
    // PARTY_PUBLIC_ORIGIN is the address phones can reach (the laptop's LAN address in local play).
    return json({
      ok: true,
      publicOrigin: env.PARTY_PUBLIC_ORIGIN || null,
      simLatency: env.PARTY_SIM_LATENCY === "on",
      // The widget only appears when the server will also check its token.
      turnstileSiteKey: botCheckEnabled(env) && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null,
    });
  }

  if (parts[0] === "qr.svg" && parts.length === 1 && method === "GET") {
    const text = url.searchParams.get("text") ?? "";
    if (!isJoinLink(text, allowedOrigins(request, env))) return error("bad_request", "Only this site's join links are drawn.");
    const svg = toSvgSource(generate(text), { on: "#1c1410", off: "#f4ead2", pad: 2, xmlDeclaration: true });
    return new Response(svg, { headers: { ...API_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
  }

  if (parts[0] === "rooms" && parts.length === 1 && method === "POST") {
    const allowed = await Promise.all([allowRequest(env, request, "create_short"), allowRequest(env, request, "create_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many rooms from this connection. Try again later.");
    const budget = await roomBudgetState(env);
    if (budget !== "open") return error("battles_full", (options.fullMessage ?? fullMessage)(budget));
    const body = await readBody(request);
    if (!body) return error("bad_request", "Expected a small JSON body.");
    const as = body.as === "screen" ? "screen" : "player";
    if (as === "player" && !cleanName(body.nickname)) return error("bad_name", "Pick a nickname first.");
    if (botCheckEnabled(env)) {
      const check = await verifyBotCheck(env, body.turnstile, request.headers.get("CF-Connecting-IP"));
      if (check === "unavailable") return error("bot_check_unavailable", "The bot check is not answering. Try again in a moment.");
      if (check !== "ok") return error("bot_check", "The bot check did not pass. Try again.");
    }
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = randomCode();
      const result = await rooms.getByName(code).create({ code, nickname: body.nickname, as });
      if (result.ok) return json(result, 201);
      if (result.error !== "exists") return error(result.error, result.message);
    }
    return error("internal", "Could not make a room. Try again.");
  }

  if (parts[0] === "join" && parts.length === 2 && (method === "GET" || method === "POST")) {
    const allowed = await Promise.all([allowRequest(env, request, "pin_short"), allowRequest(env, request, "pin_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many tries. Wait a few minutes and try again.");
    const code = await resolveRoom(env, parts[1]);
    const stub = code ? rooms.getByName(code) : null;
    if (method === "GET") {
      const preview = stub ? await stub.preview() : null;
      return preview ? json({ ok: true, preview }) : error("not_found", "No open room matches that. Check it with the host.");
    }
    if (!(await allowRequest(env, request, "join"))) return error("rate_limited", "Too many tries. Try again in a minute.");
    const body = await readBody(request);
    if (!body) return error("bad_request", "Expected a small JSON body.");
    if (!stub) return error("not_found", "No open room matches that. Check it with the host.");
    const result = await stub.join({ nickname: body.nickname, as: body.as === "screen" ? "screen" : "player" });
    return result.ok ? json(result) : error(result.error, result.message);
  }

  if (parts[0] === "scores" && parts.length === 2 && (method === "GET" || method === "POST")) {
    const rules = Object.hasOwn(options.scores ?? {}, parts[1]) ? options.scores[parts[1]] : null;
    const board = rules ? scoreBoard(env, parts[1]) : null;
    if (!board) return error("not_found", "There is no score board for that.");
    // Reading is cheap and the same for everyone: a browser may keep it for a little while.
    if (method === "GET") return json({ ok: true, top: await board.top() }, 200, { "Cache-Control": "public, max-age=20" });
    const allowed = await Promise.all([allowRequest(env, request, "score_short"), allowRequest(env, request, "score_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many scores from this connection. Try again later.");
    const body = await readBody(request, MAX_SCORE_BODY_BYTES);
    if (!body) return error("bad_request", "Expected a small JSON body.");
    const name = cleanInitials(body.name);
    if (!name) return error("bad_name", "Three letters, and not those three.");
    // The score comes from the browser and cannot be trusted. It can at least be possible.
    if (!validScore(body.score, rules.max)) return error("bad_request", "That is not a score a round can reach.");
    return json({ ok: true, ...(await board.submit(name, body.score)) });
  }

  if (parts[0] === "rooms" && parts.length === 3 && parts[2] === "ws" && method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("bad_request", "Expected a WebSocket upgrade.");
    if (!isCode(parts[1])) return error("not_found", "That room code is not valid.");
    // Simulated latency is a test switch: a server without it says so instead of ignoring it.
    if (url.searchParams.has("lag") && env.PARTY_SIM_LATENCY !== "on") return error("bad_request", "Simulated latency is off on this server.");
    if ((url.searchParams.get("token") ?? "").length > 64) return error("bad_request", "That seat token is not valid.");
    return rooms.getByName(parts[1]).fetch(request);
  }

  return error("not_found", "Unknown endpoint.");
}
