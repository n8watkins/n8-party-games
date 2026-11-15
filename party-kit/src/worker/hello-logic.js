// The pure part of the socket handshake, shared by the kit's room and the party room, so it can
// be tested without the Workers runtime.
//
// A seat's token is a secret: whoever has it is that seat. An address is not a place for a
// secret, because every request's address is written down (Workers Logs, and anything else that
// sits in front of the Worker). So a socket is opened with no token anywhere in its address or
// its headers, and the page's first message names it: `{t: "hello", token}`.
//
// Until that message the room does not know whose the socket is. Such a socket has no seat,
// is sent nothing, and is closed by any first message that is not a hello. One that says nothing
// for ten seconds is let go.
//
// Anyone who knows a room's code can open such sockets, so how many may wait must not let them
// push a real page's socket out during the one round trip it waits for its hello to arrive. The
// room knows which client each socket came from (the address Cloudflare puts on the request, keyed
// as the door's socket limit keys it: socketClient in limit-logic.js), and the sockets that wait
// are shared out by client: a client that opens more than its share pushes out only its own, and
// when the room as a whole is full the client holding the most gives way. A page alone on its
// address is never the one pushed out while anyone else holds two.
//
// On top of that the room remembers the clients it has let in (made or joined the room through
// it, or seated a socket from it: KnownClients). When it is full, a socket from a client it has
// never let in always gives way before one from a client it knows, so a phone coming back on the
// network it played on is never pushed out by strangers, however many addresses they have.

import { socketClient } from "./limit-logic.js";

/** How long a socket may stay open without saying whose it is. Looked at when something else happens in the room; nothing is timed for it. */
export const HELLO_MS = 10_000;
/**
 * How many sockets one client (socketClient) may have waiting at once. A whole party on one home's
 * wifi coming back after a drop (four phones and the screen) is five, each waiting one round trip,
 * so they all fit. One more from that client closes that client's socket that has waited longest.
 */
export const MAX_UNKNOWN_PER_CLIENT = 6;
/**
 * How many sockets may be waiting in a room at once, from every client together. A silent socket
 * sleeps with the room and costs it next to nothing, so this is well above anything real. One more
 * closes the socket that has waited longest among the clients holding the most; only when every
 * client holds one does the oldest of all go.
 */
export const MAX_UNKNOWN = 128;
/** A token is 24 characters (room-core.js, randomToken); nothing longer is looked up. */
export const MAX_TOKEN_LENGTH = 64;

/** The first message was not a hello. A page never does this; it is not told to forget its seat. */
export const CLOSE_HELLO_EXPECTED = 4001;
/** The token names no seat (any more). The page forgets its session. */
export const CLOSE_BAD_TOKEN = 4003;
/** The socket said nothing in time, or too many were waiting. The page opens another. */
export const CLOSE_HELLO_LATE = 4009;

/**
 * TO REMOVE (added 2026-11-15) in the first release deployed more than four hours after the one
 * that ships it, with the branches that read it (DEPLOY.md, "To remove after"). A page loaded before the token left
 * the address opens its socket with `?token=` and never says hello. Until it is reloaded, such a
 * socket is taken exactly as one that opened and said hello with that token at once: seated if the
 * token names a seat, closed as a wrong hello (4003 bad_token, nothing sent) if not. Every token
 * such a page can carry is from before the deploy (making or joining a room needs the client's
 * mark, http.js), was already written down by its first connect, and stays good until its room
 * ends whether or not its page reconnects; refusing it would only cost the phone its seat. Once
 * every room open at the deploy has ended (four hours at most), nothing sends it any more.
 */
export const HONOUR_TOKEN_IN_ADDRESS = true;

/** The client a socket request came from, as the waiting sockets are shared out (socketClient). */
export function clientOf(request) {
  return socketClient(request.headers.get("CF-Connecting-IP"));
}

export function closeQuietly(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

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
  return seatToken(msg.token);
}

/** A token as a seat's may be, or an empty one (which no seat matches). */
export function seatToken(token) {
  return typeof token === "string" && token.length >= 1 && token.length <= MAX_TOKEN_LENGTH ? token : "";
}

/**
 * The sockets a room has accepted that have not said whose they are. Each carries
 * `{unknown: true, at, lag, client}` as its attachment and no token, so a room that sleeps before
 * the hello wakes knowing the socket is still nobody's, and whose client it came from (restore).
 */
