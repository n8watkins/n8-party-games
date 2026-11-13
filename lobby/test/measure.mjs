// What a party room costs to host, measured: four scripted players wander, vote, jump, bump
// and play for a while, and the room budget's books are read before and after.
//
//   node lobby/test/measure.mjs [--base=http://localhost:8791] [--minutes=10] [--players=4] [--vote-every=60] [--game=cork-and-bell]
//
// The players wander between the lights, standing in one for a while, jumping and bumping now
// and then. Every --vote-every seconds they agree to play: each picks a light and stays in it
// until a game has been played (0: they only ever wander, and a game starts only by chance).
// After a game they walk back to the light they chose and linger, so a second game often
// follows the first: a keen party, which is the dearer case.
// With --game, every vote is for that game (when its light is on): an evening of one game.
// In a round of Cork & Bell each player fires a cork about every 1.3 seconds, as someone who
// uses all seventy corks in the ninety seconds does.
//
// It needs a local server with the debug door open (the "local" environment: npm run dev) and
// nobody else using it, since the budget's books are shared by every room on the server.
//
// The players are driven by the same Pilot the page uses (lobby/shared/pilot.js), stepped at
// 30 frames a second, so they send exactly what a phone would for the same wandering.
import { ROOM_MEMORY_GB, INCLUDED_GB_S, INCLUDED_REQUESTS, MESSAGES_PER_REQUEST, EVENT_FLOOR_MS } from "../../party-kit/src/worker/budget-logic.js";

import { Pilot } from "../shared/pilot.js";
import { ROOM, boxCentre, lightHalf } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const minutes = Number(opt("minutes", "10"));
const players = Math.min(4, Number(opt("players", "4")));
/** Seconds between the party deciding to play something (0: they only ever wander). */
const voteEvery = Number(opt("vote-every", "60"));
/** The one game every vote goes to, or "" for whichever light a player fancies. */
const onlyGame = opt("game", "");
const { api, call, connect } = partyApi(base);
const books = async () => (await (await fetch(api + "/debug")).json()).budget?.usage;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

if (!(await books())) {
  console.log("This server has no debug door (PARTY_DEBUG) or no room budget, so there is nothing to read.");
  process.exit(1);
}

// ---------------------------------------------------------------- the party
const names = ["Mabel", "Fitch", "Dolly", "Tom"].slice(0, players);
const first = await call("POST", "/rooms", { nickname: names[0] });
const sessions = [first];
for (const nickname of names.slice(1)) sessions.push(await call("POST", "/join/" + first.pin, { nickname }));
const before = await books();
const clients = sessions.map(connect);
await Promise.all(clients.map((c) => c.opened));
await clients[0].wait((m) => m.room?.members.filter((x) => x?.connected).length === players, 8000, 0);
const N = clients[0].room.boxes.length;
const lit = () => clients[0].room.boxes.map((box, i) => (clients[0].room.vote.lights[box.id] === null ? i : -1)).filter((i) => i >= 0);

const sentAt = []; // when every message was sent, for the pessimistic bound
let pings = 0;
let shots = 0;
// Every so often the party agrees to play: until a game has started and ended, nobody wanders off.
let voting = false;
const callVote = voteEvery > 0 ? setInterval(() => (voting = true), voteEvery * 1000) : null;
clients[0].ws.addEventListener("message", (e) => {
  // A game played here ends; an outside game sends everyone off (these players stay, as a page may).
  if (typeof e.data === "string" && (e.data.startsWith('{"t":"end"') || e.data.startsWith('{"t":"away"'))) voting = false;
});

