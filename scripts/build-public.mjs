// Builds dist/public, the only folder the Worker serves as static files.
//
// Everything a browser needs is copied here from an allowlist; nothing else in the repository
// (sources of the server, tools, tests, notes, screenshots, node_modules, .git, local profiles,
// secrets files) can reach the public site, whatever lands in the working tree later.
// Wrangler runs this before `wrangler dev` and `wrangler deploy` (the "build" key in
// wrangler.jsonc) and again whenever a watched folder changes.
//
//   node scripts/build-public.mjs          build, print a one-line summary
//   node scripts/build-public.mjs --list   build and list every file that will be served
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = join(ROOT, "dist", "public");

/** Files and folders the browser loads. Add a new game's page and its browser folder here. */
export const SERVED = ["cork-and-bell/index.html", "cork-and-bell/game", "party-kit/client"];

/** Workers Static Assets refuses any single file over 25 MiB. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Cloudflare Turnstile's script and widget frame, allowed so a configured bot check can render. */
const TURNSTILE = "https://challenges.cloudflare.com";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : d.isFile() ? [p] : [];
  });
}

/** sha256 hashes of every inline <script> in the served pages (the import maps), for the CSP. */
function inlineScriptHashes(files) {
  const hashes = new Set();
  for (const file of files.filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(m[1])) continue;
      hashes.add(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
    }
  }
  return [...hashes].sort();
}

/**
 * The headers for every static file (Workers Static Assets reads `_headers`; it is not served).
 * Responses made by the Worker itself (the API) set their own: see party-kit/src/worker/http.js.
 */
export function headersFile(scriptHashes) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")} ${TURNSTILE}`.replace(/\s+/g, " "),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${TURNSTILE}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "",
  ].join("\n");
}

export function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const entry of SERVED) {
    cpSync(join(ROOT, entry), join(OUT, entry), {
      recursive: true,
      // Dotfiles (editor swap files, .DS_Store) never belong on the site.
      filter: (src) => !relative(ROOT, src).split(sep).some((part) => part.startsWith(".")),
    });
  }
  const files = walk(OUT);
  const tooBig = files.filter((f) => statSync(f).size > MAX_FILE_BYTES);
  if (tooBig.length) throw new Error(`Over the 25 MiB per-file limit: ${tooBig.map((f) => relative(OUT, f)).join(", ")}`);
  writeFileSync(join(OUT, "_headers"), headersFile(inlineScriptHashes(files)));
  return files.map((f) => ({ path: relative(OUT, f).split(sep).join("/"), bytes: statSync(f).size })).sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = build();
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (process.argv.includes("--list")) for (const f of files) console.log(String(f.bytes).padStart(10), f.path);
  console.log(`public site: ${files.length} files, ${(total / 1048576).toFixed(1)} MiB in ${relative(ROOT, OUT)}`);
}
