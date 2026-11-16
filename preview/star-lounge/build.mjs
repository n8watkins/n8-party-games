// Builds the Star Lounge preview: one self-contained page, with every picture and the script inside it.
//
//   node preview/star-lounge/build.mjs assets [--before=<folder of stills>]
//       turns the Blender passes (lobby/tools/blender/out, after `run.sh pack`) into the room's
//       rendered layers (lobby/public/look3d/rendered/star-lounge/layers: the party room serves
//       them and draws the Star Lounge from them with ?look=real), and the two stills of today's
//       room into preview/star-lounge/assets if a folder is given
//       (lobby/test/shoot-3d.mjs --room=ship makes them: 05-phone-vote-whole-room.png, 04-phone-vote-closer.png)
//   node preview/star-lounge/build.mjs
//       bundles src/main.js with three.js and the room's own drawing of the Star Lounge (the same
//       modules the party room loads), and writes preview/star-lounge/star-lounge.html from
//       src/page.html, the room's layers and the two stills
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
/** The preview's own pictures: the two stills of today's room. */
const assets = join(here, "assets");
/** The room's rendered layers, which the preview shows too. */
const layers = join(root, "lobby/public/look3d/rendered/star-lounge/layers");
const out = join(root, "lobby/tools/blender/out");
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");

if (args[0] === "assets") {
  mkdirSync(assets, { recursive: true });
  mkdirSync(layers, { recursive: true });
  const webp = (from, name, o = {}, resize = null) => {
    let img = sharp(from);
    if (resize) img = img.resize(resize);
    return img.webp({ effort: 6, ...o }).toFile(join(layers, name + ".webp"));
  };
  await webp(join(out, "pack/base.png"), "base", { quality: 92 });
  await webp(join(out, "pack/lights.png"), "lights", { quality: 84 });
  await webp(join(out, "pack/cards.png"), "cards", { quality: 88, alphaQuality: 95 });
  await webp(join(out, "env.png"), "env", { quality: 78 });
  // Round two: the planet's surface at 4096 across (render.sh), twice round one's, when it is there.
  const planet2 = join(here, "out/tex-planet.png");
  await webp(existsSync(planet2) ? planet2 : join(out, "tex-planet.png"), "planet", { quality: existsSync(planet2) ? 74 : 82 });
  await webp(join(out, "tex-moon.png"), "moon", { quality: 78 });
  await webp(join(out, "tex-sky.png"), "sky", { quality: 60 }, { width: 1024 });
  // Round two: the passing things come from preview/star-lounge/out (render.sh: the same scene at twice the size) when they are there.
  const out2 = join(here, "out");
  for (const s of ["liner", "rocket", "saucer", "rock0", "rock1", "rock2"]) {
    const big = join(out2, `sprite-${s}.png`);
    await webp(existsSync(big) ? big : join(out, `sprite-${s}.png`), s, { quality: 86, alphaQuality: 90 });
  }
  writeFileSync(join(layers, "plate.json"), readFileSync(join(out, "pack/plate.json")));
  const before = opt("before");
  if (before) {
    // Only the room: the strip of buttons under it is cut off, because the preview has its own.
    for (const [file, name] of [["05-phone-vote-whole-room.png", "before-room"], ["04-phone-vote-closer.png", "before-closer"]])
      await sharp(join(before, file)).extract({ left: 0, top: 0, width: 1688, height: 640 }).webp({ quality: 78, effort: 6 }).toFile(join(assets, name + ".webp"));
  }
  let total = 0;
  for (const f of readdirSync(layers).sort()) {
    const size = statSync(join(layers, f)).size;
    total += size;
    console.log(String(Math.round(size / 1024)).padStart(6) + " KB  " + f);
  }
  console.log(String(Math.round(total / 1024)).padStart(6) + " KB  the room's layers (what a device with ?look=real fetches in the Star Lounge)");
  process.exit(0);
}

const three = join(root, "node_modules/three/build/three.module.js");
const bundle = await build({
  entryPoints: [join(here, "src/main.js")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  target: "es2020",
  legalComments: "none",
  define: { "import.meta.url": '"https://preview.invalid/"' },
  plugins: [
    {
      // The room gets three.js from the copy the site serves; here it comes from node_modules, once.
      name: "one-three",
      setup(b) {
        b.onResolve({ filter: /^three$|three\.module\.js$/ }, () => ({ path: three }));
        // The site serves lobby/shared beside lobby/public's folders; in the repository it is one level up.
        b.onResolve({ filter: /^(\.\.\/)+shared\// }, (a) => {
          const at = resolve(dirname(a.importer), a.path);
          const pub = join(root, "lobby/public/shared/");
          return at.startsWith(pub) ? { path: join(root, "lobby/shared", at.slice(pub.length)) } : null;
        });
      },
    },
  ],
});
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const A = {};
for (const folder of [layers, assets]) for (const f of readdirSync(folder)) if (f.endsWith(".webp")) A[f.replace(".webp", "").replace(/-(\w)/g, (_, c) => c.toUpperCase())] = dataUri(join(folder, f), "image/webp");
A.corkArt = dataUri(join(root, "lobby/public/look3d/art/cork-and-bell.jpg"), "image/jpeg");
for (const need of ["base", "lights", "cards", "env", "planet", "moon", "sky", "liner", "rocket", "saucer", "rock0", "rock1", "rock2", "beforeRoom", "beforeCloser"]) if (!A[need]) throw new Error(`there is no picture for "${need}": run "node preview/star-lounge/build.mjs assets" first`);
const fonts = `
  @font-face { font-family: "Abril Fatface"; font-weight: 400; src: url(${dataUri(join(root, "node_modules/cork-and-bell/game/fonts/AbrilFatface-Regular.ttf"), "font/ttf")}) format("truetype"); }
  @font-face { font-family: "Nunito"; font-weight: 500 900; src: url(${dataUri(join(root, "lobby/public/look3d/fonts/nunito-latin-900-normal.woff2"), "font/woff2")}) format("woff2"); }`;
const data = `window.__ASSETS = ${JSON.stringify(A)};\n  window.__PLATE = ${readFileSync(join(layers, "plate.json"), "utf8")};\n  window.__CFG = ${readFileSync(join(root, "lobby/tools/blender/star-lounge.json"), "utf8")};`;
const code = bundle.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const page = readFileSync(join(here, "src/page.html"), "utf8")
  .replace("/*FONTS*/", () => fonts)
  .replace("/*DATA*/", () => data)
  .replace("/*BUNDLE*/", () => code);
if (page.includes(String.fromCharCode(8212))) throw new Error("the page has an em dash in it");
const file = join(here, "star-lounge.html");
writeFileSync(file, page);
console.log(`wrote ${file}: ${(page.length / 1024 / 1024).toFixed(2)} MB (script ${(code.length / 1024).toFixed(0)} KB)`);
if (!existsSync(file)) process.exit(1);
