// An end-to-end check of the party room over real sockets, against a running local server
// (npm run dev, or any port). No browser: plain fetch and WebSocket from Node.
//
//   node lobby/test/e2e-lobby.mjs [--base=http://localhost:8791] [--quiet=25]
//
// Four players join one room and go through an evening: a vote, a count that pauses, a game
// that starts and comes back with points, a tie and its coin toss, an outside game that sends
// everyone to its own site, someone leaving, a dropped
// phone coming back, a bump, a big screen, and a client that misbehaves. Then nobody touches
// anything for --quiet seconds and the room must go silent (0 skips that part).
import { KNOCK_MIN, STUN_MS, knockLanding } from "../shared/bump.js";
import { boxCentre, lightHalf, spawnX } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const quietSeconds = Number(opt("quiet", "25"));
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const N = 6;
const COIN = 1; // Coin Flip's place on the wall
const CORK = 0;
const WHO = 2; // Who Am I?, an outside game
const light = (i, off = 0) => Math.round(boxCentre(i, N) + off);
const dark = (i) => Math.round(boxCentre(i, N) + lightHalf(N) + 20);
const voteOf = (m) => (m.t === "vote" ? m.vote : m.room?.vote);

// ---------------------------------------------------------------- joining
const a = await call("POST", "/rooms", { nickname: "Ann" });
check(a.status === 201 && /^\d{4}$/.test(a.pin) && a.seat === 0 && a.role === "player", "start a party: a 4-digit code and the first seat (" + a.pin + ")");
const preview = await call("GET", "/join/" + a.pin);
check(preview.ok && preview.preview.players.join() === "Ann" && preview.preview.game === "party", "look the code up: the party and who is in it");
const qr = await fetch(api + "/qr.svg?text=" + encodeURIComponent(base + "/lobby/?join=" + a.pin));
check(qr.ok && (await qr.text()).includes("<svg"), "the join link as a QR code");
const b = await call("POST", "/join/" + a.pin, { nickname: "Bo" });
const cy = await call("POST", "/join/" + a.pin, { nickname: "Cy" });
const d = await call("POST", "/join/" + a.pin, { nickname: "Di" });
check([b, cy, d].every((s, i) => s.ok && s.seat === i + 1 && s.code === a.code), "three more join by code: seats 2, 3 and 4");
const fifth = await call("POST", "/join/" + a.pin, { nickname: "Eve" });
check(fifth.status === 409 && fifth.error === "room_full", "a fifth player is turned away: " + fifth.message);
const wrong = await call("POST", "/join/0000", { nickname: "X" });
check(!wrong.ok, "a wrong code is turned away");
const foreign = await fetch(api + "/rooms", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ nickname: "Mal" }) });
check(foreign.status === 403, "a page on another site cannot start a party (the kit's origin check)");
const fat = await fetch(api + "/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: "x".repeat(5000) }) });
check(fat.status === 400, "an oversized body is refused (the kit's body cap)");

// A party of one whose only player leaves at once: by the end of this run it must be gone.
const left = await call("POST", "/rooms", { nickname: "Zed" });
const Z = connect(left);
await Z.opened;
await Z.wait((m) => m.t === "hello", 8000, 0);
Z.ws.close();
const leftAt = Date.now();

const [A, B, C, D] = [a, b, cy, d].map(connect);
const all = [A, B, C, D];
// A page keeps its socket alive by itself (the keep-alive the room answers without waking). These
// bare sockets must too, or a round of Cork & Bell in which they say nothing for ninety seconds
// gets them taken for phones that have gone.
const breathing = setInterval(() => all.forEach((c) => c.send("ping")), 20_000);
await Promise.all(all.map((c) => c.opened));
const hello = await A.wait((m) => m.t === "hello", 8000, 0);
check(hello.you.seat === 0 && hello.room.boxes.length === N && hello.room.pin === a.pin, "hello: your seat, the code and the six boxes on the wall");
await D.wait((m) => m.t === "hello", 8000, 0);
await A.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 8000, 0);
check(
  A.room.members.every((m, i) => m.x === spawnX(i, N)) && A.room.vote.waiting.length === 4,
  "everyone starts by the door, in the dark, and the room is waiting for all four",
);
const lights = A.room.vote.lights;
check(lights["cork-and-bell"] === null && lights["coin-flip"] === null && lights["who-am-i"] === "For 2 players" && lights["tin-derby"] === "Coming soon" && lights.flood === "Coming soon" && lights["fox-trouble"] === "Coming soon", "two lights are on (Cork & Bell, Coin Flip); Who Am I? is for two, and the rest say Coming soon");
A.send("ping");
await sleep(300);
check(A.raw.includes("pong"), "the keep-alive is answered");

