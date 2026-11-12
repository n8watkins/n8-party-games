// Hand-painted surfaces for the moving things, made on canvases: enamel paint with brush
// strokes, a sign-writer's shading, chips down to the iron where corks have struck for years.
// Each painter returns { map, roughnessMap, bumpMap } for a MeshStandardMaterial, plus the
// outline it was painted for, so the cut sheet-iron shape and its paint always agree.
import * as THREE from "three";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function texture(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Brush strokes: many thin translucent streaks along a direction. */
function strokes(ctx, size, r, colour, count, angle, alpha, width = 3) {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  ctx.translate(-size / 2, -size / 2);
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const y = r() * size * 1.4 - size * 0.2;
    const x = r() * size * 1.4 - size * 0.2;
    const len = size * (0.15 + r() * 0.5);
    ctx.globalAlpha = alpha * (0.3 + r() * 0.7);
    ctx.lineWidth = width * (0.4 + r() * 1.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 6, x + len * 0.7, y + (r() - 0.5) * 6, x + len, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Chips: irregular blobs, most of them near the edge of the shape and around the middle where corks land. */
function chips(ctx, size, r, pts, count, colour, scale = 1) {
  ctx.fillStyle = colour;
  for (let i = 0; i < count; i++) {
    const p = pts[Math.floor(r() * pts.length)];
    const inward = r() * r() * 0.16 * size;
    const cx = size / 2 + (p[0] - size / 2) * (1 - inward / (size / 2));
    const cy = size / 2 + (p[1] - size / 2) * (1 - inward / (size / 2));
    const rad = (1.5 + r() * r() * 9) * scale;
    ctx.beginPath();
    const n = 7;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = rad * (0.55 + r() * 0.7);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.fill();
  }
}

function strikes(ctx, size, r, count, colour) {
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * size * 0.3;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const rad = 5 + r() * 7;
    const g = ctx.createRadialGradient(x, y, rad * 0.5, x, y, rad);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.75, colour);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Paints one plate. `outline` is a list of [x, y] in 0..1 (y up) tracing the cut shape;
 * `art(ctx, size, r)` paints the picture inside it.
 */
export function paintPlate({ outline, base, art, seed = 1, size = 512, wear = 1 }) {
  const r = rng(seed);
  const pts = outline.map(([x, y]) => [x * size, (1 - y) * size]);
  const colour = canvas(size);
  const rough = canvas(size);
  const bump = canvas(size);
  const c = colour.getContext("2d");
  const rg = rough.getContext("2d");
  const b = bump.getContext("2d");

  // Bare iron under everything (seen at the cut edge and through chips).
  c.fillStyle = "#231d19";
  c.fillRect(0, 0, size, size);
  rg.fillStyle = "#b8b8b8";
  rg.fillRect(0, 0, size, size);
  b.fillStyle = "#606060";
  b.fillRect(0, 0, size, size);

  const trace = (ctx) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  };
  for (const ctx of [c, rg, b]) {
    ctx.save();
    trace(ctx);
    ctx.clip();
  }
  // The enamel coat.
  c.fillStyle = base;
  c.fillRect(0, 0, size, size);
  const angle = (r() - 0.5) * 0.5;
  const dense = (size / 512) ** 2; // the same brush on a smaller plate lays fewer strokes
  strokes(c, size, r, "rgba(255,255,255,0.5)", Math.round(260 * dense), angle, 0.07);
  strokes(c, size, r, "rgba(0,0,0,0.6)", Math.round(260 * dense), angle, 0.07);
  rg.fillStyle = "#4a4a4a"; // glossy enamel
  rg.fillRect(0, 0, size, size);
  strokes(rg, size, r, "#707070", Math.round(200 * dense), angle, 0.25);
  b.fillStyle = "#a0a0a0";
  b.fillRect(0, 0, size, size);
  strokes(b, size, r, "#d8d8d8", Math.round(420 * dense), angle, 0.22, 2.2);
  strokes(b, size, r, "#707070", Math.round(420 * dense), angle, 0.22, 2.2);

  art?.(c, size, r, b);

  // Years of corks: dull rings in the gloss, then chips through to primer and iron.
  strikes(rg, size, r, Math.round(26 * wear), "rgba(170,170,170,0.5)");
  strikes(c, size, r, Math.round(10 * wear), "rgba(235,225,200,0.12)");
  chips(c, size, r, pts, Math.round(46 * wear), "#8f3a22", 1.25);
  chips(c, size, r, pts, Math.round(40 * wear), "#2a221d");
  const r2 = rng(seed);
  for (let i = 0; i < 2000; i++) r2();
  chips(rg, size, rng(seed + 7), pts, Math.round(46 * wear), "#c8c8c8", 1.25);
  chips(b, size, rng(seed + 7), pts, Math.round(46 * wear), "#585858", 1.25);
  for (const ctx of [c, rg, b]) ctx.restore();
  // A dark worn line right at the cut edge.
  c.lineWidth = size * 0.012;
  c.strokeStyle = "rgba(25,18,14,0.7)";
  trace(c);
  c.stroke();
  return { map: texture(colour, true), roughnessMap: texture(rough, false), bumpMap: texture(bump, false), outline };
}

// ---------------------------------------------------------------- shapes (0..1, y up)

function smooth(points, steps = 6) {
  // Catmull-Rom through the given points, closed.
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

/** A fat teapot in profile, spout to the left, standing on a foot tab that takes the hinge. */
export const TEAPOT = smooth(
  [
    [0.4, 0.06], [0.6, 0.06], [0.64, 0.14], [0.76, 0.2], [0.83, 0.34], [0.84, 0.46], [0.93, 0.5], [0.97, 0.42], [0.93, 0.3], [0.86, 0.27],
    [0.9, 0.24], [0.99, 0.32], [1.0, 0.46], [0.94, 0.58], [0.82, 0.6], [0.74, 0.7], [0.62, 0.75], [0.58, 0.8], [0.57, 0.86], [0.5, 0.9],
    [0.43, 0.86], [0.42, 0.8], [0.38, 0.75], [0.27, 0.7], [0.2, 0.6], [0.14, 0.66], [0.07, 0.76], [0.01, 0.74], [0.06, 0.6], [0.12, 0.46],
    [0.17, 0.32], [0.24, 0.2], [0.36, 0.14],
  ],
  5,
);

export function star(points = 5, inner = 0.46, round = 0.0) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const rad = (i % 2 ? inner : 1) * 0.49;
    out.push([0.5 + Math.cos(a) * rad, 0.5 + Math.sin(a) * rad]);
  }
  void round;
  return out;
}

export function disc(n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([0.5 + Math.cos((i / n) * Math.PI * 2) * 0.49, 0.5 + Math.sin((i / n) * Math.PI * 2) * 0.49]);
  return out;
}

// ---------------------------------------------------------------- the pictures

const GOLD = "#c9962e";
const GOLD_HI = "#f0cf73";
const GOLD_LO = "#7d5416";

function goldLine(c, path, width) {
  c.lineJoin = "round";
  c.lineCap = "round";
  c.strokeStyle = GOLD_LO;
  c.lineWidth = width * 1.5;
  c.stroke(path);
  c.strokeStyle = GOLD;
  c.lineWidth = width;
  c.stroke(path);
  c.strokeStyle = GOLD_HI;
  c.lineWidth = width * 0.3;
  c.stroke(path);
}

export function paintTeapot(base, seed) {
  return paintPlate({
    outline: TEAPOT,
    base,
    seed,
    art(c, s) {
      // Sign-writer's modelling: a darker belly shade, a cream highlight, a gold band and lid line.
      const shade = c.createRadialGradient(s * 0.42, s * 0.42, s * 0.05, s * 0.5, s * 0.55, s * 0.5);
      shade.addColorStop(0, "rgba(255,240,210,0.26)");
      shade.addColorStop(0.5, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(0,0,0,0.45)");
      c.fillStyle = shade;
      c.fillRect(0, 0, s, s);
      const band = new Path2D();
      band.moveTo(s * 0.2, s * 0.56);
      band.quadraticCurveTo(s * 0.5, s * 0.66, s * 0.82, s * 0.56);
      goldLine(c, band, s * 0.02);
      const band2 = new Path2D();
      band2.moveTo(s * 0.23, s * 0.5);
      band2.quadraticCurveTo(s * 0.5, s * 0.6, s * 0.8, s * 0.5);
      goldLine(c, band2, s * 0.008);
      const lid = new Path2D();
      lid.moveTo(s * 0.3, s * 0.3);
      lid.quadraticCurveTo(s * 0.5, s * 0.22, s * 0.7, s * 0.3);
      goldLine(c, lid, s * 0.012);
      // A cream highlight stroke, laid on in one pass of a round brush.
      c.strokeStyle = "rgba(255,246,222,0.82)";
      c.lineCap = "round";
      c.lineWidth = s * 0.03;
      c.beginPath();
      c.moveTo(s * 0.33, s * 0.36);
      c.quadraticCurveTo(s * 0.27, s * 0.42, s * 0.28, s * 0.5);
      c.stroke();
      c.lineWidth = s * 0.016;
      c.beginPath();
      c.arc(s * 0.5, s * 0.125, s * 0.02, 0, 7);
      c.stroke();
      // A small flower sprig, three dabs and a stalk.
      c.fillStyle = "rgba(250,236,200,0.9)";
      for (const [dx, dy] of [[0, 0], [0.05, 0.02], [0.025, -0.045], [-0.03, -0.03], [0.02, 0.05]]) {
        c.beginPath();
        c.ellipse(s * (0.55 + dx), s * (0.4 + dy), s * 0.022, s * 0.016, dx * 30, 0, 7);
        c.fill();
      }
      c.fillStyle = GOLD;
      c.beginPath();
      c.arc(s * 0.563, s * 0.4, s * 0.013, 0, 7);
      c.fill();
    },
  });
}

export function paintStar(seed) {
  return paintPlate({
    outline: star(),
    base: "#c79a2c",
    seed,
    size: 256,
    wear: 0.7,
    art(c, s) {
      // Each point is split light and dark down its ridge, as a sign-writer shades a star.
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 - (i * 2 * Math.PI) / 5;
        const tip = [s / 2 + Math.cos(a) * s * 0.49, s / 2 - Math.sin(a) * s * 0.49];
        const side = [s / 2 + Math.cos(a - Math.PI / 5) * s * 0.225, s / 2 - Math.sin(a - Math.PI / 5) * s * 0.225];
        c.fillStyle = "rgba(60,30,0,0.38)";
        c.beginPath();
        c.moveTo(s / 2, s / 2);
        c.lineTo(tip[0], tip[1]);
        c.lineTo(side[0], side[1]);
        c.closePath();
        c.fill();
      }
      c.fillStyle = "rgba(255,238,170,0.4)";
      c.beginPath();
      c.arc(s * 0.46, s * 0.44, s * 0.08, 0, 7);
      c.fill();
      c.strokeStyle = "#8f1f14";
      c.lineWidth = s * 0.02;
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.1, 0, 7);
      c.stroke();
    },
  });
}

