// The Worker side of the party kit: the HTTP API under /api/party and the three Durable Objects.
//
//   import { createPartyRoom, PinDirectory, RateLimiter, handlePartyApi } from "party-kit/src/worker/index.js";
//   export const PartyRoom = createPartyRoom(myGame);
//   export { PinDirectory, RateLimiter };
//   export default { fetch: (req, env) => handlePartyApi(req, env) ?? env.ASSETS.fetch(req) };
//
// Bindings the kit expects: PARTY_ROOMS, PARTY_PINS, PARTY_LIMITER (Durable Objects).
import { generate } from "lean-qr";
import { toSvgSource } from "lean-qr/extras/svg";
import { cleanName } from "../core/room-core.js";
import { isPin, PIN_DIRECTORY_NAME } from "./pin-logic.js";
import { allowRequest } from "./rate-limiter.js";

export { createPartyRoom } from "./room.js";
export { PinDirectory } from "./pin-directory.js";
export { RateLimiter } from "./rate-limiter.js";

export const API_PREFIX = "/api/party";
// No vowels and no look-alikes, so a code never spells a word and reads cleanly aloud.
const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 8;
const MAX_BODY_BYTES = 1024;
const NO_STORE = { "Cache-Control": "no-store" };

const STATUS = { bad_request: 400, bad_name: 400, not_found: 404, room_full: 409, in_progress: 409, rate_limited: 429, internal: 500 };

function json(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(code, message) {
  return json({ ok: false, error: code, message }, STATUS[code] ?? 400);
}

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

function isCode(value) {
  return typeof value === "string" && value.length === CODE_LENGTH && [...value].every((c) => CODE_ALPHABET.includes(c));
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body = text ? JSON.parse(text) : {};
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
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
 *   POST /api/party/rooms              {nickname, as?: "player" | "screen"}  -> {code, pin, token, seat, role}
 *   GET  /api/party/join/:pinOrCode                                          -> {preview}
 *   POST /api/party/join/:pinOrCode    {nickname, as?}                       -> {code, pin, token, seat, role}
 *   GET  /api/party/rooms/:code/ws?token=...[&lag=ms]                        WebSocket
 *   GET  /api/party/qr.svg?text=...                                          a QR code as SVG
 *   GET  /api/party/config                                                   {publicOrigin, simLatency}
 */
export async function handlePartyApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(API_PREFIX + "/")) return null;
  try {
    return await route(request, env, url);
  } catch (err) {
    console.error("party-kit: unhandled error", err instanceof Error ? err.message : "unknown");
    return error("internal", "Something went wrong.");
  }
}

async function route(request, env, url) {
  const parts = url.pathname.slice(API_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;

  if (parts[0] === "config" && method === "GET") {
    // PARTY_PUBLIC_ORIGIN is the address phones can reach (the laptop's LAN address in local play).
    return json({ ok: true, publicOrigin: env.PARTY_PUBLIC_ORIGIN || null, simLatency: env.PARTY_SIM_LATENCY === "on" });
  }

  if (parts[0] === "qr.svg" && method === "GET") {
    const text = url.searchParams.get("text") ?? "";
    if (!text || text.length > 300) return error("bad_request", "Nothing to encode.");
    const svg = toSvgSource(generate(text), { on: "#1c1410", off: "#f4ead2", pad: 2, xmlDeclaration: true });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
  }

  if (parts[0] === "rooms" && parts.length === 1 && method === "POST") {
    if (!(await allowRequest(env, request, "create"))) return error("rate_limited", "Too many rooms. Try again in a minute.");
    const body = await readBody(request);
    if (!body) return error("bad_request", "Expected a small JSON body.");
    const as = body.as === "screen" ? "screen" : "player";
    if (as === "player" && !cleanName(body.nickname)) return error("bad_name", "Pick a nickname first.");
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = randomCode();
      const result = await env.PARTY_ROOMS.getByName(code).create({ code, nickname: body.nickname, as });
      if (result.ok) return json(result, 201);
      if (result.error !== "exists") return error(result.error, result.message);
    }
    return error("internal", "Could not make a room. Try again.");
  }

  if (parts[0] === "join" && parts.length === 2) {
    const allowed = await Promise.all([allowRequest(env, request, "pin_short"), allowRequest(env, request, "pin_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many tries. Wait a few minutes and try again.");
    const code = await resolveRoom(env, parts[1]);
    const stub = code ? env.PARTY_ROOMS.getByName(code) : null;
    if (method === "GET") {
      const preview = stub ? await stub.preview() : null;
      return preview ? json({ ok: true, preview }) : error("not_found", "No open room matches that. Check it with the host.");
    }
    if (method === "POST") {
      if (!(await allowRequest(env, request, "join"))) return error("rate_limited", "Too many tries. Try again in a minute.");
      const body = await readBody(request);
      if (!body) return error("bad_request", "Expected a small JSON body.");
      if (!stub) return error("not_found", "No open room matches that. Check it with the host.");
      const result = await stub.join({ nickname: body.nickname, as: body.as === "screen" ? "screen" : "player" });
      return result.ok ? json(result) : error(result.error, result.message);
    }
  }

  if (parts[0] === "rooms" && parts.length === 3 && parts[2] === "ws" && method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("bad_request", "Expected a WebSocket upgrade.");
    if (!isCode(parts[1])) return error("not_found", "That room code is not valid.");
    return env.PARTY_ROOMS.getByName(parts[1]).fetch(request);
  }

  return error("not_found", "Unknown endpoint.");
}
