// Tin Derby: the breakfast table and the course on it. Everything on the road is placed and sized from the
// rules (TUNE and sim.js), so what you see is what the rules drive on: a ramp's top is the rules' ground, a
// shaker is the rules' post, a spill is the rules' patch. Round five is a breakfast table: no books, no rulers.
// The static props are merged by region of the table, so the regions behind the camera are not drawn at all.
// With `scan` on, every prop's drawn vertices are kept by name, for the check that nothing on the road is
// drawn without a collider or a declared effect (tools/scan.mjs).
// Round five's reviewed table.js as it is; only these imports and the export at the end are new (env.js says why).
import { THREE, TUNE, BANK_EASE, BANK_SIDE, EDGE_SIDE, LEN, SHAKERS, SUSAN_AT, TAG, bankAt, groundAt, halfAt, hash, sideLimit, toastH, trackAt } from "./env.js";
import { CLOTH_FS, CLOTH_VS, Geo, M4, PANEL_FS, PANEL_VS, SHADOW_FS, SHADOW_VS, WALL_FS, WALL_VS, canvasOf, inkMaterial, lathe, ringNear, roundBox, smoothProf, surface, wallTexture, clampN, PAL, CSS } from "./art.js";

const TABLE = (() => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9;
  for (let u = 0; u < LEN; u += 1) for (const l of [-halfAt(u), halfAt(u)]) { const p = trackAt(u, l); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); }
  // The near edge is the open one: along the back straight the table ends EDGE.out past the track's outside.
  const e = trackAt((TUNE.EDGE.u0 + TUNE.EDGE.u1) / 2, -(TUNE.HALF + TUNE.EDGE.out));
  return { x0: x0 - 12, x1: x1 + 13, z0: z0 - 13, z1: e.z, drop: 9 };
})();

/** Static geometry, merged by region of the table (slices along x), so a region off camera is never drawn. */
class Regions {
  constructor(n, scan) { this.n = n; this.g = Array.from({ length: n }, () => new Geo()); this.w = (TABLE.x1 - TABLE.x0) / n; this.scan = scan; this.name = ""; }
  add(geo, m, key, flag = 0, out = "n", xAt = m.elements[12]) {
    if (this.scan && this.name) {
      const P = geo.attributes.position, v = new THREE.Vector3(), arr = this.scan[this.name] || (this.scan[this.name] = []);
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m); arr.push(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)); }
    }
    const i = Math.max(0, Math.min(this.n - 1, Math.floor((xAt - TABLE.x0) / this.w)));
    this.g[i].add(geo, m, key, flag, out);
    return this;
  }
  meshes(mat, shell) { const out = []; for (const G of this.g) if (!G.empty) { const g = G.build(); out.push(new THREE.Mesh(g, mat), new THREE.Mesh(g, shell)); } return out; }
}

