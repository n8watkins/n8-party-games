// Builds a public folder: the only files a Worker serves as static assets.
//
// Everything a browser needs is copied in from an allowlist of entries; nothing else in a
// repository (server sources, tools, tests, notes, screenshots, node_modules, .git, local
// profiles, secrets files) can reach the public site, whatever lands in the working tree later.
// The party site and every game's own site build the same way, so it lives in the kit:
//
//   import { buildPublic, kitClientEntry } from "n8-party-games/kit/build";
//   buildPublic({ out, entries: [kitClientEntry(), { from: "/abs/game", to: "my-game/game" }] });
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Workers Static Assets refuses any single file over 25 MiB. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Cloudflare Turnstile's script and widget frame, allowed so a configured bot check can render. */
const TURNSTILE = "https://challenges.cloudflare.com";

/**
 * Cloudflare Web Analytics: on a zone with it switched on, Cloudflare adds its beacon script to
 * every page, and the beacon reports to cloudflareinsights.com. Allowed so it is not refused with
 * a CSP error on every page load.
 */
const WEB_ANALYTICS_SCRIPT = "https://static.cloudflareinsights.com";
const WEB_ANALYTICS_REPORT = "https://cloudflareinsights.com";

/** Where the kit's browser files are served: games import them by this site path. */
export const KIT_CLIENT_PATH = "party-kit/client";

/** The entry that puts the kit's browser files (client, lobby, bot check) on a site. */
export function kitClientEntry() {
  return { from: resolve(dirname(fileURLToPath(import.meta.url)), "..", "client"), to: KIT_CLIENT_PATH };
}

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
    `script-src 'self' ${scriptHashes.join(" ")} ${TURNSTILE} ${WEB_ANALYTICS_SCRIPT}`.replace(/\s+/g, " "),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${WEB_ANALYTICS_REPORT}`,
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

/**
 * Empties `out` and fills it from `entries`: each `{from, to}` copies the file or folder at the
 * absolute path `from` to the site path `to` (no leading slash). Writes the `_headers` file.
 * Returns every file written as `{path, bytes}`, sorted by path.
 */
export function buildPublic({ out, entries }) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const { from, to } of entries) {
    if (!to || to.startsWith("/") || to.split("/").includes("..")) throw new Error(`Not a site path: ${to}`);
    cpSync(from, join(out, to), {
      recursive: true,
      // Dotfiles (editor swap files, .DS_Store) never belong on the site.
      filter: (src) => !relative(from, src).split(sep).some((part) => part.startsWith(".")),
    });
  }
  const files = walk(out);
  const tooBig = files.filter((f) => statSync(f).size > MAX_FILE_BYTES);
  if (tooBig.length) throw new Error(`Over the 25 MiB per-file limit: ${tooBig.map((f) => relative(out, f)).join(", ")}`);
  writeFileSync(join(out, "_headers"), headersFile(inlineScriptHashes(files)));
  return files.map((f) => ({ path: relative(out, f).split(sep).join("/"), bytes: statSync(f).size })).sort((a, b) => a.path.localeCompare(b.path));
}

/** The command line every site's build script shares: build, then a one-line summary, or the whole list with --list. */
export function report(files, out, argv = process.argv) {
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (argv.includes("--list")) for (const f of files) console.log(String(f.bytes).padStart(10), f.path);
  console.log(`public site: ${files.length} files, ${(total / 1048576).toFixed(1)} MiB in ${relative(process.cwd(), out)}`);
}
