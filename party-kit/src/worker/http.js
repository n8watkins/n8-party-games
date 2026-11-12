// The pure HTTP side of the kit's API: responses, headers, body reading, origin and QR checks.
// No Workers bindings here, so it is tested directly (party-kit/test/http.test.js).
import { isPin } from "./pin-logic.js";

// No vowels and no look-alikes, so a code never spells a word and reads cleanly aloud.
export const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";
export const CODE_LENGTH = 6;
/** Room bodies are tiny; the bot-check token (up to 2,048 characters) is the largest field. */
export const MAX_BODY_BYTES = 4096;
/** The longest text the QR endpoint encodes: an origin, a short path and ?join=<PIN or code>. */
export const MAX_QR_TEXT = 200;

export const STATUS = {
  bad_request: 400,
  bad_name: 400,
  bot_check: 403,
  forbidden_origin: 403,
  not_found: 404,
  room_full: 409,
  in_progress: 409,
  too_large: 413,
  rate_limited: 429,
  internal: 500,
  battles_full: 503,
  bot_check_unavailable: 503,
};

/** Headers on every API response. The API returns JSON or an SVG image, never a page. */
export const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

export function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { ...API_HEADERS, ...extra } });
}

export function error(code, message) {
  return json({ ok: false, error: code, message }, STATUS[code] ?? 400);
}

export function isCode(value) {
  return typeof value === "string" && value.length === CODE_LENGTH && [...value].every((c) => CODE_ALPHABET.includes(c));
}

/**
 * The JSON object in a request body, or null when it is missing the mark: not JSON, not an object,
 * or over `max` bytes. The body is read in chunks and abandoned as soon as it is too long.
 */
export async function readBody(request, max = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > max) return null;
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body = text ? JSON.parse(text) : {};
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** The origins pages that use the API are served from: this request's own and the public one. */
export function allowedOrigins(request, env) {
  const set = new Set([new URL(request.url).origin]);
  if (env.PARTY_PUBLIC_ORIGIN) {
    try {
      set.add(new URL(env.PARTY_PUBLIC_ORIGIN).origin);
    } catch {
      // A malformed setting adds nothing.
    }
  }
  return set;
}

/**
 * Browsers name the page's origin on every cross-site request and on every WebSocket. A request
 * that names another site is refused, so no other page can open rooms or sockets through a
 * visitor's browser. Requests without the header (curl, the Node test scripts) carry no page.
 */
export function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(request, env).has(origin);
}

/**
 * The QR endpoint draws only this site's own join links: an allowed origin, a short plain path and
 * a single ?join=<PIN or room code>. Anything else is refused, so it is not an open QR generator.
 */
export function isJoinLink(text, origins) {
  if (typeof text !== "string" || !text || text.length > MAX_QR_TEXT) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (!origins.has(url.origin) || url.username || url.password || url.hash) return false;
  if (!/^\/[A-Za-z0-9/_-]{0,64}$/.test(url.pathname)) return false;
  const keys = [...url.searchParams.keys()];
  const join = url.searchParams.get("join") ?? "";
  return keys.length === 1 && keys[0] === "join" && (isPin(join) || isCode(join));
}
