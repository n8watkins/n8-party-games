// End to end against the production settings (the top level of wrangler.jsonc), run locally.
// It needs its own server with fresh storage, so earlier runs do not count against the limits:
//
//   npx wrangler dev --local --env="" --port 8804 --local-upstream localhost:8804 --persist-to <empty folder>
//   node party-kit/test/e2e-production.mjs http://localhost:8804
//
// --local-upstream keeps the local address: without it, the top level's custom domain would be
// the Worker's own address, and this site's local join links would not get a QR code.
//
// Checks: no test switch is on, ?lag= is refused, a sixth room from one address in ten minutes is
// rate limited, other sites' pages are turned away, the QR endpoint draws only join links, and the
// API's security headers.
import http from "node:http";

const base = process.argv[2] ?? "http://localhost:8804";
const api = base + "/api/party";
const problems = [];
const say = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
// Each run uses its own made-up address, so the limits start from zero.
const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
const post = (path, body, headers = {}) =>
  fetch(api + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers } }).then(async (r) => ({ status: r.status, headers: r.headers, ...(await r.json()) }));

/** Opens a socket; resolves with the first message, or with the failure. */
function socket(path) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + path);
    const t = setTimeout(() => resolve({ outcome: "timeout" }), 8000);
    ws.onmessage = (e) => {
      clearTimeout(t);
      resolve({ outcome: "message", msg: JSON.parse(e.data) });
      ws.close();
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve({ outcome: "refused" });
    };
  });
}

const config = await (await fetch(api + "/config")).json();
say(config.simLatency === false, "simulated latency is off");
say(config.turnstileSiteKey === null, "no bot check without keys");

const a = await post("/rooms", { nickname: "Ann" });
say(a.status === 201, `a room is made (${a.status})`);
say(a.headers.get("x-content-type-options") === "nosniff" && a.headers.get("cache-control") === "no-store", "API answers carry nosniff and no-store");

const lagged = await socket(`/api/party/rooms/${a.code}/ws?token=${a.token}&lag=150`);
say(lagged.outcome === "refused", `a socket asking for ?lag=150 is refused (${lagged.outcome})`);
// fetch() may not send Upgrade, so ask with a plain HTTP request to see the status.
const lagStatus = await new Promise((resolve) => {
  const r = http.get(`${api}/rooms/${a.code}/ws?token=${a.token}&lag=150`, { headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" } }, (res) => {
    res.resume();
    resolve(res.statusCode);
  });
  r.on("upgrade", () => resolve(101));
  r.on("error", () => resolve("error"));
});
say(lagStatus === 400, `and the refusal is a 400 with no room touched (${lagStatus})`);
const plain = await socket(`/api/party/rooms/${a.code}/ws?token=${a.token}`);
say(plain.outcome === "message" && plain.msg.t === "hello", "the same socket without ?lag connects");

const foreign = await post("/rooms", { nickname: "Eve" }, { Origin: "https://evil.example" });
say(foreign.status === 403 && foreign.error === "forbidden_origin", `a page on another site cannot make rooms (${foreign.status})`);

const qrOwn = await fetch(api + "/qr.svg?text=" + encodeURIComponent(`${base}/cork-and-bell/?join=${a.pin}`));
say(qrOwn.ok && (await qrOwn.text()).includes("<svg"), "the QR endpoint draws this site's join link");
const qrOther = await fetch(api + "/qr.svg?text=" + encodeURIComponent("https://evil.example/pay-me"));
say(qrOther.status === 400, `and refuses anything else (${qrOther.status})`);

const statuses = [];
for (let i = 0; i < 5; i++) statuses.push((await post("/rooms", { nickname: "Bo" })).status);
say(statuses.slice(0, 4).every((s) => s === 201) && statuses[4] === 429, "the sixth room from one address in ten minutes is rate limited: " + [a.status, ...statuses].join(", "));

console.log(problems.length ? "FAILED: " + problems.length : "PASSED");
process.exit(problems.length ? 1 : 0);
