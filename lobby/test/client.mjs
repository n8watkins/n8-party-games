// A party-room client for the Node test scripts: plain fetch and WebSocket, no browser.
// It keeps track of the one thing a client must: where the room last put its own piece.
import { POSITION_SLACK } from "../shared/world.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The room API at `base` ("http://localhost:8791"): {api, call, connect}. */
export function partyApi(base) {
  const api = base + "/api/lobby";

  async function call(method, path, body) {
    // The mark the kit's client puts on its requests (party-client.js, PROTOCOL): a request to
    // make or join a room without it is taken for a page loaded before the handshake changed.
    const res = await fetch(api + path, { method, headers: body ? { "Content-Type": "application/json", "X-Party-Protocol": "2" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  }

  /**
   * Opens a socket for a session ({code, token, seat}) and returns a small client around it. It
   * sends the keep-alive every ten seconds, as a page does (the room lets a socket silent for 25
   * seconds go), unless `keepAlive: false` (a phone that loses its signal without a word).
   *
   * The seat's token is never in the address: it is the socket's first message, sent the moment
   * the socket opens, as the page's client does. `hello: false` opens the socket and says nothing
   * (the room does not know whose it is), and `oldForm: true` puts the token in the address the
   * way pages did before (taken as that hello, for now). `from` is the address the socket comes
   * from, as Cloudflare would put it on the request (the local runtime passes it through).
   */
  function connect(session, { keepAlive = true, hello = true, oldForm = false, from = null } = {}) {
    const url = new URL(api + "/rooms/" + session.code + "/ws", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (oldForm) url.searchParams.set("token", session.token);
    const ws = from ? new WebSocket(url, { headers: { "CF-Connecting-IP": from } }) : new WebSocket(url);
    // An old page sends the keep-alive too; a socket that says nothing does not.
    const alive = keepAlive && (hello || oldForm) ? setInterval(() => ws.readyState === 1 && ws.send("ping"), 10_000) : null;
    alive?.unref?.();
    const seen = [];
    const raw = [];
    const waiters = [];
    const c = {
      ws,
      seen,
      raw,
      sent: 0,
      seat: session.seat,
      room: null,
      x: 0,
      rev: 0,
      send(m) {
        if (ws.readyState !== 1) return;
        c.sent += 1;
        ws.send(typeof m === "string" ? m : JSON.stringify(m));
      },
      /** Resolves with the first message from index `since` on that passes `test`. */
      wait: (test, ms = 8000, since = seen.length) =>
        new Promise((resolve, reject) => {
          const old = seen.slice(since).find(test);
          if (old) return resolve(old);
          const w = { test, resolve };
          waiters.push(w);
          setTimeout(() => reject(new Error("timed out waiting")), ms);
        }),
      opened: new Promise((resolve) => {
        ws.onopen = () => {
          if (hello && !oldForm) ws.send(JSON.stringify({ t: "hello", token: session.token }));
          resolve();
        };
      }),
      closed: new Promise((r) => (ws.onclose = (e) => (clearInterval(alive), r({ code: e.code, reason: e.reason })))),
      /** Says where the piece is, standing still, in steps the room believes. */
      goto(x) {
        while (Math.abs(x - c.x) > POSITION_SLACK - 20) {
          c.x += Math.sign(x - c.x) * (POSITION_SLACK - 20);
          c.send({ t: "m", x: c.x, d: 0, r: c.rev });
        }
        c.x = x;
        c.send({ t: "m", x, d: 0, r: c.rev });
      },
      /**
       * Called whenever the room moves this client's piece itself (a spawn, a bump, a correction).
       * The third argument is true when it was knocked there by a bump.
       */
      onPlaced: null,
    };
    const placed = (x, rev, knocked = false) => {
      [c.x, c.rev] = [x, rev];
      c.onPlaced?.(x, rev, knocked);
    };
    ws.onmessage = (event) => {
      if (event.data === "pong") return void raw.push(event.data);
      const msg = JSON.parse(event.data);
      msg.at = Date.now();
      if (msg.room) {
        c.room = msg.room;
        const me = msg.room.members[c.seat];
        if (me && (me.rev !== c.rev || c.x === 0)) placed(me.x, me.rev);
      }
      if (msg.t === "vote" && c.room) c.room.vote = msg.vote;
      if ((msg.t === "b" && msg.to === c.seat) || msg.t === "fix") placed(msg.x, msg.rev, msg.t === "b");
      seen.push(msg);
      for (const w of [...waiters]) {
        if (w.test(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    };
    return c;
  }

  return { api, call, connect };
}
