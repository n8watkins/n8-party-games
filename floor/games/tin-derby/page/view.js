// Tin Derby: the moving picture. Everything here is for show (bounce, drift lean, dust, sparks, riders, cameras);
// it reads the race and never changes it. One race state feeds every picture: the phone's chase view, each
// pane of the television's split view, and the television's whole-table view.
// Round five's reviewed view.js, with the README's renames (a car's drift is drOn, drDir, drT, drLvl, not c.dr.*),
// `me` (the car whose warning rings grow with distance: the phone's own, not always car 0), and these imports.
import { THREE, TUNE, T, DT, SHAKERS, TAG, eggAt, groundAt, locate, steamAt, susanThings, syrupAt, toasterAt, trackAt, wrapS } from "./env.js";
import { CSS, PAPER, PART_FS, PART_VS, buildCar, clampN, dressCar, handTexture, shapesTexture } from "./art.js";
import { TABLE, buildGround, buildTable } from "./table.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const REDUCED_MOTION = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
const LOC = {};
/** The ground's height under a point on the table (the rules' own), searching near u. */
const groundXZ = (x, z, u, w) => { locate(x, z, u, LOC); return groundAt(LOC.u, LOC.lat, w); };
const DUMMY = new THREE.Object3D();
/** The whole-table picture's angle above the table, in degrees (TvRig). */
const TV_ELEVATION = 62;

