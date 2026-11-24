// Makes the Paper Masks pictures the Table's page shows, from the owner's paintings.
//
//   node games/paper-masks/tools/make-art.mjs <paintings folder>
//
// The folder holds his PNGs (pm-masks-sheet-b.png, pm-mask-blank.png, pm-mask-back.png,
// pm-reveal-flourish.png, pm-table.png, pm-table-wide.png, pm-door.png). The WebP files land in
// public/paper-masks/art/ in this game's folder, which the site serves at
// /party/games/paper-masks/art/; this script stays on the server side.
//
// The cut-outs are transparent PNGs whose fully transparent pixels still carry colour (a dark
// ground and a glow). Resizing them as they are drags that hidden colour into the edges, which
// then shows as a dark or coloured fringe. So, for every transparent picture:
//   1. alpha is snapped: below 6 is 0 (the faint halo goes), 236 and up is 255 (the sheets top out
//      at 250 to 254, so the bodies were 1 to 2 percent see-through), the band between stretched;
//   2. the colour under alpha 0 is thrown away;
//   3. it is resized in premultiplied form (colour times alpha, and alpha, resized separately),
//      so a transparent pixel adds nothing to its neighbours, then divided back;
//   4. the colour of the edge is bled outwards into the transparent pixels, and the WebP keeps it
//      (`exact`), so the lossy encoder never blurs a dark ground into an edge.
// The masks sheet (sheet B, the owner's pick in round three) is cut into its eight masks the
// way the round-three preview did: each solid piece goes to its cell of the 4 x 2 grid.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: make-art.mjs <paintings folder>");
const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(GAME, "public", "paper-masks", "art");
mkdirSync(OUT, { recursive: true });

const NAMES = ["fox", "moon", "sun", "owl", "butterfly", "jester", "plume", "leaf"];
const LO = 6;
const HI = 236;

async function load(file) {
  const { data, info } = await sharp(join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), w: info.width, h: info.height };
}

/** Steps 1 and 2: snap alpha and drop the colour under alpha 0. Changes the image in place. */
function snap(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let a = d[i + 3];
    if (a < LO) a = 0;
    else if (a >= HI) a = 255;
    else a = Math.min(254, Math.max(1, Math.floor(((a - LO) * 255) / (HI - LO))));
    d[i + 3] = a;
    if (a === 0) d[i] = d[i + 1] = d[i + 2] = 0;
  }
  return img;
}

function crop(img, x0, y0, x1, y1) {
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1) * 4), y * w * 4);
  return { data: out, w, h };
}

/** The box around every pixel with alpha above 0. */
function trim(img) {
  let x0 = img.w, y0 = img.h, x1 = 0, y1 = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x >= x1) x1 = x + 1;
        if (y >= y1) y1 = y + 1;
      }
  return crop(img, x0, y0, x1, y1);
}

/** Centred on a transparent square with a little room around it, so every mask lines up in the reveal. */
function square(img, pad = 0.04) {
  const side = Math.round(Math.max(img.w, img.h) * (1 + 2 * pad));
  const out = new Uint8ClampedArray(side * side * 4);
  const ox = Math.floor((side - img.w) / 2);
  const oy = Math.floor((side - img.h) / 2);
  for (let y = 0; y < img.h; y++) out.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((oy + y) * side + ox) * 4);
  return { data: out, w: side, h: side };
}

/** Step 3: resize colour-times-alpha and alpha separately (neither has an alpha channel to sharp). */
async function resizePremultiplied(img, w, h) {
  const n = img.w * img.h;
  const rgb = Buffer.alloc(n * 3);
  const alpha = Buffer.alloc(n);
  for (let p = 0; p < n; p++) {
    const a = img.data[p * 4 + 3];
    alpha[p] = a;
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round((img.data[p * 4 + c] * a) / 255);
  }
  const opts = { kernel: "lanczos3", fit: "fill" };
  const r = await sharp(rgb, { raw: { width: img.w, height: img.h, channels: 3 } }).resize(w, h, opts).raw().toBuffer();
  const a = await sharp(alpha, { raw: { width: img.w, height: img.h, channels: 1 } }).resize(w, h, opts).extractChannel(0).raw().toBuffer();
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const al = a[p] < 2 ? 0 : a[p];
    out[p * 4 + 3] = al;
    for (let c = 0; c < 3; c++) out[p * 4 + c] = al ? Math.min(255, Math.round((r[p * 3 + c] * 255) / al)) : 0;
  }
  return { data: out, w, h };
}

/** Step 4: every transparent pixel takes the colour of its nearest coloured neighbours. */
function bleed(img) {
  const { w, h, data } = img;
  const known = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) known[p] = data[p * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < 24; pass++) {
    const add = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (known[p]) continue;
        let r = 0, g = 0, b = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (!known[q]) continue;
            r += data[q * 4];
            g += data[q * 4 + 1];
            b += data[q * 4 + 2];
            k++;
          }
        if (k) add.push([p, r / k, g / k, b / k]);
      }
    if (!add.length) break;
    for (const [p, r, g, b] of add) {
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
      known[p] = 1;
    }
  }
  return img;
}

