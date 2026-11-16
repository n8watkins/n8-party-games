// Makes the bar's layers for its rendered drawing (lobby/public/look3d/rendered/bar/layers/) from
// the owner's painted pictures of the bar.
//
//   node lobby/tools/bar/layers.mjs [--art=<folder with the pictures>]
//
// The pictures are not in the repository (they are large); by default they are read from the
// owner's Downloads (n8games-art). It needs: bar-no-foreground.png (the room with nothing in
// front), bar-foreground.png (what stands in front of the pieces, on a clear picture) and
// bar-street.png (the street outside).
//
// What it writes, and why:
//   base.webp     the room as one picture, at one pixel per world unit, on the plate's rect: the
//                 painting with its five gold frames lifted out (they are drawn by the room, a
//                 little larger, over the posters) and the wall patched behind them, each
//                 frame's own soft shadow, the wooden join sign by the door (the code and QR are
//                 the room's live words on it), and the ceiling, floor and ends carried on past
//                 the painting's edges, darkening, so a tall or wide screen is filled.
//   lights.webp   the room's light tiles at half size: the glass (1 where the windows are, traced
//                 by hand pane by pane, with the ivy in front of them kept solid) and the soft
//                 cold light lightning throws into the room.
//   frames.webp   the five gold frames cut out of the painting, with their openings clear and the
//                 pale specks the painted prints left at the inner edge cleaned away.
//   front.webp    what stands in front of the pieces (stools, a plant, candles, a chair), in two
//                 pieces, one for each corner.
//   street-left.webp, street-right.webp   the street seen through each window, a little dark and
//                 soft (it is behind wet glass), with room to slide as the eye moves.
//   env.webp      the room all round, blurred, for the shine on the pieces.
//   plate.json    where all of that is. Numbers in painting pixels; `painting` says how they map
//                 to the room's world units (lobby/shared/world.js).
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=").slice(1).join("=");
const ART = resolve(opt("art", "/mnt/c/Users/natha/Downloads/n8games-art").replace(/^~/, homedir()));
const OUT = resolve(here, "..", "..", "public", "look3d", "rendered", "bar", "layers");
const WORK = resolve(opt("work", "/tmp/bar-layers-work"));
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------- the painting in the room

/** The painting's size, in its own pixels. */
const W = 1913;
const H = 822;
/**
 * The painting in world units: its width is the room's 1920, and its wall meets its floor
 * (painting y 605) where the 3D look's back wall meets its floor (world y 785, look3d/space.js),
 * which puts its floor line (y 702, where the preview stood its pieces) on the pieces' feet (881).
 */
const S = 1920 / W;
const OY = 785 - 605 * S;
/** The base's rect in world units: the painting with room to spare all round, for tall and wide screens. */
const RECT = { x0: -240, y0: -300, x1: 2160, y1: 1340 };
const BW = RECT.x1 - RECT.x0;
const BH = RECT.y1 - RECT.y0;
/** Where the painting's corner is on the base, and its size there. */
const AT = { x: Math.round(-RECT.x0), y: Math.round(OY - RECT.y0), w: 1920, h: Math.round(H * S) };

// ---------------------------------------------------------------- the windows, traced by hand (painting pixels)