class World {
  constructor(canvas, clothUrl, looks) {
    THREE.ColorManagement.enabled = false;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2.5, alpha: false, powerPreference: "high-performance" }));
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.setClearColor(new THREE.Color(PAPER[0], PAPER[1], PAPER[2]), 1);
    r.autoClear = false;
    this.scene = new THREE.Scene();
    this.shared = {
      uLight: { value: V3(-0.4, 0.8, 0.4).normalize() }, uPaper: { value: V3(...PAPER) }, uFade: { value: V3(TUNE.FADE_NEAR, TUNE.FADE_FAR, TUNE.FADE_MAX) },
      uDot: { value: 5 }, uCut: { value: new THREE.Vector4(0, 0, 100, 0) }, uDome: { value: V3(0, 0, 1) },
    };
    const tex = (this.clothTex = new THREE.Texture());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    const img = new Image();
    img.onload = () => { tex.image = img; tex.needsUpdate = true; this.ready = true; };
    img.src = clothUrl;
    const table = buildTable(this.shared, tex, { scan: !!(looks.scan) });
    this.drawn = table.movers.scan;
    this.scene.add(table.root);
    this.movers = table.movers;
    this.shared.uDome.value.copy(table.dome);
    this.cars = looks.map((look) => {
      const m = buildCar(this.shared, look);
      const ground = buildGround(this.shared);
      this.scene.add(m.group, ground);
      return {
        ...m, ground, look: { ...look }, roll: 0, rollV: 0, pitch: 0, pitchV: 0, hop: 0, hopV: 0, keyA: 0, keyV: 0, dustT: 0, sparkT: 0, slip: 0,
        pos: V3(0, 0, 0), fwd: V3(1, 0, 0), heading: 0, spin: 0, rHop: 0, rHopV: 0, rSq: 1, rSqV: 0, cheer: 0, lean: 0, u: 0,
      };
    });
    // The Hand of the House.
    this.hand = new THREE.Sprite(new THREE.SpriteMaterial({ map: handTexture(), alphaTest: 0.5, depthWrite: true }));
    this.hand.center.set(0.5, 0.02); this.hand.scale.set(1.5, 2.25, 1); this.hand.visible = false;
    this.scene.add(this.hand);
    // Cut-out shapes: dust, stars, sparks.
    const N = (this.maxParts = 140);
    const pg = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    pg.index = base.index; pg.setAttribute("position", base.attributes.position); pg.setAttribute("uv", base.attributes.uv);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); this.aQ = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.aP.setUsage(THREE.DynamicDrawUsage); this.aQ.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute("aP", this.aP); pg.setAttribute("aQ", this.aQ);
    this.partMesh = new THREE.Mesh(pg, new THREE.ShaderMaterial({ vertexShader: PART_VS, fragmentShader: PART_FS, uniforms: { uTex: { value: shapesTexture() } }, side: THREE.DoubleSide }));
    this.partMesh.frustumCulled = false; this.partMesh.renderOrder = 5;
    this.scene.add(this.partMesh);
    this.parts = []; this.pool = [];
    this.time = 0; this.scale = 1; this.cssW = 1; this.cssH = 1;
    this.tmp = V3(0, 0, 0); this.tp = {};
  }
  /** A car's character or colour changed (the picker). */
  setLook(i, look) { const v = this.cars[i]; dressCar(v, look); v.look = { ...look }; }
  resize(w, h, scale, cap = TUNE.DPR_CAP) {
    this.cssW = w; this.cssH = h; this.scale = scale;
    const pr = Math.min(window.devicePixelRatio || 1, cap) * scale;
    this.pr = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.shared.uDot.value = Math.max(3, 4.4 * pr);
  }
  puff(x, y, z, o = {}) {
    if (this.parts.length >= this.maxParts) this.pool.push(this.parts.shift());
    const p = this.pool.pop() || {};
    p.x = x; p.y = y; p.z = z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.age = 0; p.life = o.life || 0.6; p.size = o.size || 0.4;
    p.shape = o.shape || 0; p.rot = o.rot || 0; p.vr = o.vr || 0; p.flip = Math.random() < 0.5 ? 1 : 0; p.g = o.g || 0; p.tint = o.tint || 0;
    this.parts.push(p);
  }
  /** Dust from the rear wheels, as the poster draws it: big cream clouds either side of the tail. */
  dust(v, n, size = 0.6) {
    size *= 0.62; // round four: toy scale, so a car's dust is a car's size, not a cloud the size of the camera
    for (let k = 0; k < n; k++) {
      const s = k % 2 ? 1 : -1, j = Math.random();
      const bx = v.pos.x - v.fwd.x * 0.62, bz = v.pos.z - v.fwd.z * 0.62, sx = -v.fwd.z * 0.42 * s, sz = v.fwd.x * 0.42 * s;
      this.puff(bx + sx, v.pos.y + size * 0.38, bz + sz, { vx: -v.fwd.x * (0.4 + j * 0.5) + sx * 0.9, vy: 0.12 + j * 0.2, vz: -v.fwd.z * (0.4 + j * 0.5) + sz * 0.9, size: size * (0.85 + 0.3 * j), life: 0.45 + 0.3 * j });
    }
  }
  /** Sparks from the outside rear wheel while drifting: little brass bursts, bigger as the charge grows. */
  sparks(v, dir, lvl) {
    const s = -dir, bx = v.pos.x - v.fwd.x * 0.5 - v.fwd.z * 0.4 * s, bz = v.pos.z - v.fwd.z * 0.5 + v.fwd.x * 0.4 * s;
    this.puff(bx, v.pos.y + 0.12, bz, { shape: lvl >= 2 ? 2 : 3, size: lvl >= 2 ? 0.42 : lvl >= 1 ? 0.32 : 0.22, life: 0.18, rot: Math.random() * 6, vy: 0.6, vx: -v.fwd.x, vz: -v.fwd.z });
  }
  /** What the race said happened, turned into things to see. */
  event(e) {
    const v = this.cars[e.car];
    if (!v) return;
    if (e.k === "pad") { v.keyV += 60; v.rHopV += 1.6; this.puff(v.pos.x - v.fwd.x * 0.6, v.pos.y + 0.55, v.pos.z - v.fwd.z * 0.6, { shape: 2, size: 0.9, life: 0.32, vr: 4 }); v.pitchV += 2.2; this.dust(v, 2, 0.8); }
    else if (e.k === "mini") { v.keyV += e.lvl === 2 ? 70 : 40; v.rHopV += 1.4; this.puff(v.pos.x - v.fwd.x * 0.6, v.pos.y + 0.45, v.pos.z - v.fwd.z * 0.6, { shape: 2, size: e.lvl === 2 ? 0.85 : 0.55, life: 0.28, vr: 4 }); v.pitchV += 1.6; }
    else if (e.k === "drift") { v.hopV += 1.8; v.rHopV += 1.2; }
    else if (e.k === "charge") { v.rHopV += 0.8; }
    else if (e.k === "bump") {
      const b = this.cars[e.into];
      this.puff((v.pos.x + b.pos.x) / 2, v.pos.y + 0.45, (v.pos.z + b.pos.z) / 2, { shape: 1, size: e.hard > 2 ? 0.8 : 0.5, life: 0.24, rot: Math.random() });
      v.rollV += 3 * (Math.random() < 0.5 ? -1 : 1); b.rollV += 2.6 * (Math.random() < 0.5 ? -1 : 1); v.pitchV -= 1.2; b.pitchV += 1.0; b.rHopV += 1.6;
    } else if (e.k === "wall" || e.k === "knock") { v.rollV += 4 * (Math.random() < 0.5 ? -1 : 1); this.puff(v.pos.x + v.fwd.x * 0.4, v.pos.y + 0.3, v.pos.z + v.fwd.z * 0.4, { shape: 3, size: 0.45, life: 0.2 }); }
    else if (e.k === "clunk") { v.pitchV += 2; v.hopV += 0.8; }
    else if (e.k === "land") {
      // A little squash and a puff.
      v.hopV -= Math.min(2.6, e.hard * 0.45); v.pitchV -= 2.0; v.rHopV -= Math.min(3, e.hard * 0.5); v.rSqV -= Math.min(4.5, 1 + e.hard * 0.6);
      this.dust(v, 2, Math.min(0.9, 0.45 + e.hard * 0.08));
    } else if (e.k === "leap") { v.rHopV += 1.5; }
    else if (e.k === "fall") { v.rHopV += 3; }
    else if (e.k === "back") { this.dust(v, 2, 0.5); v.hopV += 1.2; }
    else if (e.k === "finish") { v.cheer = 0.001; }
    else if (e.k === "hit") {
      // What hit you is always shown: butter spins you with yellow stars, pepper wraps you in a grey cloud, a knock is a star.
      const x = v.pos.x, y = v.pos.y, z = v.pos.z;
      if (e.what === "pepper") { for (let k = 0; k < 10; k++) this.puff(x + (Math.random() - 0.5) * 1.4, y + 0.4 + Math.random() * 0.8, z + (Math.random() - 0.5) * 1.4, { size: 0.8 + Math.random() * 0.5, life: 0.9 + Math.random() * 0.4, vy: 0.5, tint: 1 }); this.puff(x, y + 1.0, z, { shape: 1, size: 1.1, life: 0.35, rot: Math.random() }); v.rHopV += 2.4; v.rollV += 5; }
      else if (e.what === "pepper cloud") for (let k = 0; k < 5; k++) this.puff(x + (Math.random() - 0.5) * 1.2, y + 0.4 + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.2, { size: 0.6 + Math.random() * 0.4, life: 0.7, vy: 0.4, tint: 1 });
      else if (e.what === "butter") { for (let k = 0; k < 4; k++) this.puff(x, y + 0.6, z, { shape: 1, size: 0.4, life: 0.5, vx: Math.cos(k * 1.6) * 2, vz: Math.sin(k * 1.6) * 2, vy: 1.4, g: 4, vr: 6 }); v.rHopV += 2; }
      else { this.puff(x + v.fwd.x * 0.5, y + 0.45, z + v.fwd.z * 0.5, { shape: 1, size: 0.7, life: 0.28, rot: Math.random() }); v.rollV += 4; v.rHopV += 1.8; }
    } else if (e.k === "spill") {
      // A splash of what you drove into: oats fly, salt sprays, syrup clings.
      const n = e.does === "spin" ? 6 : 3;
      for (let k = 0; k < n; k++) this.puff(v.pos.x, v.pos.y + 0.3, v.pos.z, { shape: e.does === "spin" ? 0 : 3, size: e.does === "spin" ? 0.35 : 0.25, life: 0.45, vx: Math.cos(k * 1.9) * 2.4, vz: Math.sin(k * 1.9) * 2.4, vy: 1.8, g: 6, vr: 5 });
    } else if (e.k === "trait") {
      if (e.trait === "pawn") this.puff(v.pos.x, v.pos.y + 1.1, v.pos.z, { shape: 2, size: 0.5, life: 0.3, vr: 4 });
      else if (e.trait === "slime") for (let k = 0; k < 3; k++) this.puff(v.pos.x + Math.cos(k * 2) * 0.5, v.pos.y + 0.1, v.pos.z + Math.sin(k * 2) * 0.5, { shape: 3, size: 0.3, life: 0.35 });
    } else if (e.k === "use") {
      if (e.item === "overwind") { v.keyV += 120; this.puff(v.pos.x - v.fwd.x * 0.6, v.pos.y + 0.5, v.pos.z - v.fwd.z * 0.6, { shape: 2, size: 1.2, life: 0.4, vr: 5 }); }
      else if (e.item === "pepper") { for (let k = 0; k < 3; k++) this.puff(v.pos.x + v.fwd.x * 0.8, v.pos.y + 0.5, v.pos.z + v.fwd.z * 0.8, { size: 0.5, life: 0.35, vx: v.fwd.x * 4, vz: v.fwd.z * 4, tint: 1 }); v.pitchV -= 2; }
      else if (e.item === "butter") { v.rHopV += 1; }
    } else if (e.k === "item") {
      const s = this.movers.sweets && this.movers.sweets.at[this.sweetIndex(e.box, e.sweet)];
      if (s) for (let k = 0; k < 6; k++) this.puff(s.x, s.y, s.z, { shape: k % 2 ? 1 : 3, size: 0.35, life: 0.45, vx: Math.cos(k) * 2.2, vz: Math.sin(k) * 2.2, vy: 2, g: 6, vr: 5 });
    } else if (e.k === "slick") this.dust(v, 2, 0.5);
  }
  sweetIndex(box, sweet) { let n = 0; for (let k = 0; k < box; k++) n += TUNE.BOXES[k].lats.length; return n + sweet; }
  /** The live kitchen, drawn from the race's own clock: the lazy Susan, the kettle, the toaster, the egg, the syrup,
   *  the cherries, the warning rings, the sweets, the butter, the pepper shots, and the background life. */
  syncKitchen(state, dt) {
    const M = this.movers, T = TUNE, tau = state.n * DT, time = this.time;
    const rings = this.ringList || (this.ringList = []); rings.length = 0;
    // Round five: 1.4x, so a ring reads from 20 lengths. Reviewer fix (round five): still only 23 to 55 px across from
    // 13 to 24 lengths away, so a ring far ahead of your car is drawn up to 1.6 times bigger, shrinking to its true size
    // as you come within 10 lengths.
    const me = this.cars[this.me || 0].pos;
    const ring = (x, y, z, size) => { if (rings.length < M.rings.N * 4) { const far = clampN((Math.hypot(x - me.x, z - me.z) - 10) / 14, 0, 1); rings.push(x, y, z, size * 1.4 * (1 + 0.6 * far)); } };
    // The lazy Susan turns (the rules' own angle, so its jars are where the rules have them).
    M.susan.rotation.y = -T.SUSAN.spin * tau;
    // The egg: in its cup; rocking (the warning, with rings across its path); rolling across; stopped at the far rail.
    {
      const eg = eggAt(tau, this.eggQ || (this.eggQ = {})), E = T.EGG, g = M.egg.g, sh = M.egg.sh;
      const p = trackAt(E.u, eg.lat, this.tp), gy = groundAt(E.u, eg.lat, state);
      g.visible = true; g.scale.setScalar(1);
      if (eg.stage === "cup" || eg.stage === "warn") {
        g.position.set(p.x, 0.75 + E.r * 0.9 + (eg.stage === "warn" ? Math.abs(Math.sin(time * 9)) * 0.12 : 0), p.z);
        g.rotation.set(eg.stage === "warn" ? Math.sin(time * 11) * 0.35 * (0.4 + eg.k) : 0, 0, eg.stage === "warn" ? Math.cos(time * 9) * 0.2 : 0);
        sh.visible = false;
        if (eg.stage === "warn") for (const l of [2.4, 0, -2.4]) { const q = trackAt(E.u, l, this.tp2 || (this.tp2 = {})); ring(q.x, groundAt(E.u, l, state), q.z, 0.95 + 0.25 * Math.abs(Math.sin(time * 6))); }
      } else {
        const f = eg.stage === "stop" ? clampN((eg.k - 0.6) / 0.4, 0, 1) : 0;
        g.position.set(p.x, gy + E.r * 1.0, p.z); g.scale.setScalar(Math.max(0.01, 1 - f));
        g.rotation.y = -(trackAt(E.u, 0, this.tp2 || (this.tp2 = {})).th); g.rotation.x = eg.stage === "roll" ? -(E.from - eg.lat) / E.r : g.rotation.x;
        sh.visible = f < 1; sh.position.set(p.x + 0.05, gy + 0.012, p.z + 0.06); sh.scale.set(1.0 * (1 - f), 1, 1.1 * (1 - f));
      }
    }
    // The syrup: the bottle drips (a strand to the road) and the sticky puddle grows, stays, and dries.
    {
      const sy = syrupAt(tau, this.syQ || (this.syQ = {})), S = M.syrup, Y = T.SYRUP;
      const strand = sy.stage === "warn" || sy.stage === "grow";
      S.strand.visible = strand;
      if (strand) { const top = S.mouth, k = sy.stage === "warn" ? clampN(sy.c / Y.warn, 0.05, 1) : 1; S.strand.position.set(S.at.x, top.y, S.at.z); S.strand.scale.set(1, (top.y - S.at.y) * k, 1); }
      S.puddle.visible = sy.k > 0.01; S.puddle.position.set(S.at.x, S.at.y, S.at.z); S.puddle.scale.set(Y.r * sy.k, 1, Y.r * sy.k);
      if (sy.stage === "warn") ring(S.at.x, S.at.y, S.at.z, Y.r * (0.9 + 0.15 * Math.abs(Math.sin(time * 6))));
    }
    // The kettle: the lid rattles (the warning), then steam streams across the track.
    const kt = steamAt(tau), sp = M.spout, KT = T.KETTLE;
    M.lid.position.y = 4.55 + (kt === 1 ? Math.abs(Math.sin(time * 38)) * 0.22 : kt === 2 ? 0.35 : 0);
    M.lid.rotation.z = kt === 1 ? Math.sin(time * 31) * 0.08 : 0; M.lid.rotation.x = kt === 1 ? Math.cos(time * 27) * 0.06 : 0;
    this.steamT = (this.steamT || 0) - dt;
    if (kt && this.steamT <= 0) {
      this.steamT = kt === 2 ? 0.05 : 0.22;
      const k = kt === 2 ? 1 : 0.35, speed = kt === 2 ? 7.5 : 2.5, mid = trackAt((KT.u0 + KT.u1) / 2, 0, this.tp);
      const ax = mid.x - sp.x, az = mid.z - sp.z, al = Math.hypot(ax, az) || 1;
      this.puff(sp.x, sp.y, sp.z, { size: 0.8 + 0.9 * k + Math.random() * 0.4, life: kt === 2 ? 1.6 : 0.6, vx: (ax / al) * speed + (Math.random() - 0.5), vz: (az / al) * speed + (Math.random() - 0.5), vy: kt === 2 ? -1.6 : 0.8, rot: Math.random() * 6, vr: 1 });
    }
    // The toaster: the lever goes down (the warning), the toast pops and flies over, lies across the track, and is gone.
    const ts = toasterAt(tau, this.toa || (this.toa = {})), TS = T.TOASTER;
    M.lever.position.y = ts.stage === "warn" ? M.leverY[1] : M.leverY[0];
    M.slices.visible = ts.stage === "warn" || ts.stage === "idle" || (ts.stage === "fly" && ts.fly < 0.12);
    M.slices.position.y = ts.stage === "warn" ? 3.2 + Math.sin(time * 30) * 0.03 : ts.stage === "fly" ? 5.4 : 3.0;
    const tst = M.toast, fr = M.toastFrom, ld = M.toastLand;
    if (ts.stage === "fly" && ts.fly >= 0.12) {
      const f = (ts.fly - 0.12) / 0.88, e = ease(f);
      tst.visible = true; tst.position.set(lerp(fr.x, ld.x, e), lerp(fr.y, 0.02, f) + Math.sin(Math.PI * f) * 5, lerp(fr.z, ld.z, e)); tst.rotation.set(0, 0, (1 - f) * Math.PI * 2); tst.scale.set(1, 1, 1);
    } else if (ts.stage === "lie" || ts.stage === "gone") { tst.visible = true; tst.position.set(ld.x, 0.02, ld.z); tst.rotation.set(0, 0, 0); const k = Math.max(0.02, ts.k); tst.scale.set(ts.stage === "gone" ? k : 1, k, ts.stage === "gone" ? k : 1); }
    else tst.visible = false;
    // Reviewer fix (round four): the toast's landing read as a small brown wedge. While the lever is down and the toast
    // flies, a big ring marks the strip it will land on.
    if (ts.stage === "warn" || ts.stage === "fly") { const pulse = 0.12 * Math.abs(Math.sin(time * 7)); for (const l of [TS.lat0 + 0.9, TS.lat1 - 0.9]) { const q = trackAt(TS.land, l, this.tp2 || (this.tp2 = {})); ring(q.x, groundAt(TS.land, l, state), q.z, 1.25 + pulse); } }
    // The cherries: one wobbles on the rim, a bold ring and its shadow growing on the road below; it drops, and rolls.
    const BW = T.BOWL, bk = TAG.bank;
    for (const slot of M.cherries) slot.live = false;
    for (const ch of state.cherries) {
      let slot = M.cherries.find((s) => s.id === ch.id) || M.cherries.find((s) => !s.live && !state.cherries.some((c) => c.id === s.id));
      if (!slot) continue;
      slot.id = ch.id; slot.live = true;
      const since = tau - ch.at, gy = groundAt(ch.u, ch.lat, state);
      const g = slot.g, sh = slot.sh;
      g.visible = true;
      if (ch.stage === "warn" || ch.stage === "fall") {
        const p = trackAt(ch.u, ch.lat, this.tp), top = BW.rimY - 0.6;
        const y = ch.stage === "warn" ? top : lerp(top, gy + T.CHERRY.r, ease(Math.min(1, (since) / T.CHERRY.fall)));
        g.position.set(p.x, y, p.z); g.rotation.set(Math.sin(time * 18) * 0.35 * (ch.stage === "warn" ? 1 : 0), 0, Math.cos(time * 14) * 0.25 * (ch.stage === "warn" ? 1 : 0));
        sh.visible = true; sh.position.set(p.x, gy + 0.02, p.z); const grow = clampN(1 + since / T.CHERRY.warn, 0.2, 1); sh.scale.set(0.9 * grow, 1, 1.1 * grow);
        sh.rotation.order = "YZX"; sh.rotation.set(0, 0, 0);
        ring(p.x, gy, p.z, 0.75 + 0.35 * grow + 0.1 * Math.abs(Math.sin(time * 8)));
      } else {
        g.position.set(ch.x, gy + T.CHERRY.r, ch.z); sh.visible = false;
        slot.roll = (slot.roll || 0) + dt * 6; g.rotation.set(slot.roll, 0, 0);
      }
    }
    for (const slot of M.cherries) if (!slot.live) { slot.g.visible = false; slot.sh.visible = false; slot.id = -1; }
    // The sweets: on their doilies unless taken; each bobs and turns.
    const SW = M.sweets; let n = 0;
    for (let k = 0; k < T.BOXES.length; k++) for (let j = 0; j < T.BOXES[k].lats.length; j++, n++) {
      const s = SW.at[n], on = state.boxT[k][j] <= tau, back = on ? clampN((tau - state.boxT[k][j]) / 0.3, 0, 1) : 0;
      DUMMY.position.set(s.x, s.y + Math.sin(time * 3 + n) * 0.08, s.z); DUMMY.rotation.set(0.3, s.yaw + time * 1.6 + n, 0); DUMMY.scale.setScalar(on ? (state.boxT[k][j] > 0 ? ease(back) : 1) * 1.25 + 1e-4 : 1e-4);
      DUMMY.updateMatrix(); SW.inst.setMatrixAt(n, DUMMY.matrix); SW.shell.setMatrixAt(n, DUMMY.matrix);
    }
    SW.inst.instanceMatrix.needsUpdate = true; SW.shell.instanceMatrix.needsUpdate = true;
    // Butter pats in their slicks where they lie; pepper shots as a big peppercorn with a grey trail along their flight.
    const B = M.butter, SH = M.shots; let nb = 0, ns = 0;
    for (const d of state.drops) {
      if (d.k === "butter" && nb < B.N) { const left = clampN(d.life / 1.0, 0, 1); DUMMY.position.set(d.x, d.y + 0.01, d.z); DUMMY.rotation.set(0, (d.id * 1.3) % 6.28, 0); DUMMY.scale.setScalar(0.25 + 0.75 * left); DUMMY.updateMatrix(); B.inst.setMatrixAt(nb, DUMMY.matrix); nb++; }
      else if (d.k === "shot" && ns < SH.N) {
        const p = trackAt(d.u, d.lat, this.tp);
        DUMMY.position.set(p.x, d.y, p.z); DUMMY.rotation.set(time * 9, time * 7, 0); DUMMY.scale.setScalar(1.3); DUMMY.updateMatrix(); SH.inst.setMatrixAt(ns, DUMMY.matrix); SH.shell.setMatrixAt(ns, DUMMY.matrix); ns++;
        if (Math.random() < dt * 45) this.puff(p.x - p.dx * 0.5, d.y, p.z - p.dz * 0.5, { size: 0.45 + Math.random() * 0.25, life: 0.45, tint: 1, rot: Math.random() * 6 });
      }
    }
    B.inst.count = nb; B.inst.instanceMatrix.needsUpdate = true;
    SH.inst.count = SH.shell.count = ns; SH.inst.instanceMatrix.needsUpdate = true; SH.shell.instanceMatrix.needsUpdate = true;
    // The warning rings this frame.
    { const W = M.rings; let n = 0; for (let k = 0; k < rings.length; k += 4) { DUMMY.position.set(rings[k], rings[k + 1] + 0.03, rings[k + 2]); DUMMY.rotation.set(0, time * 1.5, 0); DUMMY.scale.set(rings[k + 3], 1, rings[k + 3]); DUMMY.updateMatrix(); W.inst.setMatrixAt(n++, DUMMY.matrix); } W.inst.count = n; W.inst.instanceMatrix.needsUpdate = true; }
    // Background life: the cat's paw reaches up over the open edge every so often, pats the air, and goes.
    const pw = M.paw, cyc = (tau + 4) % 13;
    const up = cyc < 1.0 ? ease(cyc) : cyc < 3.4 ? 1 : cyc < 4.2 ? 1 - ease((cyc - 3.4) / 0.8) : 0;
    pw.g.visible = up > 0.01; pw.g.position.y = -6 + up * 6.4 + (cyc > 1 && cyc < 3.4 ? Math.abs(Math.sin(time * 5)) * 0.4 : 0);
    pw.g.rotation.x = up * 0.5 + (cyc > 1 && cyc < 3.4 ? Math.sin(time * 5) * 0.12 : 0);
    // The fly: a lazy loop round the fruit.
    const fa = time * 1.3;
    M.fly.m.position.set(M.fly.x + Math.cos(fa) * 6 + Math.sin(fa * 3.1), 10 + Math.sin(fa * 2.3) * 1.5, M.fly.z + Math.sin(fa) * 5); M.fly.m.rotation.y = -fa;
  }
  /** Poses every car from the race. */
  sync(state, dt) {
    this.time += dt;
    const T = TUNE, saw = state; // the ground under a car: the race's own (the cutting board's tilt, the toast)
    for (const c of state.cars) {
      const v = this.cars[c.i];
      const racing = state.t >= 0, running = racing && c.fallT <= 0;
      let x = c.x, z = c.z, y = c.y, h = c.h, hand = 0;
      // Off the table: it falls; then the Hand brings it down onto the loop near where it fell.
      if (c.fallT > 0 && c.fallT < T.HAND_T) {
        hand = 1 - c.fallT / T.HAND_T;
        const p = trackAt(c.fallU - 1, -0.8, this.tp);
        x = p.x; z = p.z; h = p.th; y = groundAt(c.fallU - 1, -0.8, saw) + 3.2 * (1 - ease(hand));
      }
      // Drift: the body swings into the turn (the nose points in further than the car is going).
      const driftDir = c.drOn ? c.drDir : 0;
      v.slip += ((driftDir * 0.38) - v.slip) * damp(8, dt);
      // Body springs.
      v.rollV += (-v.roll * 120 - v.rollV * 9) * dt; v.roll += v.rollV * dt;
      v.pitchV += (-v.pitch * 110 - v.pitchV * 10) * dt; v.pitch += v.pitchV * dt;
      v.hopV += (-v.hop * 160 - v.hopV * 11) * dt; v.hop += v.hopV * dt;
      const fx = Math.cos(h), fz = Math.sin(h), rx = -fz, rz = fx;
      // The ground under it: its slope along (pitch) and across (roll), from the rules' own heights.
      const g = hand ? y : groundXZ(x, z, c.u, saw);
      let gAlong = 0, gAcross = 0;
      if (!hand && c.fallT <= 0) {
        gAlong = (groundXZ(x + fx * 0.3, z + fz * 0.3, c.u, saw) - groundXZ(x - fx * 0.3, z - fz * 0.3, c.u, saw)) / 0.6;
        gAcross = (groundXZ(x + rx * 0.25, z + rz * 0.25, c.u, saw) - groundXZ(x - rx * 0.25, z - rz * 0.25, c.u, saw)) / 0.5;
      }
      const buzz = running ? Math.min(1, Math.abs(c.v) / 9) : 0;
      const airPitch = c.air && c.fallT <= 0 ? clampN(Math.atan2(c.vy, Math.max(1, Math.abs(c.v))) * 0.7, -0.4, 0.22) : Math.atan(gAlong); // round four: less nose-up in the air (from the low camera a big tilt read as flipping over)
      let pitch = airPitch + v.pitch * 0.08 + (c.boostT > 0 ? 0.1 * Math.min(1, c.boostT * 3) : 0);
      let roll = -Math.atan(gAcross) * (c.air ? 0.5 : 1) + v.roll * 0.08 + Math.sin(this.time * 61 + c.i) * 0.012 * buzz - driftDir * 0.08 + (c.wobT > 0 ? Math.sin(this.time * 30) * 0.08 : 0);
      let lift = Math.max(0, v.hop * 0.12) + Math.abs(Math.sin(this.time * 53 + c.i)) * 0.006 * buzz;
      if (c.fallT > 0 && !hand) { roll += (T.FALL_T + T.HAND_T - c.fallT) * 5; pitch += (T.FALL_T + T.HAND_T - c.fallT) * 2; }
      v.heading = h; v.u = c.u; v.mh = c.spinT > 0 ? c.mh : h; // the camera follows the slide, not a spin
      v.phase = c.phaseT > 0;
      v.fwd.set(fx, 0, fz);
      v.pos.set(x, y, z);
      v.group.position.set(x, y + lift, z);
      v.group.rotation.y = -(h + v.slip);
      v.pivot.rotation.set(roll, 0, pitch);
      // The hand.
      if (hand) { this.hand.visible = true; this.hand.position.set(x, y + 0.7, z); this.handFor = c.i; }
      else if (this.handFor === c.i) { this.hand.visible = false; this.handFor = -1; }
      // Wheels; and the key: it winds while a drift charges and spins free while a boost runs.
      v.spin -= (c.air ? 14 : c.v / 0.15) * dt;
      for (const w of v.wheels) w.rotation.z = v.spin;
      const winding = driftDir !== 0, unwinding = c.boostT > 0;
      if (winding) v.keyA += dt * (8 + 10 * (c.drLvl || 0));
      else if (unwinding) v.keyA -= dt * 30;
      else { const rest = Math.round(v.keyA / Math.PI) * Math.PI; v.keyV += (-(v.keyA - rest) * 260 - v.keyV * 16) * dt; v.keyA += v.keyV * dt; }
      v.key.rotation.x = v.keyA;
      // The rider: leans into the turn, bounces on bumps and landings, cheers or slumps at the finish.
      v.lean += (clampN(c.st * Math.abs(c.v) * 0.035 + driftDir * 0.12, -0.42, 0.42) - v.lean) * damp(6, dt);
      v.rHopV += (-v.rHop * 140 - v.rHopV * 9) * dt; v.rHop += v.rHopV * dt;
      v.rSqV += (-(v.rSq - 1) * 160 - v.rSqV * 10) * dt; v.rSq += v.rSqV * dt;
      let rx2 = v.lean - roll * 0.4, rz2 = -(c.boostT > 0 ? 0.2 : 0) - (c.air ? clampN(c.vy * 0.05, -0.2, 0.2) : 0), ry2 = 0, rh = v.rHop * 0.06, sq = v.rSq;
      if (c.fin) {
        v.cheer = Math.min(1, v.cheer + dt * 2);
        const k = v.cheer, place = c.place || 4;
        if (place <= 2) { const b = Math.abs(Math.sin(this.time * 7.5)); rh += k * b * 0.16; ry2 += k * Math.sin(this.time * 4) * 0.6; sq *= 1 + k * 0.12 * b; rz2 += k * 0.15; }
        else { rz2 -= k * 0.5; rh -= k * 0.06; sq *= 1 - k * 0.12; rx2 += k * Math.sin(this.time * 1.3) * 0.06; }
      } else v.cheer = 0;
      v.riderTilt.rotation.set(rx2, ry2, rz2);
      v.riderTilt.position.y = rh;
      v.riderTilt.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      // Its shadow on the cloth (or on the ramp under it).
      const gs = c.air ? groundXZ(x, z, c.u, saw) : g;
      const high = Math.max(0, y + lift - gs);
      v.ground.visible = c.fallT <= 0 || hand > 0;
      v.ground.position.set(x + 0.07, gs + 0.012, z + 0.09);
      v.ground.rotation.order = "YZX"; v.ground.rotation.set(-Math.atan(gAcross), -(h + v.slip), Math.atan(gAlong));
      const sc = 1 / (1 + high * 0.8); v.ground.scale.set(sc, 1, sc);
      // Dust from the wheels when it is moving quickly, bigger on a boost; sparks while drifting.
      const fast = c.v > 6.4 && !c.air && c.fallT <= 0;
      v.dustT -= dt * (fast ? (c.boostT > 0 ? 1.8 : 1) : 0);
      if (v.dustT < 0 && fast) { v.dustT = 0.24 + Math.random() * 0.12; this.dust(v, 2, Math.min(0.85, 0.3 + 0.045 * c.v)); }
      if (driftDir && !c.air) { v.sparkT -= dt; if (v.sparkT < 0) { v.sparkT = 0.07; this.sparks(v, driftDir, c.drLvl || 0); } }
    }
    // The cutting board tips with the race; the rest of the kitchen moves on its own clock.
    this.syncKitchen(state, dt);
    // Shapes in the air.
    const P = this.aP.array, Q = this.aQ.array;
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.age += dt; if (p.age >= p.life) { this.pool.push(p); this.parts.splice(i, 1); } }
    for (const p of this.parts) {
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.vr * dt;
      const t = p.age / p.life, s = p.size * (t < 0.18 ? 0.5 + 0.5 * ease(t / 0.18) : t > 0.7 ? 1 - ease((t - 0.7) / 0.3) : 1);
      P[n * 4] = p.x; P[n * 4 + 1] = p.y; P[n * 4 + 2] = p.z; P[n * 4 + 3] = s;
      Q[n * 4] = p.rot; Q[n * 4 + 1] = p.shape; Q[n * 4 + 2] = p.flip; Q[n * 4 + 3] = p.tint; n++;
    }
    this.partMesh.geometry.instanceCount = n; this.aP.needsUpdate = true; this.aQ.needsUpdate = true;
    this.shared.uFade.value.set(T.FADE_NEAR, T.FADE_FAR, T.FADE_MAX);
  }
  /** Draws each view into its part of the canvas. rect is in CSS pixels from the canvas's top left. */
  render(views) {
    const r = this.renderer;
    r.setScissorTest(false); r.setViewport(0, 0, this.cssW, this.cssH); r.clear();
    r.setScissorTest(views.length > 1);
    for (const view of views) {
      const { cam, rect } = view;
      r.setViewport(rect.x, this.cssH - rect.y - rect.h, rect.w, rect.h);
      r.setScissor(rect.x, this.cssH - rect.y - rect.h, rect.w, rect.h);
      if (views.length > 1) r.clear();
      cam.aspect = rect.w / rect.h; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      this.shared.uLight.value.set(-0.42, 0.78, 0.46).normalize().transformDirection(cam.matrixWorld);
      this.shared.uLight.value.y = Math.max(0.55, this.shared.uLight.value.y); this.shared.uLight.value.normalize();
      // Another car right at this camera is not drawn at all; a little further it breaks into paper dots.
      for (let i = 0; i < this.cars.length; i++) {
        const v = this.cars[i], own = i === view.focus;
        v.ghost.value = v.phase ? 3 : own || view.focus === undefined ? 0 : 1; // round five: the ghost racer fading through a knock
        v.group.visible = !(!own && view.focus !== undefined && v.pos.distanceTo(cam.position) < TUNE.CAM_HIDE);
      }
      // A shaker right beside this camera opens into holes; its outline would show through them as a dark slab, so
      // while the camera is that close the shakers' outline is not drawn.
      let nearShaker = false;
      for (const s of SHAKERS) if (Math.hypot(cam.position.x - s.x, cam.position.z - s.z) < s.r + 2.6) nearShaker = true;
      this.movers.shakerShell.visible = !nearShaker;
      r.render(this.scene, cam);
    }
    for (const v of this.cars) v.group.visible = true;
  }
  /**
   * The party room's big screen: every car (and its shadow) drawn `s` times its size, since at true size a car on the
   * whole-table picture is a speck from across a room. Only the picture changes; call it after sync, each frame.
   */
  sizeCars(s) {
    for (const v of this.cars) { v.group.scale.setScalar(s); v.ground.scale.x *= s; v.ground.scale.z *= s; }
  }
  /** Where a car is on the screen, for name tags. Returns null when it is behind the camera. Reuses `out`. */
  project(i, view, lift = 0.95, out = {}) {
    const p = this.tmp.copy(this.cars[i].pos); p.y += lift; p.project(view.cam);
    if (p.z > 1 || p.z < -1) return null;
    out.x = view.rect.x + (p.x * 0.5 + 0.5) * view.rect.w; out.y = view.rect.y + (-p.y * 0.5 + 0.5) * view.rect.h;
    return out;
  }
}

