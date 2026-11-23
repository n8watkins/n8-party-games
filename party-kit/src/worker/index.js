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
import { API_HEADERS, CODE_ALPHABET, CODE_LENGTH, OUTDATED_MESSAGE, allowedOrigins, currentPage, error, isCode, isJoinLink, json, originAllowed, readBody } from "./http.js";
import { MAX_TOKEN_LENGTH } from "./hello-logic.js";
import { isPin, PIN_DIRECTORY_NAME } from "./pin-logic.js";
import { allowRequest } from "./rate-limiter.js";
import { fullMessage, roomBudgetState } from "./room-budget.js";
import { MAX_RUN_BODY_BYTES, MAX_SCORE_BODY_BYTES, cleanInitials, isSeed, scoreBoard, validScore } from "./score-board.js";
import { BOT_CHECK_MESSAGE, BOT_CHECK_UNAVAILABLE_MESSAGE, botCheckEnabled, botCheckHostnames, testKeysAllowed, verifyBotCheck, warnIfNoSiteKey } from "./turnstile.js";

export { createPartyRoom } from "./room.js";
export { PinDirectory } from "./pin-directory.js";
export { RateLimiter } from "./rate-limiter.js";
export { RoomBudget } from "./room-budget.js";
export { ScoreBoard } from "./score-board.js";

export const API_PREFIX = "/api/party";
const CODE_ATTEMPTS = 8;
/**
 * The config is kept by the browser for a minute: it changes only with a deploy or a setting, and
 * a party that reloads into a new build together should not ask for it again, each request
 * counting against the zone's limit on /api/ requests from one address (site/release-switch.js).
 */