export function paintMoon(seed) {
  return paintPlate({
    outline: disc(),
    base: "#12264f",
    seed,
    size: 256,
    wear: 0.8,
    art(c, s, r) {
      // A cream crescent on night blue, with a gold rim and a few dabbed stars.
      c.fillStyle = "#ead9a8";
      c.beginPath();
      c.arc(s * 0.47, s * 0.5, s * 0.3, 0, 7);
      c.fill();
      c.fillStyle = "#12264f";
      c.beginPath();
      c.arc(s * 0.58, s * 0.46, s * 0.26, 0, 7);
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.35)";
      c.lineWidth = s * 0.012;
      c.beginPath();
      c.arc(s * 0.47, s * 0.5, s * 0.275, 2.2, 3.9);
      c.stroke();
      const rim = new Path2D();
      rim.arc(s / 2, s / 2, s * 0.44, 0, 7);
      goldLine(c, rim, s * 0.022);
      c.fillStyle = GOLD_HI;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(s * (0.6 + r() * 0.2), s * (0.3 + r() * 0.42), s * (0.008 + r() * 0.012), 0, 7);
        c.fill();
      }
      c.fillStyle = "#b3261a";
      c.beginPath();
      c.arc(s * 0.5, s * 0.5, s * 0.035, 0, 7);
      c.fill();
    },
  });
}