/** The chase camera behind one car. One is made for each picture that follows a car (the phone, each television pane). */
class ChaseRig {
  constructor(seatIndex) {
    this.i = seatIndex; this.cam = new THREE.PerspectiveCamera(TUNE.CAM_FOV, 2, 0.08, 240);
    this.head = null; this.y = 0; this.kick = 0; this.shake = 0; this.sx = 0; this.sy = 0; this.raise = 0; this.px = 0; this.pz = 0;
    this.a = {}; this.view = { cam: this.cam, focus: seatIndex, rect: { x: 0, y: 0, w: 1, h: 1 } };
  }
  bump(amount) { if (!REDUCED_MOTION) this.shake = Math.max(this.shake, amount); }
  reset() { this.head = null; this.raise = 0; }
  /** The camera point moved in along the line from the car until it is clear of every solid prop near it. */
  clear(state, carX, carZ, camX, camZ, camY) {
    let k = 1;
    const dx = camX - carX, dz = camZ - carZ, a = dx * dx + dz * dz || 1e-6;
    const test = (px, pz, r, top) => {
      if (camY > top + 0.25) return;
      const fx = carX - px, fz = carZ - pz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - r * r;
      if (cc < 0) return; // the car itself is there (it never is: the rules keep it out)
      const disc = b * b - 4 * a * cc;
      if (disc < 0) return;
      const s = (-b - Math.sqrt(disc)) / (2 * a);
      if (s >= 0 && s < k) k = s;
    };
    for (const sh of SHAKERS) test(sh.x, sh.z, sh.r + 0.3, sh.h);
    const tau = state.n * DT;
    for (const th of susanThings(tau, this.sth || (this.sth = []))) test(th.x, th.z, th.r + 0.3, th.h + 0.3);
    { const eg = eggAt(tau, this.egq || (this.egq = {})); if (eg.stage === "roll" || eg.stage === "stop") { const p = trackAt(TUNE.EGG.u, eg.lat, this.eqp || (this.eqp = {})); test(p.x, p.z, TUNE.EGG.r + 0.3, 2 * TUNE.EGG.r); } }
    for (const ch of state.cherries) if (ch.stage === "roll" || ch.stage === "rest") test(ch.x, ch.z, TUNE.CHERRY.r + 0.25, 1.2);
    const out = this.cp || (this.cp = {});
    k = k < 1 ? Math.max(0.18, k - 0.04) : 1;
    out.x = carX + dx * k; out.z = carZ + dz * k; out.y = camY;
    // In the cereal box's arch: inside its walls, under its roof.
    const TN = TUNE.TUNNEL, L = locate(out.x, out.z, state.cars[this.i].u, this.lc || (this.lc = {}));
    if (Math.abs(wrapS(L.u - TN.u)) < TN.len / 2 + 0.35) {
      const lim = TN.half - 0.25;
      if (Math.abs(L.lat) > lim) { const q = trackAt(L.u, Math.sign(L.lat) * lim, this.a2 || (this.a2 = {})); out.x = q.x; out.z = q.z; }
      out.y = Math.min(out.y, TN.arch - 0.3);
    }
    return out;
  }
  update(state, world, dt, aspect) {
    const T = TUNE, c = state.cars[this.i], v = world.cars[this.i], saw = state;
    const falling = c.fallT >= T.HAND_T, hand = c.fallT > 0 && !falling;
    // Where it looks: the way the car is going, turned part of the way toward where the track goes next, so a corner shows early.
    const ahead = trackAt(c.u + 4 + Math.max(0, c.v) * 0.25, 0, this.a), head0 = v.mh === undefined ? v.heading : v.mh;
    const into = clampN(angDiff(Math.atan2(ahead.z - v.pos.z, ahead.x - v.pos.x), head0), -0.7, 0.7);
    const want = head0 + (c.v < -0.5 ? 0 : into * T.CAM_TURN_LOOK) + (c.spinT > 0 ? 0 : v.slip * 0.4);
    if (this.head === null || hand) { this.head = want; this.px = v.pos.x; this.pz = v.pos.z; this.y = v.pos.y; }
    this.head += angDiff(want, this.head) * damp(1 / T.CAM_LAG, dt);
    if (!falling) { this.px = v.pos.x; this.pz = v.pos.z; }
    const carY = falling ? 0.06 : v.pos.y;
    this.y += (carY - this.y) * damp(c.air ? 3 : carY < this.y ? 12 : 7, dt); // quick down a step, so the car stays in frame
    this.kick *= Math.exp(-3.2 * dt); this.shake *= Math.exp(-7 * dt);
    const fx = Math.cos(this.head), fz = Math.sin(this.head), rx = -fz, rz = fx;
    const dist = T.CAM_DIST - this.kick * 0.2 + (falling ? 1.2 : 0), hgt = T.CAM_HEIGHT + (falling ? 1.0 : 0);
    if (this.shake > 0.002) { this.sx = (Math.random() - 0.5) * this.shake; this.sy = (Math.random() - 0.5) * this.shake; } else this.sx = this.sy = 0;
    let camX = this.px - fx * dist + rx * this.sx, camZ = this.pz - fz * dist + rz * this.sx, camY = this.y + hgt + this.sy;
    // Never below the ground it is over, and when a ledge rises between the camera and the car (just off a
    // stack of pancakes), rise over it and look down.
    let gMax = 0;
    for (let k = 0; k <= 5; k++) gMax = Math.max(gMax, groundXZ(this.px - fx * ((dist + 0.4) * k) / 5, this.pz - fz * ((dist + 0.4) * k) / 5, c.u, saw));
    if (camY < gMax + 0.35) camY = gMax + 0.35;
    const aimY = carY + 0.35;
    let need = 0;
    for (let k = 1; k <= 6; k++) {
      const f = k / 7, gk = groundXZ(this.px - fx * dist * (1 - f), this.pz - fz * dist * (1 - f), c.u, saw);
      need = Math.max(need, (gk + 0.14 - aimY * f) / (1 - f) - camY);
    }
    this.raise = Math.max(need, this.raise - dt * 1.6, 0);
    camY += this.raise;
    // Never inside a prop: it comes in toward the car, in front of a shaker, a cherry or the cereal box's wall.
    if (!falling) { const p = this.clear(state, this.px, this.pz, camX, camZ, camY); camX = p.x; camZ = p.z; camY = Math.min(camY, p.y); }
    const cam = this.cam;
    cam.position.set(camX, camY, camZ);
    // On a short screen the controls take more of the height, so the camera looks a little higher and the car sits lower.
    const pitch = ((T.CAM_PITCH - (world.cssH < 360 ? 3.5 : world.cssH < 400 ? 1.5 : 0)) * Math.PI) / 180, far = 10;
    let lx = camX + fx * far, ly = this.y + hgt - Math.tan(pitch) * far, lz = camZ + fz * far;
    if (this.raise > 0.02 || falling) { const k = Math.min(1, this.raise * 2 + (falling ? 1 : 0)); lx = lerp(lx, this.px, k); ly = lerp(ly, aimY, k); lz = lerp(lz, this.pz, k); }
    cam.lookAt(lx, ly + this.sy, lz);
    const base = aspect >= 1.55 ? T.CAM_FOV : Math.min(96, (2 * Math.atan((Math.tan((T.CAM_FOV * Math.PI) / 360) * 1.55) / aspect) * 180) / Math.PI);
    cam.fov = base + this.kick * T.CAM_KICK_FOV + (c.boostT > 0 ? 5 : 0);
    return this.view;
  }
}

