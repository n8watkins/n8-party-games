// The browser side of the party kit. No build step: import it as an ES module.
//
//   const party = new PartyClient();
//   await party.create({ nickname: "Nat" });         // or party.create({ as: "screen" })
//   await party.join("4821", { nickname: "Sam" });   // by PIN (or room code)
//   party.on("room", (room) => ...)                  // lobby and presence changes
//   party.on("start", ({ room, s }) => ...)          // a round began; s is the first snapshot
//   party.on("events", (events, now) => ...)         // what the room decided
//   party.on("snapshot", (s, now) => ...)
//   party.on("end", ({ room, result }) => ...)
//   party.sendInput({ ... })                         // inputs only, never results
//   await party.sendInput({ ... }, { id: "q-7" })    // a turn-based game's answer: ok, or a PartyError
//   party.now()                                      // the room's clock, in ms
//   party.setAway(document.hidden)                   // hidden with the socket kept open: away, not dropped
//
// The session is kept in sessionStorage, so a reload or a dropped connection comes back to the
// same seat (the room holds it for 30 seconds).

const API = "/api/party";
/**
 * The mark on every request this client makes to the room API: it says the page opens its socket
 * the current way, with the seat's token as the first message. The Worker hands a seat only to a
 * request that carries it (party-kit/src/worker/http.js holds the same two values).
 */
export const PROTOCOL_HEADER = "X-Party-Protocol";
export const PROTOCOL = "2";
const STORE_KEY = "party-kit:session";
// Pings keep the two clocks in step. That matters during a round; in the lobby a slow ping is
// enough, and it lets the room sleep.
const PING_EVERY_MS = 2000;
const IDLE_PING_EVERY_MS = 10_000;
/** How long sendInput waits for the room to answer an input with an id. */
export const ANSWER_TIMEOUT_MS = 10_000;
/** An input id as a key: 7 and "7" are different ids, as they are to the room. */
const answerKey = (id) => `${typeof id === "number" ? "n" : "s"}:${id}`;

export class PartyClient {
  /**
   * @param {{base?: string, lag?: number, storage?: Storage | null, api?: string, quietPing?: {text: string, everyMs: number}}} [opts]
   *   lag: simulated latency in ms each way (the room must allow it: PARTY_SIM_LATENCY="on").
   *   api: the path of the room API, for a site with a second kind of room ("/api/lobby").
   *   quietPing: outside a round, send this fixed text instead of the clock ping. A room that
   *     answers it with an automatic reply is not woken by it at all.
   */
  constructor(opts = {}) {
    this.base = opts.base ?? "";
    this.api = opts.api ?? API;
    // Each kind of room keeps its own session, so a tab that visits both never mixes them up.
    this.storeKey = this.api === API ? STORE_KEY : `${STORE_KEY}:${this.api}`;
    this.quietPing = opts.quietPing ?? null;
    this.lag = opts.lag ?? 0;
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.handlers = new Map();
    this.session = null; // {code, pin, token, seat, role}
    this.room = null;
    this.you = null;
    this.ws = null;
    this.status = "idle"; // idle | connecting | open | reconnecting | closed
    this.clockOffset = 0; // room clock minus local clock
    this.rtt = 0;
    this.retry = 0;
    this.wantOpen = false;
    this.pingTimer = null;
    /** The turn-based game the clock was last set for, by a few round trips ("id/round"). */
    this.clockFor = null;
    /** Inputs sent with an id and not yet answered: key -> {promise, resolve, reject, timer} (sendInput). */
    this.answers = new Map();
    /** What makes this page's input ids its own (nextInputId): fresh on every page load. */
    this.idNonce = randomNonce();
    this.idCount = 0;
    /** The follow-up clock pings of a turn-based game (syncClock), cancelled when the connection goes. */
    this.clockTimers = [];
    /** Whether this page told the room it is hidden (setAway): said again on every new connection. */
    this.away = false;
    /** The reconnect waiting out its back-off after a drop, if any. */
    this.retryTimer = null;
  }

