// What a race of Tin Derby costs a party room running in workerd (the Workers runtime), measured from outside:
// the CPU time the local Worker's process spends while a race runs, less what it spends idle, and the bytes each
// viewer is sent. One plain socket joins a party, votes for Tin Derby and drives its car with the house's driver
// through its own replica (as a phone's page does), so all four cars race and the room relays real inputs.
//
//   node floor/games/tin-derby/tools/workerd-cost.mjs --base=http://127.0.0.1:9070 --pid=<workerd pid> [--idle=20]
//
// The pid is the workerd process that serves the base address (`ss -ltnp | grep :9070`). A Worker cannot time
// itself (its clock stands still while it runs), so this reads the process's CPU counters from /proc. Run it on a
// server no other test is using: everything that process does in the window is counted.
import { readFileSync } from "node:fs";
import { partyApi, sleep } from "../../../../lobby/test/client.mjs";
import { boxCentre } from "../../../../lobby/shared/world.js";
import { rules } from "../shared/rules.js";
import { makeReplica } from "../shared/replica.js";
import { BTN } from "../shared/house.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://127.0.0.1:8791");
// wrangler dev runs two workerd processes (the one listening on the port, and the one running the Worker): pass both.
const pids = opt("pid", "").split(",").map(Number).filter(Boolean);
const idleS = Number(opt("idle", "20"));
if (!pids.length) throw new Error("--pid=<the workerd processes of --base, comma-separated> is needed");
const HZ = 100; // clock ticks a second in /proc (USER_HZ)
const cpu = () => pids.reduce((sum, pid) => { const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" "); return sum + (Number(f[11]) + Number(f[12])) / HZ; }, 0);

const { call, connect } = partyApi(base);
// Idle first: what the process spends with nothing to do (other rooms' alarms, the runtime's own work).
const i0 = cpu(), t0 = Date.now();
await sleep(idleS * 1000);
const idlePerS = (cpu() - i0) / ((Date.now() - t0) / 1000);

const session = await call("POST", "/rooms", { nickname: "Meter" });
const sock = connect(session);
await sock.opened;
await sock.wait((m) => m.room?.members[session.seat]?.connected, 8000, 0);
const N = sock.room.boxes.length, at = sock.room.boxes.findIndex((b) => b.id === "tin-derby");
sock.goto(Math.round(boxCentre(at, N)));
const start = await sock.wait((m) => m.t === "start", 30000, 0);
let replica = makeReplica(rules, start.s, { seat: session.seat });
const raceFrom = sock.seen.length;
const c0 = cpu(), r0 = Date.now();
let bytes = 0, frames = 0, end = null, drive = null;
const old = sock.ws.onmessage;
sock.ws.onmessage = (event) => {
  if (event.data !== "pong") { bytes += Buffer.byteLength(event.data); frames++; }
  old(event);
  const msg = sock.seen.at(-1);
  if (!msg || event.data === "pong") return;
  if (msg.t === "ev") replica.events(msg.ev);
  else if (msg.t === "snap") replica.snapshot(msg.s);
  else if (msg.t === "end") end = msg;
};
// The hands, thirty times a second: the house's driver on this socket's own prediction.
drive = setInterval(() => {
  const now = Date.now(), p = replica.predict(now), c = p.cars[replica.car];
  if (!c || c.fin) return;
  const out = {};
  rules.house.drive(p, c, out);
  const msg = replica.input(now, out.st, out.b & BTN.GO, out.b & BTN.BRAKE, out.b & BTN.DRIFT, out.b & BTN.USE);
  if (msg) sock.send({ t: "in", d: msg });
}, 33);
while (!end && Date.now() - r0 < 200_000) await sleep(200);
clearInterval(drive);
const seconds = (Date.now() - r0) / 1000, spent = cpu() - c0;
const raceCpu = spent - idlePerS * seconds;
const ticks = seconds * rules.game.tickHz;
sock.ws.close();
console.log(JSON.stringify({
  raced: end ? end.result : null,
  seconds: +seconds.toFixed(1),
  idleCpuPerS: +idlePerS.toFixed(4),
  processCpu: +spent.toFixed(2),
  raceCpu: +raceCpu.toFixed(2),
  cpuShareOfOneCore: +(raceCpu / seconds).toFixed(4),
  msPerTick: +((raceCpu * 1000) / ticks).toFixed(3),
  bytesPerSecond: Math.round(bytes / seconds),
  messagesPerSecond: +(frames / seconds).toFixed(1),
  messages: sock.seen.length - raceFrom,
}, null, 1));
process.exit(0);
