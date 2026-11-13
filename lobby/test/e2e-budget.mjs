// End to end: what a party room does when the hosting allowance is spent, and what it does
// with a phone that has gone without saying so. It needs its own server with a tiny budget and
// fresh storage, so the day's allowance is gone after one game of Coin Flip:
//
//   npx wrangler dev --local --env local --port 8832 --persist-to <empty folder> \
//     --var PARTY_ROOM_BUDGET_SHARE:0.000005
//   node lobby/test/e2e-budget.mjs http://localhost:8832
//
// It takes about four minutes: an open room is given three minutes' notice before it closes.
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const base = process.argv[2] ?? "http://localhost:8832";
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const COIN = Math.round(boxCentre(1, 6));

const a = await call("POST", "/rooms", { nickname: "Ann" });
check(a.status === 201, "with the allowance unspent, a party starts (" + a.status + ")");
const A = connect(a);
await A.opened;
await A.wait((m) => m.t === "hello", 5000, 0);
const keepAlive = setInterval(() => A.send("ping"), 20_000);

// Waiting in the lobby is free: nothing is spent however long people stand around.
await sleep(4000);
const early = await call("POST", "/rooms", { nickname: "Bo" });
check(early.status === 201, "after standing around in the lobby, a second party can still start (" + early.status + ")");

// A game is what costs. One Coin Flip keeps the room awake for three seconds, which is the whole allowance here.
A.goto(COIN);
const end = await A.wait((m) => m.t === "end", 12000);
check(end.last.rows.length === 1, "one game of Coin Flip is played to its end");
const told = await A.wait((m) => m.room?.closing, 8000, 0).catch(() => null);
check(told?.room.closing.reason === "budget" && told.room.closing.in > 170_000, "the open room is told the allowance is spent and that it closes in three minutes");
const toldAt = Date.now();

const refused = await call("POST", "/rooms", { nickname: "Cy" });
check(refused.status === 503 && refused.error === "battles_full" && /party rooms are full/i.test(refused.message), `a new party is refused, with words that make sense here: ${refused.status} "${refused.message}"`);

// Friends can still come in to say goodbye, but no game starts.
const b = await call("POST", "/join/" + a.pin, { nickname: "Bo" });
check(b.ok, "the open room can still be joined");
const B = connect(b);
await B.opened;
await sleep(7000);
let mark = A.seen.length;
A.goto(COIN + 20);
B.goto(COIN - 20);
await sleep(4500);
check(!A.seen.slice(mark).some((m) => m.t === "start" || (m.t === "vote" && m.vote.count)), "everyone stands in a light, and no count and no game starts");

// Bo's phone goes without saying so: no keep-alive, no close. After a minute and a half of
// silence, the next thing anyone does shows the room that Bo is gone.
console.log("     Bo's phone goes silent; waiting 95 seconds...");
await sleep(95_000);
mark = A.seen.length;
A.goto(COIN + 30);
const dropped = await A.wait((m) => m.t === "room" && m.room.members[1]?.connected === false, 5000, mark).catch(() => null);
check(!!dropped, "a phone that has said nothing for 90 seconds is treated as dropped the next time anyone moves");
check((await Promise.race([B.closed, sleep(2000).then(() => null)]))?.code === 1001, "and its socket is closed");

console.log("     waiting for the room to close...");
const closed = await Promise.race([A.closed, sleep(120_000).then(() => null)]);
const after = Math.round((Date.now() - toldAt) / 1000);
check(closed?.code === 4000 && closed.reason === "allowance_spent", `the room closes ${after} seconds after it was told: code ${closed?.code} "${closed?.reason}"`);
check(after >= 170 && after <= 200, "which is the three minutes it promised");
clearInterval(keepAlive);
const gone = await call("GET", "/join/" + a.pin);
check(gone.status === 404, "and its code no longer opens anything");

console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
