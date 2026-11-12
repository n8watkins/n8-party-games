// A party-room client for the Node test scripts: plain fetch and WebSocket, no browser.
// It keeps track of the one thing a client must: where the room last put its own piece.
import { POSITION_SLACK } from "../shared/world.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The room API at `base` ("http://localhost:8791"): {api, call, connect}. */
export function partyApi(base) {
  const api = base + "/api/lobby";

  async function call(method, path, body) {
    const res = await fetch(api + path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  }

  /** Opens a socket for a session ({code, token, seat}) and returns a small client around it. */
  function connect(session) {
    const url = new URL(api + "/rooms/" + session.code + "/ws", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", session.token);
    const ws = new WebSocket(url);
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
      opened: new Promise((r) => (ws.onopen = r)),
      closed: new Promise((r) => (ws.onclose = (e) => r({ code: e.code, reason: e.reason }))),
      /** Says where the piece is, standing still, in steps the room believes. */
      goto(x) {
        while (Math.abs(x - c.x) > POSITION_SLACK - 20) {
          c.x += Math.sign(x - c.x) * (POSITION_SLACK - 20);
          c.send({ t: "m", x: c.x, d: 0, r: c.rev });
        }
        c.x = x;
        c.send({ t: "m", x, d: 0, r: c.rev });
      },
      /** Called whenever the room moves this client's piece itself (a spawn, a bump, a correction). */
      onPlaced: null,
    };
    const placed = (x, rev) => {
      [c.x, c.rev] = [x, rev];
      c.onPlaced?.(x, rev);
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
      if ((msg.t === "b" && msg.to === c.seat) || msg.t === "fix") placed(msg.x, msg.rev);
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