function buildTable(shared, clothTex, opts = {}) {
  const root = new THREE.Group(), scan = opts.scan ? {} : null;
  const T_ = TUNE, H = T_.HALF;
  const at = (u, lat = 0) => trackAt(u, lat, {});
  const yaw = (p) => Math.atan2(-p.dz, p.dx);
  const bank = TAG.bank;
  // ---- The cloth: the table top, its hanging edges, and the bank (cloth over a rolled tea towel) ----
  {
    const p = [], n = [];
    const quad = (a, b, c, d, nn) => { for (const v of [a, b, c, a, c, d]) { p.push(...v); n.push(...nn); } };
    const { x0, x1, z0, z1, drop } = TABLE;
    quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0]);
    quad([x0, 0, z1], [x0, -drop, z1], [x1, -drop, z1], [x1, 0, z1], [0, 0, 1]); quad([x1, 0, z0], [x1, -drop, z0], [x0, -drop, z0], [x0, 0, z0], [0, 0, -1]);
    quad([x1, 0, z1], [x1, -drop, z1], [x1, -drop, z0], [x1, 0, z0], [1, 0, 0]); quad([x0, 0, z0], [x0, -drop, z0], [x0, -drop, z1], [x0, 0, z1], [-1, 0, 0]);
    const bk = bank, w = H + 0.6, cols = 8, step = 0.5;
    for (let u = bk.u0 - BANK_EASE; u < bk.u1 + BANK_EASE - 1e-6; u += step) {
      const ua = u, ub = Math.min(bk.u1 + BANK_EASE, u + step);
      for (let i = 0; i < cols; i++) {
        const la = -w + (2 * w * i) / cols, lb = -w + (2 * w * (i + 1)) / cols;
        const P = (uu, l) => { const q = at(uu, l); return [q.x, groundAt(uu, l) + 0.004, q.z]; };
        const A = P(ua, la), B = P(ua, lb), C = P(ub, lb), D = P(ub, la);
        const e1 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], e2 = [B[0] - D[0], B[1] - D[1], B[2] - D[2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(nx, ny, nz) || 1;
        const nn = ny < 0 ? [-nx / nl, -ny / nl, -nz / nl] : [nx / nl, ny / nl, nz / nl];
        for (const v of ny < 0 ? [A, B, C, A, C, D] : [A, C, B, A, D, C]) { p.push(...v); n.push(...nn); }
      }
      const s = -BANK_SIDE, ga = groundAt(ua, s * w), gb = groundAt(ub, s * w);
      const qa = at(ua, s * w), qb = at(ub, s * w), oa = at(ua, s * (w + 0.35 + ga * 0.8)), ob = at(ub, s * (w + 0.35 + gb * 0.8));
      const A = [qa.x, ga, qa.z], B = [qb.x, gb, qb.z], C = [ob.x, 0.002, ob.z], D = [oa.x, 0.002, oa.z];
      for (const v of [A, B, C, A, C, D]) { p.push(...v); n.push(-qa.dz * s * 0.7, 0.55, qa.dx * s * 0.7); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    const m = new THREE.ShaderMaterial({ vertexShader: CLOTH_VS, fragmentShader: CLOTH_FS, uniforms: { ...shared, uTex: { value: clothTex }, uRep: { value: 1 / T_.CLOTH_TILE } }, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
    root.add(mesh);
  }
  // ---- Painted on the cloth: the start line, the wind-up pads, the edge lines, the spills, the doilies ----
  {
    const G = new Geo();
    const P = (u, l, y = 0.014) => { const q = at(u, l); return [q.x, groundAt(u, l) + y, q.z]; };
    const cols = 14, wl = H;
    for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
      const l0 = wl - ((c + 1) * 2 * wl) / cols, l1 = wl - (c * 2 * wl) / cols, u0 = T_.LINE_U + r * 0.48, u1 = u0 + 0.48;
      G.strip([[P(u0, l0), P(u0, l1)], [P(u1, l0), P(u1, l1)]], (r + c) % 2 ? "navy" : "page", 3);
    }
    // The track's edges as the poster paints them: a cream line just inside each wall (none along the open edge's outside).
    for (const s of [-1, 1]) {
      let run = [];
      const flush = () => { if (run.length > 1) G.strip(run, "page", 3); run = []; };
      for (let u = 0; u <= LEN + 0.01; u += 0.5) {
        if (s === EDGE_SIDE && u >= T_.EDGE.u0 && u <= T_.EDGE.u1) { flush(); continue; }
        const lim = sideLimit(u, s) + T_.CAR_W / 2, a = s * (lim - 0.12), b = s * (lim - 0.42);
        run.push(s > 0 ? [P(u, b, 0.012), P(u, a, 0.012)] : [P(u, a, 0.012), P(u, b, 0.012)]);
      }
      flush();
    }
    // Wind-up keys: a big brass key painted across the line, with a chevron pointing on.
    for (const pd of T_.PADS) {
      const k = Math.min(1, pd.hw / 1.6), q = at(pd.u + 0.6, pd.lat), lobes = [[0, 0.9], [1.25, 0.72], [-1.25, 0.72]];
      for (const [off, r] of lobes) {
        const cx = q.x - q.dz * off * k, cz = q.z + q.dx * off * k, gy = groundAt(pd.u + 0.6, pd.lat + off * k) + 0.016;
        G.add(new THREE.CircleGeometry((r + 0.12) * k, 16), M4(cx, gy, cz, -Math.PI / 2, 0, 0), "navy", 3, "");
        G.add(new THREE.CircleGeometry(r * k, 16), M4(cx, gy + 0.004, cz, -Math.PI / 2, 0, 0), "mustard", 3, "");
        if (off) G.add(new THREE.CircleGeometry(r * 0.38 * k, 12), M4(cx, gy + 0.008, cz, -Math.PI / 2, 0, 0), "navy", 3, "");
      }
      for (const [d, ink, sz] of [[1.9, "navy", 1], [1.9, "mustard", 0.62]]) {
        const a = at(pd.u + 0.6 + d, pd.lat), gy = groundAt(pd.u + 0.6 + d, pd.lat) + (ink === "navy" ? 0.017 : 0.021), s = 0.9 * k * sz;
        const tri = new THREE.BufferGeometry();
        tri.setAttribute("position", new THREE.Float32BufferAttribute([0.55 * s, 0, 0, -0.35 * s, 0, -0.75 * s, -0.35 * s, 0, 0.75 * s], 3));
        tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        G.add(tri, M4(a.x, gy, a.z, 0, yaw(a), 0), ink, 3, "");
      }
    }
    // The spills, each its own look, so what it does reads before the word does: salt is white grains, oatmeal a lumpy
    // cream porridge with oats, tea a brown pool with a shine. Each is exactly the rules' patch.
    const LOOK = { salt: ["white", "page", 70, 0.05], oatmeal: ["cream", "toast", 26, 0.22], tea: ["toast", "cream", 8, 0.3] };
    for (const sl of T_.SPILLS) {
      const q = at(sl.u, sl.lat), [ink, grain, ng, gs] = LOOK[sl.name] || LOOK.salt;
      const blob = (sc, key, y) => { const sh = new THREE.Shape(); for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI * 2, w = 1 + 0.06 * Math.sin(a * 5 + sl.u) + 0.04 * Math.sin(a * 9); const px = Math.cos(a) * sl.ru * w * sc, pz = Math.sin(a) * sl.rl * w * sc; i ? sh.lineTo(px, pz) : sh.moveTo(px, pz); } G.add(new THREE.ShapeGeometry(sh), M4(q.x, groundAt(sl.u, sl.lat) + y, q.z, Math.PI / 2, yaw(q), 0), key, 3, ""); };
      blob(1.02, "navy", 0.018); blob(0.96, ink, 0.021);
      for (let i = 0; i < ng; i++) {
        const a = hash(41, i + sl.u) * Math.PI * 2, rr = Math.sqrt(hash(43, i + sl.u)) * 0.82, du = Math.cos(a) * sl.ru * rr, dl = Math.sin(a) * sl.rl * rr, c = at(sl.u + du, sl.lat + dl);
        const sz = gs * (0.7 + 0.6 * hash(47, i)), y = groundAt(sl.u + du, sl.lat + dl) + 0.025;
        if (sl.name === "oatmeal") G.add(new THREE.CircleGeometry(sz, 7), M4(c.x, y, c.z, -Math.PI / 2, a, 0, 1, 0.55, 1), grain, 3, "");
        else G.add(new THREE.CircleGeometry(sz, sl.name === "salt" ? 5 : 10), M4(c.x, y, c.z, -Math.PI / 2, 0, 0, 1, sl.name === "salt" ? 1 : 0.4, 1), sl.name === "salt" ? (i % 3 ? "page" : "grey") : grain, 3, "");
      }
    }
    // Doilies under the sweets: white paper lace, a scalloped round with a ring of holes.
    for (const b of T_.BOXES) for (const l of b.lats) {
      const q = at(b.u, l), gy = groundAt(b.u, l) + 0.02;
      const sh = new THREE.Shape(); for (let i = 0; i <= 36; i++) { const a = (i / 36) * Math.PI * 2, r = 0.62 + 0.07 * Math.cos(a * 12); i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, hp = new THREE.Path(); hp.absarc(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.06, 0, Math.PI * 2, true); sh.holes.push(hp); }
      G.add(new THREE.ShapeGeometry(sh, 3), M4(q.x, gy, q.z, -Math.PI / 2, 0, 0), "white", 3, "");
    }
    const m = inkMaterial(shared, { offset: 2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(G.build(), m); mesh.frustumCulled = false;
    root.add(mesh);
  }
  // ---- The props, merged by region ----
  const R = new Regions(5, scan);
  const prop = (geo, m, key, flag = 0, out = "n") => R.add(geo, m, key, flag, out);
  const named = (name, fn) => { R.name = name; fn(); R.name = ""; };
  /** A box laid along the loop from u0 to u1 (on a straight), its top at height y1, `lat` across its middle. */
  const along = (u0, u1, lat, w, y0, y1, key, flag = 0, pitch = 0) => {
    const a = at((u0 + u1) / 2, lat), len = u1 - u0;
    prop(new THREE.BoxGeometry(len, y1 - y0, w), M4(a.x, (y0 + y1) / 2, a.z, 0, yaw(a), pitch), key, flag, "c");
  };
  /** A deck's sloped part as one board, its top exactly the rules' ground. */
  const slope = (dk, a, b, key, w, lc, th = 0.12) => {
    const len = b[0] - a[0], rise = b[1] - a[1], pitch = Math.atan2(rise, len), lenS = Math.hypot(len, rise), m = at((a[0] + b[0]) / 2, lc);
    prop(new THREE.BoxGeometry(lenS, th, w), M4(m.x, (a[1] + b[1]) / 2 - (th / 2) * Math.cos(pitch), m.z, 0, yaw(m), pitch), key, 0, "c");
    return { pitch, m };
  };
  const lath = (u, l, prof, s, ink, segs = 18, y = 0, per = 3) => { const q = at(u, l); prop(lathe(smoothProf(prof, per), segs), M4(q.x, y, q.z, 0, 0, 0, s), ink, 1, "n"); return q; };
  const BOWL_PROF = [[0.5, 0], [0.6, 0.08], [0.55, 0.2], [1.0, 0.45], [1.45, 1.05], [1.5, 1.15], [1.38, 1.12], [0.9, 0.55], [0.3, 0.32]];
  const bowlInk = (c) => (c.y > 0.95 ? "teal" : c.y > 0.55 && Math.abs(Math.sin(Math.atan2(c.z, c.x) * 3)) > 0.75 ? "teal" : "cream");
  // ---- The set pieces, from the rules' decks: a bread board, a wooden spoon, a spatula, butter knives ----
  for (const dk of T_.DECKS) {
    const [l0, l1] = dk.lat, lc = (l0 + l1) / 2, w = l1 - l0, p = dk.pts;
    named(dk.name, () => {
      if (dk.look === "board") {
        // The bread board, leant on a baguette: two slopes of wood with a darker rim, the loaf under its top end.
        for (let i = 0; i < p.length - 1; i++) if (p[i + 1][0] > p[i][0]) { const s = slope(dk, p[i], p[i + 1], "wood", w, lc, 0.14); prop(new THREE.BoxGeometry(Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) - 0.2, 0.012, w - 0.32), M4(s.m.x, (p[i][1] + p[i + 1][1]) / 2 + 0.006, s.m.z, 0, yaw(s.m), s.pitch), "toast", 3, ""); }
        const top = p[p.length - 1], q = at(top[0] - 0.55, lc);
        prop(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.42, w - 0.95, 4, 10) : new THREE.CylinderGeometry(0.42, 0.42, w, 10), M4(q.x, 0.42, q.z, Math.PI / 2, yaw(q), 0), (c) => (Math.abs(Math.sin(c.y * 3)) > 0.9 ? "cream" : "toast"), 1, "n");
      } else if (dk.look === "spoon") {
        // A big wooden spoon laid up onto a cereal bowl's rim: the handle is the slope, its bowl rests over the cereal bowl.
        for (let i = 0; i < p.length - 1; i++) { const s = slope(dk, p[i], p[i + 1], "wood", w, lc, 0.16); if (i === p.length - 2) { const e = at((p[i][0] + p[i + 1][0]) / 2, lc); prop(new THREE.CircleGeometry(1, 18), M4(e.x, (p[i][1] + p[i + 1][1]) / 2 + 0.012, e.z, -Math.PI / 2, yaw(e), s.pitch, 0.5, w / 2 - 0.15, 1), "toast", 3, ""); } }
        // The bowl the spoon rests on, under the spoon's top end, kept below the slope everywhere.
        const q = at(p[p.length - 1][0] - 1.0, lc);
        prop(lathe(smoothProf(BOWL_PROF, 3), 18), M4(q.x, 0, q.z, 0, 0, 0, 0.55, 0.6, 0.55), bowlInk, 1, "n");
      } else if (dk.look === "spatula") {
        // A steel spatula leant up onto the tall stack of pancakes: the blade is the slope, its slots painted on.
        const s = slope(dk, p[0], p[1], "steel", w, lc, 0.1);
        for (let k = -2; k <= 2; k++) { const q = at((p[0][0] + p[1][0]) / 2, lc + k * 1.2); prop(new THREE.BoxGeometry(Math.hypot(p[1][0] - p[0][0], p[1][1]) * 0.62, 0.012, 0.28), M4(q.x, p[1][1] / 2 + 0.01, q.z, 0, yaw(q), s.pitch), "navy", 3, ""); }
        const h = at(p[0][0] - 0.3, -(H + 2.6));
        prop(new THREE.BoxGeometry(5.2, 0.32, 0.7), M4(h.x, 0.16, h.z, 0, yaw(h) - 0.55, 0), "red", 0, "c");
      } else if (dk.look === "knives") {
        // Two butter knives side by side, resting on egg cups: steel blades, cream handles sloping up from the cloth.
        const half = w / 2;
        for (const off of [-half / 2, half / 2]) {
          slope(dk, p[0], p[1], "cream", half - 0.05, lc + off, 0.14);
          along(p[1][0], p[2][0], lc + off, half - 0.05, p[1][1] - 0.09, p[1][1], "steel", 1);
        }
        for (let t = p[1][0] + 1.5; t < p[2][0]; t += 5) { const q = at(t, lc); prop(lathe(smoothProf([[0.35, 0], [0.45, 0.05], [0.25, 0.18], [0.22, 0.26], [0.5, 0.38], [0.55, 0.41]], 3), 14), M4(q.x, 0, q.z, 0, 0, 0, Math.min(1, w / 1.25)), "white", 1, "n"); }
      }
    });
  }
  // The pancake staircase: each stack is the rules' ellipse, its pancakes as layers, butter and syrup on the tallest.
  named("pancakes", () => {
    for (const s of T_.STACKS) {
      const q = at(s.u, s.lat), n = Math.max(2, Math.round(s.h / 0.25)), th = s.h / n;
      for (let k = 0; k < n; k++) {
        const k1 = 1 - 0.035 * ((k * 7) % 3);
        prop(new THREE.CylinderGeometry(1, 1, th * 0.92, 28), M4(q.x, k * th + th * 0.46, q.z, 0, yaw(q), 0, s.ru * k1, 1, s.rl * k1), (c) => (Math.abs(c.y) > th * 0.36 ? "toast" : "cream"), 0, "c");
      }
      prop(new THREE.CylinderGeometry(1, 1, 0.02, 28), M4(q.x, s.h + 0.008, q.z, 0, yaw(q), 0, s.ru * 0.7, 1, s.rl * 0.7), "butter", 3, "");
    }
    const t = T_.STACKS[0], q = at(t.u, t.lat + 1.5);
    prop(new THREE.BoxGeometry(1.1, 0.03, 0.9), M4(q.x, t.h + 0.02, q.z, 0, yaw(q) + 0.3, 0), "butter", 3, ""); // a melted pat, flat on top
  });
  // The butter dish: a plate, the glass cover over the butter (cars drive right over it).
  named("butter dish", () => {
    const dm = T_.DOMES.find((d) => d.name === "butter dish"), q = at(dm.u, dm.lat);
    prop(new THREE.CylinderGeometry(dm.rim, dm.rim + 0.1, dm.rimH, 32), M4(q.x, dm.rimH / 2, q.z), "teal", 0, "c");
    prop(new THREE.CylinderGeometry(dm.rim - 0.3, dm.rim - 0.25, 0.02, 32), M4(q.x, dm.rimH + 0.01, q.z), "cream", 3, "");
    const prof = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; prof.push([dm.ru * Math.cos(a), dm.rimH + (dm.h - dm.rimH) * Math.sin(a)]); }
    prop(lathe(prof, 26), M4(q.x, 0, q.z), (c) => (c.y < dm.rimH + 0.35 ? "butter" : "chrome"), 1, "n");
    // Round five: the knob is painted on the glass (a raised knob stood above the rules' dome, so cars passed through it).
    prop(new THREE.CircleGeometry(0.32, 12), M4(q.x, dm.h + 0.012, q.z, -Math.PI / 2, 0, 0), "mustard", 3, "");
  });
  // The fruit bowl in the middle of the bank: a hill of a bowl, its rim hanging out over the inside lanes.
  const BW = T_.BOWL, bx = bank.cx, bz = bank.cz;
  named("fruit bowl", () => {
    const prof = smoothProf([[BW.foot - 0.8, 0], [BW.foot, 0.3], [BW.foot - 0.5, 1.0], [BW.foot + 1.6, 2.0], [BW.foot + 4.6, 3.9], [BW.rim - 1.6, 6.0], [BW.rim - 0.15, BW.rimY - 0.15], [BW.rim, BW.rimY], [BW.rim - 0.5, BW.rimY + 0.05], [BW.rim - 2.4, 6.0], [BW.foot + 3.6, 4.2], [0.6, 3.0]], 2);
    const n = prof.length - 1, geo = lathe(prof, 36), uvA = geo.attributes.uv;
    const iLo = prof.findIndex((p) => p[1] > 1.9), iHi = prof.findIndex((p) => p[1] > BW.rimY - 0.9);
    for (let i = 0; i < uvA.count; i++) { const t = uvA.getY(i) * n; uvA.setY(i, t < iLo ? (0.25 * t) / iLo : t < iHi ? 0.25 + (0.5 * (t - iLo)) / (iHi - iLo) : 0.75 + (0.25 * (t - iHi)) / (n - iHi)); }
    const footY = ringNear(prof, 0.9), rimY = ringNear(prof, BW.rimY - 0.5);
    prop(geo, M4(bx, 0, bz), (c) => (c.y < footY && Math.hypot(c.x, c.z) > BW.foot - 1 ? "teal" : c.y > rimY && Math.hypot(c.x, c.z) > BW.rim - 1.2 ? "teal" : "cream"), 4, "n");
    prop(new THREE.SphereGeometry(4.0, 14, 10), M4(bx - 2.2, 8.6, bz + 1.6, 0, 0, 0, 1.05, 0.95, 1.05), "red", 1, "n");
    prop(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 6), M4(bx - 2.4, 12.6, bz + 1.4, 0, 0, 0.25), "navy", 3, "");
    prop(new THREE.SphereGeometry(1.5, 10, 5), M4(bx - 1.2, 12.9, bz + 1.6, 0, 0.3, 0.5, 1, 0.13, 0.5), "teal", 0, "n");
    prop(lathe(smoothProf([[0, 0], [2.2, 0.4], [3.0, 2.0], [2.4, 3.9], [1.3, 5.4], [0.95, 6.6], [0, 6.9]], 3), 14), M4(bx + 2.6, 5.6, bz - 1.4, 0.12, 0, -0.16), "butter", 1, "n");
    prop(new THREE.SphereGeometry(2.6, 12, 8), M4(bx + 1.0, 7.4, bz + 4.2), "orange", 1, "n");
    for (const [dx, dy, dz] of [[3.6, 7.6, 3.4], [4.6, 7.8, 2.0], [4.2, 8.8, 3.0], [3.0, 8.6, 4.4]]) prop(new THREE.SphereGeometry(0.8, 8, 6), M4(bx + dx, dy, bz + dz), "red", 1, "n");
    // Cherries hanging over the rim on the track's side, in pairs on a stem.
    for (let k = 0; k < 7; k++) {
      const u = bank.u0 + bank.len * (0.08 + 0.84 * (k / 6)), q = at(u, 0), dx = q.x - bx, dz = q.z - bz, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
      const rx = bx + ux * (BW.rim + 0.25), rz = bz + uz * (BW.rim + 0.25);
      for (const [o, dy] of [[-0.35, -0.9], [0.35, -1.25]]) prop(new THREE.SphereGeometry(0.5, 8, 6), M4(rx - uz * o, BW.rimY + dy, rz + ux * o), "red", 1, "n");
      prop(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 4), M4(rx, BW.rimY - 0.3, rz, 0, 0, 0), "navy", 3, "");
    }
  });
  // The cereal box: a building stood across the track, an arch cut through it, its front and back printed.
  const TN = T_.TUNNEL, boxPanels = [];
  named("cereal box", () => {
    const u0 = TN.u - TN.len / 2, u1 = TN.u + TN.len / 2, inner = TN.half, wall = TN.wall, top = TN.top, arch = TN.arch;
    const band = (hh) => (c) => (c.y > hh - 1.4 ? "red" : "mustard");
    for (const s of [-1, 1]) along(u0, u1, s * (inner + wall / 2), wall, 0, top, band(top / 2), 0);
    along(u0, u1, 0, 2 * inner + 0.02, arch, top, band((top - arch) / 2), 0);
    for (const s of [-1, 1]) { const q = at(TN.u, s * (inner + wall + 0.01)); prop(new THREE.PlaneGeometry(TN.len * 0.86, 2.2), M4(q.x, top * 0.45, q.z, 0, yaw(q) + (s > 0 ? 0 : Math.PI), 0), "teal", 3, ""); }
    for (const [u, dir] of [[u0 - 0.02, -1], [u1 + 0.02, 1]]) { const q = at(u, 0); boxPanels.push({ x: q.x, z: q.z, ry: yaw(q) + (dir < 0 ? -Math.PI / 2 : Math.PI / 2), w: 2 * (inner + wall), h: top - arch, y: (top + arch) / 2 }); }
  });
  // The toaster in the infield: chrome and red, two slots on top (its lever and the toast move).
  const TS = T_.TOASTER, toq = at(TS.u, TS.lat), toyaw = yaw(toq);
  named("toaster", () => {
    prop(roundBox(5.2, 4.2, 3.6, 0.22, 16, 10), M4(toq.x, 2.1, toq.z, 0, toyaw, 0), (c) => (c.y < -1.2 ? "red" : "chrome"), 1, "n");
    for (const o of [-0.7, 0.7]) { const sx = toq.x - toq.dz * o, sz = toq.z + toq.dx * o; prop(new THREE.BoxGeometry(3.6, 0.04, 0.45), M4(sx, 4.21, sz, 0, toyaw, 0), "navy", 3, ""); }
  });
  // The kettle outside the home straight: a big teal enamel kettle, its spout toward the track (its lid moves).
  const KT = T_.KETTLE, kq = at(KT.u, KT.lat), kyaw = yaw(kq);
  const kSpoutDir = { x: -kq.dz * -Math.sign(KT.lat), z: kq.dx * -Math.sign(KT.lat) };
  named("kettle", () => {
    prop(lathe(smoothProf([[2.6, 0], [3.1, 0.3], [3.5, 1.6], [3.3, 3.2], [2.3, 4.3], [1.6, 4.6]], 3), 22), M4(kq.x, 0, kq.z), (c) => (c.y < 0.5 ? "navy" : "teal"), 1, "n");
    prop(new THREE.TorusGeometry(2.2, 0.28, 6, 16, Math.PI), M4(kq.x, 4.5, kq.z, 0, kyaw, 0), "navy", 1, "n");
    const sx = kq.x + kSpoutDir.x * 3.6, sz = kq.z + kSpoutDir.z * 3.6;
    prop(new THREE.CylinderGeometry(0.32, 0.75, 3.2, 10), M4(sx, 2.8, sz, 0, Math.atan2(-kSpoutDir.z, kSpoutDir.x), -0.85), "teal", 1, "n");
  });
  // The teacup on its side by the far corner, its tea spilt across the inside line (the rules' tea patch).
  named("teacup", () => {
    const sl = T_.SPILLS.find((s) => s.name === "tea"), q = at(sl.u + 1.0, H + 4.3), tq2 = at(sl.u, sl.lat), dir = Math.atan2(-(tq2.z - q.z), tq2.x - q.x);
    prop(lathe(smoothProf([[1.4, 0], [1.6, 0.2], [2.4, 1.6], [2.9, 3.1], [3.0, 3.3], [2.8, 3.3], [2.2, 1.9], [0.4, 0.4]], 3), 22), M4(q.x, 2.7, q.z, 0, dir, -(Math.PI / 2 + 0.25)), (c) => (c.y > 2.6 && c.y < 2.95 ? "red" : c.y > 1.0 && c.y < 2.2 && Math.abs(c.x) > 2.0 ? "teal" : "cream"), 1, "n");
    prop(new THREE.TorusGeometry(1.0, 0.25, 6, 12, Math.PI * 1.3), M4(q.x - Math.cos(dir) * 1.2, 3.8, q.z + Math.sin(dir) * 1.2, 0, dir + Math.PI / 2, 0), "cream", 1, "n");
  });
  // The cereal bowl tipped over on the infield side, its oatmeal spilt onto the road (the rules' oatmeal patch).
  named("oatmeal bowl", () => {
    const sl = T_.SPILLS.find((s) => s.name === "oatmeal"), q = at(sl.u + 0.4, H + 2.6), oq = at(sl.u, sl.lat), dir = Math.atan2(-(oq.z - q.z), oq.x - q.x);
    prop(lathe(smoothProf(BOWL_PROF, 3), 20), M4(q.x, 1.55, q.z, 0, dir, Math.PI / 2 + 0.35, 1.5, 1.6, 1.5), bowlInk, 1, "n");
    prop(new THREE.SphereGeometry(1.0, 10, 6), M4(q.x + Math.cos(dir) * 0.6, 0.3, q.z - Math.sin(dir) * 0.6, 0, dir, 0, 1.2, 0.3, 0.9), "cream", 0, "n");
  });
  // A bread basket of rolls outside, opposite the oatmeal; a juice jug and a stack of plates by the pancakes.
  named("bread basket", () => {
    const q = at(91, -(H + 4.4));
    prop(lathe(smoothProf([[2.4, 0], [2.6, 0.2], [3.2, 1.6], [3.3, 1.75]], 3), 20), M4(q.x, 0, q.z, 0, 0, 0, 1, 1, 0.75), (c) => (Math.floor(c.y * 4 + Math.atan2(c.z, c.x) * 3) % 2 ? "wood" : "toast"), 1, "n");
    for (const [dx, dz, r] of [[-1.1, 0.2, 0.3], [0.9, -0.3, -0.4], [0.0, 0.6, 1.2]]) prop(new THREE.SphereGeometry(1.0, 10, 6), M4(q.x + dx, 1.7, q.z + dz, 0, r, 0, 1.4, 0.75, 0.9), "toast", 1, "n");
  });
  named("juice jug", () => { lath(160, -(H + 5.2), [[1.6, 0], [1.8, 0.2], [1.9, 3.2], [1.5, 4.6], [1.7, 5.2]], 1, (c) => (c.y < 3.4 ? "orange" : "glass"), 16); });
  named("plates", () => { const q = at(166, H + 5.6); for (let k = 0; k < 6; k++) prop(lathe(smoothProf([[1.4, 0], [2.8, 0.15], [3.3, 0.42], [3.2, 0.46], [1.2, 0.2]], 2), 20), M4(q.x + (hash(5, k) - 0.5) * 0.3, k * 0.44, q.z + (hash(6, k) - 0.5) * 0.3), (c) => (c.y > 0.3 ? "teal" : "cream"), 1, "n"); });
  // The jug of flowers in the far corner, by the bank.
  named("flowers", () => {
    const q = at(bank.u0 - 9, -(H + 6.5)), jx = q.x, jz = q.z, S = 2.6;
    prop(lathe(smoothProf([[0.62, 0], [0.7, 0.1], [0.95, 0.7], [0.9, 1.3], [0.56, 1.9], [0.6, 2.3], [0.72, 2.42]], 3), 16), M4(jx, 0, jz, 0, 0, 0, S), "cream", 4, "n");
    for (const [dx, dy, dz, s] of [[0, 4.4, 0, 1.2], [-0.9, 3.9, 0.4, 1], [0.8, 4.0, -0.5, 1.05]]) {
      prop(new THREE.SphereGeometry(0.46 * s * S, 8, 5), M4(jx + dx * S, dy * S, jz + dz * S, 0, 0, 0, 1, 0.5, 1), "white", 0, "n");
      prop(new THREE.SphereGeometry(0.2 * s * S, 6, 4), M4(jx + dx * S, (dy + 0.14 * s) * S, jz + dz * S), "mustard", 3, "");
    }
    for (const [dx, dy, dz, r] of [[-0.6, 3.2, -0.6, 0.4], [0.9, 3.3, 0.4, 0.5], [0.4, 3.15, -1.0, 2]]) prop(new THREE.SphereGeometry(0.75 * S, 6, 4), M4(jx + dx * S, dy * S, jz + dz * S, 0.5, r, 0.4, 1, 0.14, 0.45), "teal", 0, "n");
  });
  // The teapot in the infield of the home straight.
  const teapotAt = at(66, 15.5);
  named("teapot", () => {
    const tx = teapotAt.x, tz = teapotAt.z, s = 3.4;
    const pot = smoothProf([[0.9, 0], [1.0, 0.1], [1.5, 0.6], [1.62, 1.1], [1.3, 1.7], [0.7, 1.98], [0.66, 2.04]], 3), potY = ringNear(pot, 0.2);
    prop(lathe(pot, 22), M4(tx, 0, tz, 0, 0, 0, s), (c) => (c.y < potY * s ? "teal" : "cream"), 4, "n");
    const lid = smoothProf([[0.72, 0], [0.74, 0.08], [0.5, 0.26], [0.16, 0.34], [0.2, 0.52], [0, 0.6]], 2), lidY = ringNear(lid, 0.3);
    prop(lathe(lid, 14), M4(tx, 2.0 * s, tz, 0, 0, 0, s), (c) => (c.y > lidY * s ? "teal" : "cream"), 1, "n");
    prop(new THREE.CylinderGeometry(0.16 * s, 0.34 * s, 1.5 * s, 8), M4(tx - 1.2 * s, 1.2 * s, tz - 0.6 * s, 0, Math.PI * 0.85, -0.9), "cream", 1, "n");
    prop(new THREE.TorusGeometry(0.6 * s, 0.11 * s, 5, 12, Math.PI * 1.2), M4(tx + 1.25 * s, 1.0 * s, tz + 0.5 * s, 0, Math.PI * 0.85 + Math.PI, -0.6 - Math.PI / 2), "cream", 1, "n");
  });
  // A sugar bowl and its cubes outside the home straight, before the line.
  const sugarAt = at(LEN + T_.LINE_U - 9, -(H + 5.5));
  named("sugar bowl", () => {
    const c = sugarAt, s = 2.2;
    prop(lathe(smoothProf([[1.1, 0], [1.25, 0.1], [1.55, 0.7], [1.5, 1.2], [1.3, 1.35]], 3), 18), M4(c.x, 0, c.z, 0, 0, 0, s), (q) => (q.y < 0.3 * s ? "teal" : "cream"), 4, "n");
    prop(lathe(smoothProf([[1.32, 0], [1.2, 0.15], [0.6, 0.3], [0.2, 0.36], [0.22, 0.5], [0, 0.55]], 2), 14), M4(c.x, 1.35 * s, c.z, 0, 0, 0, s), (q) => (q.y > 0.25 * s ? "teal" : "cream"), 1, "n");
    for (const [dx, dz, r] of [[3.8, 0.8, 0.3], [4.8, -0.6, 1.1], [4.4, -1.6, 0.7]]) prop(new THREE.BoxGeometry(0.9, 0.9, 0.9), M4(c.x + dx, 0.45, c.z + dz, 0, r, 0), "white", 0, "c");
  });
  // The chair at the end of the table, its red back over the edge.
  named("chair", () => {
    const cx = TABLE.x1 + 6, cz = (TABLE.z0 + TABLE.z1) / 2;
    prop(new THREE.TorusGeometry(9, 0.7, 5, 16, Math.PI), M4(cx, 8, cz, 0, Math.PI / 2, 0), "red", 0, "n");
    for (const dz of [-5.4, -2, 2, 5.4]) prop(new THREE.CylinderGeometry(0.45, 0.45, 12.5, 6), M4(cx, 8.4, cz + dz, 0, 0, 0, 1, dz * dz > 16 ? 0.82 : 1.2, 1), "red", 0, "n");
  });
  // More of breakfast round the lap: a jam jar and saucers by the open edge, a milk bottle by the far straight,
  // an orange by the toast, a coffee mug by the start, the egg cup and the syrup on its stand (below, with what moves).
  named("jam jar", () => {
    const jq = lath(212, H + 6.4, [[2.3, 0], [2.5, 0.2], [2.6, 4.2], [2.2, 4.8], [2.25, 5.4]], 1, (c) => (c.y > 4.6 ? "glass" : c.y > 1.6 && c.y < 3.6 ? (c.y > 2.4 && c.y < 2.8 ? "red" : "cream") : "red"), 18);
    prop(new THREE.CylinderGeometry(2.55, 2.55, 0.9, 18), M4(jq.x, 5.75, jq.z), (c) => (Math.floor(Math.atan2(c.z, c.x) * 4) % 2 ? "red" : "white"), 0, "c");
  });
  named("saucers", () => { const q = at(223, H + 5.6); for (let k = 0; k < 4; k++) prop(lathe(smoothProf([[1.4, 0], [2.6, 0.15], [3.2, 0.42], [3.1, 0.46], [1.2, 0.2]], 2), 20), M4(q.x + (hash(5, k) - 0.5) * 0.3, k * 0.44, q.z + (hash(6, k) - 0.5) * 0.3), (c) => (c.y > 0.3 ? "teal" : "cream"), 1, "n"); });
  named("milk bottle", () => { lath(281, -(H + 6.0), [[1.9, 0], [2.1, 0.2], [2.1, 4.4], [1.4, 6.6], [1.0, 7.6], [1.05, 8.4]], 1, (c) => (c.y > 7.9 ? "red" : c.y > 6.0 ? "glass" : c.y > 2.2 && c.y < 3.4 ? "teal" : "white"), 16); });
  named("orange", () => { const q = at(250, H + 6.5); prop(new THREE.SphereGeometry(2.5, 14, 10), M4(q.x, 2.4, q.z, 0, 0, 0, 1, 0.94, 1), "orange", 1, "n"); prop(new THREE.SphereGeometry(0.9, 8, 5), M4(q.x + 0.4, 4.8, q.z, 0.3, 0.6, 0.4, 1, 0.14, 0.45), "teal", 0, "n"); });
  named("coffee mug", () => { const q = lath(14, H + 6.8, [[2.0, 0], [2.2, 0.15], [2.3, 4.0], [2.35, 4.3]], 1, (c) => (c.y > 1.4 && c.y < 2.2 ? "red" : "white"), 18); prop(new THREE.TorusGeometry(1.1, 0.32, 6, 12, Math.PI * 1.25), M4(q.x - 2.4, 2.3, q.z, 0, 0, Math.PI / 2 + 0.95), "white", 1, "n"); });
  named("sugar cubes", () => { for (const [u, l, r] of [[38, 7.0, 0.3], [130, -6.2, 0.7], [182, 8.0, 0.4], [270, -6, 0.2]]) { const q = at(u, l); prop(new THREE.BoxGeometry(0.9, 0.9, 0.9), M4(q.x, 0.45, q.z, 0, r, 0), "white", 0, "c"); } });
  // The egg cup on the west straight's infield, where the egg rocks before it rolls (the egg itself moves).
  const EG = T_.EGG, eq = at(EG.u, EG.from);
  named("egg cup", () => { prop(lathe(smoothProf([[0.55, 0], [0.7, 0.06], [0.32, 0.3], [0.3, 0.45], [0.72, 0.7], [0.78, 0.75]], 3), 16), M4(eq.x, 0, eq.z, 0, 0, 0, 1.0), (c) => (c.y > 0.55 ? "red" : "white"), 1, "n"); });
  // The syrup bottle on a cake stand in the last corner's infield, tilted out over the road (its strand and its puddle move).
  const SY = T_.SYRUP, sq = at(SY.u, H + 3.2), sp = at(SY.u, SY.lat + 0.3);
  const syDir = Math.atan2(-(sp.z - sq.z), sp.x - sq.x);
  named("syrup stand", () => {
    // Reviewer fix (round five): the bottle stood on a thin-stemmed cake stand that read as a mushroom table. It now sits
    // on a wooden bread box with a rolled lid (the same height, so the bottle and its strand are where they were).
    prop(roundBox(2.9, 2.6, 2.5, 0.3, 20, 10), M4(sq.x, 1.3, sq.z, 0, syDir, 0), (c) => (c.y > 0.55 ? "toast" : "wood"), 1, "n");
    for (const k of [-0.9, -0.3, 0.3, 0.9]) prop(new THREE.BoxGeometry(0.07, 0.02, 2.0), M4(sq.x + Math.cos(syDir) * k, 2.61, sq.z - Math.sin(syDir) * k, 0, syDir, 0), "navy", 3, "");
    const m = new THREE.Matrix4().compose(new THREE.Vector3(sq.x, 2.6, sq.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, syDir, -1.05, "YZX")), new THREE.Vector3(1, 1, 1));
    prop(lathe(smoothProf([[0.7, 0], [0.8, 0.1], [0.8, 1.9], [0.45, 2.5], [0.26, 3.1], [0.3, 3.4]], 3), 14), m, (c) => (c.y > 3.0 ? "red" : c.y > 0.6 && c.y < 1.4 ? "cream" : "mustard"), 1, "n");
  });
  // ---- The rails: a low cream rolled edge just outside each wall (none on the open edge's outside) ----
  R.name = "";
  for (const s of [-1, 1]) {
    const runs = s === EDGE_SIDE ? [[T_.EDGE.u1, LEN + T_.EDGE.u0]] : [[0, LEN]];
    for (const [r0, r1] of runs) {
      for (let p0 = r0; p0 < r1 - 1e-6; p0 += 15) {
        const p1 = Math.min(r1, p0 + 15), pos = [], nor = [], idx = [], seg = 5, rad = 0.12;
        let rows = 0, mx = 0;
        for (let u = p0; u <= p1 + 1e-6; u += 0.75) {
          const off = s * (sideLimit(u, s) + T_.CAR_W / 2 + 0.12), c = at(u, off), y = Math.max(0, groundAt(u, off) - (groundAt(u, off) > 0.3 && !(TAG.bank && bankAt(u) > 0) ? groundAt(u, off) : 0)) + 0.08;
          const rx = -c.dz, rz = c.dx;
          for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); pos.push(c.x + rx * ca * rad, y + sa * rad, c.z + rz * ca * rad); nor.push(rx * ca, sa, rz * ca); }
          rows++; mx += c.x;
        }
        for (let j = 0; j < rows - 1; j++) for (let k = 0; k < seg; k++) { const A = j * (seg + 1) + k, B = A + 1, C = A + seg + 1, D = C + 1; idx.push(A, C, B, B, C, D); }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
        R.add(g, M4(), "page", 0, "", mx / rows);
      }
    }
  }
  const propMat = inkMaterial(shared, { side: THREE.DoubleSide }), propShell = inkMaterial(shared, { shell: true, thick: TUNE.OUTLINE * 1.25 });
  for (const m of R.meshes(propMat, propShell)) root.add(m);
  // The cereal box's printed fronts: a flat print on card (a canvas picture), above the arch.
  {
    const tex = cerealTexture();
    const mat = new THREE.ShaderMaterial({ vertexShader: PANEL_VS, fragmentShader: PANEL_FS, uniforms: { ...shared, uTex: { value: tex } } });
    for (const p of boxPanels) { const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat); m.position.set(p.x, p.y, p.z); m.rotation.y = p.ry; root.add(m); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { cerealTexture(tex.image); tex.needsUpdate = true; }).catch(() => {});
  }
  // Salt and pepper shakers standing in the middle of the widened road: glass with salt or pepper in it and a chrome
  // cap, about nine cars tall. Their own mesh, which breaks into paper dots right at the lens, as a rival car does.
  let shakerShell;
  {
    const SG = new Geo();
    const r = T_.SHAKER_R, h = T_.SHAKER_H, capH = h * 0.19, bodyH = h - capH;
    const sp2 = smoothProf([[r * 0.9, 0], [r, 0.12], [r, bodyH * 0.72], [r * 0.86, bodyH * 0.94], [r * 0.74, bodyH]], 3);
    const cap = smoothProf([[r * 0.78, 0], [r * 0.8, capH * 0.12], [r * 0.8, capH * 0.55], [r * 0.6, capH * 0.86], [r * 0.25, capH], [0, capH]], 2);
    for (const sh of SHAKERS) {
      const m = M4(sh.x, 0, sh.z), fill = sh.kind === "salt" ? "white" : "pepper";
      if (scan) { const R2 = new Regions(1, scan); R2.name = "shaker " + sh.kind + " " + sh.u; R2.add(lathe(sp2, 14), m, "glass"); }
      SG.add(lathe(sp2, 14), m, (c) => (c.y < h * 0.48 ? fill : "glass"), 1, "n");
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.26; SG.add(new THREE.PlaneGeometry(0.05, bodyH * 0.62), m.clone().multiply(M4(Math.cos(a) * (r + 0.006), bodyH * 0.38, Math.sin(a) * (r + 0.006), 0, -a + Math.PI / 2, 0)), "navy", 3, ""); }
      SG.add(lathe(cap, 12), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, bodyH - 0.02, 0)), "chrome", 1, "n");
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; SG.add(new THREE.CircleGeometry(0.07, 6), m.clone().multiply(M4(Math.cos(a) * r * 0.28, h + 0.002, Math.sin(a) * r * 0.28, -Math.PI / 2, 0, 0)), "navy", 3, ""); }
    }
    const ghost = { value: 2 }, sg = SG.build();
    const body = new THREE.Mesh(sg, inkMaterial(shared, { ghost, fadeOut: true, side: THREE.DoubleSide })), shell = new THREE.Mesh(sg, inkMaterial(shared, { shell: true, ghost }));
    root.add(body, shell);
    shakerShell = shell;
  }
  // ---- Things that move ----
  const movers = { scan };
  const mover = (G, shell = true) => { const g = G.build(), grp = new THREE.Group(); grp.add(new THREE.Mesh(g, propMat)); if (shell) grp.add(new THREE.Mesh(g, inkMaterial(shared, { shell: true }))); root.add(grp); return grp; };
  // The lazy Susan: a turntable with arrows round its rim showing which way it turns, a jam jar and a honey pot riding on it.
  {
    const SU = T_.SUSAN, G = new Geo(), d = Math.sign(SU.spin) || 1;
    G.add(lathe([[SU.r, 0], [SU.r, 0.06], [SU.r - SU.bevel, SU.h - 0.01], [0.001, SU.h]], 40), M4(), (c) => (Math.hypot(c.x, c.z) > SU.r - SU.bevel * 0.6 ? "red" : "wood"), 0, "n");
    G.add(new THREE.RingGeometry(SU.r - SU.bevel - 0.55, SU.r - SU.bevel - 0.2, 40), M4(0, SU.h + 0.006, 0, -Math.PI / 2, 0, 0), "cream", 3, "");
    for (let i = 0; i < 6; i++) {
      // A chevron pointing the way it turns, at the middle of the rim band.
      const a = (i / 6) * Math.PI * 2, rr = SU.r - SU.bevel - 0.375, tri = new THREE.BufferGeometry(), s = 0.42;
      tri.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -s * d, -s * 0.8, 0, s * 0.5 * d, s * 0.8, 0, s * 0.5 * d], 3)); tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      G.add(tri, M4(Math.cos(a) * rr, SU.h + 0.012, Math.sin(a) * rr, 0, -a, 0), "navy", 3, "");
    }
    G.add(new THREE.CircleGeometry(1.0, 20), M4(0, SU.h + 0.006, 0, -Math.PI / 2, 0, 0), "teal", 3, "");
    for (const th of SU.things) {
      const x = Math.cos(th.a) * th.at, z = Math.sin(th.a) * th.at;
      if (th.kind === "jam") {
        G.add(lathe(smoothProf([[th.r * 0.9, 0], [th.r, 0.1], [th.r, th.h * 0.78], [th.r * 0.86, th.h * 0.86]], 3), 16), M4(x, SU.h, z), (c) => (c.y > SU.h + th.h * 0.3 && c.y < SU.h + th.h * 0.55 ? "cream" : "red"), 1, "n");
        G.add(new THREE.CylinderGeometry(th.r * 1.02, th.r * 1.02, th.h * 0.2, 16), M4(x, SU.h + th.h * 0.9, z), (c) => (Math.floor(Math.atan2(c.z - z, c.x - x) * 3) % 2 ? "red" : "white"), 0, "c");
      } else {
        G.add(lathe(smoothProf([[th.r * 0.7, 0], [th.r, th.h * 0.35], [th.r * 0.9, th.h * 0.75], [th.r * 0.55, th.h * 0.85], [th.r * 0.6, th.h]], 3), 16), M4(x, SU.h, z), (c) => (Math.abs(c.y - SU.h - th.h * 0.5) < th.h * 0.08 ? "navy" : "mustard"), 1, "n");
      }
    }
    const g = mover(G);
    g.position.set(SUSAN_AT.x, 0, SUSAN_AT.z);
    movers.susan = g;
  }
  // The kettle's lid (it rattles before the steam).
  {
    const L = new Geo();
    L.add(lathe(smoothProf([[1.7, 0], [1.6, 0.25], [0.9, 0.55], [0.3, 0.6], [0.35, 0.9], [0, 1.0]], 2), 16), M4(), (c) => (c.y > 0.55 ? "navy" : "teal"), 1, "n");
    const lid = mover(L); lid.position.set(kq.x, 4.55, kq.z); movers.lid = lid;
    movers.spout = { x: kq.x + kSpoutDir.x * 5.0, y: 4.0, z: kq.z + kSpoutDir.z * 5.0, dx: kSpoutDir.x, dz: kSpoutDir.z };
  }
  // The toaster's lever and the toast: two slices that pop, fly over and land across the track as a ramp.
  {
    const Lv = new Geo(); Lv.add(new THREE.BoxGeometry(0.9, 0.35, 0.5), M4(0, 0, 0), "red", 0, "c");
    const lever = new THREE.Mesh(Lv.build(), propMat);
    const side = { x: toq.x - toq.dx * 2.75, z: toq.z - toq.dz * 2.75 };
    lever.position.set(side.x, 3.2, side.z); lever.rotation.y = toyaw; root.add(lever); movers.lever = lever; movers.leverY = [3.3, 1.4];
    const Tg = new Geo(), u0 = TS.land - TS.len / 2, nu = 5, nl = 5, c0 = at(TS.land, (TS.lat0 + TS.lat1) / 2);
    const pt = (u, l) => { const q = at(u, l); return [q.x - c0.x, toastH(u, l, 1), q.z - c0.z]; };
    Tg.add(surface(nu, nl, (s, t) => pt(u0 + TS.len * s, TS.lat0 + (TS.lat1 - TS.lat0) * t)), M4(), "toast", 0, "n");
    for (const l of [TS.lat0 + 0.12, TS.lat1 - 0.12]) Tg.add(surface(nu, 1, (s, t) => { const p = pt(u0 + TS.len * s, l); return [p[0], p[1] * t + 0.005, p[2]]; }), M4(), "wood", 0, "c");
    Tg.add(surface(nl, 1, (s, t) => { const p = pt(u0 + TS.len - 0.001, TS.lat0 + (TS.lat1 - TS.lat0) * s); return [p[0], p[1] * t, p[2]]; }), M4(), "wood", 0, "c");
    const toast = mover(Tg); toast.position.set(c0.x, 0.02, c0.z);
    movers.toast = toast; movers.toastLand = { x: c0.x, z: c0.z }; movers.toastFrom = { x: toq.x, z: toq.z, y: 4.4 };
    const S = new Geo(); for (const o of [-0.7, 0.7]) S.add(new THREE.BoxGeometry(2.8, 2.0, 0.28), M4(0, 0, o), "toast", 0, "c");
    const slices = mover(S); slices.position.set(toq.x, 3.6, toq.z); slices.rotation.y = toyaw; movers.slices = slices;
  }
  // Warning rings painted on the cloth where something is about to land or roll: a mustard ring with a navy edge,
  // pulsing. One instanced mesh, a few at a time (the cherry's landing, the toast's landing, the egg's path, the syrup's drip).
  {
    const W = new Geo();
    W.add(new THREE.RingGeometry(0.78, 1.0, 28), M4(0, 0, 0, -Math.PI / 2, 0, 0), "navy", 3, "");
    W.add(new THREE.RingGeometry(0.82, 0.96, 28), M4(0, 0.003, 0, -Math.PI / 2, 0, 0), "mustard", 3, "");
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; W.add(new THREE.CircleGeometry(0.08, 6), M4(Math.cos(a) * 0.62, 0.003, Math.sin(a) * 0.62, -Math.PI / 2, 0, 0), "navy", 3, ""); }
    const N = 6, inst = new THREE.InstancedMesh(W.build(), inkMaterial(shared, { offset: 3, side: THREE.DoubleSide }), N);
    inst.frustumCulled = false; inst.count = 0; inst.renderOrder = 1; root.add(inst); movers.rings = { inst, N };
  }
  // Cherries that drop off the bowl: a small pool, each a red ball with a stem and its shadow.
  {
    const C = new Geo(), r = T_.CHERRY.r;
    C.add(new THREE.SphereGeometry(r, 12, 8), M4(), "red", 1, "n");
    C.add(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 4), M4(0.05, r + 0.25, 0, 0, 0, -0.3), "navy", 0, "c");
    C.add(new THREE.SphereGeometry(r * 0.22, 6, 4), M4(-r * 0.45, r * 0.45, r * 0.55), "cream", 3, "");
    const cg = C.build();
    movers.cherries = [];
    for (let k = 0; k < T_.CHERRY.max; k++) {
      const g = new THREE.Group(); g.add(new THREE.Mesh(cg, propMat), new THREE.Mesh(cg, inkMaterial(shared, { shell: true }))); g.visible = false; root.add(g);
      const sh = buildGround(shared); sh.scale.set(0.9, 1, 0.9); sh.visible = false; root.add(sh);
      movers.cherries.push({ g, sh, id: -1 });
    }
  }
  // The egg: a big brown egg that rocks in its cup, then rolls across the road with its shadow under it.
  {
    const E = new Geo(); E.add(new THREE.SphereGeometry(EG.r, 14, 10), M4(0, 0, 0, 0, 0, 0, 1, 1.3, 1), (c) => (c.y > EG.r * 0.6 && c.x < 0 ? "white" : "cream"), 1, "n");
    const g = mover(E); g.visible = true; g.rotation.order = "YXZ";
    const sh = buildGround(shared); sh.scale.set(1.0, 1, 1.1); root.add(sh);
    movers.egg = { g, sh };
  }
  // The syrup: the strand from the bottle's mouth to the road, and the sticky amber puddle it makes.
  {
    const S = new Geo(); S.add(new THREE.CylinderGeometry(0.08, 0.13, 1, 6), M4(0, -0.5, 0), "mustard", 0, "");
    const strand = new THREE.Mesh(S.build(), propMat); root.add(strand); strand.visible = false;
    const P = new Geo(); const sh = new THREE.Shape(); for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2, w = 1 + 0.07 * Math.sin(a * 5) + 0.04 * Math.sin(a * 11); i ? sh.lineTo(Math.cos(a) * w, Math.sin(a) * w) : sh.moveTo(Math.cos(a) * w, Math.sin(a) * w); }
    P.add(new THREE.ShapeGeometry(sh), M4(0, 0, 0, -Math.PI / 2, 0, 0, 1.04, 1.04, 1), "navy", 3, ""); P.add(new THREE.ShapeGeometry(sh), M4(0, 0.003, 0, -Math.PI / 2, 0, 0), "mustard", 3, "");
    P.add(new THREE.ShapeGeometry(sh), M4(0.1, 0.005, 0.05, -Math.PI / 2, 0, 0, 0.62, 0.62, 1), "butter", 3, "");
    for (const [x, z] of [[-0.3, -0.25], [0.35, 0.3]]) P.add(new THREE.CircleGeometry(0.16, 10), M4(x, 0.007, z, -Math.PI / 2, 0, 0, 1, 0.5, 1), "white", 3, "");
    const puddle = new THREE.Mesh(P.build(), inkMaterial(shared, { offset: 3, side: THREE.DoubleSide })); puddle.renderOrder = 1; root.add(puddle); puddle.visible = false;
    const q = at(SY.u, SY.lat), mouth = { x: sq.x + Math.cos(syDir) * 2.9, y: 4.3, z: sq.z - Math.sin(syDir) * 2.9 };
    movers.syrup = { strand, puddle, at: { x: q.x, z: q.z, y: groundAt(SY.u, SY.lat) + 0.03 }, mouth };
  }
  // The sweets on the doilies: a wrapped sweet, twisted at both ends, turning slowly; one instanced mesh for all.
  {
    const S = new Geo();
    S.add(new THREE.CylinderGeometry(0.26, 0.26, 0.56, 10), M4(0, 0, 0, 0, 0, Math.PI / 2), (c) => (Math.abs(c.x) < 0.1 ? "cream" : "red"), 1, "c");
    for (const s of [-1, 1]) S.add(new THREE.ConeGeometry(0.24, 0.32, 6), M4(s * 0.42, 0, 0, 0, 0, s * Math.PI / 2), "mustard", 0, "c");
    const sg = S.build(), n = T_.BOXES.reduce((a, b) => a + b.lats.length, 0);
    // A sweet you drive through can be right at the lens: like a rival car, it opens into dots there instead of filling the picture.
    const near = { value: 1 }, inst = new THREE.InstancedMesh(sg, inkMaterial(shared, { ghost: near, fadeOut: true }), n), shell = new THREE.InstancedMesh(sg, inkMaterial(shared, { shell: true, ghost: near }), n);
    inst.frustumCulled = shell.frustumCulled = false;
    root.add(inst, shell);
    movers.sweets = { inst, shell, at: [] };
    for (const b of T_.BOXES) for (const l of b.lats) { const q = at(b.u, l); movers.sweets.at.push({ x: q.x, z: q.z, y: groundAt(b.u, l) + 0.55, yaw: yaw(q) }); }
  }
  // Butter pats dropped on the track: a yellow slab in a wide shiny yellow slick (the rules' patch); a small pool.
  {
    const B = new Geo();
    const sh = new THREE.Shape(); for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, w = T_.BUTTER_R * (1 + 0.08 * Math.sin(a * 4)); i ? sh.lineTo(Math.cos(a) * w, Math.sin(a) * w) : sh.moveTo(Math.cos(a) * w, Math.sin(a) * w); }
    B.add(new THREE.ShapeGeometry(sh), M4(0, 0.02, 0, -Math.PI / 2, 0, 0, 1.06, 1.06, 1), "navy", 3, ""); B.add(new THREE.ShapeGeometry(sh), M4(0, 0.024, 0, -Math.PI / 2, 0, 0), "butter", 3, "");
    for (const [x, z] of [[0.45, 0.2], [-0.35, -0.4], [-0.2, 0.5]]) B.add(new THREE.CircleGeometry(0.12, 8), M4(x, 0.028, z, -Math.PI / 2, 0, 0, 1, 0.5, 1), "white", 3, "");
    B.add(roundBox(0.95, 0.32, 0.75, 0.3, 10, 6), M4(0, 0.18, 0), "butter", 1, "n"); B.add(new THREE.BoxGeometry(0.4, 0.02, 0.08), M4(-0.1, 0.35, -0.12), "cream", 3, "");
    const bg = B.build(), N = 8;
    const inst = new THREE.InstancedMesh(bg, inkMaterial(shared, { offset: 1 }), N);
    inst.frustumCulled = false; inst.count = 0;
    root.add(inst); movers.butter = { inst, N };
  }
  // Pepper shots in flight: a big peppercorn each (its grey trail is made of puffs).
  {
    const P = new Geo(); P.add(new THREE.IcosahedronGeometry(0.3, 1), M4(), "pepper", 1, "n"); P.add(new THREE.SphereGeometry(0.1, 6, 4), M4(-0.12, 0.14, 0.12), "grey", 3, "");
    const N = 6, inst = new THREE.InstancedMesh(P.build(), inkMaterial(shared, {}), N), shell = new THREE.InstancedMesh(P.build(), inkMaterial(shared, { shell: true }), N);
    inst.frustumCulled = shell.frustumCulled = false; inst.count = shell.count = 0; root.add(inst, shell); movers.shots = { inst, shell, N };
  }
  // Background life: a ginger cat's paw that reaches up over the open edge now and then, and a fly round the fruit.
  {
    const P = new Geo();
    P.add(new THREE.CylinderGeometry(0.95, 1.1, 5, 10), M4(0, -2.4, 0), (c) => (Math.floor((c.y + 6) * 1.2) % 2 ? "orange" : "toast"), 1, "n");
    P.add(new THREE.SphereGeometry(1.15, 12, 8), M4(0, 0.1, 0.35, 0, 0, 0, 1, 0.7, 1.3), "orange", 1, "n");
    for (const o of [-0.62, -0.2, 0.22, 0.64]) P.add(new THREE.SphereGeometry(0.3, 6, 4), M4(o, 0.25, 1.35, 0, 0, 0, 1, 0.8, 1.1), "cream", 1, "n");
    const paw = mover(P);
    const e = at(217, -(H + T_.EDGE.out + 1.3)); paw.position.set(e.x, -6, e.z); paw.rotation.order = "YXZ"; paw.rotation.y = yaw(e);
    movers.paw = { g: paw, x: e.x, z: e.z };
    const F = new Geo(); F.add(new THREE.SphereGeometry(0.22, 6, 4), M4(), "navy", 0, "n"); for (const s of [-1, 1]) F.add(new THREE.CircleGeometry(0.26, 8), M4(0, 0.15, s * 0.22, -Math.PI / 2 + s * 0.4, 0, 0, 1, 1, 0.6), "white", 3, "");
    const fly = new THREE.Mesh(F.build(), propMat); root.add(fly); movers.fly = { m: fly, x: bx, z: bz };
  }
  // Shadows printed on the cloth.
  {
    const p = [], uv = [], kind = [];
    const blob = (x, z, rx, rz, k = 0, rot = 0.5) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [a, b] of [[-1, -1], [-1, 1], [1, 1], [-1, -1], [1, 1], [1, -1]]) { p.push(x + a * rx * c - b * rz * s, 0.006, z + a * rx * s + b * rz * c); uv.push(a, b); kind.push(k); }
    };
    blob(bx + 1.6, bz + 1.8, BW.foot + 2.0, BW.foot + 1.0);
    for (const sh of SHAKERS) blob(sh.x + 0.6, sh.z + 0.6, sh.r * 1.5, sh.r * 1.05);
    { const dm = T_.DOMES[0], q = at(dm.u, dm.lat); blob(q.x + 0.5, q.z + 0.6, dm.rim * 1.05, dm.rim * 0.8); }
    blob(teapotAt.x + 1.2, teapotAt.z + 1.2, 6.0, 4.4); blob(sugarAt.x + 0.8, sugarAt.z + 0.8, 4.0, 2.8);
    blob(kq.x + 0.8, kq.z + 0.9, 4.2, 3.4); blob(toq.x + 0.8, toq.z + 0.9, 3.8, 2.8); blob(sq.x + 0.6, sq.z + 0.7, 2.4, 2.0);
    { const q = at(bank.u0 - 9, -(H + 6.5)); blob(q.x + 0.8, q.z + 0.8, 3.2, 2.2); }
    { const q = at(TN.u, 0); blob(q.x + 2.4, q.z + 3.0, 6.5, 4.8, 0, 0.1); }
    blob(SUSAN_AT.x + 0.3, SUSAN_AT.z + 0.4, T_.SUSAN.r * 1.05, T_.SUSAN.r * 0.95);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
    const mesh = new THREE.Mesh(g, shadowMaterial(shared));
    mesh.renderOrder = 1; mesh.frustumCulled = false;
    root.add(mesh);
  }
  // The room beyond: a painted wall on four cards, and a plain floor far below the open edge.
  {
    const tex = wallTexture();
    const m = new THREE.ShaderMaterial({ vertexShader: WALL_VS, fragmentShader: WALL_FS, uniforms: { uTex: { value: tex } }, side: THREE.DoubleSide });
    const g = new THREE.PlaneGeometry(300, 120);
    for (const [x, z, ry] of [[130, 0, -Math.PI / 2], [-130, 0, Math.PI / 2], [0, -95, 0], [0, 95, Math.PI]]) { const w = new THREE.Mesh(g, m); w.position.set(x, 30, z); w.rotation.y = ry; w.renderOrder = -1; root.add(w); }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 220), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.37, 0.31) }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -TABLE.drop - 0.2; root.add(floor);
  }
  movers.shakerShell = shakerShell;
  return { root, dome: new THREE.Vector3(1e4, 1e4, 0.1), movers };
}
function shadowMaterial(shared, amt = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: SHADOW_VS, fragmentShader: SHADOW_FS, uniforms: { ...shared, uAmt: { value: amt } },
    transparent: true, blending: THREE.MultiplyBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
}
/** Under each car: its shadow, one flat mesh on the cloth. */
function buildGround(shared) {
  const p = [], uv = [], kind = [];
  for (const [a, b] of [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]]) { p.push(-0.68 + 1.4 * a, 0, -0.5 + b); uv.push(-1 + 2 * a, -1 + 2 * b); kind.push(0); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  const mesh = new THREE.Mesh(geo, shadowMaterial(shared));
  mesh.renderOrder = 2;
  return mesh;
}
/** The cereal box's front, printed: a red band with the name, a big bowl of flakes with a spoon, a starburst. */
function cerealTexture(reuse) {
  const W = 512, Hh = 552, c = reuse || canvasOf(W, Hh), x = c.getContext("2d");
  x.clearRect(0, 0, W, Hh);
  x.fillStyle = "#f4ab16"; x.fillRect(0, 0, W, Hh);
  x.fillStyle = "#d9301f"; x.fillRect(0, 0, W, 132);
  x.fillStyle = "#242a3e"; x.fillRect(0, 128, W, 8);
  x.fillStyle = "#fbe6bd"; x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `76px "Bowlby One", "Arial Black", Impact, sans-serif`; x.lineWidth = 10; x.strokeStyle = "#242a3e"; x.strokeText("TIN FLAKES", W / 2, 70); x.fillText("TIN FLAKES", W / 2, 70);
  x.lineJoin = "round";
  x.fillStyle = "#fadba3"; x.beginPath(); x.arc(W / 2, 340, 172, 0, Math.PI * 2); x.fill(); x.lineWidth = 8; x.strokeStyle = "#242a3e"; x.stroke();
  for (let i = 0; i < 26; i++) { const a = hash(61, i) * Math.PI, r = 30 + 110 * hash(62, i), px = W / 2 + Math.cos(a) * r * (hash(63, i) < 0.5 ? -1 : 1), py = 300 - 30 * hash(64, i); x.fillStyle = i % 3 ? "#e2a35a" : "#d5801a"; x.beginPath(); x.ellipse(px, py, 26, 16, a, 0, Math.PI * 2); x.fill(); x.lineWidth = 4; x.stroke(); }
  x.fillStyle = "#2a7b70"; x.beginPath(); x.moveTo(W / 2 - 190, 316); x.quadraticCurveTo(W / 2, 560, W / 2 + 190, 316); x.closePath(); x.fill(); x.lineWidth = 8; x.stroke();
  x.fillStyle = "#fdeccb"; for (let i = 0; i < 5; i++) { x.beginPath(); x.ellipse(W / 2 - 120 + i * 60, 380, 14, 30, 0.4 * (i - 2), 0, Math.PI * 2); x.fill(); }
  x.save(); x.translate(W / 2 + 120, 250); x.rotate(-0.7);
  x.fillStyle = "#c4c6c4"; x.beginPath(); x.ellipse(0, -40, 34, 50, 0, 0, Math.PI * 2); x.fill(); x.lineWidth = 7; x.stroke(); x.fillRect(-11, 0, 22, 170); x.strokeRect(-11, 0, 22, 170);
  x.restore();
  x.save(); x.translate(80, 216); x.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 46 : 64; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fillStyle = "#d9301f"; x.fill(); x.lineWidth = 5; x.stroke();
  x.fillStyle = "#fbe6bd"; x.font = `22px "Bowlby One", "Arial Black", Impact, sans-serif`; x.fillText("NEW", 0, 2); x.restore();
  if (reuse) return c;
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export { TABLE, buildTable, buildGround, shadowMaterial };