export const CONFIG_CACHE = "private, max-age=60";
/** A QR code for a text never changes: kept a day, longer than any room lasts. */
export const QR_CACHE = "public, max-age=86400, immutable";

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
 * The two POSTs that hand out a seat need the client's mark, `X-Party-Protocol: 2` (http.js).
 *
 *   POST /api/party/rooms              {nickname, as?: "player" | "screen", turnstile?}  -> {code, pin, token, seat, role}
 *   GET  /api/party/join/:pinOrCode                                                      -> {preview}
 *   POST /api/party/join/:pinOrCode    {nickname, as?}                                   -> {code, pin, token, seat, role}
 *   GET  /api/party/rooms/:code/ws[?lag=ms]                                              WebSocket; its first message is {t: "hello", token}
 *   GET  /api/party/qr.svg?text=<this site's join link>                                  a QR code as SVG
 *   GET  /api/party/config                                                               {publicOrigin, simLatency, testGames, turnstileSiteKey}
 *   GET  /api/party/scores/:game                                                         -> {top: [{name, score, at}]}
 *   POST /api/party/scores/:game       {name: "ABC", seed, ...what scoreRun reads}       -> {top, place, score}  (a game with scoreRun)
 *   POST /api/party/scores/:game       {name: "ABC", score}                              -> {top, place}  (a game without)
 *
 * `options.scores` names the games that have a score board: {max} (the most one round can score)
 * and, for a game that can play a run again, `scoreRun(run) -> score | null` (score-logic.js).
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
      // The server's test games and test switches are on (a local test server, never production):
      // a game's page may then honour its own test switches, such as a bot playing a seat.
      testGames: env.PARTY_TEST_GAMES === "on",
      // The widget only appears when the server will also check its token.
      turnstileSiteKey: botCheckEnabled(env) && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null,
    }, 200, { "Cache-Control": CONFIG_CACHE });
  }

  if (parts[0] === "qr.svg" && parts.length === 1 && method === "GET") {
    const text = url.searchParams.get("text") ?? "";
    if (!isJoinLink(text, allowedOrigins(request, env))) return error("bad_request", "Only this site's join links are drawn.");
    const svg = toSvgSource(generate(text), { on: "#1c1410", off: "#f4ead2", pad: 2, xmlDeclaration: true });
    // The same text always draws the same code, and a room's join link lasts its four hours: kept a
    // day, so a page reloading into a new build late in a party does not ask for it again.
    return new Response(svg, { headers: { ...API_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": QR_CACHE } });
  }

  // A seat is handed out only to a page that will open its socket the current way (http.js,
  // PROTOCOL). Refused before anything is counted or woken, with a line the old page shows.
  const seats = (parts[0] === "rooms" && parts.length === 1) || (parts[0] === "join" && parts.length === 2);
  if (seats && method === "POST" && !currentPage(request)) return error("page_outdated", OUTDATED_MESSAGE);

  if (parts[0] === "rooms" && parts.length === 1 && method === "POST") {
    const allowed = await Promise.all([allowRequest(env, request, "create_short"), allowRequest(env, request, "create_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many rooms from this connection. Try again later.");
    const budget = await roomBudgetState(env);
    if (budget !== "open") return error("battles_full", (options.fullMessage ?? fullMessage)(budget));
    const body = await readBody(request);
    if (!body) return error("bad_request", "Expected a small JSON body.");
    const as = body.as === "screen" ? "screen" : "player";
    if (as === "player" && !cleanName(body.nickname)) return error("bad_name", "Pick a nickname first.");
    // The bot check comes last, after every cheaper refusal, so a token is only spent on a room
    // that will be made. It fails closed: when Turnstile cannot be asked, no room is made and the
    // page says to try again (a room is what costs; nobody already in a party is affected).
    if (botCheckEnabled(env)) {
      warnIfNoSiteKey(env);
      const check = await verifyBotCheck(env, body.turnstile, {
        remoteip: request.headers.get("CF-Connecting-IP"),
        hostnames: botCheckHostnames(request, env),
        testKeys: testKeysAllowed(request, env),
        fetcher: options.siteverify,
      });
      if (check === "unavailable") return error("bot_check_unavailable", BOT_CHECK_UNAVAILABLE_MESSAGE);
      if (check !== "ok") return error("bot_check", BOT_CHECK_MESSAGE);
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
    /** The game plays a run again to score it (score-logic.js): its board takes runs, never bare scores. */
    const replays = typeof rules.scoreRun === "function";
    // Reading is cheap and the same for everyone: a browser may keep it for a little while.
    if (method === "GET") return json({ ok: true, top: await board.top() }, 200, { "Cache-Control": "public, max-age=20" });
    const allowed = await Promise.all([allowRequest(env, request, "score_short"), allowRequest(env, request, "score_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many scores from this connection. Try again later.");
    const body = await readBody(request, replays ? MAX_RUN_BODY_BYTES : MAX_SCORE_BODY_BYTES);
    if (!body) return error("bad_request", "Expected a small JSON body.");
    const name = cleanInitials(body.name);
    if (!name) return error("bad_name", "Three letters, and not those three.");
    if (replays) {
      // The game plays the run again from its seed and what its player did, and that is the score:
      // whatever score the page claims is never read. The run keeps to the game's rules; nothing
      // here can tell whether a person played it. Its seed is kept with the row, so the same run
      // sent again is turned away.
      if (!isSeed(body.seed)) return error("bad_request", "That is not a run a page could have played.");
      let score = null;
      try {
        score = rules.scoreRun(body);
      } catch {
        score = null;
      }
      if (score === null || score === undefined) return error("bad_request", "That is not a run a page could have played.");
      if (!validScore(score, rules.max)) return error("bad_request", "That run scored nothing the board can take.");
      const result = await board.submit(name, score, body.seed);
      if (result.replayed) return error("already_chalked", "That run is on the board already.");
      return json({ ok: true, score, ...result });
    }
    // A bare score comes from the browser and cannot be trusted. It can at least be possible.
    if (!validScore(body.score, rules.max)) return error("bad_request", "That is not a score a round can reach.");
    return json({ ok: true, ...(await board.submit(name, body.score)) });
  }

  if (parts[0] === "rooms" && parts.length === 3 && parts[2] === "ws" && method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("bad_request", "Expected a WebSocket upgrade.");
    if (!isCode(parts[1])) return error("not_found", "That room code is not valid.");
    // Simulated latency is a test switch: a server without it says so instead of ignoring it.
    if (url.searchParams.has("lag") && env.PARTY_SIM_LATENCY !== "on") return error("bad_request", "Simulated latency is off on this server.");
    // The seat's token is not in the address (every address is written down by the logs): it is
    // the socket's first message, read by the room. A page loaded before that still sends
    // ?token=, and the room takes it as that hello for now (hello-logic.js,
    // HONOUR_TOKEN_IN_ADDRESS). Something too long to be a token is not passed on at all.
    if ((url.searchParams.get("token") ?? "").length > MAX_TOKEN_LENGTH) return error("bad_request", "That seat token is not valid.");
    // With no token to look at, the door cannot tell whose socket this is, and every socket
    // wakes the room: one address may open only so many a minute.
    if (!(await allowRequest(env, request, "socket"))) return error("rate_limited", "Too many connections. Try again in a minute.");
    return rooms.getByName(parts[1]).fetch(request);
  }

  return error("not_found", "Unknown endpoint.");
}