async function saveCutout(img, file, w, h = w) {
  const small = bleed(await resizePremultiplied(img, w, h));
  const buf = await sharp(Buffer.from(small.data.buffer), { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 86, alphaQuality: 100, effort: 6, exact: true }).toBuffer();
  writeFileSync(join(OUT, file), buf);
  return buf.length;
}

async function savePainting(file, out, w, quality = 80) {
  const buf = await sharp(join(SRC, file)).resize(w, null, { kernel: "lanczos3" }).webp({ quality, effort: 6 }).toBuffer();
  writeFileSync(join(OUT, out), buf);
  return buf.length;
}

/** Labels the solid pieces (alpha 128 and up) of the sheet, 4-connected. */
function pieces(img) {
  const { w, h, data } = img;
  const label = new Int32Array(w * h);
  const found = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] || data[start * 4 + 3] < 128) continue;
    const id = found.length + 1;
    let size = 0, sx = 0, sy = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      size++;
      sx += x;
      sy += y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || label[q] || data[q * 4 + 3] < 128) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    found.push({ id, size, cx: sx / size, cy: sy / size });
  }
  return { label, found };
}

/** 4-neighbour dilation, `times` over. */
function dilate(bits, w, h, times) {
  let cur = bits;
  for (let t = 0; t < times; t++) {
    const next = cur.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (cur[p]) continue;
        if ((x > 0 && cur[p - 1]) || (x < w - 1 && cur[p + 1]) || (y > 0 && cur[p - w]) || (y < h - 1 && cur[p + w])) next[p] = 1;
      }
    cur = next;
  }
  return cur;
}

const report = {};

// The eight masks, from sheet B.
{
  const sheet = await load("pm-masks-sheet-b.png");
  const { w, h } = sheet;
  const { label, found } = pieces(sheet);
  const cellOf = new Map();
  for (const p of found) {
    if (p.size < 30) continue; // dust
    const col = Math.min(3, Math.floor(p.cx / (w / 4)));
    const row = Math.min(1, Math.floor(p.cy / (h / 2)));
    cellOf.set(p.id, row * 4 + col);
  }
  const bodies = NAMES.map((_, k) => {
    const bits = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) if (label[p] && cellOf.get(label[p]) === k) bits[p] = 1;
    return bits;
  });
  for (let k = 0; k < NAMES.length; k++) {
    const keep = dilate(bodies[k], w, h, 3);
    const others = new Uint8Array(w * h);
    for (let j = 0; j < NAMES.length; j++) if (j !== k) for (let p = 0; p < w * h; p++) if (bodies[j][p]) others[p] = 1;
    const near = dilate(others, w, h, 1);
    const piece = { data: new Uint8ClampedArray(sheet.data), w, h };
    for (let p = 0; p < w * h; p++) if (!keep[p] || near[p]) piece.data[p * 4 + 3] = 0;
    const cut = square(trim(snap(piece)));
    report[NAMES[k]] = { px: [cut.w, cut.h], b512: await saveCutout(cut, `mask-${NAMES[k]}-512.webp`, 512), b128: await saveCutout(cut, `mask-${NAMES[k]}-128.webp`, 128) };
  }
}

// The plain mask: the same square framing, so it lies exactly over the author's mask in the reveal.
{
  const cut = square(trim(snap(await load("pm-mask-blank.png"))));
  report.blank = { b512: await saveCutout(cut, "mask-blank-512.webp", 512), b128: await saveCutout(cut, "mask-blank-128.webp", 128) };
}

// The card back, trimmed to the card (the brown border is hidden ground under alpha 0).
{
  const cut = trim(snap(await load("pm-mask-back.png")));
  const w = 400;
  const h = Math.round((cut.h / cut.w) * w);
  report.cardBack = { px: [w, h], from: [cut.w, cut.h], bytes: await saveCutout(cut, "card-back-400.webp", w, h) };
}

// The reveal flourish: a ring of light with a see-through middle.
{
  const cut = snap(await load("pm-reveal-flourish.png"));
  report.flourish = { bytes: await saveCutout(cut, "reveal-flourish-640.webp", 640) };
}

// The stage paintings (opaque): his table for phones and for wide screens, and the door for the list.
report.tableTall = await savePainting("pm-table.png", "table-tall-1024.webp", 1024);
report.tableWide = await savePainting("pm-table-wide.png", "table-wide-1536.webp", 1536);
report.door = await savePainting("pm-door.png", "door-480.webp", 480, 78);

console.log(JSON.stringify(report, null, 1));