// ---------------------------------------------------------------- moving and voting
let mark = B.seen.length;
A.goto(light(COIN));
const relayed = await B.wait((m) => m.t === "m" && m.s === 0 && m.x === light(COIN), 4000, mark);
check(!!relayed, "one player's move reaches the others");
const v1 = await B.wait((m) => m.t === "vote" && m.vote.standing[0] === "coin-flip", 4000, mark);
check(v1.vote.waiting.join() === "1,2,3" && v1.vote.count === null, "standing in a light is a vote; the room waits for the three in the dark");
check(!A.seen.some((m) => m.t === "m" && m.s === 0), "a player's own moves are not echoed back");

mark = A.seen.length;
B.goto(light(COIN, -40));
C.goto(light(COIN, 40));
D.goto(light(COIN, 80));
const counting = await A.wait((m) => voteOf(m)?.count, 4000, mark);
check(counting.vote.count.endsIn > 2500 && counting.vote.leaders.join() === "coin-flip", "everyone in a light: the count runs (Starts in 10) and Coin Flip leads");
mark = A.seen.length;
D.goto(dark(COIN));
const paused = await A.wait((m) => m.t === "vote" && !m.vote.count, 4000, mark);
check(paused.vote.waiting.join() === "3", "stepping out of every light stops the count: waiting for Di");
await sleep(3300);
check(!A.seen.slice(mark).some((m) => m.t === "start"), "nothing starts while someone is in the dark");

// ---------------------------------------------------------------- a game and back
mark = A.seen.length;
D.goto(light(COIN, 80));
const t0 = Date.now();
const start = await A.wait((m) => m.t === "start", 13000, mark);
check(start.room.phase === "playing" && start.room.game.id === "coin-flip" && start.s.seats.length === 4, `the count ends and Coin Flip starts with the party's four seats (${Date.now() - t0} ms)`);
const end = await A.wait((m) => m.t === "end", 8000, mark);
const rows = end.last.rows;
check(rows.length === 4 && rows.map((r) => r.points).join() === "3,2,1,0", "it ends with places: 3, 2, 1 and 0 points (" + rows.map((r) => r.name).join(", ") + ")");
check(end.room.phase === "lobby" && end.room.tonight.games === 1 && end.room.members.every((m, i) => m.x === spawnX(i, N) && m.rev === 1), "everyone is back in the lobby, by the door, with the Tonight board filled in");
check(end.room.members.map((m) => m.points).sort().join() === "0,1,2,3", "the board holds the points");
const points = Object.fromEntries(end.room.members.map((m) => [m.name, m.points]));

