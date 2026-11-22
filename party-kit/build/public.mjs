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

/**
 * Cloudflare Turnstile's script, widget frame and the calls its script makes, allowed on the pages
 * that make rooms (headersFile, `botCheck`) so a configured bot check can run there.
 * https://developers.cloudflare.com/turnstile/reference/content-security-policy/
 */
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

/** The kit's bot check module: a page can make a room with the check on only if it loads this. */
export const BOT_CHECK_MODULE = `${KIT_CLIENT_PATH}/bot-check.js`;

/** Code with its comments taken out, so an import named in a comment (a JSDoc type) is not followed. */
function withoutComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** The module specifiers a script names: static imports and re-exports, and import() of a plain string. */
function specifiers(code) {
  const text = withoutComments(code);
  const found = [];
  for (const m of text.matchAll(/\b(?:import|export)\s[^;'"`]*?\bfrom\s*["']([^"']+)["']/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\s*["']([^"']+)["']/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  return found;
}

/**
 * Every file in `out` that the page at `page` (a path inside `out`) loads as a module, the page's
 * own module scripts first: followed through static imports, re-exports and import() of a plain
 * string, resolving site paths ("/x.js"), relative ones and the page's import map. What it cannot
 * see (an import() of a computed name) it does not follow.
 */
export function moduleGraph(out, page) {
  const html = readFileSync(page, "utf8");
  const map = {};
  for (const m of html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi)) Object.assign(map, JSON.parse(m[1]).imports ?? {});
  // A script tag's src is a URL ("main.js" is next to the page); a module specifier without ./ is bare.
  const resolveFrom = (from, spec, url = false) => {
    if (/^[a-z]+:/i.test(spec) || spec.startsWith("//")) return null;
    const bare = !url && !spec.startsWith("/") && !spec.startsWith("./") && !spec.startsWith("../");
    if (bare) {
      const key = Object.keys(map).find((k) => spec === k || (k.endsWith("/") && spec.startsWith(k)));
      if (!key) return null;
      spec = map[key] + spec.slice(key.length);
      from = page;
    }
    const path = spec.startsWith("/") ? join(out, spec.split(/[?#]/)[0]) : resolve(dirname(from), spec.split(/[?#]/)[0]);
    return path.startsWith(out + sep) ? path : null;
  };
  const seen = new Set();
  const queue = [];
  const add = (path) => {
    if (path && !seen.has(path) && statSync(path, { throwIfNoEntry: false })?.isFile()) {
      seen.add(path);
      queue.push(path);
    }
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type=["']module["']/.test(m[1])) continue;
    const src = m[1].match(/\bsrc=["']([^"']+)["']/)?.[1];
    if (src) add(resolveFrom(page, src, true));
    else for (const spec of specifiers(m[2])) add(resolveFrom(page, spec));
  }
  while (queue.length) {
    const file = queue.shift();
    if (file.endsWith(".js") || file.endsWith(".mjs")) for (const spec of specifiers(readFileSync(file, "utf8"))) add(resolveFrom(file, spec));
  }
  return [...seen];
}

/**
 * The site paths (for headersFile's `botCheck`) of the pages in `out` that can make a room with the
 * bot check on: those whose module graph loads the kit's bot check (BOT_CHECK_MODULE). Each is
 * the page's folder ("/lobby/*"); a page inside a folder already listed adds nothing.
 */
export function roomMakingPages(out) {
  const target = join(out, BOT_CHECK_MODULE);
  const folders = walk(out)
    .filter((f) => f.endsWith(".html") && moduleGraph(out, f).includes(target))
    .map((f) => `/${relative(out, dirname(f)).split(sep).join("/")}/`.replace(/^\/\/$/, "/") + "*")
    .sort();
  return folders.filter((path) => !folders.some((other) => other !== path && path.startsWith(other.slice(0, -1))));
}

/**
 * The headers for every static file (Workers Static Assets reads `_headers`; it is not served).
 * Responses made by the Worker itself (the API) set their own: see party-kit/src/worker/http.js.
 *
 * `frames` is who may put this site's pages in a frame. "none" (the default): nobody. "self": the
 * site's own pages, and only those, which a site needs when one of its pages shows another of
 * its pages in a frame (the party room mounts a game's page that way). No other site ever may.
 *
 * `images` maps a site path ("/party/*") to the outside origins (https only) its pages may show
 * pictures from; none by default. Those pages get the very same policy with only img-src widened.
 *
 * `botCheck` lists the site paths whose pages may run the bot check on making a room (Cloudflare
 * Turnstile, client/bot-check.js): they may load its script, show its frame and let it call home,
 * all from https://challenges.cloudflare.com and nowhere else. ["/*"] (the default) is every page,
 * for a game's own site whose pages all make rooms; a site that lists its room-making pages gives
 * the rest no Turnstile at all. A listed page gets the very same policy with only those widened.
 *
 * A page path may be listed in `images` and `botCheck` both (its policy has both), but two
 * different listed paths may not overlap: a page matched by two would be sent two policies, and a
 * browser keeps to both.
 */
export function headersFile(scriptHashes, { frames = "none", microphone = [], images = {}, botCheck = ["/*"] } = {}) {
  const own = frames === "self";
  for (const origins of Object.values(images)) for (const origin of origins) if (!/^https:\/\/[a-z0-9.-]+$/.test(origin)) throw new Error(`Not an https origin for img-src: ${origin}`);
  for (const path of botCheck) if (!/^\/[A-Za-z0-9._~/-]*\*?$/.test(path)) throw new Error(`Not a site path for the bot check: ${path}`);
  const everywhere = botCheck.includes("/*");
  // The pages whose policy differs from the site-wide one, each with what it adds.
  const widened = new Map();
  for (const [path, origins] of Object.entries(images)) widened.set(path, { images: origins, turnstile: everywhere });
  if (!everywhere) for (const path of botCheck) widened.set(path, { images: widened.get(path)?.images ?? [], turnstile: true });
  const paths = [...widened.keys()];
  const covers = (wide, path) => wide !== path && wide.endsWith("*") && path.startsWith(wide.slice(0, -1));
  for (const a of paths) for (const b of paths) if (covers(a, b)) throw new Error(`Overlapping header paths: ${a} covers ${b}`);
  const csp = ({ images: extra = [], turnstile = everywhere } = {}) => [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes, ...(turnstile ? [TURNSTILE] : []), WEB_ANALYTICS_SCRIPT].join(" "),
    "style-src 'self'",
    ["img-src 'self' data: blob:", ...extra].join(" "),
    "font-src 'self'",
    ["connect-src 'self'", ...(turnstile ? [TURNSTILE] : []), WEB_ANALYTICS_REPORT].join(" "),
    `frame-src ${[...(own ? ["'self'"] : []), ...(turnstile ? [TURNSTILE] : [])].join(" ") || "'none'"}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${own ? "'self'" : "'none'"}`,
  ].join("; ");
  const policy = (mic) => `camera=(), microphone=${mic}, geolocation=(), payment=(), usb=()`;
  return [
    "/*",
    `  Content-Security-Policy: ${csp()}`,
    "  X-Content-Type-Options: nosniff",
    `  X-Frame-Options: ${own ? "SAMEORIGIN" : "DENY"}`,
    "  Referrer-Policy: strict-origin-when-cross-origin",
    `  Permissions-Policy: ${policy("()")}`,
    // A path in `microphone` may use the microphone on this site's own pages: the site-wide
    // policy is detached ("!") and the same one sent with only microphone=(self) changed.
    ...microphone.flatMap((path) => [path, "  ! Permissions-Policy", `  Permissions-Policy: ${policy("(self)")}`]),
    // A path in `images` or `botCheck` gets what it adds: the same policy, detached and resent.
    ...[...widened].flatMap(([path, adds]) => [path, "  ! Content-Security-Policy", `  Content-Security-Policy: ${csp(adds)}`]),
    "",
  ].join("\n");
}

/**
 * Empties `out` and fills it from `entries`: each `{from, to}` copies the file or folder at the
 * absolute path `from` to the site path `to` (no leading slash). Writes the `_headers` file.
 * Returns every file written as `{path, bytes}`, sorted by path. `frames`, `microphone` (the
 * site paths, such as "/lab/x/*", whose pages may use the microphone) and `images` (site path ->
 * the outside origins its pages may show pictures from) and `botCheck` (the site paths whose
 * pages may run the bot check; every page by default) are passed to headersFile. `botCheck:
 * "room-making"` finds those paths in what was built: the pages that load the kit's bot check
 * (roomMakingPages).
 */
export function buildPublic({ out, entries, frames = "none", microphone = [], images = {}, botCheck = ["/*"] }) {
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
  const botPages = botCheck === "room-making" ? roomMakingPages(resolve(out)) : botCheck;
  writeFileSync(join(out, "_headers"), headersFile(inlineScriptHashes(files), { frames, microphone, images, botCheck: botPages }));
  return files.map((f) => ({ path: relative(out, f).split(sep).join("/"), bytes: statSync(f).size })).sort((a, b) => a.path.localeCompare(b.path));
}

/** The command line every site's build script shares: build, then a one-line summary, or the whole list with --list. */
export function report(files, out, argv = process.argv) {
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (argv.includes("--list")) for (const f of files) console.log(String(f.bytes).padStart(10), f.path);
  console.log(`public site: ${files.length} files, ${(total / 1048576).toFixed(1)} MiB in ${relative(process.cwd(), out)}`);
}