export class UnknownSockets {
  /** @param {(client: string) => boolean} [isKnown] whether the room has let `client` in before (KnownClients.has) */
  constructor(isKnown = () => false) {
    /** socket -> {unknown: true, at, lag, client} */
    this.waiting = new Map();
    this.isKnown = isKnown;
  }

  get size() {
    return this.waiting.size;
  }

  has(ws) {
    return this.waiting.has(ws);
  }

  /** How many sockets `client` has waiting. */
  countOf(client) {
    let n = 0;
    for (const kept of this.waiting.values()) if (kept.client === client) n += 1;
    return n;
  }

  /**
   * A socket the room has just accepted from `client` (clientOf). Makes room for it first: the
   * late ones go; then, if its client already has its share waiting, that client's oldest; else,
   * if the room is full, one socket of the clients that give way first (makeRoom).
   */
  add(ws, now, lag = 0, client = socketClient(null)) {
    this.clear(now);
    if (this.countOf(client) >= MAX_UNKNOWN_PER_CLIENT) this.closeOldest((kept) => kept.client === client);
    else if (this.waiting.size >= MAX_UNKNOWN) this.makeRoom(client);
    const kept = { unknown: true, at: now, lag, client };
    ws.serializeAttachment(kept);
    this.waiting.set(ws, kept);
  }

  /**
   * The room is full and `client` is under its share. The sockets of clients the room has never
   * let in give way first, and only when none of those is waiting do the known clients' sockets.
   * Among the ones that give way, the clients holding the most go first (the newcomer counted
   * with its own), and of those the socket that has waited longest. When every client holds one,
   * that is the oldest socket of all.
   */
  makeRoom(client) {
    let pool = [...this.waiting.values()].filter((kept) => !this.isKnown(kept.client));
    if (!pool.length) pool = [...this.waiting.values()];
    const counts = new Map([[client, 1]]);
    for (const kept of pool) counts.set(kept.client, (counts.get(kept.client) ?? 0) + 1);
    let most = 0;
    for (const kept of pool) most = Math.max(most, counts.get(kept.client));
    const inPool = new Set(pool);
    this.closeOldest((kept) => inPool.has(kept) && counts.get(kept.client) === most);
  }

  /** Closes the socket that has waited longest among those `which` picks (none if it picks none). */
  closeOldest(which) {
    let oldest = null;
    for (const [ws, kept] of this.waiting) if (which(kept) && (!oldest || kept.at < oldest[1].at)) oldest = [ws, kept];
    if (oldest) this.close(oldest[0], "crowded");
  }

  /** After a sleep: a socket whose attachment says it was still waiting (one from before clients were kept counts as the local one). */
  restore(ws, kept) {
    this.waiting.set(ws, { ...kept, client: kept.client ?? socketClient(null) });
  }

  /** The socket has spoken, or closed: it waits no longer. Returns what it carried, or null if it was not waiting. */
  take(ws) {
    const kept = this.waiting.get(ws) ?? null;
    this.waiting.delete(ws);
    return kept;
  }

  /** Closes the sockets that said nothing in time. */
  clear(now) {
    for (const [ws, kept] of this.waiting) if (now - kept.at >= HELLO_MS) this.close(ws, "hello_late");
  }

  close(ws, reason) {
    this.waiting.delete(ws);
    closeQuietly(ws, CLOSE_HELLO_LATE, reason);
  }

  /** The room closed every socket itself (destroy). */
  forget() {
    this.waiting.clear();
  }
}

/** How many clients a room remembers having let in. Once full it takes no more, so nobody can push the real ones out of it. */
export const MAX_KNOWN_CLIENTS = 64;

/**
 * The clients (socketClient) a room has let in: it was made or joined through them, or it seated a
 * socket from them. The room saves the list with itself (`list`), as it must outlive a sleep and a
 * restart: after a deploy resets a busy room, every phone comes back at once.
 */
export class KnownClients {
  constructor(list = []) {
    this.clients = new Set(Array.isArray(list) ? list.slice(0, MAX_KNOWN_CLIENTS) : []);
  }

  has(client) {
    return this.clients.has(client);
  }

  /** Remembers `client`. Returns true when that changed the list (the room then saves it). */
  add(client) {
    if (typeof client !== "string" || !client || this.clients.has(client) || this.clients.size >= MAX_KNOWN_CLIENTS) return false;
    this.clients.add(client);
    return true;
  }

  list() {
    return [...this.clients];
  }
}