// ---------------------------------------------------------------- a tie
await sleep(200);
mark = A.seen.length;
A.goto(light(CORK));
B.goto(light(CORK, 40));
C.goto(light(COIN));
D.goto(light(COIN, 40));
const tied = await A.wait((m) => voteOf(m)?.count, 9000, mark);
check(tied.vote.leaders.join() === "cork-and-bell,coin-flip", "two against two is a tie (the count waited for the result to be read first)");
const toss = await A.wait((m) => voteOf(m)?.toss, 14000, mark);
const tossed = voteOf(toss).toss;
check(tossed.between.length === 2 && tossed.between.includes(tossed.winner), "the tie is settled by a coin toss everybody is shown: " + tossed.winner);
// Either game is played inside the room. Coin Flip is over in three seconds; a round of Cork &
// Bell is ninety, so when the toss picks it this run is a minute and a half longer.
let end2;
if (tossed.winner === "cork-and-bell") {
  const begun = await A.wait((m) => m.t === "start", 13000, mark);
  check(begun.room.game.id === "cork-and-bell" && begun.s.seats.length === 4 && begun.s.seed > 0, "Cork & Bell won: a battle starts for the party's four seats");
  console.log("     a round of Cork & Bell: ninety seconds...");
  // Ann fires a cork every second for a while, stamped with the round's own time, as her page would.
  const roundTime = () => (Date.now() - begun.s.startAt) / 1000 - 3;
  await sleep(4000);
  for (let i = 0; i < 12; i++) {
    A.send({ t: "in", d: { f: [Math.round(roundTime() * 1000) / 1000, -0.6 + (i % 5) * 0.3, 1.2] } });
    await sleep(1000);
  }
  const fired = A.seen.slice(mark).filter((m) => m.t === "ev").flatMap((m) => m.ev).filter((e) => e.k === "f" && e.seat === 0).length;
  check(fired >= 10 && A.seen.slice(mark).some((m) => m.t === "snap" && m.s.stalls?.length === 4), `the room takes a player's inputs and relays them (${fired} of 12 corks), and sends its snapshots`);
  end2 = await A.wait((m) => m.t === "end", 110000, mark);
  const ann = end2.result.find((r) => r.seat === 0);
  check(end2.last.rows.length === 4 && ann.shots >= 10 && end2.last.rows.every((r) => typeof r.score === "number") && end2.room.tonight.games === 2, `it ends with places and scores: ${end2.last.rows.map((r) => `${r.name} ${r.score} (+${r.points})`).join(", ")}`);
} else {
  end2 = await A.wait((m) => m.t === "end", 12000, mark);
  check(end2.last.rows.length === 4 && end2.room.tonight.games === 2, "Coin Flip won: a second game is on the board");
}
check(end2.room.phase === "lobby", "and everyone is back in the lobby again");

// ---------------------------------------------------------------- a bump
await sleep(200);
mark = B.seen.length;
const markA = A.seen.length;
A.goto(400);
B.goto(450);
// The two sockets are not in step with each other: bump once the room has said where Bo is.
await A.wait((m) => m.t === "m" && m.s === 1 && m.x === 450, 4000, markA);
A.send({ t: "m", x: 400, d: 1, r: A.rev });
A.send({ t: "m", x: 400, d: 0, r: A.rev });
A.send({ t: "b" });
const bump = await B.wait((m) => m.t === "b" && m.s === 0, 4000, mark);
const lit = A.room.boxes.map((box, i) => (A.room.vote.lights[box.id] === null ? i : -1)).filter((i) => i >= 0);
check(bump.to === 1 && bump.x === knockLanding(450, 1, N, lit) && bump.x >= 450 + KNOCK_MIN, "a bump knocks the player in front a long way (" + (bump.x - 450) + " units), into the dark");
// The knocked piece gets up before anything else is asked of it.
await sleep(STUN_MS + 60);
B.send({ t: "m", x: B.x, d: 0, r: B.rev });

// ---------------------------------------------------------------- leaving, dropping, coming back
mark = A.seen.length;
D.send({ t: "leave" });
const note = await A.wait((m) => m.t === "note" && m.k === "left", 4000, mark);
const gone = await A.wait((m) => m.t === "room" && m.room.members[3] === null, 4000, mark);
check(note.name === "Di" && note.why === "left" && !!gone, "Leave the party: Di is gone at once and everyone is told");
check((await D.closed).code === 1000, "and Di's socket is closed");

mark = A.seen.length;
C.ws.close();
const grey = await A.wait((m) => m.t === "room" && m.room.members[2]?.connected === false, 4000, mark);
check(!!grey && grey.room.members[2].name === "Cy", "a dropped phone: Cy's piece stays, marked as not connected");
await sleep(800);
const C2 = connect(cy);
await C2.opened;
const hello2 = await C2.wait((m) => m.t === "hello", 4000, 0);
check(hello2.you.seat === 2 && hello2.room.members[2].points === (end2.room.members[2]?.points ?? points.Cy), "Cy is back in the same seat with the same points");
const back = await A.wait((m) => m.t === "room" && m.room.members[2]?.connected === true, 4000, mark);
check(!!back, "and everyone sees Cy back");