  /**
   * An id for `sendInput(data, {id})` that no other input of this seat has used in this game,
   * also after a reload: a random part made when the page loaded, and a count. Send the same id
   * again only to retry the same input.
   */
  nextInputId() {
    this.idCount += 1;
    return `${this.idNonce}.${this.idCount}`;
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type).delete(handler);
  }

  emit(type, ...args) {
    for (const h of this.handlers.get(type) ?? []) h(...args);
  }

  /** The room's clock in ms, estimated from pings. Timestamps on inputs use this. */
  now() {
    return Date.now() + this.clockOffset;
  }

  async request(method, path, body) {
    const res = await fetch(this.base + this.api + path, {
      method,
      headers: body ? { "Content-Type": "application/json", [PROTOCOL_HEADER]: PROTOCOL } : { [PROTOCOL_HEADER]: PROTOCOL },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Not JSON: treated as a failure below.
    }
    if (!data || !data.ok) throw new PartyError(data?.error ?? "network", data?.message ?? "Could not reach the room.");
    return data;
  }

  /**
   * Makes a room. `as: "screen"` makes this device the shared screen with no seat. `turnstile` is
   * the bot-check token, needed only when the server has one configured (see config()).
   */
  async create({ nickname = "", as = "player", turnstile } = {}) {
    const data = await this.request("POST", "/rooms", turnstile ? { nickname, as, turnstile } : { nickname, as });
    return this.adopt(data);
  }

  /** The server's settings: {publicOrigin, simLatency, turnstileSiteKey}. Fetched once. */
  config() {
    this.configPromise ??= this.request("GET", "/config").catch((err) => {
      this.configPromise = null;
      throw err;
    });
    return this.configPromise;
  }

  /** Looks a PIN up without joining: {code, game, phase, players, full}. */
  async preview(pinOrCode) {
    return (await this.request("GET", `/join/${encodeURIComponent(pinOrCode)}`)).preview;
  }

  async join(pinOrCode, { nickname = "", as = "player" } = {}) {
    const data = await this.request("POST", `/join/${encodeURIComponent(pinOrCode)}`, { nickname, as });
    return this.adopt(data);
  }

  adopt(data) {
    this.session = { code: data.code, pin: data.pin, token: data.token, seat: data.seat, role: data.role };
    this.storage?.setItem(this.storeKey, JSON.stringify(this.session));
    this.connect();
    return this.session;
  }

  /** Picks up the session left by an earlier page load, if any. Returns true when one was found. */
  resume() {
    try {
      const saved = JSON.parse(this.storage?.getItem(this.storeKey) ?? "null");
      if (!saved?.token) return false;
      this.session = saved;
      this.connect();
      return true;
    } catch {
      return false;
    }
  }

  connect() {
    if (!this.session) return;
    // One socket at a time: a reconnect still waiting out its back-off is this one.
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.wantOpen = true;
    this.setStatus(this.retry ? "reconnecting" : "connecting");
    const origin = this.base || location.origin;
    const url = new URL(`${this.api}/rooms/${this.session.code}/ws`, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    // The seat's token is never part of the address: addresses are written down by the server's
    // logs, and whoever reads the token there could take the seat. It is the first message.
    if (this.lag) url.searchParams.set("lag", String(this.lag));
    const { token } = this.session;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      // A socket this page has already given up on says nothing: it is not ours to seat.
      if (this.ws !== ws) return;
      this.heardAt = Date.now();
      // The hello comes before anything else: until the room has read it, this socket has no
      // seat, is sent nothing, and is closed by any other first message.
      ws.send(JSON.stringify({ t: "hello", token }));
      // A new socket is a page that is showing, to the room: one that is hidden says so first.
      if (this.away) this.send({ t: "away" });
      this.setStatus("open");
      this.pingPace = 0;
      this.clockFor = null;
      this.setPingPace(this.pingPaceFor(this.room));
    };
    ws.onmessage = (event) => {
      // When the room was last heard from, the automatic keep-alive reply included: a page can
      // tell a connection that has quietly died from one that is merely quiet.
      this.heardAt = Date.now();
      this.onMessage(event.data);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.stopClockPings();
      this.ws = null;
      // An answer cannot come on a closed socket: whoever waits may send the same id again once it is back.
      this.dropAnswers();
      // 4000: the room closed. 4003: the seat is no longer ours (the grace ran out, it was given
      // up, or the room does not know the token). Anything else is a drop, and the socket is
      // opened again: the signal went, or the room let go of a socket that had not said hello yet
      // (4009: too many were waiting, or the hello came too late).
      if (event.code === 4000 || event.code === 4003 || !this.wantOpen) {
        // Final: nothing opens a socket for this session again, not a back-off still pending and
        // not the page being shown again (setAway).
        this.wantOpen = false;
        this.forget();
        this.setStatus("closed");
        // The second word is the room's own reason for closing the socket, when it gave one.
        this.emit("closed", event.code === 4003 ? "seat_lost" : "room_closed", event.reason || "");
        return;
      }
      this.retry += 1;
      this.setStatus("reconnecting");
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          if (this.wantOpen) this.connect();
        },
        Math.min(4000, 250 * 2 ** Math.min(this.retry, 4)),
      );
    };
  }

  /**
   * Tells the room this page is hidden (`true`: a locked phone, another app) or showing again
   * (`false`) while its socket stays open: the seat is away, not dropped, and a turn-based game
   * hears it through `game.presence`. Remembered, and said again on a new connection. Shown again
   * with the connection lost (it died while the page was hidden), it reconnects at once instead
   * of waiting out the back-off. Returns whether it was said to the room now.
   */
  setAway(away) {
    const was = this.away;
    this.away = !!away;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (was !== this.away) this.send({ t: this.away ? "away" : "back" });
      return was !== this.away;
    }
    if (!this.away && this.wantOpen && !this.ws && this.session) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.connect();
    }
    return false;
  }

  onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg.t) {
      case "hello":
        // The room read our hello and seated this socket. Only now does the reconnect back-off
        // start over: a socket that opens and is closed before this keeps backing off.
        this.retry = 0;
        this.you = msg.you;
        this.setRoom(msg.room);
        break;
      case "room":
        this.setRoom(msg.room);
        break;
      case "pong": {
        const t1 = Date.now();
        const rtt = t1 - msg.c;
        // The quickest round trip has the least error: a quicker one than any lately replaces the
        // estimate outright (a round that starts while the page is busy loading can make the first
        // round trip slow and the estimate off by a second); one nearly as quick nudges it.
        const offset = msg.s + rtt / 2 - t1;
        if (!this.rtt || rtt < this.rtt) this.clockOffset = offset;
        else if (rtt <= this.rtt * 1.5) this.clockOffset = this.clockOffset * 0.7 + offset * 0.3;
        this.rtt = this.rtt ? Math.min(this.rtt * 1.05, rtt) : rtt;
        break;
      }
      case "start":
        this.setRoom(msg.room);
        this.emit("start", msg);
        break;
      case "ev":
        this.emit("events", msg.ev, msg.now);
        break;
      case "snap":
        this.emit("snapshot", msg.s, msg.now, !!msg.full);
        break;
      case "end":
        this.setRoom(msg.room);
        this.emit("end", msg);
        break;
      case "ack":
        this.settleAnswer(answerKey(msg.id), { ok: true, id: msg.id });
        break;
      case "error":
        // An error with an id answers that input (sendInput); one nobody waits for any more (it
        // timed out, or the page reloaded) is the page's to hear, on the error event.
        if (msg.id !== undefined && msg.id !== null) {
          const err = new PartyError(msg.error, msg.message, msg.id);
          if (!this.settleAnswer(answerKey(msg.id), err)) this.emit("error", err);
        } else this.emit("error", new PartyError(msg.error, msg.message));
        break;
      default:
        // Anything else belongs to whoever built on the kit (the party site's lobby).
        this.emit("message", msg);
        break;
    }
  }

  pingPaceFor(room) {
    if (ticking(room)) return PING_EVERY_MS;
    return this.quietPing?.everyMs ?? IDLE_PING_EVERY_MS;
  }

  /**
   * A turn-based game (`room.game.turns`) keeps the quiet pace, so a match of people talking does
   * not wake the room every two seconds; the clock is set by a few round trips when it begins
   * and after every reconnect, which is all a turn timer needs.
   */
  syncClock(room) {
    if (room?.phase !== "playing" || !room.game?.turns) return;
    const key = `${room.game.id}/${room.game.round}`;
    if (this.clockFor === key) return;
    this.clockFor = key;
    this.stopClockPings();
    this.send({ t: "ping", c: Date.now() });
    for (const after of [300, 1000]) this.clockTimers.push(setTimeout(() => this.clockFor === key && this.send({ t: "ping", c: Date.now() }), after));
  }

  /** The follow-up clock pings belong to one connection: a new one sends its own. */
  stopClockPings() {
    for (const timer of this.clockTimers) clearTimeout(timer);
    this.clockTimers = [];
  }

  setPingPace(ms) {
    if (this.pingPace === ms) return;
    this.pingPace = ms;
    clearInterval(this.pingTimer);
    this.ping();
    // A round is starting: a few quick round trips straight away, so the clock is right from its first second.
    if (ms === PING_EVERY_MS) for (const after of [250, 600, 1000]) setTimeout(() => this.pingPace === PING_EVERY_MS && this.ping(), after);
    this.pingTimer = setInterval(() => this.ping(), ms);
  }

  setRoom(room) {
    this.room = room;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.setPingPace(this.pingPaceFor(room));
      this.syncClock(room);
    }
    if (this.session && room.pin && room.pin !== this.session.pin) this.session.pin = room.pin;
    this.emit("room", room);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  ping() {
    if (this.quietPing && !ticking(this.room)) {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(this.quietPing.text);
      return;
    }
    this.send({ t: "ping", c: Date.now() });
  }

  /**
   * Inputs only. The room decides what they did.
   *
   * With no id it is fire and forget, as every ticking game uses it: true when it was sent.
   * With `{id}` (a string of up to 64 characters or an integer, unique on this page) it returns a
   * promise for the room's answer from a turn-based game: it resolves with `{ok: true, id}` when
   * the input was applied, and rejects with a PartyError (`code` the game's error, or "timeout",
   * "disconnected", "not_connected") when it was not. The fresh snapshot comes before the answer.
   * The same id sent again (after a reconnect, or a second tap) is never applied twice: the room
   * answers it the way it did the first time. In a ticking game nothing is answered, so the input
   * goes without its id and the promise resolves at once with `{ok: true, id, answered: false}`.
   */
  sendInput(data, { id = null, timeoutMs = ANSWER_TIMEOUT_MS } = {}) {
    if (id === null || id === undefined) return this.send({ t: "in", d: data });
    if (!(typeof id === "string" ? id.length >= 1 && id.length <= 64 : Number.isSafeInteger(id))) {
      return Promise.reject(new PartyError("bad_id", "An input id is a string of up to 64 characters, or a whole number."));
    }
    if (ticking(this.room)) {
      return this.send({ t: "in", d: data }) ? Promise.resolve({ ok: true, id, answered: false }) : Promise.reject(new PartyError("not_connected", "Not connected to the room."));
    }
    const key = answerKey(id);
    let waiting = this.answers.get(key);
    if (!waiting) {
      waiting = {};
      waiting.promise = new Promise((resolve, reject) => Object.assign(waiting, { resolve, reject }));
      this.answers.set(key, waiting);
    }
    clearTimeout(waiting.timer);
    waiting.timer = setTimeout(() => this.settleAnswer(key, new PartyError("timeout", "The room did not answer in time.")), timeoutMs);
    if (!this.send({ t: "in", d: data, id })) this.settleAnswer(key, new PartyError("not_connected", "Not connected to the room."));
    return waiting.promise;
  }

  /** Every input still waiting for an answer is rejected: the connection it went on is gone. */
  dropAnswers() {
    for (const key of [...this.answers.keys()]) this.settleAnswer(key, new PartyError("disconnected", "The connection to the room dropped before it answered."));
  }

  /** Resolves (with a result) or rejects (with a PartyError) the promise waiting on an input's answer. */
  settleAnswer(key, outcome) {
    const waiting = this.answers.get(key);
    if (!waiting) return false;
    this.answers.delete(key);
    clearTimeout(waiting.timer);
    if (outcome instanceof Error) waiting.reject(outcome);
    else waiting.resolve(outcome);
    return true;
  }
  setReady(ready) {
    return this.send({ t: "ready", v: !!ready });
  }
  rename(nickname) {
    return this.send({ t: "name", v: nickname });
  }
  setCharacter(character) {
    return this.send({ t: "character", v: character });
  }
  addBot() {
    return this.send({ t: "addBot" });
  }
  removeBot(seat) {
    return this.send({ t: "removeBot", seat });
  }
  start() {
    return this.send({ t: "start" });
  }

  /** Leaves on purpose: the seat goes to a bot (in a round) or is freed (in the lobby). */
  leave() {
    this.wantOpen = false;
    this.send({ t: "leave" });
    this.dropAnswers();
    this.forget();
    this.ws?.close();
  }

  /** Drops the connection without leaving, as a bad network would. For tests. */
  dropConnection({ reconnectAfterMs = null } = {}) {
    this.wantOpen = false;
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    this.stopClockPings();
    this.dropAnswers();
    ws?.close();
    this.setStatus("reconnecting");
    if (reconnectAfterMs !== null) setTimeout(() => this.connect(), reconnectAfterMs);
  }

  forget() {
    this.storage?.removeItem(this.storeKey);
  }

  /** The address a phone should open to join this room. */
  async joinUrl(path = location.pathname) {
    let origin = location.origin;
    try {
      const config = await this.config();
      if (config.publicOrigin) origin = config.publicOrigin;
    } catch {
      // The page's own origin will do.
    }
    return `${origin}${path}?join=${this.session?.pin ?? this.session?.code ?? ""}`;
  }

  qrUrl(text) {
    return `${this.base}${this.api}/qr.svg?text=${encodeURIComponent(text)}`;
  }
}

export class PartyError extends Error {
  /** `id`: the input this answers, for an error the room sent back for one (sendInput). */
  constructor(code, message, id = undefined) {
    super(message);
    this.code = code;
    if (id !== undefined) this.id = id;
  }
}

/** A game on the room's timer is being played: the clock pings keep their quick pace. A turn-based game is not ticked. */
function ticking(room) {
  return room?.phase === "playing" && !room.game?.turns;
}

/** Eight random letters and digits, from the secure source when there is one. */
function randomNonce() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function safeStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
