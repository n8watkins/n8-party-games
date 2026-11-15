// The full gate that runs once before a deploy, on the combined result: unit tests, then the
// end-to-end scripts that need a local Worker, one after the other (never two browsers at once).
//
//   npm run predeploy                 (locally, from the owner's PC)
//   .github/workflows/predeploy-gate.yml   (the same script, on a GitHub-hosted runner)
//
// The script is named `predeploy` on purpose: npm runs `pre<name>` before `npm run <name>`, so
// `npm run deploy` runs this gate first by itself and stops if it fails. `npm run predeploy`
// alone runs the gate without deploying. In an emergency, and only on the owner's word,
// `npx wrangler deploy --env=''` deploys without the gate.
//
// Needs `npm ci` first, and Playwright's Chromium for the Cork & Bell step
// (`npx playwright install chromium`). It starts its own local Worker on PREDEPLOY_PORT (default
// 8853), so it does not touch a dev server that is already running. The Windows-Chrome playtest
// (`npm run playtest:battle`) and the production-settings check in DEPLOY.md stay manual: they
// need the owner's PC and a second server.
import { spawn } from "node:child_process";

const port = process.env.PREDEPLOY_PORT ?? "8853";
const base = `http://localhost:${port}`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

const results = [];
async function step(name, cmd, args) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  const code = await run(cmd, args);
  results.push({ name, code, seconds: Math.round((Date.now() - started) / 1000) });
  return code === 0;
}

function summary() {
  console.log("\n=== predeploy gate ===");
  for (const r of results) console.log(`${r.code === 0 ? "ok  " : "FAIL"} ${r.name} (${r.seconds}s)`);
  const failed = results.some((r) => r.code !== 0);
  console.log(failed ? "\nGATE FAILED: do not deploy." : "\nGATE PASSED.");
  return failed ? 1 : 0;
}

if (!(await step("unit tests (npm test)", npm, ["test"]))) process.exit(summary());

// A local Worker for the end-to-end scripts, in its own process group so it can be stopped whole.
const server = spawn("npx", ["wrangler", "dev", "--local", "--env", "local", "--port", port], {
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
});
let serverDied = false;
server.on("exit", () => (serverDied = true));
const stop = () => {
  if (!serverDied) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
};
process.on("SIGINT", () => (stop(), process.exit(130)));
process.on("SIGTERM", () => (stop(), process.exit(143)));

try {
  let ready = false;
  for (let i = 0; i < 180 && !ready && !serverDied; i++) {
    ready = await fetch(base + "/api/party/config").then((r) => r.ok, () => false);
    if (!ready) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) {
    console.log("The local Worker did not come up on " + base);
    results.push({ name: "start local Worker", code: 1, seconds: 0 });
  } else {
    // Stop at the first failure: the later scripts only add noise once the room is broken.
    for (const [name, script] of [
      ["room, over sockets (test:room)", "test:room"],
      ["party room, over sockets (test:lobby)", "test:lobby"],
      ["Cork & Bell in the party room, headless browser (test:cork)", "test:cork"],
    ]) {
      if (!(await step(name, npm, ["run", script, "--", `--base=${base}`]))) break;
    }
  }
} finally {
  stop();
}
process.exit(summary());