// ---------------------------------------------------------------- a big screen
const s = await call("POST", "/join/" + a.pin, { as: "screen" });
check(s.ok && s.role === "screen" && s.seat === -1, "a laptop joins with the code as the room's screen, with no seat");
const S = connect(s);
await S.opened;
const helloS = await S.wait((m) => m.t === "hello", 4000, 0);
check(helloS.you.role === "screen" && helloS.room.members.filter(Boolean).length === 3, "the screen sees the whole room");
await A.wait((m) => m.room?.screens === 1, 4000, 0);
mark = S.seen.length;
S.send({ t: "m", x: 500, d: 0, r: 0 });
S.send({ t: "b" });
await sleep(300);
check(!S.seen.slice(mark).some((m) => m.t === "m" || m.t === "b"), "a screen cannot move a piece or bump");

// ---------------------------------------------------------------- a client that misbehaves
mark = B.seen.length;
A.send("{broken");
A.send(JSON.stringify([1, 2, 3]));
A.send("x".repeat(600));
A.send({ t: "m", x: "left", d: 0 });
A.send({ t: "m", x: 1e9, d: 0, r: A.rev });
await sleep(400);
const stray = B.seen.slice(mark).filter((m) => m.t === "m" && m.s === 0);
check(stray.length === 1 && stray[0].x <= 1810 && A.ws.readyState === 1, "broken, oversized and nonsense messages are dropped; a wild position is pulled back into the room");
const fix = A.seen.find((m) => m.t === "fix");
check(!!fix, "and the room tells that player where their piece really is");

const e = await call("POST", "/join/" + a.pin, { nickname: "Eve" });
const E = connect(e);
await E.opened;
await E.wait((m) => m.t === "hello", 4000, 0);
mark = A.seen.length;
for (let i = 0; i < 400; i++) E.send({ t: "m", x: 200, d: 0, r: 0 });
const kicked = await Promise.race([E.closed, sleep(5000).then(() => null)]);
check(kicked?.code === 4008, "a client that floods is cut off (close code " + kicked?.code + ")");
const freed = await A.wait((m) => m.t === "room" && m.room.members[3] === null, 4000, mark).catch(() => null);
check(!!freed, "and its seat is freed");
const relays = A.seen.slice(mark).filter((m) => m.t === "m" && m.s === 3).length;
check(relays <= 45, "only the first burst of its messages was passed on (" + relays + " of 400)");

const debug = async (code = "") => (await fetch(api + "/debug" + (code ? "/" + code : ""))).json();

// ---------------------------------------------------------------- an outside game (Who Am I?)
// A room of its own: two players, since Who Am I? is for exactly two.
{
  const p = await call("POST", "/rooms", { nickname: "Pat" });
  const q = await call("POST", "/join/" + p.pin, { nickname: "Quin" });
  const [P, Q] = [p, q].map(connect);
  await Promise.all([P.opened, Q.opened]);
  await P.wait((m) => m.room?.members.filter((x) => x?.connected).length === 2, 8000, 0);
  const box = P.room.boxes[WHO];
  check(box.id === "who-am-i" && box.url === "https://whoami.n8builds.dev/" && box.min === 2 && box.max === 2 && P.room.vote.lights["who-am-i"] === null, "Who Am I? hangs as an outside game for exactly two, and its light is on for a party of two");
  let from = P.seen.length;
  P.goto(light(WHO, -30));
  Q.goto(light(WHO, 30));
  const t1 = Date.now();
  const away = await P.wait((m) => m.t === "away", 15000, from);
  const awayQ = await Q.wait((m) => m.t === "away", 2000, 0);
  check(away.id === "who-am-i" && away.url === box.url && away.in >= 5000 && awayQ.url === box.url, `it wins the count: both pages are told to go to ${away.url} in ${away.in / 1000} seconds (${Date.now() - t1} ms)`);
  const then = await P.wait((m) => m.t === "room", 4000, P.seen.indexOf(away));
  check(then.room.phase === "lobby" && then.room.game === null && then.room.tonight.games === 0 && then.room.members.filter(Boolean).every((m) => m.points === 0 && m.x === spawnX(m.seat, N)), "nothing starts in the room, nobody scores, and the pieces are back by the door");
  check(!P.seen.some((m) => m.t === "start" || m.t === "end"), "no game was started for it");
  // The pages go: the room is left empty and closes by the usual rule, a minute later.
  P.ws.close();
  Q.ws.close();
  await sleep(600);
  const left = (await debug(p.code)).room;
  if (left) check(left.sockets === 0 && left.timer === false && left.alarmIn > 20_000 && left.alarmIn <= 60_000, `once both pages have gone the room holds no socket and no timer; it next wakes in ${Math.round(left.alarmIn / 1000)} seconds to let the two seats go, and closes a minute after it emptied`);

  // A party of three does not fit.
  const r = await call("POST", "/rooms", { nickname: "Ria" });
  const more = [await call("POST", "/join/" + r.pin, { nickname: "Sol" }), await call("POST", "/join/" + r.pin, { nickname: "Tam" })];
  const three = [r, ...more].map(connect);
  await Promise.all(three.map((c) => c.opened));
  const full = await three[0].wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 8000, 0);
  check(full.room.vote.lights["who-am-i"] === "For 2 players", 'with three in the party its light is off and says "For 2 players"');
  for (const c of three) c.send({ t: "leave" });
  await sleep(300);
}

