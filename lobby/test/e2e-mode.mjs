// An end-to-end check of the party's two waiting rooms over real sockets, against a running local
// server (npm run dev, or any port). No browser: plain fetch and WebSocket from Node.
//
//   node lobby/test/e2e-mode.mjs [--base=http://localhost:8791]
//
// Two players and a big screen switch the party to the plain waiting room and back. Every page
// that hears the switch moves the way a page does: it closes its socket and opens a new one with
// the same token (lobby/public/hop.js). One player's phone is offline during a switch, and one
// reconnects in the middle of one: both land in the right room. A new phone joins while the
// party is in the plain room. The vote does nothing there, and works again on the way back.
import { MODE_COOLDOWN_MS } from "../shared/mode.js";
import { SETTLE_MS } from "../shared/vote.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

/** The hello on a freshly opened socket. */
async function seat(session) {
  const c = connect(session);
  await c.opened;
  const hello = await c.wait((m) => m.t === "hello");
  return { c, hello };
}

/** What a page does when the room's mode is not its own: its socket goes, and the next page opens one with the same token. */
async function hop(c, session) {
  // A browser leaving a page says 1001 (going away); Node's client may only say 1000.
  c.ws.close(1000, "");
  await c.closed;
  return seat(session);
}

const roomIn = (mode) => (m) => m.room?.mode === mode;

// ---------------------------------------------------------------- a party in the character room
const ann = await call("POST", "/rooms", { nickname: "Ann" });
const bo = await call("POST", "/join/" + ann.pin, { nickname: "Bo" });
const tv = await call("POST", "/join/" + ann.pin, { as: "screen" });
check(ann.ok && bo.ok && tv.ok && tv.role === "screen", `a party of Ann, Bo and a big screen (${ann.pin})`);
let A = await seat(ann);
let B = await seat(bo);
let T = await seat(tv);
check([A, B, T].every((s) => s.hello.room.mode === "party-games"), "it starts in the character room: every hello says party-games");
const preview = await call("GET", "/join/" + ann.pin);
check(preview.preview?.mode === "party-games", "the way in can tell which room the party is in (preview.mode)");

// ---------------------------------------------------------------- who may switch
B.c.send({ t: "mode", v: "turn-based" });
const no = await B.c.wait((m) => m.t === "mode-no");
check(no.v === "party-games" && /Only the one who started the party/.test(no.why), `Bo is refused, to his page only: "${no.why}"`);
await sleep(300);
check(!A.c.seen.some((m) => m.t === "mode-no") && !A.c.seen.some(roomIn("turn-based")), "and nobody else hears of it");

// ---------------------------------------------------------------- to the plain room
let since = { a: A.c.seen.length, b: B.c.seen.length, t: T.c.seen.length };
A.c.send({ t: "mode", v: "turn-based" });
const heard = await Promise.all([A.c.wait(roomIn("turn-based"), 8000, since.a), B.c.wait(roomIn("turn-based"), 8000, since.b), T.c.wait(roomIn("turn-based"), 8000, since.t)]);
check(heard.length === 3, "Ann switches: both phones and the screen hear the room in turn-based");
const note = B.c.seen.slice(since.b).find((m) => m.t === "note" && m.k === "mode");
check(note?.text === "Ann moved the party to the Table", `with a note: "${note?.text}"`);
// A double tap: the second is refused, and nobody bounces.
A.c.send({ t: "mode", v: "party-games" });
const again = await A.c.wait((m) => m.t === "mode-no", 8000, since.a);
check(/Wait a moment/.test(again.why) && again.v === "turn-based", `a second tap at once is refused: "${again.why}"`);

// Every page moves: a new socket each, the same token, the same seat.
A = await hop(A.c, ann);
T = await hop(T.c, tv);
// Bo's phone reconnects in the middle of it: its socket drops before it hears anything more,
// and the next page comes up a moment later.
B.c.ws.close(1000, "");
await B.c.closed;
await sleep(150);
B = await seat(bo);
check(A.hello.room.mode === "turn-based" && A.hello.you.seat === 0, "Ann's next page is seated as Ann, in turn-based");
check(B.hello.room.mode === "turn-based" && B.hello.you.seat === 1, "Bo's next page, after a drop mid-switch, is seated as Bo, in turn-based");
check(T.hello.room.mode === "turn-based" && T.hello.you.role === "screen", "the screen's next page is the screen, in turn-based");
check(A.hello.room.picker?.seat === 0, "Ann still holds the controls");
await sleep(300);
const members = (B.c.room ?? B.hello.room).members.filter(Boolean);
check(members.length === 2 && members.every((m) => m.connected), "nobody was let go by the hop: both players here and connected");
check(![A, B, T].some((s) => s.c.seen.some((m) => m.t === "note" && m.k === "left")), "and nobody heard 'left'");

// ---------------------------------------------------------------- in the plain room
const pv = await call("GET", "/join/" + ann.pin);
check(pv.preview?.mode === "turn-based", "the preview says turn-based now");
const cy = await call("POST", "/join/" + ann.pin, { nickname: "Cy" });
const C = await seat(cy);
check(cy.ok && C.hello.room.mode === "turn-based" && C.hello.you.seat === 2, "a new phone joins while the party is in the plain room, and hears turn-based in its hello");
since = { b: B.c.seen.length };
const me = A.hello.room.members[0];
A.c.send({ t: "m", x: me.x + 40, d: 1, r: me.rev });
A.c.send({ t: "b" });
await sleep(500);
check(!B.c.seen.slice(since.b).some((m) => m.t === "m" || m.t === "b"), "nothing walks or bumps in the plain room: a move and a bump are not passed on");

// ---------------------------------------------------------------- Bo is offline when the party goes back
B.c.ws.close(1000, "");
await B.c.closed;
await sleep(Math.max(0, MODE_COOLDOWN_MS - 600));
since = { a: A.c.seen.length, c: C.c.seen.length, t: T.c.seen.length };
A.c.send({ t: "mode", v: "party-games" });
await Promise.all([A.c.wait(roomIn("party-games"), 8000, since.a), C.c.wait(roomIn("party-games"), 8000, since.c), T.c.wait(roomIn("party-games"), 8000, since.t)]);
check(true, "after the cooldown Ann switches back: Ann, Cy and the screen hear party-games");
A = await hop(A.c, ann);
await sleep(1000);
B = await seat(bo);
check(B.hello.room.mode === "party-games" && B.hello.you.seat === 1, "Bo, offline during the switch, comes back seated as Bo, in party-games");
check(A.hello.room.mode === "party-games", "Ann's next page is in party-games");

// ---------------------------------------------------------------- the vote works again
await sleep(SETTLE_MS + 300);
since = { b: B.c.seen.length };
const ann2 = A.hello.room.members[0];
A.c.send({ t: "m", x: ann2.x + 40, d: 1, r: ann2.rev });
await sleep(400);
check(B.c.seen.slice(since.b).some((m) => m.t === "m" && m.s === 0), "back in the character room, a move is passed on again");

for (const s of [A, B, C, T]) s.c.ws.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall good");
process.exit(problems.length ? 1 : 0);