/** One scripted player: picks somewhere to go, walks there, stands a while, now and then jumps or bumps. */
function bot(c) {
  const pilot = new Pilot({
    lights: N,
    x: c.x,
    rev: c.rev,
    send: (m) => {
      sentAt.push(Date.now());
      c.send(m);
    },
  });
  // Like the page: a knock lays the piece down where the room threw it; anything else just places it.
  c.onPlaced = (x, rev, knocked) => (knocked ? pilot.knock(x, rev, Date.now()) : pilot.place(x, rev, Date.now()));
  let lights = "";
  let goal = c.x;
  let voteGoal = null;
  let idleUntil = Date.now() + rand(500, 3000);
  const choose = () => {
    const lights = lit();
    const roll = Math.random();
    if (roll < 0.62 && lights.length) {
      const i = lights[Math.floor(Math.random() * lights.length)];
      goal = boxCentre(i, N) + rand(-0.7, 0.7) * lightHalf(N);
      idleUntil = Infinity; // set on arrival
      return rand(4000, 12000);
    }
    goal = rand(ROOM.minX + 20, ROOM.maxX - 20);
    idleUntil = Infinity;
    return rand(1500, 5000);
  };
  let stay = 0;
  let nextShot = 0;
  return setInterval(() => {
    const now = Date.now();
    if (c.room?.phase !== "lobby") {
      pilot.steer(0, now);
      pilot.step(now);
      // In a round of Cork & Bell: a cork about every 1.3 seconds, stamped with the round's time.
      const round = c.room?.game?.id === "cork-and-bell" ? c.seen.findLast((m) => m.t === "start") : null;
      const t = round ? (now - round.s.startAt) / 1000 - 3 : -1;
      if (t > 0.5 && t < 90 && now >= nextShot) {
        nextShot = now + rand(1000, 1600);
        sentAt.push(now);
        shots += 1;
        c.send({ t: "in", d: { f: [Math.round(t * 1000) / 1000, Math.round(rand(-1.2, 1.2) * 100) / 100, Math.round(rand(0.9, 2.2) * 100) / 100] } });
      }
      return;
    }
    // Like the page, tell the Pilot which lights are on whenever that changes.
    if (lights !== (lights = lit().join())) pilot.setLit(lit(), now);
    // "Let's play something": everyone picks a light and stands in it until a game has been played.
    if (voting && voteGoal === null && lit().length) {
      const wanted = clients[0].room.boxes.findIndex((box) => box.id === onlyGame);
      const on = lit().includes(wanted) ? [wanted] : lit();
      voteGoal = boxCentre(on[Math.floor(Math.random() * on.length)], N) + rand(-0.6, 0.6) * lightHalf(N);
    } else if (!voting) voteGoal = null;
    if (voteGoal !== null) goal = voteGoal;
    const gap = goal - pilot.x;
    // One step of walking is 14 units: close enough is closer than that, or the piece would dither.
    if (Math.abs(gap) > 16) pilot.steer(Math.sign(gap), now);
    else {
      pilot.steer(0, now);
      if (idleUntil === Infinity) idleUntil = now + stay;
      if (voteGoal === null && now >= idleUntil) stay = choose();
    }
    if (Math.random() < 1 / (30 * 9)) pilot.jump(now); // about once in nine seconds
    if (Math.random() < 1 / (30 * 14)) pilot.bump(now) && sentAt.push(now); // about once in fourteen
    pilot.step(now);
  }, 33);
}

console.log(`${players} scripted players wander and vote in party ${first.pin} for ${minutes} minutes...`);
const started = Date.now();
const timers = clients.map(bot);
const keepAlive = setInterval(() => {
  for (const c of clients) {
    c.send("ping");
    pings += 1;
  }
}, 20_000);
let games = 0;
let seenTo = 0;
const progress = setInterval(() => {
  games += clients[0].seen.slice(seenTo).filter((m) => m.t === "end" || m.t === "away").length;
  seenTo = clients[0].seen.length;
  console.log(`     ${Math.round((Date.now() - started) / 60_000)} min: ${sentAt.length} messages, ${games} games`);
}, 60_000);
await sleep(minutes * 60_000);
// A round that is on is played to its end, so every game counted was paid for in full.
if (callVote) clearInterval(callVote);
voting = false;
if (clients[0].room?.phase === "playing") await clients[0].wait((m) => m.t === "end", 120_000).catch(() => null);
[...timers, keepAlive, progress].forEach((t) => t && clearInterval(t));
games += clients[0].seen.slice(seenTo).filter((m) => m.t === "end" || m.t === "away").length;
const seconds = (Date.now() - started) / 1000;
const ends = clients[0].seen.filter((m) => m.t === "end");
const tossed = clients[0].seen.filter((m) => m.t === "vote" && m.vote.toss).length;
// Every game played in the room, by name, and how long the room was held awake for them.
const played = {};
let heldSeconds = 0;
for (const end of ends) {
  const begun = clients[0].seen.findLast((m) => m.t === "start" && m.at <= end.at);
  played[end.last.name] = (played[end.last.name] ?? 0) + 1;
  if (begun) heldSeconds += (end.at - begun.at) / 1000;
}
const playedLine = Object.entries(played).map(([name, n]) => `${n} of ${name}`).join(", ") || "none";
const bumps = clients[0].seen.filter((m) => m.t === "b");
const knocks = bumps.filter((m) => m.to >= 0).length;

