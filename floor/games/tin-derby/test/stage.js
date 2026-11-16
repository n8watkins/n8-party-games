// A stage for the rule tests: a race with the clock set where the test wants it, cars put exactly where it
// wants them, the rest parked off the table, and the steps run one by one with everything that happened kept.
import { BTN, DT, rules as RULES } from "../shared/rules.js";

export { BTN, DT };
export const GO = BTN.GO;

/**
 * `tau` is the race's own clock in seconds (the count-in is its first three): the default is one second into
 * the race, well before the live kitchen arms. `park: false` leaves the other three cars on the grid.
 */
export function stage({ rules = RULES, seed = 9, character = "pawn", tau = rules.T.COUNT_IN + 1, seats = null, park = true, cherryN = 99 } = {}) {
  const T = rules.T, { trackAt, groundAt, locate } = rules.course;
  const st = rules.createRace({ seed, seats: seats || [{ seat: 0, name: "You", character }], now: 0, delay: 0 });
  st.n = Math.round(tau / DT); st.t = st.n * DT - T.COUNT_IN;
  st.cherryN = cherryN; // (jumping the clock would otherwise fill the bowl with cherries from the time skipped)
  const api = {
    rules, T, st, me: st.cars[0], cars: st.cars, stats: st.stats,
    /** Off the table and out of the way for good. */
    park(...cars) { for (const o of cars) { o.fallT = 1e9; o.x = 1e4; o.z = 1e4; o.house = true; } return api; },
    /** A car at (u, lat), pointing `side` radians off the road's direction, at speed v, holding `b` with the wheel at `steer`. */
    place(c, u, lat, v, { side = 0, b = GO, steer = 0 } = {}) {
      const p = trackAt(u, lat, {}), L = locate(p.x, p.z, u, {});
      Object.assign(c, { x: p.x, z: p.z, h: p.th + side, mh: p.th + side, u: L.u, lat: L.lat, s: u, v, y: groundAt(L.u, L.lat, st), vy: 0, air: false, fallT: 0, safeT: 0, st: steer, inSt: steer, inB: b, lap: Math.floor(u / rules.LEN) });
      return c;
    },
    /** Runs `seconds` of race. Returns the events; `each(event)` and `step()` are called as it goes. */
    run(seconds, { each = null, step = null } = {}) {
      const out = [];
      for (let k = Math.round(seconds / DT); k > 0 && !st.over; k--) {
        st.ev.length = 0;
        rules.advance(st, st.n + 1);
        for (const e of st.ev) { out.push({ ...e }); if (each) each(e); }
        if (step) step(st);
      }
      return out;
    },
    /** The race's clock (tau) at the first moment from now on when `when(tau)` holds, in steps of one step. */
    findTau(when, from = rules.course.ARM_TAU) { let t = from; while (!when(t) && t < from + 120) t += DT; return t; },
    setTau(tau) { st.n = Math.round(tau / DT); st.t = st.n * DT - T.COUNT_IN; return api; },
  };
  if (park) api.park(...st.cars.slice(1));
  return api;
}

export const of = (events, k, car) => events.filter((e) => e.k === k && (car === undefined || e.car === car));
