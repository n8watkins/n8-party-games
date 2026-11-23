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
// room knows which client each socket came from (the address Cloudflare puts on the request, IPv6
// by the /48: socketClient in limit-logic.js; the door's limit keeps the /64), and the sockets that wait
// are shared out by client: a client that opens more than its share pushes out only its own, and
// when the room as a whole is full the client holding the most gives way. A page alone on its
// address is never the one pushed out while anyone else holds two, and once every client holds one
// it goes only when a full room's worth of newer opens has landed inside its round trip.
//
// The client lives only on the waiting socket's attachment: it is dropped when the socket is
// seated, and no player's address is written to the room's storage.

import { socketClient } from "./limit-logic.js";

/** How long a socket may stay open without saying whose it is. Looked at when something else happens in the room; nothing is timed for it. */
export const HELLO_MS = 10_000;
/**
 * How many sockets one client (socketClient) may have waiting at once. A whole party on one home's
 * wifi coming back after a drop (four phones and the screen) is five, each waiting one round trip,
 * so they all fit; so do two phones on one carrier /48 with two tabs each (four). One more from
 * that client closes that client's socket that has waited longest.
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
 *
 * When it is removed, keep a one-line branch in both rooms' fetch that closes a `?token=` socket
 * at once with 4003 (CLOSE_BAD_TOKEN). Without it such a socket becomes an ordinary one that never
 * says hello: it is closed 4009 at the next sweep, 4009 tells an old tab to try again for ever, and
 * in a room that no longer exists nothing sweeps it at all.
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
  return readHelloFields(data, maxBytes)?.token ?? null;
}

/**
 * The hello a page loaded before the release record says nothing about its build or its protocol.
 * It speaks protocol 2 (the token as the first message, http.js PROTOCOL), the only one there was.
 */
export const LEGACY_HELLO_PROTOCOL = "2";
/** A release id (scripts/release.mjs): 12 hex digits. Anything else is no release. */
const RELEASE_ID = /^[0-9a-f]{12}$/;
/**
 * The reason a room gives when it closes a socket whose page speaks an older protocol than it does:
 * with code 4000, so a page from before this reason existed takes it as the room closing (and
 * leaves, rather than reconnecting for ever), and a newer one reloads into its seat (party-client.js).
 */
export const UPDATE_REQUIRED = "update_required";

/**
 * Everything a socket's first message says, when it is a hello: `{token, release, protocol}`, with
 * `release` the page's release id or null, and `protocol` the page's protocol (LEGACY_HELLO_PROTOCOL
 * when it does not say). Null when it is not a hello at all (as readHello).
 */
export function readHelloFields(data, maxBytes) {
  if (typeof data !== "string" || data.length > maxBytes) return null;
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.t !== "hello") return null;
  return {
    token: seatToken(msg.token),
    release: typeof msg.release === "string" && RELEASE_ID.test(msg.release) ? msg.release : null,
    protocol: typeof msg.protocol === "string" && /^[0-9]{1,4}$/.test(msg.protocol) ? msg.protocol : LEGACY_HELLO_PROTOCOL,
  };
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
  constructor() {
    /** socket -> {unknown: true, at, lag, client} */
    this.waiting = new Map();
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
   * The room is full and `client` is under its share: the clients holding the most give way (the
   * newcomer counted with its own), and of theirs the socket that has waited longest. When every
   * client holds one, that is the oldest lone socket of all, and the newcomer is let in: refusing
   * it instead would let addresses that each hold one fresh silent socket keep a real phone out.
   */
  makeRoom(client) {
    const counts = new Map([[client, 1]]);
    for (const kept of this.waiting.values()) counts.set(kept.client, (counts.get(kept.client) ?? 0) + 1);
    let most = 0;
    for (const kept of this.waiting.values()) most = Math.max(most, counts.get(kept.client));
    this.closeOldest((kept) => counts.get(kept.client) === most);
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
