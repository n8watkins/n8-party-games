// Builds dist/public, the only folder the Worker serves as static files.
//
// The work is done by the kit (party-kit/build/public.mjs). Each hosted game (games.js) lists
// its public files in its manifest; they are copied from the game's package in node_modules to
// the game's path on the site, beside the kit's browser files. Nothing else can reach the site.
// Wrangler runs this before `wrangler dev` and `wrangler deploy` (the "build" key in
// wrangler.jsonc) and again whenever a watched folder changes.
//
//   node scripts/build-public.mjs            build, print a one-line summary
//   node scripts/build-public.mjs --list     build and list every file that will be served
//   node scripts/build-public.mjs --preview  also build the pages that are not approved yet (below)
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_CLIENT_PATH, buildPublic, kitClientEntry, report } from "../party-kit/build/public.mjs";
import { GAMES, TURN_GAMES } from "../games.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = join(ROOT, "dist", "public");

const require = createRequire(import.meta.url);

/** One game's public files: from its package's folder to its path on the site. */
function gameEntries({ manifest }) {
  const from = dirname(require.resolve(`${manifest.id}/package.json`));
  const under = manifest.path.replace(/^\/|\/$/g, "");
  return manifest.public.map((file) => ({ from: join(from, file.from), to: `${under}/${file.to}` }));
}

/**
 * The site's own pages: the front page, the party room (the lobby) with the plain logic its page
 * shares with the room (lobby/shared), and the party's plain waiting room (party/public). The
 * lobby's server code is not among them.
 */
const siteEntries = [
  { from: join(ROOT, "site", "index.html"), to: "index.html" },
  { from: join(ROOT, "site", "site.css"), to: "site.css" },
  { from: join(ROOT, "site", "front.js"), to: "front.js" },
  // The web app manifest and its icons (scripts/make-icons.py draws them): "Add to Home Screen" opens the site full screen.
  { from: join(ROOT, "site", "manifest.webmanifest"), to: "manifest.webmanifest" },
  { from: join(ROOT, "site", "icons"), to: "icons" },
  // The party's plain waiting room (Turn-based), beside the character room at /lobby/ (lobby/shared/mode.js).
  { from: join(ROOT, "party", "public"), to: "party" },
  { from: join(ROOT, "lobby", "public"), to: "lobby" },
  { from: join(ROOT, "lobby", "shared"), to: "lobby/shared" },
  { from: join(ROOT, "lab", "hot-potato", "public"), to: "lab/hot-potato" }, // unlisted, throwaway: the Hot Potato hearing test
  // The Star Lounge's numbers, which its Blender scene and its rendered drawing in the room share (one file, not a copy).
  { from: join(ROOT, "lobby", "tools", "blender", "star-lounge.json"), to: "lobby/look3d/rendered/star-lounge/layers/star-lounge.json" },
];

/**
 * Pages still waiting for the owner's approval. They are built only with --preview, which the
 * local environment's build command passes (wrangler.jsonc, env.local) and the production one
 * does not, so they can be opened locally at /preview/... and never reach the live site.
 */
const previewEntries = [{ from: join(ROOT, "landing", "public"), to: "preview/landing" }];
const PREVIEW = process.argv.includes("--preview");

// A Table game's public files (its view) come from its package as any hosted game's do.
const entries = [kitClientEntry(), ...siteEntries, ...[...GAMES, ...TURN_GAMES].flatMap(gameEntries), ...(PREVIEW ? previewEntries : [])];

/**
 * Folders that hold server code and server-only data, never sent to a page: the room's own code,
 * and the Table games' rules (party/games: Paper Masks' questions.js holds its ghost answers). The
 * build refuses to copy anything from inside them, or any folder that holds one of them.
 */
export const SERVER_ONLY = [join(ROOT, "lobby", "server"), join(ROOT, "party", "games"), join(ROOT, "worker.js"), join(ROOT, "games.js")];
const inside = (path, folder) => path === folder || path.startsWith(folder + sep);
for (const { from } of entries) {
  const bad = SERVER_ONLY.find((folder) => inside(resolve(from), folder) || inside(folder, resolve(from)));
  if (bad) throw new Error(`build-public: ${relative(ROOT, from)} would publish server-only ${relative(ROOT, bad)}`);
}

/** Every site path that is served: the kit's browser files, the site's pages and each game's public files. */
export const SERVED = entries.map((entry) => entry.to);
/** Where each served path is copied from. */
export const SOURCES = entries.map((entry) => entry.from);

export function build() {
  // The party room shows a hosted game by putting the game's own page in a frame, so this site's
  // pages may be framed by this site's pages, and by nobody else.
  // The Hot Potato hearing test (lab/hot-potato) listens through the microphone; no other page may.
  return buildPublic({ out: OUT, entries, frames: "self", microphone: ["/lab/hot-potato/*"] });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) report(build(), OUT);