/** Enamelled sheet for flat parts: shutters, the cam bar, wheel rims. */
export function paintSheet(base, seed, { size = 256, lines = false } = {}) {
  return paintPlate({
    outline: [[0, 0], [1, 0], [1, 1], [0, 1]],
    base,
    seed,
    size,
    wear: 0.5,
    art(c, s) {
      if (!lines) return;
      const p = new Path2D();
      p.rect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);
      goldLine(c, p, s * 0.02);
    },
  });
}

/** Cork: pale, speckled, with darker pores. One small tile, used on every cork. */
export function paintCork() {
  const s = 128;
  const col = canvas(s);
  const c = col.getContext("2d");
  const r = rng(11);
  c.fillStyle = "#c39a66";
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = r() < 0.5 ? `rgba(90,58,30,${0.15 + r() * 0.4})` : `rgba(240,214,170,${0.1 + r() * 0.3})`;
    c.beginPath();
    c.ellipse(r() * s, r() * s, 0.6 + r() * 2.6, 0.5 + r() * 1.4, r() * 3, 0, 7);
    c.fill();
  }
  const t = texture(col, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Varnished walnut for the gun stock: long grain with darker figure. */
export function paintWood(seed = 3, base = "#5a321a", dark = "rgba(28,12,4,0.5)") {
  const s = 512;
  const col = canvas(s);
  const c = col.getContext("2d");
  const r = rng(seed);
  c.fillStyle = base;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 300; i++) {
    c.strokeStyle = r() < 0.6 ? dark : "rgba(170,100,50,0.25)";
    c.globalAlpha = 0.12 + r() * 0.3;
    c.lineWidth = 0.6 + r() * 2.6;
    const y = r() * s;
    c.beginPath();
    c.moveTo(0, y);
    const phase = r() * 6;
    const sway = 1.5 + r() * 4;
    for (let x = 0; x <= s; x += 16) c.lineTo(x, y + Math.sin(x * 0.009 + phase) * sway);
    c.stroke();
  }
  c.globalAlpha = 1;
  const t = texture(col, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Stitched leather belting. */
export function paintBelt() {
  const w = 64;
  const h = 256;
  const col = document.createElement("canvas");
  col.width = w;
  col.height = h;
  const c = col.getContext("2d");
  const r = rng(5);
  c.fillStyle = "#4a2c18";
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) {
    c.fillStyle = `rgba(${r() < 0.5 ? "20,10,5" : "150,100,60"},${0.08 + r() * 0.2})`;
    c.fillRect(r() * w, r() * h, 1 + r() * 3, 2 + r() * 14);
  }
  c.fillStyle = "#c9b48a";
  for (let y = 4; y < h; y += 16) {
    c.fillRect(8, y, 3, 8);
    c.fillRect(w - 11, y, 3, 8);
  }
  // The laced joint, once per loop, so the eye can follow the belt round.
  c.fillStyle = "#1a0f08";
  c.fillRect(0, h - 22, w, 10);
  c.fillStyle = "#d8c8a0";
  for (let x = 8; x < w; x += 10) c.fillRect(x, h - 26, 3, 18);
  const t = texture(col, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The score reels: cream enamel drums with black numerals, 0 to 9 round the rim. */
export function paintReel() {
  // Laid out along the canvas's x axis, which runs round the drum; each numeral stands on its side.
  const w = 1280;
  const h = 128;
  const col = document.createElement("canvas");
  col.width = w;
  col.height = h;
  const c = col.getContext("2d");
  const r = rng(21);
  c.fillStyle = "#e6d6ac";
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    c.fillStyle = `rgba(90,60,30,${r() * 0.07})`;
    c.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 30);
  }
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `400 112px "Abril Fatface", Georgia, serif`;
  for (let d = 0; d < 10; d++) {
    c.save();
    c.translate(d * 128 + 60, h / 2);
    c.rotate(Math.PI / 2);
    c.fillStyle = "#17120e";
    c.fillText(String(d), 0, 0);
    c.restore();
    c.fillStyle = "#8f1f14";
    c.fillRect(d * 128 - 1, 8, 3, h - 16);
  }
  const t = texture(col, true);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Chalk on slate: the best scores of the day. */
export function chalkTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 412;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const draw = (rows) => {
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "rgba(236,232,220,0.9)";
    g.textAlign = "center";
    g.font = `400 46px "Abril Fatface", Georgia, serif`;
    g.fillText("High scores", 256, 58);
    g.fillRect(96, 76, 320, 3);
    // Each row: its place, three letters, the score. The row this device chalked up is underlined
    // twice and starred, as a showman would.
    rows.slice(0, 5).forEach((row, i) => {
      const y = 138 + i * 60;
      g.font = `400 30px "Abril Fatface", Georgia, serif`;
      g.textAlign = "right";
      g.fillText(String(row.rank ?? i + 1), 66, y - 2);
      g.font = `italic 700 40px "Playfair Display", Georgia, serif`;
      g.textAlign = "left";
      g.fillText(String(row.name).slice(0, 5), 92, y);
      g.textAlign = "right";
      g.fillText(String(row.score), 452, y);
      if (row.mine) {
        g.fillRect(88, y + 9, 366, 3);
        g.fillRect(88, y + 16, 366, 2);
        g.font = `400 32px "Abril Fatface", Georgia, serif`;
        g.fillText("\u2605", 492, y - 2);
      }
    });
    // Chalk is never solid: rub some of it away.
    g.globalCompositeOperation = "destination-out";
    const r = rng(rows.length * 7 + 3);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.5})`;
      g.fillRect(r() * c.width, r() * c.height, 1 + r() * 2, 1 + r() * 2);
    }
    g.globalCompositeOperation = "source-over";
    t.needsUpdate = true;
  };
  /** A cork has struck the board at (u, v), 0..1 from its top left: the chalk there is rubbed thin, with a pale ring of dust. */
  const smudge = (u, v) => {
    const g = c.getContext("2d");
    const x = u * c.width;
    const y = v * c.height;
    g.globalCompositeOperation = "destination-out";
    const rub = g.createRadialGradient(x, y, 4, x, y, 46);
    rub.addColorStop(0, "rgba(0,0,0,0.9)");
    rub.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rub;
    g.fillRect(x - 50, y - 50, 100, 100);
    g.globalCompositeOperation = "source-over";
    const dust = g.createRadialGradient(x, y, 14, x, y, 40);
    dust.addColorStop(0, "rgba(236,232,220,0)");
    dust.addColorStop(0.7, "rgba(236,232,220,0.16)");
    dust.addColorStop(1, "rgba(236,232,220,0)");
    g.fillStyle = dust;
    g.fillRect(x - 50, y - 50, 100, 100);
    t.needsUpdate = true;
  };
  return { texture: t, draw, smudge };
}

/** Trodden grass at dusk, with the stall's lamplight spilling out of its open front. */
export function groundTexture() {
  const s = 512;
  const c = canvas(s);
  const g = c.getContext("2d");
  g.fillStyle = "#06080c";
  g.fillRect(0, 0, s, s);
  // The pool of warm light in front of the counter (the stall sits at the centre, facing down the canvas).
  const pool = g.createRadialGradient(s / 2, s * 0.56, 4, s / 2, s * 0.6, s * 0.2);
  pool.addColorStop(0, "rgba(120,74,30,0.9)");
  pool.addColorStop(0.5, "rgba(58,36,18,0.6)");
  pool.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = pool;
  g.fillRect(0, 0, s, s);
  const r = rng(77);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.25})` : `rgba(90,100,70,${r() * 0.07})`;
    g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 3);
  }
  return texture(c, true);
}

/** A soft dark patch: the contact shadow where a thing stands or lies on a board. */
export function contactTexture() {
  const s = 64;
  const c = canvas(s);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** The UVs of an extruded outline are its x, y in 0..1, so the paint lines up with the cut edge. */
export function plateGeometry(outline, width, height, thickness = 0.004) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2((x - 0.5) * width, (y - 0.5) * height)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -thickness / 2);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / width + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / height + 0.5;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