// ---------------------------------------------------------------- the books
const books = await debug();
if (!books.ok) {
  console.log("     (no debug door on this server: skipping the budget and quiet checks)");
} else {
  check(books.budget.usage.dayUsed > 0 && books.budget.usage.dayRequests > 0, `the room budget has counted awake time and requests (${books.budget.usage.dayUsed.toFixed(3)} GB-s, ${books.budget.usage.dayRequests.toFixed(1)} requests today)`);
  const inner = (await debug(a.code)).room;
  check(inner.timer === false && inner.sockets === 4, "back in the lobby no timer is running (three players and the screen are connected)");

  // -------------------------------------------------------------- nobody touches anything
  clearInterval(breathing);
  if (quietSeconds > 0) {
    console.log(`     nobody touches anything for ${quietSeconds} seconds...`);
    // What the evening left behind runs out first (the rest after the last game, a short wake-up).
    for (let i = 0; i < 20 && (await debug(a.code)).room.alarmIn < 60_000; i++) await sleep(1000);
    await sleep(1500);
    // The room's own tally, not the shared books: other rooms on the server may be closing down meanwhile.
    const before = (await debug(a.code)).room;
    const marks = [A, B, C2, S].map((c) => c.seen.length);
    const pongs = A.raw.length;
    const quietFrom = Date.now();
    // The page's keep-alive goes on: one "ping" per socket every 20 seconds.
    const keepAlive = setInterval(() => [A, B, C2, S].forEach((c) => c.send("ping")), 20_000);
    await sleep(quietSeconds * 1000);
    clearInterval(keepAlive);
    const heard = [A, B, C2, S].map((c, i) => c.seen.length - marks[i]);
    check(heard.every((n) => n === 0), "a lobby nobody touches sends nothing at all (" + heard.join(", ") + " messages)");
    if (quietSeconds >= 20) check(A.raw.length > pongs, "while the keep-alive is still answered");
    const quiet = (await debug(a.code)).room;
    const same = JSON.stringify(quiet.owed) === JSON.stringify(before.owed) && quiet.reportedAt === before.reportedAt;
    check(same, `and the room counted nothing: it was not awake (owed ${JSON.stringify(quiet.owed)} before and after)`);
    check(quiet.timer === false, "no timer is running");
    check(quiet.alarmIn > 5 * 60_000, `the only wake-up set is the slow "forgotten room" check, ${Math.round(quiet.alarmIn / 60_000)} minutes away`);
    const slept = quiet.wokeAgo < Date.now() - quietFrom - 2000;
    console.log(`     the room object ${slept ? "was put to sleep and woken by this check" : "stayed in memory (idle and able to sleep, which is not billed)"}: in memory for ${quiet.wokeAgo} ms`);
  }
}

// ---------------------------------------------------------------- the room everyone left
{
  const waited = Date.now() - leftAt;
  if (waited < 68_000) {
    console.log(`     waiting ${Math.ceil((68_000 - waited) / 1000)} seconds more for the room that was left at the start...`);
    await sleep(68_000 - waited);
  }
  const gone = await debug(left.code).catch(() => null);
  if (gone?.ok) {
    const back = await call("GET", "/join/" + left.pin);
    check(gone.room === null && !back.ok, "a room everyone left is closed a minute later, though it slept in between, and its code is given back");
  }
}

for (const c of [A, B, C2, S]) c.ws.close();
await sleep(200);
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
