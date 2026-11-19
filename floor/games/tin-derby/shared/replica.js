// Tin Derby: a page's copy of the race. No drawing and no sockets: a page hands it what the room sends
// (snapshots and events) and its player's hands, and asks for the race as it is right now.
//
// It keeps two things:
//   the room's word   the race exactly as the room has run it, up to the last step the room said it reached.
//                     It is built only from snapshots and events, so it is the room's race bit for bit.
//   the player's own inputs the room has not answered yet.
// `predict(now)` copies the room's word, adds those inputs at the steps they were stamped for, and runs the
// copy forward to `now`. Nothing is blended or smoothed here: when the room's word arrives, the next
// prediction simply starts from it. An input that reached the room in time took effect at the very step the
// page gave it, so the prediction was already right and nothing moves; a late one moves the car by what the
// lateness was worth. Rivals are run forward from the last hands the room relayed for them.
import { BTN } from "./house.js";

export function makeReplica(rules, snapshot, { seat = null } = {}) {
  const NET = rules.T.NET;
  let auth = rules.load(snapshot);
  const mine = () => (seat === null ? null : rules.carOf(auth, seat) || null);
  const me = mine() && !mine().house ? mine().i : -1;
  /** The player's inputs the room has not answered: {q, n, st, b}. */
  let pending = [];
  let q = me < 0 ? 0 : auth.room.q[me];
  let sent = me < 0 ? [0, 0] : auth.room.sent[me].slice();
  let sentAt = -Infinity;
  /** When this page last sent anything at all (hands or a beat). */
  let saidAt = -Infinity;

  /** Forgets the inputs the room has read (it says the highest number it has read from each car). */
  function settle() {
    if (me < 0) return;
    const heard = auth.room.q[me];
    if (pending.length && pending[0].q <= heard) pending = pending.filter((p) => p.q > heard);
    // With nothing of ours in flight, what the room last took from us is what we last sent (it may have refused one).
    if (!pending.length && heard >= q) sent = auth.room.sent[me].slice();
  }

  return {
    /** The car this page drives (its index in `cars`), or -1 for a screen. */
    car: me,
    /** The race as the room has run it (do not change it). */
    get auth() { return auth; },
    get pending() { return pending.length; },

    /** A snapshot from the room (game.snapshot): the page carries on from it. An older one than what it has is ignored. */
    snapshot(s) {
      if (s.n < auth.n) return;
      auth = rules.load(s);
      settle();
    },

    /** What the room told everyone at a tick (game.tick's events), in order. Returns what happened in the steps the room's word moved on by. */
    events(list) {
      auth.ev.length = 0;
      for (const e of list) {
        if (e.k === "n") rules.advance(auth, e.n);
        else {
          rules.hear(auth, e);
          // Handed back to its player: the room holds the car straight until told otherwise, so the next input is sent whatever it is.
          if (e.k === "a" && e.c === me && !e.on) sent = [0, BTN.GO];
        }
      }
      settle();
      return auth.ev;
    },

    /**
     * The player's hands right now; call it every frame. Returns the message to send to the room
     * ({c: [at, steer, go, brake, drift, use], q}), or null when there is nothing new to say: the hands have not
     * moved, or only the steer has and the last message is less than NET.SEND_EVERY old (the room takes 20 messages
     * a second from a socket; a button is always sent at once).
     */
    input(now, steer, go, brake, drift, use, { force = false, again = false } = {}) {
      if (me < 0 || auth.over) return null;
      const msg = { c: [now, steer, go ? 1 : 0, brake ? 1 : 0, drift ? 1 : 0, use ? 1 : 0], q: q + 1 };
      const inp = rules.readInput(msg);
      // `again`: sent even if unchanged (a page taking its car back from the house, which only hands do).
      if (!again && inp.st === sent[0] && inp.b === sent[1]) return null;
      // `force`: the page is going away (hidden, closed), so the hands it lets go of are sent now, not a frame later.
      if (!force && inp.b === sent[1] && now - sentAt < NET.SEND_EVERY * 1000) return null;
      q += 1; sent = [inp.st, inp.b]; sentAt = saidAt = now;
      msg.c[1] = inp.st;
      pending.push({ q, n: rules.stepOf(auth, now) + 1, st: inp.st, b: inp.b });
      return msg;
    },

    /**
     * A sign that this page is still there ({h: 1}), when it has said nothing for NET.ALIVE_EVERY; otherwise null.
     * The room gives a car to the house when it has heard nothing at all from its page for NET.SILENT, and takes
     * none from a page that is still loading until its first word: call it once when the page is up and then
     * every frame (or on a timer) while the race runs.
     */
    beat(now) {
      if (me < 0 || auth.over) return null;
      if (now - saidAt < NET.ALIVE_EVERY * 1000) return null;
      saidAt = now;
      return { h: 1 };
    },

    /** The race at `now` on the room's clock, as near as this page can know it: a fresh copy each call, the caller's to keep or drop. */
    predict(now) {
      const p = rules.clone(auth);
      let floor = me < 0 ? 0 : p.room.lastN[me];
      for (const e of pending) {
        floor = Math.max(e.n, p.n + 1, floor);
        rules.enqueue(p, [floor, me, 1, e.st, e.b]);
      }
      rules.advance(p, rules.stepOf(p, now));
      return p;
    },
  };
}