// Closing the sockets makes the room report everything it still owes.
for (const c of clients) c.ws.close();
await sleep(2500);
const after = await books();

// ---------------------------------------------------------------- the sums
const gbs = after.monthUsed - before.monthUsed;
const awake = gbs / ROOM_MEMORY_GB;
const messages = sentAt.length;
const counted = after.monthRequests - before.monthRequests; // what the room saw: messages / 20, events, its reports
const requests = counted + pings / MESSAGES_PER_REQUEST; // the keep-alives never reach the room, but are billed
const hours = seconds / 3600;
const gbsPerHour = gbs / hours;
const reqPerHour = requests / hours;
const share = 0.1;
// The pessimistic reading: as if every second in which anything arrived were billed whole.
const busySeconds = new Set(sentAt.map((t) => Math.floor(t / 1000))).size;
const f = (n, d = 1) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

console.log(`
What ${players} players wandering and voting for ${f(seconds / 60, 1)} minutes cost
(${games} votes won. Games played in the room: ${playedLine}. Sent off to an outside game: ${games - ends.length}. Coin tosses: ${tossed}. Corks fired: ${shots}.)

  Messages to the room      ${f(messages, 0)} in all, ${f(messages / seconds, 2)} a second (${f(messages / seconds / players, 2)} per player)
  Keep-alives               ${f(pings, 0)} (one per player every 20 seconds, answered without waking the room)
  Bumps                     ${f(bumps.length, 0)}, of which ${f(knocks, 0)} knocked somebody over (each is one of the messages above)
  Awake time                ${f(awake, 2)} seconds in all, ${f((awake / seconds) * 60, 3)} seconds per minute
                            (each event counted as its real time, and never less than ${EVENT_FLOOR_MS} ms; a game's tick loop second for second)
                            of which games being played: ${f(heldSeconds, 1)} seconds (${ends.length ? f(heldSeconds / ends.length, 1) : "0"} a game); the lobby itself: ${f((Math.max(0, awake - heldSeconds) / seconds) * 60, 3)} seconds per minute
  Duration                  ${f(gbsPerHour, 2)} GB-seconds per room-hour
  Requests                  ${f(reqPerHour, 0)} per room-hour (messages count one twentieth each)

What the owner's 10% buys at that rate, each month

  Time      10% of ${f(INCLUDED_GB_S, 0)} GB-s is ${f(INCLUDED_GB_S * share, 0)} GB-s: ${f((INCLUDED_GB_S * share) / gbsPerHour, 0)} room-hours
  Requests  the plan includes ${f(INCLUDED_REQUESTS, 0)}; this room uses ${f(reqPerHour, 0)} an hour, so
            10% of them (${f(INCLUDED_REQUESTS * share, 0)}) is ${f((INCLUDED_REQUESTS * share) / reqPerHour, 0)} room-hours, and all of them ${f(INCLUDED_REQUESTS / reqPerHour, 0)}
            (past the included million a million more costs $0.15: ${f((reqPerHour / 1e6) * 0.15 * 1000, 3)} dollars per 1,000 room-hours)

The pessimistic reading, if every second with any message in it were billed whole
  ${f(busySeconds, 0)} of ${f(seconds, 0)} seconds had a message: ${f((busySeconds / seconds) * 60, 1)} awake seconds per minute,
  ${f((busySeconds / hours) * ROOM_MEMORY_GB, 1)} GB-s per room-hour, and the 10% would buy ${f((INCLUDED_GB_S * share) / ((busySeconds / hours) * ROOM_MEMORY_GB), 0)} room-hours.
  Cloudflare's pricing page says it does not bill this way (an idle room that can sleep is not billed).
`);
process.exit(0);