/** The television's whole-table picture, with a close shot for a fall and the finish. Kept so the owner can compare it with the split view. */
class TvRig {
  constructor() { this.cam = new THREE.PerspectiveCamera(30, 2, 0.5, 400); this.close = 0; this.gap = 0; this.cp = V3(0, 0, 0); this.cl = V3(0, 0, 0); this.who = -1; this.view = { cam: this.cam, rect: { x: 0, y: 0, w: 1, h: 1 }, tv: true }; }
  cut(world, state, e) {
    if (this.gap > 0 && e.k !== "finish") return;
    const v = world.cars[e.car]; if (!v) return;
    if (e.k === "finish") {
      if (e.place !== 1) return;
      const a = trackAt(TUNE.LINE_U + 3.2, -4.6, {}), b = trackAt(TUNE.LINE_U - 0.8, 0, {});
      this.cp.set(a.x, 1.2, a.z); this.cl.set(b.x, 0.3, b.z); this.close = 2.6; this.who = -1;
    } else { this.close = TUNE.TV_CUT_T; this.who = e.car; this.side = Math.random() < 0.5 ? -1 : 1; }
    this.gap = this.close + TUNE.TV_CUT_GAP;
  }
  update(state, world, dt, aspect) {
    const cam = this.cam;
    this.gap -= dt; this.close -= dt;
    this.view.close = false;
    if (this.close > 0) {
      if (this.who >= 0) { const v = world.cars[this.who]; this.cp.set(v.pos.x + v.fwd.x * 2.6 - v.fwd.z * 2.3 * this.side, Math.max(0, v.pos.y) + 1.1, v.pos.z + v.fwd.z * 2.6 + v.fwd.x * 2.3 * this.side); this.cl.set(v.pos.x, v.pos.y + 0.3, v.pos.z); }
      cam.fov = 44; cam.position.copy(this.cp); cam.lookAt(this.cl);
      this.view.close = true;
      return this.view;
    }
    // Far enough back to hold the whole table and the chair at its end (table.js); a narrow screen widens the lens
    // instead of leaving the room. The party room's big screen looks down steeply enough that the far wall stays out
    // of the picture (at 52 degrees its lower edge showed as a strip along the top).
    const { x0, z0, z1 } = TABLE, x1 = TABLE.x1 + 8, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, hw = (x1 - x0) / 2 + 1, hd = (z1 - z0) / 2 + 1;
    const el = (TV_ELEVATION * Math.PI) / 180, vf = 30, tv = Math.tan((vf * Math.PI) / 360);
    const dW = hw / (tv * aspect) + hd * Math.cos(el), dD = (hd * Math.sin(el) + 3) / tv + hd * Math.cos(el) * 0.3;
    const dist = Math.max(dW, dD) * 0.98;
    cam.fov = vf;
    cam.position.set(mx, Math.sin(el) * dist, mz + Math.cos(el) * dist + 1);
    cam.lookAt(mx, -1.5, mz + 1);
    return this.view;
  }
}

export { World, ChaseRig, TvRig, ease, lerp, damp };