function ellipseArch(x0, x1, cx, cy, rx, ry, yFlat, step = 2) {
  const pts = [];
  for (let x = x0; x <= x1 + 0.001; x += step) {
    const t = Math.min(1, Math.abs(x - cx) / rx);
    pts.push([x, Math.max(yFlat, cy - ry * Math.sqrt(1 - t * t))]);
  }
  if (pts[pts.length - 1][0] !== x1) {
    const t = Math.min(1, Math.abs(x1 - cx) / rx);
    pts.push([x1, Math.max(yFlat, cy - ry * Math.sqrt(1 - t * t))]);
  }
  return pts;
}
const archL = (x0, x1) => ellipseArch(x0, x1, 125.5, 125, 117, 73, 51);
const ARCH_R = [[1701, 100], [1706, 88], [1714, 77], [1724, 68], [1736, 60], [1750, 54], [1765, 50], [1780, 47], [1913, 47]];
function archR(x0, x1) {
  const out = [];
  for (let x = x0; x <= x1; x += 2) {
    let y = 47;
    for (let i = 0; i < ARCH_R.length - 1; i++) {
      const [ax, ay] = ARCH_R[i];
      const [bx, by] = ARCH_R[i + 1];
      if (x >= ax && x <= bx) {
        y = ay + ((by - ay) * (x - ax)) / (bx - ax);
        break;
      }
    }
    out.push([x, y]);
  }
  return out;
}
const archPane = (arch, x0, x1, yBottom) => [...arch(x0, x1), [x1, yBottom], [x0, yBottom]];
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PANES = [
  // The left window, over and beside the door.
  archPane(archL, 10, 80, 116.5),
  archPane(archL, 87, 165, 116.5),
  archPane(archL, 172, 241, 116.5),
  rect(10, 125, 80, 208),
  rect(87, 125, 165, 208),
  rect(172, 125, 241, 208),
  rect(10, 221, 47, 487),
  // The right window.
  archPane(archR, 1701, 1780, 116.5),
  archPane(archR, 1786, 1856, 116.5),
  archPane(archR, 1861, 1913, 116.5),
  rect(1701, 124, 1780, 195),
  rect(1786, 124, 1856, 195),
  rect(1861, 124, 1913, 195),
  rect(1700, 202, 1780, 486),
  rect(1786, 202, 1856, 486),
  rect(1861, 202, 1913, 486),
];
/** Each window's box (painting pixels): what is outside is laid out in it. */
const WINDOWS = { left: [6, 42, 246, 492], right: [1696, 40, 1913, 492] };
/**
 * The street seen through each window: a strip of bar-street.png (its pixels) from `x`, `w` wide,
 * shown at the preview's framing, with street pixel `mid` at the window's middle. The strips are
 * wider than the windows, so the street can slide behind the glass as the eye moves: a lot on the
 * side it slides from (the left window is seen with the eye to the left, so its street slides left
 * and needs more on its right; the right window the other way), a little on the other.
 */
const STREET = { left: { x: 220, w: 800, mid: 545 }, right: { x: 852, w: 820, mid: 1347 } };
const STREET_SHRINK = 0.7;

// ---------------------------------------------------------------- helpers

