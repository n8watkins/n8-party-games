// Starts the local server so phones on the same network can join: it listens on every
// interface and tells the kit which address to put in the join link and the QR code.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const port = process.env.PORT ?? "8791";
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);
// Prefer an ordinary home or office address over VPN ranges.
const lan = addresses.find((a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? addresses[0] ?? "localhost";
const origin = `http://${lan}:${port}`;
console.log(`Shared screen:  ${origin}/cork-and-bell/`);
console.log(`Phones join at: ${origin}/cork-and-bell/ (or scan the QR code in the lobby)`);
const child = spawn("npx", ["wrangler", "dev", "--local", "--env", "local", "--ip", "0.0.0.0", "--port", port, "--var", `PARTY_PUBLIC_ORIGIN:${origin}`], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
