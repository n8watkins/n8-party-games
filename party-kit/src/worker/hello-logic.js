// The pure part of the socket handshake, shared by the kit's room and the party room, so it can
// be tested without the Workers runtime.
//
// A seat's token is a secret: whoever has it is that seat. An address is not a place for a
// secret, because every request's address is written down (Workers Logs, and anything else that
// sits in front of the Worker). So a socket is opened with no token anywhere in its address or
// its headers, and the page's first message names it: `{t: "hello", token}`.
//
// Until that message the room does not know whose the socket is. Such a socket has no seat,
// is sent nothing, and is closed by any first message that is not a hello. It is also not worth
// much to the room: only a handful are kept at once, and one that says nothing is let go.

/** How long a socket may stay open without saying whose it is. Looked at when something else happens in the room; nothing is timed for it. */
export const HELLO_MS = 10_000;
/**
 * How many sockets may be waiting to say whose they are at once. A whole party coming back
 * after a drop is five (four phones and the screen), each waiting for one round trip. One more
 * than this closes the one that has waited longest.
 */
export const MAX_UNKNOWN = 8;
/** A token is 24 characters (room-core.js, randomToken); nothing longer is looked up. */
export const MAX_TOKEN_LENGTH = 64;

/** The first message was not a hello. A page never does this; it is not told to forget its seat. */
export const CLOSE_HELLO_EXPECTED = 4001;
/** The token names no seat (any more), or it came in the address. The page forgets its session. */
export const CLOSE_BAD_TOKEN = 4003;
/** The socket said nothing in time, or too many were waiting. The page opens another. */
export const CLOSE_HELLO_LATE = 4009;
/** The close reason for a socket opened the old way, with the token in its address: the page is out of date. */
export const OLD_FORM_REASON = "reload";

/**
 * The token a socket's first message names: a string when the message is a hello (an empty one
 * when its token cannot be a seat's, which no seat matches), or null when it is not a hello at
 * all (not text, too long, not JSON, another message).
 */
export function readHello(data, maxBytes) {
  if (typeof data !== "string" || data.length > maxBytes) return null;
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.t !== "hello") return null;
  const token = msg.token;
  return typeof token === "string" && token.length >= 1 && token.length <= MAX_TOKEN_LENGTH ? token : "";
}

/**
 * The sockets a room has accepted that have not said whose they are. Each carries
 * `{unknown: true, at, lag}` as its attachment and no token, so a room that sleeps before the
 * hello wakes knowing the socket is still nobody's (restore).
 */
export class UnknownSockets {
  constructor() {
    /** socket -> {unknown: true, at, lag} */
    this.waiting = new Map();
  }

  get size() {
    return this.waiting.size;
  }

  has(ws) {
    return this.waiting.has(ws);
  }

  /** A socket the room has just accepted. Makes room for it first: the late ones go, and the oldest if there are still too many. */
  add(ws, now, lag = 0) {
    this.clear(now, true);
    const kept = { unknown: true, at: now, lag };
    ws.serializeAttachment(kept);
    this.waiting.set(ws, kept);
  }

  /** After a sleep: a socket whose attachment says it was still waiting. */
  restore(ws, kept) {
    this.waiting.set(ws, kept);
  }

  /** The socket has spoken, or closed: it waits no longer. Returns what it carried, or null if it was not waiting. */
  take(ws) {
    const kept = this.waiting.get(ws) ?? null;
    this.waiting.delete(ws);
    return kept;
  }

  /** Closes the sockets that said nothing in time, and with `incoming` (one more is arriving) the oldest of the rest until there is room. */
  clear(now, incoming = false) {
    for (const [ws, kept] of this.waiting) if (now - kept.at >= HELLO_MS) this.close(ws, "hello_late");
    if (!incoming || this.waiting.size < MAX_UNKNOWN) return;
    const oldestFirst = [...this.waiting].sort((a, b) => a[1].at - b[1].at);
    for (const [ws] of oldestFirst.slice(0, this.waiting.size - MAX_UNKNOWN + 1)) this.close(ws, "crowded");
  }

  close(ws, reason) {
    this.waiting.delete(ws);
    try {
      ws.close(CLOSE_HELLO_LATE, reason);
    } catch {
      // Already closed.
    }
  }

  /** The room closed every socket itself (destroy). */
  forget() {
    this.waiting.clear();
  }
}