const svgOf = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
async function grey(input, w, h) {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i * info.channels];
  return out;
}
async function blurOne(buf, w, h, sigma) {
  const { data, info } = await sharp(Buffer.from(buf), { raw: { width: w, height: h, channels: 1 } }).blur(sigma).raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i * info.channels];
  return out;
}
async function rgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const polys = (list, { fill = "#fff", stroke = null, sw = 0 } = {}) =>
  svgOf(W, H, `<rect width="100%" height="100%" fill="#000"/><path d="${list.map((p) => "M" + p.map(([x, y]) => `${x},${y}`).join("L") + "Z").join(" ")}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter"` : ""}/>`);
const ease = (u) => u * u * (3 - 2 * u);
const sizes = {};
async function save(img, name) {
  await img.toFile(join(OUT, name));
  sizes[name] = statSync(join(OUT, name)).size;
}

// ---------------------------------------------------------------- the glass

/** Ivy in front of the glass: green, not the warm yellow of lit windows or lamps. */
const isLeaf = (r, g, b) => g >= r * 0.97 && g > b * 1.5 && g > 55 && r < 225;

async function glassMask(room) {
  const filled = await grey(polys(PANES), W, H);
  const grown = await grey(polys(PANES, { stroke: "#fff", sw: 7 }), W, H);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!grown[i]) continue;
    const [r, g, b] = [room.data[i * 3], room.data[i * 3 + 1], room.data[i * 3 + 2]];
    if (isLeaf(r, g, b)) continue;
    // Inside a traced pane: glass. Just outside it: glass only where it looks like glass (cool), never wood.
    if (filled[i] > 128) mask[i] = 255;
    else if (b + 18 >= r && b > 35 && grown[i] > 128) mask[i] = 210;
  }
  // The ivy is kept a pixel wider, so no green fringe sits on the street.
  const out = new Uint8Array(mask);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (isLeaf(room.data[j * 3], room.data[j * 3 + 1], room.data[j * 3 + 2])) out[i] = 0;
    }
  return blurOne(out, W, H, 0.6);
}

// ---------------------------------------------------------------- the frames

const frameness = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx ? (mx - mn) / mx : 0;
  // The cream of the painted prints is bright and pale; gold and the shadowed edges are saturated or dark.
  return sat > 0.6 || mx < 170;
};
/** The pale cream the painted prints are made of. */
const cream = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx > 150 && (mx - mn) / mx < 0.5;
};
const FRAME_CENTRES = [654.5, 811.5, 968.5, 1125.5, 1282.5];
/** From a frame's opening to the outer edge of its gold, crests included (measured at 4x). */
const FRAME_PAD = { l: 19, t: 28, r: 20, b: 19 };

async function cutFrames(room) {
  const data = room.data;
  const p = (x, y) => {
    const i = (y * W + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const med = (a) => a.sort((m, n) => m - n)[Math.floor(a.length / 2)];
  const frames = [];
  const boxes = [];
  for (const cx of FRAME_CENTRES) {
    const cy = 328;
    const [ls, rs, ts, bs] = [[], [], [], []];
    for (let k = -40; k <= 40; k += 8) {
      let x = Math.round(cx);
      let y = cy + k;
      while (!frameness(...p(x - 1, y))) x--;
      ls.push(x);
      x = Math.round(cx);
      while (!frameness(...p(x + 1, y))) x++;
      rs.push(x);
      x = Math.round(cx) + Math.round(k / 2);
      y = cy;
      while (!frameness(...p(x, y - 1))) y--;
      ts.push(y);
      y = cy;
      while (!frameness(...p(x, y + 1))) y++;
      bs.push(y);
    }
    const op = { x: med(ls), y: med(ts), w: med(rs) - med(ls) + 1, h: med(bs) - med(ts) + 1 };
    frames.push(op);
    boxes.push({ x: op.x - FRAME_PAD.l, y: op.y - FRAME_PAD.t, w: op.w + FRAME_PAD.l + FRAME_PAD.r, h: op.h + FRAME_PAD.t + FRAME_PAD.b });
  }
  // The wall's fine grain, from a plain stretch of it under the frames.
  const [tx0, ty0, tw, th] = [600, 424, 740, 30];
  const grain = new Float32Array(tw * th * 3);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const [yy, xx] = [Math.min(th - 1, Math.max(0, y + dy)), Math.min(tw - 1, Math.max(0, x + dx))];
            s += data[((ty0 + yy) * W + tx0 + xx) * 3 + c];
            n++;
          }
        grain[(y * tw + x) * 3 + c] = data[((ty0 + y) * W + tx0 + x) * 3 + c] - s / n;
      }
  // The wall behind each frame: a Coons patch from the wall just outside it, plus the grain.
  const patched = Buffer.from(data);
  const PAD = 8;
  boxes.forEach((b, fi) => {
    const [x0, y0, x1, y1] = [b.x - PAD, b.y - PAD, b.x + b.w + PAD, b.y + b.h + PAD];
    const strip = (x, y, across) => {
      const o = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const xx = across ? x : x < x0 + 1 ? x - k : x + k;
        const yy = across ? (y < y0 + 1 ? y - k : y + k) : y;
        const q = p(xx, yy);
        for (let c = 0; c < 3; c++) o[c] += q[c] / 3;
      }
      return o;
    };
    const [top, bot, lef, rig] = [[], [], [], []];
    for (let x = x0 - 1; x <= x1; x++) top.push(strip(x, y0 - 1, true)), bot.push(strip(x, y1, true));
    for (let y = y0 - 1; y <= y1; y++) lef.push(strip(x0 - 1, y, false)), rig.push(strip(x1, y, false));
    const smooth = (arr, rad) =>
      arr.map((_, i) => {
        const o = [0, 0, 0];
        let n = 0;
        for (let k = -rad; k <= rad; k++) {
          const q = arr[Math.max(0, Math.min(arr.length - 1, i + k))];
          for (let c = 0; c < 3; c++) o[c] += q[c];
          n++;
        }
        return o.map((v) => v / n);
      });
    for (const a of [top, bot, lef, rig]) {
      const s = smooth(a, 12);
      for (let i = 0; i < a.length; i++) a[i] = s[i];
    }
    const [Wd, Ht] = [x1 - x0 + 1, y1 - y0 + 1];
    const [c00, c10, c01, c11] = [top[0], top[Wd], bot[0], bot[Wd]];
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const [u, v] = [(x - x0 + 1) / Wd, (y - y0 + 1) / Ht];
        const [ix, iy] = [x - x0 + 1, y - y0 + 1];
        const j = (y * W + x) * 3;
        const tj = (((y - y0) % th) * tw + ((x - x0 + fi * 131) % tw)) * 3;
        // The outer 6 pixels of the patch fade into the painted wall, so no edge shows.
        const f = Math.min(1, (Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y) + 0.5) / 6);
        for (let c = 0; c < 3; c++) {
          const val = (1 - v) * top[ix][c] + v * bot[ix][c] + (1 - u) * lef[iy][c] + u * rig[iy][c] - ((1 - u) * (1 - v) * c00[c] + u * (1 - v) * c10[c] + (1 - u) * v * c01[c] + u * v * c11[c]);
          patched[j + c] = Math.max(0, Math.min(255, Math.round(f * (val + grain[tj + c] * 0.9) + (1 - f) * data[j + c])));
        }
      }
  });

  // The sheet of frames. A pixel is the frame's by how far it is from the patched (frameless) wall:
  // gold differs strongly, the wall and the cream hardly, the painted contact shadow a little.
  const sx0 = Math.min(...boxes.map((b) => b.x)) - 2;
  const sy0 = Math.min(...boxes.map((b) => b.y)) - 2;
  const sw = Math.max(...boxes.map((b) => b.x + b.w)) + 2 - sx0;
  const sh = Math.max(...boxes.map((b) => b.y + b.h)) + 2 - sy0;
  const sheet = Buffer.alloc(sw * sh * 4);
  const alpha = new Uint8Array(sw * sh);
  const band = new Uint8Array(sw * sh);
  let cleaned = 0;
  frames.forEach((op, fi) => {
    const b = boxes[fi];
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        const [r, g, bl] = p(x, y);
        const i = (y * W + x) * 3;
        const diff = Math.abs(r - patched[i]) + Math.abs(g - patched[i + 1]) + Math.abs(bl - patched[i + 2]);
        const j = (y - sy0) * sw + (x - sx0);
        sheet.set([r, g, bl], j * 4);
        // In the opening (and 6 pixels into the gold) the cream must go entirely: only the gold lip stays.
        const inside = x >= op.x - 6 && x < op.x + op.w + 6 && y >= op.y - 6 && y < op.y + op.h + 6;
        if (!inside) {
          alpha[j] = Math.round(255 * Math.max(0, Math.min(1, (diff - 22) / 48)));
          continue;
        }
        band[j] = 1;
        const keep = frameness(r, g, bl) && diff > 60 && !cream(r, g, bl);
        if (frameness(r, g, bl) && diff > 60 && !keep) cleaned++;
        alpha[j] = keep ? 255 : 0;
      }
  });
  // At the inner edge, a speck that is not joined to the gold (fewer than three solid neighbours) goes too.
  for (let pass = 0; pass < 2; pass++)
    for (let y = 1; y < sh - 1; y++)
      for (let x = 1; x < sw - 1; x++) {
        const j = y * sw + x;
        if (!band[j] || !alpha[j]) continue;
        let n = 0;
        for (const k of [j - 1, j + 1, j - sw, j + sw, j - sw - 1, j - sw + 1, j + sw - 1, j + sw + 1]) if (alpha[k]) n++;
        if (n < 3) (alpha[j] = 0), cleaned++;
      }
  const soft = await blurOne(alpha, sw, sh, 0.45);
  for (let j = 0; j < sw * sh; j++) sheet[j * 4 + 3] = soft[j];
  console.log(`frames: ${cleaned} pale specks cleaned from the inner edges`);
  await sharp(sheet, { raw: { width: sw, height: sh, channels: 4 } }).flatten({ background: "#ff00ff" }).png().toFile(join(WORK, "frames-on-magenta.png"));
  return { frames, boxes, sheet, sheetBox: { x: sx0, y: sy0, w: sw, h: sh }, patched };
}

/** How much larger the posters and their frames are than painted (the owner's pick: "a little larger"), each about its own middle. */
const POSTER_SCALE = 1.06;
/** A frame at its drawn size: its opening and its whole box, in painting pixels. */
function grown(op, box, s = POSTER_SCALE) {
  const [cx, cy] = [op.x + op.w / 2, op.y + op.h / 2];
  const at = (r) => ({ x: cx + (r.x - cx) * s, y: cy + (r.y - cy) * s, w: r.w * s, h: r.h * s });
  return { open: at(op), box: at(box) };
}

// ---------------------------------------------------------------- the join sign by the door (option B)

/** The sign, in painting pixels, and the cream panel on it that the room's live words (code, QR) sit on. */
const SIGN = { x: 266, y: 176, w: 258, h: 150 };
const PANEL = { x: SIGN.x + 13, y: SIGN.y + 13, w: SIGN.w - 26, h: SIGN.h - 26 };

function signSvg() {
  const { x, y, w, h } = SIGN;
  const cut = 8;
  const chains = [x + 34, x + w - 34]
    .flatMap((cx) => {
      const links = [];
      for (let cy = 149; cy < y + 4; cy += 7) links.push(`<ellipse cx="${cx}" cy="${cy + 3}" rx="2.4" ry="3.6" fill="none" stroke="#7d6038" stroke-width="2.2"/>`);
      return links;
    })
    .join("");
  const outline = `M${x + cut},${y} L${x + w - cut},${y} L${x + w},${y + cut} L${x + w},${y + h - cut} L${x + w - cut},${y + h} L${x + cut},${y + h} L${x},${y + h - cut} L${x},${y + cut} Z`;
  return svgOf(
    W,
    H,
    `<defs>
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f4022"/><stop offset=".5" stop-color="#56301a"/><stop offset="1" stop-color="#3c2011"/></linearGradient>
      <linearGradient id="cream" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecd2a2"/><stop offset="1" stop-color="#d6b27a"/></linearGradient>
      <radialGradient id="lit" cx="${x + 50}" cy="${y + h + 20}" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="rgb(255,200,140)" stop-opacity=".10"/><stop offset="1" stop-color="rgb(70,32,10)" stop-opacity=".30"/></radialGradient>
      <clipPath id="sign"><path d="${outline}"/></clipPath>
    </defs>
    ${chains}
    <path d="${outline}" fill="url(#wood)" stroke="rgba(255,190,120,.28)" stroke-width="1.5"/>
    <rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" fill="url(#cream)"/>
    <rect x="${PANEL.x + 1}" y="${PANEL.y + 1}" width="${PANEL.w - 2}" height="${PANEL.h - 2}" fill="none" stroke="rgba(60,30,10,.45)" stroke-width="2"/>
    <rect x="${x - 4}" y="${y - 30}" width="${w + 8}" height="${h + 34}" fill="url(#lit)" clip-path="url(#sign)"/>`,
  );
}

// ---------------------------------------------------------------- putting it together

async function main() {
  const room = await rgb(join(ART, "bar-no-foreground.png"));
  if (room.w !== W || room.h !== H) throw new Error(`bar-no-foreground.png is ${room.w}x${room.h}, not ${W}x${H}`);
  const { frames, boxes, sheet, sheetBox, patched } = await cutFrames(room);
  const glass = await glassMask(room);

  // The wall: frames lifted out, then each frame's soft shadow at its drawn size, then the sign and its shadow.
  const shade = new Uint8Array(W * H);
  frames.forEach((op, i) => {
    const g = grown(op, boxes[i]);
    const b = boxes[i];
    // The frame's alpha, drawn at its grown size 2 pixels right and 5 down, as the preview cast it.
    for (let y = Math.floor(g.box.y); y < Math.ceil(g.box.y + g.box.h); y++)
      for (let x = Math.floor(g.box.x); x < Math.ceil(g.box.x + g.box.w); x++) {
        const sx = Math.round(b.x + (x - g.box.x) / POSTER_SCALE) - sheetBox.x;
        const sy = Math.round(b.y + (y - g.box.y) / POSTER_SCALE) - sheetBox.y;
        if (sx < 0 || sy < 0 || sx >= sheetBox.w || sy >= sheetBox.h) continue;
        const [tx, ty] = [x + 2, y + 5];
        if (tx >= W || ty >= H) continue;
        shade[ty * W + tx] = Math.max(shade[ty * W + tx], sheet[(sy * sheetBox.w + sx) * 4 + 3]);
      }
  });
  const shadeSoft = await blurOne(shade, W, H, 4);
  const signShade = await blurOne(
    (() => {
      const a = new Uint8Array(W * H);
      for (let y = SIGN.y + 10; y < SIGN.y + 10 + SIGN.h; y++) for (let x = SIGN.x + 8; x < SIGN.x + 8 + SIGN.w; x++) a[y * W + x] = 255;
      return a;
    })(),
    W,
    H,
    7,
  );
  const wall = Buffer.from(patched);
  for (let i = 0; i < W * H; i++) {
    // Each frame casts 0.42 of black; the sign a warm dark (rgb 15, 6, 2) at 0.42.
    const f = 1 - 0.42 * (shadeSoft[i] / 255);
    const s = 0.42 * (signShade[i] / 255);
    for (let c = 0; c < 3; c++) wall[i * 3 + c] = Math.round(wall[i * 3 + c] * f * (1 - s) + [15, 6, 2][c] * s);
  }
  const sign = await sharp(signSvg()).blur(0.55).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < W * H; i++) {
    const a = sign.data[i * 4 + 3] / 255;
    if (!a) continue;
    for (let c = 0; c < 3; c++) wall[i * 3 + c] = Math.round(wall[i * 3 + c] * (1 - a) + sign.data[i * 4 + c] * a);
  }
  await sharp(wall, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(WORK, "wall.png"));

  // The base: the painting on its rect, and the room carried on past its edges, softer and darker.
  const painted = await sharp(wall, { raw: { width: W, height: H, channels: 3 } }).resize(AT.w, AT.h, { kernel: "lanczos3" }).raw().toBuffer();
  // What carries on past the edges is the painting's edge, smeared and blurred: in colour for the
  // floor, greyed for the ceiling and the two ends (so the ivy and the street's lights do not run on).
  // The ends are the painting's own edge mirrored (so a wall carries on as a wall), the ceiling and floor its edge drawn on.
  const extend = async (img, mode) => {
    const buf = await img.raw().toBuffer();
    const sides = await sharp(buf, { raw: { width: AT.w, height: AT.h, channels: 3 } })
      .extend({ left: AT.x, right: BW - AT.x - AT.w, top: 0, bottom: 0, extendWith: mode })
      .raw()
      .toBuffer();
    return sharp(sides, { raw: { width: BW, height: AT.h, channels: 3 } })
      .extend({ top: AT.y, bottom: BH - AT.y - AT.h, left: 0, right: 0, extendWith: "copy" })
      .blur(18)
      .raw()
      .toBuffer();
  };
  const around = await extend(sharp(painted, { raw: { width: AT.w, height: AT.h, channels: 3 } }), "mirror");
  const grey = await extend(sharp(painted, { raw: { width: AT.w, height: AT.h, channels: 3 } }).modulate({ saturation: 0.45, brightness: 0.85 }), "mirror");
  const base = Buffer.alloc(BW * BH * 3);
  const FEATHER = 28;
  // Toward either end of the painting a soft shade, so the room carries on past it into the dark without an edge.
  const END = 140;
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < BW; x++) {
      const j = (y * BW + x) * 3;
      const [px, py] = [x - AT.x, y - AT.y];
      const dx = px < 0 ? -px : px >= AT.w ? px - AT.w + 1 : 0;
      const up = py < 0 ? -py : 0;
      const down = py >= AT.h ? py - AT.h + 1 : 0;
      // Past the painting: the ceiling darkens fast (the lamps hang in it), the floor and the ends more slowly.
      const k = Math.exp(-up / 60) * Math.exp(-down / 150) * Math.exp(-dx / 45);
      const dim = (0.08 + 0.92 * k) * (dx ? 0.62 : 1);
      const far = (c) => (down && !dx ? around[j + c] : grey[j + c]) * dim * (up ? 0.4 : 1);
      if (!dx && !up && !down) {
        // Inside, the last few pixels at the bottom and the two ends blend into what carries on.
        const i = (py * AT.w + px) * 3;
        const edge = Math.min(px, AT.w - 1 - px, AT.h - 1 - py);
        const t = edge >= FEATHER ? 1 : (edge + 1) / (FEATHER + 1);
        const side = Math.min(px, AT.w - 1 - px) < AT.h - 1 - py;
        // At the top the painting's beam and the ivy hanging from it fade into the dark ceiling the lamps hang in.
        const end = Math.min(px, AT.w - 1 - px);
        const top = (py < 48 ? 0.4 + 0.6 * ease(py / 48) : 1) * (end < END ? 0.62 + 0.38 * ease(end / END) : 1);
        for (let c = 0; c < 3; c++) base[j + c] = Math.round((painted[i + c] * t + (side ? grey[j + c] : around[j + c]) * (1 - t)) * top);
        continue;
      }
      for (let c = 0; c < 3; c++) base[j + c] = Math.round(far(c));
    }
  await save(sharp(base, { raw: { width: BW, height: BH, channels: 3 } }).webp({ quality: 80, effort: 6, smartSubsample: true }), "base.webp");

  // The light tiles, at half size: the glass, and the cold light lightning throws into the room.
  const TW = BW / 2;
  const TH = BH / 2;
  const tile = (fn) => {
    const out = Buffer.alloc(TW * TH * 3);
    for (let y = 0; y < TH; y++)
      for (let x = 0; x < TW; x++) {
        // The world point of this texel, and the painting pixel under it.
        const wx = RECT.x0 + (x + 0.5) * 2;
        const wy = RECT.y0 + (y + 0.5) * 2;
        const px = wx / S;
        const py = (wy - OY) / S;
        const v = fn(px, py);
        out.set(v, (y * TW + x) * 3);
      }
    return out;
  };
  const sample = (buf, px, py) => {
    // Bilinear, 0 outside.
    const [x0, y0] = [Math.floor(px - 0.5), Math.floor(py - 0.5)];
    const [fx, fy] = [px - 0.5 - x0, py - 0.5 - y0];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : buf[y * W + x]);
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const glassTile = tile((px, py) => {
    // The panes at the painting's very ends fade into its wall, so the street never stops at the painting's edge.
    const end = Math.min(px, W - px);
    const v = Math.round(sample(glass, px, py) * (end < 40 ? ease(Math.max(0, end) / 40) : 1));
    return [v, v, v];
  });
  // Lightning: a soft cold glow round each window inside the room (the preview's), nothing on the glass itself.
  const flashTile = tile((px, py) => {
    const g = sample(glass, px, py) / 255;
    let a = 0;
    for (const [cx, cy, rx, ry] of [[125, 270, 300, 330], [1805, 270, 280, 340]]) {
      const d = Math.hypot((px - cx) / rx, (py - cy) / ry);
      a += d < 1 ? (1 - d) ** 1.6 : 0;
    }
    a = Math.min(1, a) * (1 - g);
    return [170, 195, 255].map((c) => Math.round(c * a));
  });
  const atlas = Buffer.alloc(TW * 2 * TH * 3);
  for (let y = 0; y < TH; y++) {
    glassTile.copy(atlas, y * TW * 2 * 3, y * TW * 3, (y + 1) * TW * 3);
    flashTile.copy(atlas, (y * TW * 2 + TW) * 3, y * TW * 3, (y + 1) * TW * 3);
  }
  await save(sharp(atlas, { raw: { width: TW * 2, height: TH, channels: 3 } }).webp({ quality: 90, effort: 6 }), "lights.webp");
  const mag = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const a = glass[i] / 255;
    mag.set([room.data[i * 3] * (1 - a) + 255 * a, room.data[i * 3 + 1] * (1 - a), room.data[i * 3 + 2] * (1 - a) + 255 * a].map(Math.round), i * 3);
  }
  await sharp(mag, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(WORK, "glass-on-magenta.png"));

  // The frames.
  await save(sharp(sheet, { raw: { width: sheetBox.w, height: sheetBox.h, channels: 4 } }).webp({ quality: 90, alphaQuality: 100, effort: 6 }), "frames.webp");

  // What stands in front: the two corners of bar-foreground.png, side by side on one sheet.
  const fg = await sharp(join(ART, "bar-foreground.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fw = fg.info.width;
  const corner = (x0, x1) => {
    let [minX, minY, maxX, maxY] = [1e9, 1e9, -1, -1];
    for (let y = 0; y < fg.info.height; y++)
      for (let x = x0; x < x1; x++)
        if (fg.data[(y * fw + x) * 4 + 3] > 6) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };
  const fl = corner(0, 700);
  const fr = corner(1300, fw);
  // Where the painting is cut (its ends and its foot), what stands in front fades out over a few pixels
  // instead, so on a screen wider or taller than the painting it goes into the dark and does not stop at a line.
  const faded = Buffer.from(fg.data);
  for (let y = 0; y < fg.info.height; y++)
    for (let x = 0; x < fw; x++) {
      const edge = Math.min(x, fw - 1 - x, (fg.info.height - 1 - y) * 1.6);
      if (edge < 36) faded[(y * fw + x) * 4 + 3] = Math.round(faded[(y * fw + x) * 4 + 3] * ease(edge / 36));
    }
  const fgImage = () => sharp(faded, { raw: { width: fw, height: fg.info.height, channels: 4 } });
  const front = await sharp({ create: { width: fl.w + fr.w + 4, height: Math.max(fl.h, fr.h), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await fgImage().extract({ left: fl.x, top: fl.y, width: fl.w, height: fl.h }).png().toBuffer(), left: 0, top: 0 },
      { input: await fgImage().extract({ left: fr.x, top: fr.y, width: fr.w, height: fr.h }).png().toBuffer(), left: fl.w + 4, top: 0 },
    ])
    .png()
    .toBuffer();
  await save(sharp(front).webp({ quality: 84, alphaQuality: 90, effort: 6 }), "front.webp");

  // The street through each window.
  const street = await sharp(join(ART, "bar-street.png")).metadata();
  for (const [key, s] of Object.entries(STREET))
    await save(
      sharp(join(ART, "bar-street.png"))
        .extract({ left: s.x, top: 0, width: s.w, height: street.height })
        .resize(Math.round(s.w * STREET_SHRINK))
        .modulate({ brightness: 0.82, saturation: 0.9 })
        .blur(0.5)
        .webp({ quality: 80, effort: 6 }),
      `street-${key}.webp`,
    );

  // The room all round, for the pieces' shine: the painting across the middle, blurred, warm and dark above and below.
  const envW = 512;
  const envH = 256;
  const band = await sharp(wall, { raw: { width: W, height: H, channels: 3 } }).resize(envW, Math.round(envH * 0.55), { fit: "fill" }).blur(3).raw().toBuffer();
  const env = Buffer.alloc(envW * envH * 3);
  const top0 = Math.round(envH * 0.2);
  for (let y = 0; y < envH; y++)
    for (let x = 0; x < envW; x++) {
      const by = Math.min(Math.round(envH * 0.55) - 1, Math.max(0, y - top0));
      const k = y < top0 ? 0.35 * (y / top0) : y >= top0 + Math.round(envH * 0.55) ? 0.6 : 1;
      for (let c = 0; c < 3; c++) env[(y * envW + x) * 3 + c] = Math.round(band[(by * envW + x) * 3 + c] * k);
    }
  await save(sharp(env, { raw: { width: envW, height: envH, channels: 3 } }).blur(2).webp({ quality: 80, effort: 6 }), "env.webp");

  const round = (v) => Math.round(v * 10) / 10;
  const plate = {
    about: "Written by lobby/tools/bar/layers.mjs. Numbers are painting pixels unless they say otherwise; `painting` maps them to world units.",
    painting: { w: W, h: H, scale: S, oy: OY },
    rect: RECT,
    boxes: 5,
    lights: { flash: { tile: 1, gain: 1 } },
    glassTile: 0,
    lightsGrid: { cols: 2, rows: 1, w: TW, h: TH },
    frames: frames.map((op, i) => ({ open: op, box: boxes[i], drawn: grown(op, boxes[i]) })),
    framesSheet: sheetBox,
    posterScale: POSTER_SCALE,
    front: { left: { ...fl, at: [0, 0, fl.w, fl.h] }, right: { ...fr, at: [fl.w + 4, 0, fr.w, fr.h] }, sheet: { w: fl.w + fr.w + 4, h: Math.max(fl.h, fr.h) } },
    windows: WINDOWS,
    panes: PANES.map((p) => p.map(([x, y]) => [round(x), round(y)])),
    street: { ...Object.fromEntries(Object.entries(STREET).map(([k, s]) => [k, { ...s, h: street.height }])), shrink: STREET_SHRINK },
    sign: SIGN,
    panel: PANEL,
    board: { x: 1428, y: 244, w: 214, h: 184 },
    sizes,
  };
  writeFileSync(join(OUT, "plate.json"), JSON.stringify(plate, null, 1) + "\n");
  let total = 0;
  for (const [name, n] of Object.entries(sizes)) {
    total += n;
    console.log(`${name.padEnd(18)} ${(n / 1024).toFixed(1).padStart(7)} KB`);
  }
  console.log(`${"all".padEnd(18)} ${(total / 1024).toFixed(1).padStart(7)} KB   (checks in ${WORK})`);
}

await main();
