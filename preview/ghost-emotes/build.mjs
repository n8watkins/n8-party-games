// Builds the ghost emotes preview into one self-contained file: dist/index.html.
//
//   node preview/ghost-emotes/build.mjs            with the room's recordings embedded
//   node preview/ghost-emotes/build.mjs --no-sound  without them
//
// Everything is inlined: the page's own code, three.js (the version the room uses), the room's
// own emote drawing (lobby/public/emotes/svg.js, look3d/emote-arms.js) and, as base64, the
// room's recording for each emote (lobby/public/sounds/emote-<id>.mp3). The page makes no
// request to anywhere. The output has no <html>, <head> or <body> of its own: a hosted page
// (an Artifact) wraps it. dist/wrapped.html is the same page inside that wrapper, for opening
// and checking locally.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const withSound = !process.argv.includes("--no-sound");

const EMOTES = (await import(join(repo, "party-kit", "client", "emotes.js"))).EMOTES;

async function sounds() {
  if (!withSound) return "export default null;";
  const out = {};
  for (const { id } of EMOTES) out[id] = (await readFile(join(repo, "lobby", "public", "sounds", `emote-${id}.mp3`))).toString("base64");
  return `export default ${JSON.stringify(out)};`;
}

const result = await build({
  entryPoints: [join(here, "src", "main.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  legalComments: "none",
  plugins: [
    {
      name: "preview",
      setup(b) {
        // The room takes three.js from the copy Cork & Bell ships; here it is the same version from node_modules, once.
        b.onResolve({ filter: /^\/cork-and-bell\/game\/vendor\/three\.module\.js$/ }, () => b.resolve("three", { kind: "import-statement", resolveDir: here }));
        b.onResolve({ filter: /^virtual:sounds$/ }, () => ({ path: "sounds", namespace: "virtual" }));
        b.onLoad({ filter: /.*/, namespace: "virtual" }, async () => ({ contents: await sounds(), loader: "js" }));
      },
    },
  ],
});

const js = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const page = (await readFile(join(here, "src", "page.html"), "utf8")).replace("/*BUNDLE*/", () => js);

// The rig here and the room's list must name the same emotes, in the same order.
const { GHOST_RIG } = await import(join(here, "src", "ghost-rig.js"));
const mine = GHOST_RIG.map((e) => e.id).join(",");
const theirs = EMOTES.map((e) => e.id).join(",");
if (mine !== theirs) throw new Error(`The ghost's emotes (${mine}) are not the room's (${theirs}).`);
if (/(src|href)=["']?https?:|url\(\s*["']?https?:/i.test(page.replace(js, ""))) throw new Error("The page asks for something from outside.");

// What a hosted page puts round the file (the Artifact skeleton), for local checks.
const WRAP =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';

await mkdir(join(here, "dist"), { recursive: true });
await writeFile(join(here, "dist", "index.html"), page);
await writeFile(join(here, "dist", "wrapped.html"), WRAP + page);
console.log(`dist/index.html  ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB  (${withSound ? `${EMOTES.length} recordings embedded` : "no sound"})`);
