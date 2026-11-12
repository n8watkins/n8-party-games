// Builds dist/public, the only folder the Worker serves as static files.
//
// The work is done by the kit (party-kit/build/public.mjs): files are copied in from an
// allowlist, and nothing else in the repository can reach the public site.
// Wrangler runs this before `wrangler dev` and `wrangler deploy` (the "build" key in
// wrangler.jsonc) and again whenever a watched folder changes.
//
//   node scripts/build-public.mjs          build, print a one-line summary
//   node scripts/build-public.mjs --list   build and list every file that will be served
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_CLIENT_PATH, buildPublic, kitClientEntry, report } from "../party-kit/build/public.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = join(ROOT, "dist", "public");

/** Files and folders the browser loads, by site path. Add a new game's page and its browser folder here. */
export const SERVED = ["cork-and-bell/index.html", "cork-and-bell/game", KIT_CLIENT_PATH];

export function build() {
  return buildPublic({
    out: OUT,
    entries: [kitClientEntry(), ...SERVED.filter((to) => to !== KIT_CLIENT_PATH).map((to) => ({ from: join(ROOT, to), to }))],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) report(build(), OUT);
