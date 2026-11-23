// The Star Lounge made real, as a preview: the room rendered in Blender (lobby/tools/blender/star-lounge.py)
// put back together with depth, the universe drawn live outside its window, and the room's real
// pieces (lobby/public/look3d/pieces.js, called and not copied) walking its line.
//
// The room itself is drawn by the same modules the party room uses for its rendered Star Lounge
// (?look=real): lobby/public/look3d/rendered/plate.js (the picture and its glass cut, drawn over
// what is outside), rendered/star-lounge/outside.js (the universe), parts.js (the lamps, the chart
// table, the blinking lights, the rods and shines) and sky.js (the timetable). What is only this
// page's: its stand-ins for the room's data (posters, signs, boards, pieces wandering), the eye
// that moves with Depth on, the taps, and the Notes.
//
// What is a picture and what is live:
//   - The room is one rendered picture thrown back onto the room's own shape (floor, walls, ceiling)
//     from the place it was taken, so it holds together when the eye moves. Each light in it was
//     rendered on its own and is added here with one number: five lamps, the lines of light, the chart's glow.
//   - The lamps and the chart table are rendered cards at their own depth.
//   - Outside is live: a turning ball with a rendered surface, its ring and shadow, a moon, two
//     depths of stars, gas clouds, and rendered ships and rocks that pass.
//   - The pieces, posters, signs and words are drawn live, as they are in the room today.
import * as THREE from "three";
import { camera as viewOf } from "../../../lobby/shared/camera.js";
import { ROOM, WALK_SPEED, boxCentre, clampX, lightHalf } from "../../../lobby/shared/world.js";
import { boxArt } from "../../../lobby/public/look3d/paint.js";
import { dressPawn, makePawn, posePawn } from "../../../lobby/public/look3d/pieces.js";
import { CAM, D_WALL, SPACE, U, WALK, layout, walkX, wallX, wallY } from "../../../lobby/public/look3d/space.js";
import { canvasTexture as paintedTexture, clamp, drawOutsideFirst, loadTexture, radialTexture, seeded, shellGroup, shellMaterial, windowBox } from "../../../lobby/public/look3d/rendered/plate.js";
import { createOutside } from "../../../lobby/public/look3d/rendered/star-lounge/outside.js";
import { LIGHTS, buildBlinks, buildHolo, buildLamp, colours, onWall, rodRects, rodsMesh, runHolo, setLamp, sheensMesh, strikeHolo } from "../../../lobby/public/look3d/rendered/star-lounge/parts.js";
import { createSky } from "../../../lobby/public/look3d/rendered/star-lounge/sky.js";

const A = window.__ASSETS;
const P = window.__PLATE;
const CFG = window.__CFG;
const Q = new URLSearchParams(location.search);
const N = P.boxes;
const L = layout(N);
const ZB = SPACE.zBack;
const { accent: ACCENT, lamp: LAMP } = colours(CFG);
const BAR = 64;
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("gl");

// ------------------------------------------------------------------ what the preview is showing
const state = {
  look: "real", // "real" | "today"
  mode: Q.get("view") === "room" ? "room" : "closer",
  depth: Q.get("depth") !== "off",
  drag: Number(Q.get("eye") ?? 0), // metres the eye was pushed by a finger
  paused: false,
};
const still = Q.has("still"); // for screenshots: a fixed moment, nothing random
const SPEED = Math.max(1, Number(Q.get("speed") ?? 1) || 1);

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance", alpha: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x01020a, 1);
renderer.sortObjects = true;
renderer.autoClear = false;
renderer.info.autoReset = false; // a frame is two drawings; the count of draw calls is for both
const ANISO = Math.min(4, renderer.capabilities.getMaxAnisotropy());
// Two pictures, drawn one after the other, every frame:
//   1. outside: everything beyond the glass (sky, stars, planet, moon, and whatever is passing, with its lights).
//   2. `scene`: the room, drawn over it. The room's picture is solid everywhere but the glass.
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera();
cam.position.set(0, CAM.y, CAM.z);
cam.matrixAutoUpdate = true;

const texture = (name, o = {}) => loadTexture(A[name], { anisotropy: ANISO, ...o }).catch(() => Promise.reject(new Error(`the picture "${name}" did not load`)));
const canvasTexture = (w, h, draw) => paintedTexture(w, h, draw, ANISO);
const radial = radialTexture();

// ================================================================== outside the window
let world = null; // star-lounge/outside.js
const timetable = createSky();
const LABEL = { star: "shooting star", rocket: "rocket", liner: "liner", saucer: "saucer", rock0: "rock", rock1: "rock", rock2: "rock" };
/** For a screenshot (?still&pass=rocket&at=0.3): one named thing held at one point of its way. */
let heldEv = Q.get("pass") ? { thing: { name: Q.get("pass") }, u: Number(Q.get("at") ?? 0.5), held: true } : null;
let passing = null; // the name of what is in the sky this frame, for the checks
function runSky(t) {
  const ev = heldEv ?? (still ? null : timetable.step(t));
  world.step(t, eye, ev);
  passing = world.passing;
}

// ================================================================== the room, from its rendered picture
let shell = null;
function buildShell(base, lights) {
  const mat = shellMaterial(P, base, lights, LIGHTS, { exposure: Number(Q.get("exposure") ?? 0.95), shine: Number(Q.get("shine") ?? 0.5) });
  const group = shellGroup(mat);
  scene.add(group);
  shell = { mat, u: mat.uniforms, group };
  // A lamp's light on the dark blue deck comes back very blue; it is warmed a little so the pool reads as light.
  for (const [i, name] of LIGHTS.entries()) if (name.startsWith("lamp")) shell.u.uTint.value[i].setRGB(1.3, 1.08, 0.86);
}
const gainOf = (name) => P.lights[name].gain;

// ---- the lamps: a card that swings from the ceiling, a glow, a beam, and the light for the pieces under it
const lamps = [];
function buildLamps(sheet) {
  for (let i = 0; i < N; i++) lamps.push({ ...buildLamp(i, { plate: P, sheet, radial, colour: LAMP, exposure: shell.u.uExposure.value, add: (o) => scene.add(o) }), level: 0, aim: 0, swing: 0, swingV: 0, flick: 0, struck: -1 });
}

// ---- the chart table: a card, and over it a globe of light drawn live
let holo = null;
function buildChart(sheet) {
  holo = buildHolo({ plate: P, cfg: CFG, sheet, radial, exposure: shell.u.uExposure.value, add: (o) => scene.add(o) });
}

// ---- the wall's words and pictures: live, as in the room today (stand-ins for the room's own HTML)
const BOXES = [
  { name: "Cork & Bell", art: "cork-and-bell", about: "1-4 players", tag: "Any device" },
  { name: "Who Am I?", art: "who-am-i", url: "https://example.invalid", about: "For 2 players" },
  { name: "Tin Derby", art: "tin-derby", soon: true, about: "Coming soon" },
  { name: "Flood", art: "flood", soon: true, about: "Coming soon" },
  { name: "Fox Trouble", art: "fox-trouble", soon: true, about: "Coming soon" },
];
const posters = [];
const wallQuad = (xw, yw, ww, hw, tex, z = ZB + 0.42, order = -40) => {
  const [l, t] = [wallX(xw), wallY(yw)];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ww / U, hw / U), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  // The words are laid out on the back wall; a quad nearer than the wall is drawn smaller so it still covers the same place.
  const k = (CAM.z - z) / D_WALL;
  m.scale.setScalar(k);
  m.position.set((l + ww / U / 2) * k, CAM.y + (t - hw / U / 2 - CAM.y) * k, z);
  m.renderOrder = order;
  scene.add(m);
  return m;
};
const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h); // an older phone: square corners
};
/** A hung screen's body: a dark glass panel in a metal rim, with a line of the room's light inside it. */
function panel(g, w, h, r, line = "rgba(110,231,255,.65)") {
  g.fillStyle = "rgba(4,8,20,.93)";
  rr(g, 3, 3, w - 6, h - 6, r);
  g.fill();
  const rim = g.createLinearGradient(0, 0, 0, h);
  rim.addColorStop(0, "#c9d6ea");
  rim.addColorStop(0.08, "#5d6c86");
  rim.addColorStop(0.92, "#27324a");
  rim.addColorStop(1, "#0b1020");
  g.strokeStyle = rim;
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = line;
  g.lineWidth = 2.5;
  rr(g, 11, 11, w - 22, h - 22, Math.max(2, r - 8));
  g.stroke();
}
const sheenRects = [];
const rods = [];
let sheenMesh = null;
function buildWall(images) {
  for (const [i, box] of BOXES.entries()) {
    const tex = new THREE.CanvasTexture(boxArt(box, images));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L.bw, L.bh), mat);
    m.position.set(L.xs[i], L.by, ZB + 0.36);
    m.renderOrder = -40;
    scene.add(m);
    sheenRects.push({ x: L.xs[i], y: L.by, z: ZB + 0.365, w: L.bw, h: L.bh });
    posters.push({ mat, glitch: -1 });
    // Its sign: the same size and place as in every room.
    const sw = Math.round(L.signW * 0.84);
    wallQuad(boxCentre(i, N) - sw / 2, L.signTop, sw, 46, canvasTexture(sw * 4, 46 * 4, (g, w, h) => {
      g.scale(w / (sw * 3), h / (58 * 3));
      [w, h] = [sw * 3, 58 * 3];
      g.fillStyle = "rgba(6,10,22,.86)";
      rr(g, 3, 3, w - 6, h - 6, 26);
      g.fill();
      g.strokeStyle = i === 0 ? "rgba(255,95,176,.95)" : "rgba(110,231,255,.5)";
      g.lineWidth = 4;
      g.setLineDash(i === 0 ? [] : [10, 8]);
      g.stroke();
      g.textBaseline = "middle";
      g.font = "800 46px Nunito, system-ui, sans-serif";
      if (box.tag) {
        g.font = "800 38px Nunito, system-ui, sans-serif";
        g.fillStyle = "#cfe8ff";
        g.textAlign = "left";
        g.fillText(box.about, 26, h / 2 + 2);
        const tw = g.measureText(box.tag).width + 40;
        g.fillStyle = "#38c8ff";
        rr(g, w - tw - 26, 34, tw, h - 68, 40);
        g.fill();
        g.fillStyle = "#06101c";
        g.textAlign = "center";
        g.fillText(box.tag, w - tw / 2 - 26, h / 2 + 2);
      } else {
        const tw = g.measureText(box.about).width + 56;
        g.fillStyle = "#fff1e6";
        rr(g, (w - tw) / 2, 30, tw, h - 60, 50);
        g.fill();
        g.fillStyle = "#b3261e";
        g.textAlign = "center";
        g.fillText(box.about, w / 2, h / 2 + 3);
      }
    }));
  }
  // The join sign: its code must stay readable (the QR picture is a stand-in pattern, not a working code).
  rods.push(...rodRects(P, 181 - 106, 212, 133));
  sheenRects.push(onWall(181 - 106, 133, 212, 276, ZB + 0.425));
  wallQuad(181 - 106, 133, 212, 276, canvasTexture(212 * 3, 276 * 3, (g, w, h) => {
    panel(g, w, h, 24);
    g.fillStyle = "#6ee7ff";
    g.font = "700 30px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center";
    g.letterSpacing = "4px";
    g.fillText("SCAN OR TYPE THE CODE", w / 2, 58);
    g.letterSpacing = "0px";
    g.fillStyle = "#fff7ea";
    rr(g, w / 2 - 190, 86, 380, 380, 14);
    g.fill();
    const rnd = seeded(99);
    g.fillStyle = "#101010";
    const cells = 25;
    const cs = 340 / cells;
    const finder = (cx, cy) => {
      g.fillRect(cx, cy, cs * 7, cs * 7);
      g.fillStyle = "#fff7ea";
      g.fillRect(cx + cs, cy + cs, cs * 5, cs * 5);
      g.fillStyle = "#101010";
      g.fillRect(cx + cs * 2, cy + cs * 2, cs * 3, cs * 3);
    };
    for (let y = 0; y < cells; y++)
      for (let x = 0; x < cells; x++) {
        const corner = (x < 8 && y < 8) || (x > cells - 9 && y < 8) || (x < 8 && y > cells - 9);
        if (!corner && rnd() < 0.48) g.fillRect(w / 2 - 170 + x * cs, 106 + y * cs, cs + 0.5, cs + 0.5);
      }
    finder(w / 2 - 170, 106);
    finder(w / 2 + 170 - cs * 7, 106);
    finder(w / 2 - 170, 106 + 340 - cs * 7);
    g.fillStyle = "#fff";
    g.font = "700 168px ui-monospace, Menlo, Consolas, monospace";
    g.fillText("4827", w / 2, 640);
    g.fillStyle = "#9fb4d0";
    g.font = "500 30px ui-monospace, Menlo, Consolas, monospace";
    g.fillText("partygames.n8builds.dev", w / 2, 730);
  }));
  // The Tonight board.
  rods.push(...rodRects(P, 1722 - 118, 236, 136));
  sheenRects.push(onWall(1722 - 118, 136, 236, 240, ZB + 0.425));
  wallQuad(1722 - 118, 136, 236, 240, canvasTexture(236 * 3, 240 * 3, (g, w, h) => {
    panel(g, w, h, 18);
    g.fillStyle = "#6ee7ff";
    g.font = "700 44px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center";
    g.letterSpacing = "10px";
    g.fillText("TONIGHT", w / 2 + 5, 78);
    g.letterSpacing = "0px";
    g.fillStyle = "rgba(110,231,255,.5)";
    g.fillRect(50, 110, w - 100, 3);
    g.font = "700 56px ui-monospace, Menlo, Consolas, monospace";
    PLAYERS.forEach((p, i) => {
      const y = 190 + i * 88;
      g.textAlign = "left";
      g.fillStyle = "#9fb4d0";
      g.font = "500 40px ui-monospace, Menlo, Consolas, monospace";
      g.fillText(String(i + 1), 46, y);
      g.fillStyle = p.hex;
      g.beginPath();
      g.arc(124, y - 16, 20, 0, 7);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "700 56px ui-monospace, Menlo, Consolas, monospace";
      g.fillText(p.name, 160, y);
      g.textAlign = "right";
      g.fillText(String(p.score), w - 50, y);
    });
    g.fillStyle = "#9fb4d0";
    g.font = "500 30px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center";
    g.fillText("1st 3 pts, 2nd 2, 3rd 1", w / 2, h - 60);
  }));
  // The rods and the shines, once every screen has said where it is: two drawings in all.
  scene.add(rodsMesh(rods));
  sheenMesh = sheensMesh(sheenRects);
  scene.add(sheenMesh);
}

// ---- the lights on the bench that blink, and the ring a touch leaves on the glass
let blinks = null;
const ripples = [];
function buildSmall() {
  blinks = buildBlinks({ gaps: L.gaps, add: (o) => scene.add(o) });
  const ringTex = canvasTexture(128, 128, (g) => {
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 56, 0, 7);
    g.stroke();
  });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    m.position.z = ZB + 0.02;
    m.renderOrder = -45;
    m.visible = false;
    scene.add(m);
    ripples.push({ m, t0: -10 });
  }
}

// ================================================================== the pieces
const PLAYERS = [
  { name: "You", hex: "#c8382c", score: 5, x: 420 },
  { name: "Mabel", hex: "#2f8fd0", score: 3, x: 700 },
  { name: "Fitch", hex: "#d9a02a", score: 2, x: 1180 },
  { name: "Tom", hex: "#3f8a4a", score: 0, x: 1460 },
];
const pieces = [];
const mirror = new THREE.Group();
let tags = [];
function buildPieces(env) {
  scene.add(new THREE.HemisphereLight(0x8fb0ff, 0x05070f, 0.55));
  // The planet's light, coming in low through the glass behind them; and the room's own soft light from the front.
  const shine = new THREE.DirectionalLight(0xffc08a, 1.5);
  shine.position.set(4, 1.6, -8);
  const front = new THREE.DirectionalLight(0xc4d8ff, 0.85);
  front.position.set(-2.5, 6, 10);
  scene.add(shine, front, mirror);
  const pm = new THREE.PMREMGenerator(renderer);
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pm.fromEquirectangular(env).texture;
  scene.environmentIntensity = 0.75;
  pm.dispose();
  const rnd = seeded(21);
  for (const [seat, p] of PLAYERS.entries()) {
    const pawn = makePawn(radial);
    dressPawn(pawn, p.hex, true);
    pawn.mat.roughness = 0.3;
    pawn.mat.clearcoat = 1;
    pawn.mat.clearcoatRoughness = 0.12;
    pawn.mat.envMapIntensity = 1;
    // Solid, but drawn in the same back-to-front list as the room's pictures, after them.
    for (const mesh of pawn.turn.children) {
      mesh.material.transparent = true;
      mesh.renderOrder = mesh.material === pawn.mat ? 0 : 1;
    }
    pawn.blob.material.depthTest = false;
    pawn.blob.renderOrder = -12;
    scene.add(pawn.group, pawn.blob);
    // Its reflection in the deck: the same body, standing on its head under the floor.
    const refl = pawn.group.clone();
    refl.traverse((o) => {
      if (!o.isMesh) return;
      o.visible = o.material === pawn.mat;
      if (!o.visible) return;
      o.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
      o.renderOrder = -11;
    });
    mirror.add(refl);
    // The light the deck gives back under its feet.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: radial, color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.renderOrder = -13;
    scene.add(glow);
    pieces.push({ ...p, seat, pawn, refl, glow, piece: { rx: p.x, seat, face: seat % 2 ? -1 : 1, jumpAt: -1e9, fx: {} }, target: p.x, wait: 1 + rnd() * 3, walking: false, moved: 0, rnd });
  }
  tags = PLAYERS.map((p, i) => {
    const el = document.createElement("div");
    el.className = "tag" + (i === 0 ? " you" : "");
    el.innerHTML = `<i style="background:${p.hex}"></i>${p.name}`;
    $("tags").appendChild(el);
    return el;
  });
}
/** The stand-ins wander: to a light, to the dark between two, sometimes a jump. The first one is "you" and the closer view follows it. */
function walkPieces(now, dt) {
  const half = lightHalf(N);
  for (const p of pieces) {
    const piece = p.piece;
    if (still) {
      p.walking = false;
    } else if (Math.abs(p.target - piece.rx) > 2) {
      const dir = Math.sign(p.target - piece.rx);
      piece.rx = clampX(piece.rx + dir * Math.min(Math.abs(p.target - piece.rx), WALK_SPEED * dt));
      piece.face = dir;
      p.walking = true;
    } else {
      p.walking = false;
      p.wait -= dt;
      if (p.wait <= 0) {
        const r = p.rnd();
        if (r < 0.22) piece.jumpAt = now;
        else if (r < 0.75) p.target = boxCentre(Math.floor(p.rnd() * N), N) + (p.rnd() - 0.5) * half * 1.2;
        else p.target = clampX(ROOM.minX + 40 + p.rnd() * (ROOM.maxX - ROOM.minX - 80));
        p.wait = 1.5 + p.rnd() * 4;
      }
    }
  }
}
const lampOver = (xw) => {
  let best = { lit: 0, x: xw, d: Infinity };
  const half = lightHalf(N);
  for (const b of lamps) {
    if (!(b.level > 0.002)) continue;
    const d = Math.abs(xw - b.cx);
    if (d < best.d) best = { lit: Math.min(1, 0.5 + 0.5 * b.level) * clamp((half + 150 - d) / 150, 0, 1), x: b.cx, d };
  }
  return best;
};
function drawPieces(now, dt) {
  for (const p of pieces) {
    const { pawn, piece } = p;
    const lamp = lampOver(piece.rx);
    posePawn(pawn, piece, now, dt, { walking: p.walking, lit: lamp.lit, calm: false });
    // The room has real light, so the paint is not dimmed: the light does it.
    pawn.mat.color.copy(pawn.colour);
    pawn.mat.emissiveIntensity = 0.03;
    const away = lamp.lit > 0 ? clamp((piece.rx - lamp.x) / (lightHalf(N) + 60), -1, 1) : 0;
    pawn.blob.position.x += away * 0.2;
    pawn.blob.scale.multiplyScalar(1.3);
    pawn.blob.scale.x *= 1 + Math.abs(away) * 0.6;
    pawn.blob.material.opacity = Math.min(1, pawn.blob.material.opacity * (0.75 + 0.8 * lamp.lit));
    const r = p.refl;
    const [tilt, mt] = [pawn.group.children[0], r.children[0]];
    const [turn, mturn] = [tilt.children[0], mt.children[0]];
    r.position.set(pawn.group.position.x, -pawn.group.position.y, pawn.group.position.z);
    r.scale.set(1, -1, 1);
    mt.rotation.copy(tilt.rotation);
    mt.scale.copy(tilt.scale);
    mturn.rotation.copy(turn.rotation);
    const body = mturn.children[0];
    body.material.color.copy(pawn.mat.color).multiplyScalar(0.4 + 0.6 * lamp.lit);
    body.material.opacity = (0.16 + 0.2 * lamp.lit) * Math.max(0, 1 - pawn.group.position.y * 0.9);
    // The deck lights up under a piece that is moving, and fades behind it.
    p.moved += ((p.walking ? 1 : 0.25) - p.moved) * Math.min(1, dt * 4);
    p.glow.position.set(walkX(piece.rx), 0.01, SPACE.walkZ + 0.05);
    p.glow.material.opacity = 0.34 * p.moved;
  }
}

// ================================================================== the room's life
function runLamps(t, dt) {
  const half = lightHalf(N);
  for (const b of lamps) {
    const inside = pieces.filter((p) => Math.abs(p.piece.rx - b.cx) <= half).length;
    const aim = inside ? Math.min(1.25, 0.8 + 0.15 * inside) : 0;
    if (aim > 0 && b.aim === 0) b.struck = t; // it stutters as it comes on, like a tube
    b.aim = aim;
    b.level += (aim - b.level) * Math.min(1, dt * 7);
    // A lamp that was knocked swings and flickers.
    const acc = -22 * b.swing - 1.6 * b.swingV;
    b.swingV += acc * dt;
    b.swing += b.swingV * dt;
    const since = t - b.struck;
    let flick = 1;
    if (since >= 0 && since < 0.45) flick = Math.sin(since * 70) > -0.2 ? 1 : 0.25;
    if (b.flick > 0) {
      b.flick -= dt;
      flick *= Math.sin(t * 61) * Math.sin(t * 23) > -0.15 ? 1 : 0.3;
    }
    const level = Math.max(b.flick > 0 ? 0.7 : 0, b.level) * flick;
    const glow = Math.min(1, level * 8);
    const k = 0.3 * glow + 0.7 * level;
    // A lamp nobody stands under gives the room nothing, so its layer is not looked up at all.
    shell.u.uGain.value[b.i] = gainOf(`lamp${b.i}`) * k * 1.6;
    shell.u.uSway.value[b.i] = -b.swing * 0.035;
    setLamp(b, { glow, k, level, swing: b.swing });
    const post = posters[b.i];
    const g = post.glitch > 0 ? (Math.sin(t * 90) > 0 ? 1.5 : 0.25) : 1;
    post.glitch -= dt;
    post.mat.color.setScalar((0.3 + 0.66 * glow) * g);
  }
}
function runChart(t, dt) {
  const i = LIGHTS.indexOf("holo");
  shell.u.uGain.value[i] = gainOf("holo") * runHolo(holo, t, dt, shell.u.uTint.value[i]).power;
}
function runSmall(t) {
  const i = LIGHTS.indexOf("strips");
  // The lines of light in the deck breathe slowly.
  shell.u.uGain.value[i] = gainOf("strips") * (0.82 + 0.18 * Math.sin(t * 1.3));
  blinks.material.uniforms.uTime.value = t;
  for (const r of ripples) {
    const u = (t - r.t0) / 0.9;
    r.m.visible = u >= 0 && u < 1;
    if (!r.m.visible) continue;
    r.m.scale.setScalar(0.2 + u * 2.4);
    r.m.material.opacity = 0.8 * (1 - u) * (1 - u);
  }
}

// ================================================================== a touch
/** The point of the plane at depth z under a point of the screen, in room metres. */
function under(cx, cy, z) {
  const box = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector3(((cx - box.left) / box.width) * 2 - 1, -(((cy - box.top) / box.height) * 2 - 1), 0.5).unproject(cam);
  const dir = ndc.sub(cam.position);
  const k = (z - cam.position.z) / dir.z;
  return [cam.position.x + dir.x * k, cam.position.y + dir.y * k];
}
function touch(cx, cy) {
  const t = clock.t;
  // A lamp?
  const [lx, ly] = under(cx, cy, SPACE.walkZ);
  for (const b of lamps)
    if (Math.abs(lx - b.x) < 0.75 && ly > SPACE.lampY - 0.7) {
      b.swingV += (lx >= b.x ? -1 : 1) * 1.5 + (Math.random() - 0.5) * 0.3;
      b.flick = 1.3;
      return say("The lamp swings and flickers, and its pool of light goes with it.");
    }
  // The chart table?
  const [hx, hy] = under(cx, cy, CFG.holo.z);
  if (Math.hypot(hx - CFG.holo.x, hy - CFG.holo.y) < 0.85 || (Math.abs(hx - CFG.holo.x) < 0.6 && hy < CFG.holo.y && hy > 0)) {
    strikeHolo(holo, t);
    return say("The chart spins up, turns pink and throws sparks. Its light on the wall and the deck turns with it.");
  }
  // A screen?
  const [wx, wy] = under(cx, cy, ZB + 0.36);
  for (const [i, x] of L.xs.entries())
    if (Math.abs(wx - x) < L.bw / 2 && Math.abs(wy - L.by) < L.bh / 2) {
      posters[i].glitch = 0.45;
      lamps[i].flick = 0.5;
      return say("The screen stutters, and so does its lamp.");
    }
  // The glass: a ring where it was touched, and a shooting star through that place.
  const [gx, gy] = under(cx, cy, ZB);
  if (gy > P.layout.sill && gy < P.layout.head && Math.abs(gx) < SPACE.w / 2) {
    const r = ripples.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    r.t0 = t;
    r.m.position.set(gx, gy, ZB + 0.02);
    // The shooting star is the sky's to give: it comes only into an empty sky, like everything else out there.
    const [sx, sy] = under(cx, cy, -40);
    const busy = timetable.now?.thing.name;
    if (timetable.startIfEmpty("star", t, { x: sx, y: sy, len: 11 })) return say("A ring on the glass, and a shooting star behind it.");
    return say(busy === "star" ? "A ring on the glass." : `A ring on the glass. No shooting star while the ${LABEL[busy] ?? "sky"} is passing: one thing at a time.`);
  }
  // The deck: a piece comes over.
  if (ly < 0.2 || gy < P.layout.sill) {
    const p = pieces[0];
    p.target = clampX(960 + (under(cx, cy, SPACE.walkZ)[0] / WALK) * U);
    p.wait = 4;
    return say("Your piece walks to where you touched.");
  }
}
let sayTimer = 0;
function say(text) {
  const el = $("said");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => el.classList.remove("on"), 3200);
}

// ================================================================== the frame
const clock = { t: still ? Number(Q.get("t") ?? 30) : 0, last: performance.now() };
const meter = { frames: [], script: [], shown: 0 };
let view = null;
let eye = 0;
function frameView() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const phone = Math.min(w, h) < 560;
  return viewOf({ w, h, bar: BAR, mode: state.mode, focusX: pieces[0]?.piece.rx ?? 960, phone, boxes: N });
}
function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const ratio = sharp;
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  world?.resize(ratio, h);
  if (blinks) blinks.material.uniforms.uPx.value = ratio * Math.max(0.75, h / 520);
}
/** Drawn pixels per screen pixel: at most two, and fewer on a device that cannot keep up (see the meter in tick). */
let sharp = Math.min(window.devicePixelRatio || 1, 2);
let slowSince = 0;

/** One frame: the outside first, then the room over it. */
function drawFrame() {
  renderer.info.reset();
  // The outside is only drawn inside the box of screen that the window wall takes up (from the sill
  // to the ceiling, from side wall to side wall, where the eye is now). The planet is a very large
  // ball and most of it lies behind the bench and the deck: none of that is worked out any more.
  drawOutsideFirst(renderer, world.scene, cam, scene, cam, windowBox(cam, stage.clientWidth, stage.clientHeight, P.layout.sill));
}
/** For the checks (shoot.mjs --paths): does a passing thing change any pixel that is not glass, anywhere along its way?
 *  This one moment of the room is drawn with an empty sky, then with only the glass (in white), then
 *  with the named thing at each of `steps` + 1 points of its way. For each point it counts the pixels
 *  the thing changed, and how many of those are not glass. Nothing else moves between the drawings. */
function leakSweep(name, steps, x) {
  const gl = renderer.getContext();
  const [w, h] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  const grab = () => {
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const before = heldEv;
  window.__hold(null);
  runSky(clock.t);
  const quiet = passing === null; // (false on a live page while the timetable has something out: then this check says nothing)
  drawFrame();
  const empty = grab();
  const others = scene.children.filter((o) => o !== shell.group && o.visible);
  others.forEach((o) => (o.visible = false));
  shell.u.uProbe.value = 1;
  renderer.clear();
  renderer.render(scene, cam);
  const glass = grab();
  shell.u.uProbe.value = 0;
  others.forEach((o) => (o.visible = true));
  let panes = 0;
  for (let i = 0; i < glass.length; i += 4) if (glass[i] > 0) panes++;
  const changed = [];
  const leaked = [];
  let worst = 0;
  let drew = true;
  for (let s = 0; s <= steps; s++) {
    window.__hold(name, s / steps, x);
    runSky(clock.t);
    drew &&= passing === name;
    drawFrame();
    const full = grab();
    let c = 0;
    let l = 0;
    for (let i = 0; i < empty.length; i += 4) {
      const d = Math.max(Math.abs(empty[i] - full[i]), Math.abs(empty[i + 1] - full[i + 1]), Math.abs(empty[i + 2] - full[i + 2]));
      if (!d) continue;
      c++;
      if (glass[i] === 0) {
        l++;
        worst = Math.max(worst, d);
      }
    }
    changed.push(c);
    leaked.push(l);
  }
  heldEv = before;
  runSky(clock.t);
  drawFrame();
  return { quiet, drew, changed, leaked, worst, glass: panes, pixels: w * h };
}

function tick(nowMs) {
  requestAnimationFrame(tick);
  const dtReal = Math.min(0.1, (nowMs - clock.last) / 1000);
  meter.frames.push(nowMs - clock.last);
  clock.last = nowMs;
  if (state.look !== "real" || state.paused) return;
  const t0 = performance.now();
  // ?speed=20 runs the room's clock fast, for the check that watches the sky for a long time (shoot.mjs --sky).
  // Each step is still at most a tenth of a second, as on a slow phone.
  const dt = still ? 0 : Math.min(0.1, dtReal * SPEED);
  clock.t += dt;
  const t = clock.t;
  const now = t * 1000;

  walkPieces(now, dt);
  runLamps(t, dt);
  drawPieces(now, dt);
  runChart(t, dt);
  runSmall(t);

  // The view: the frame slides and scales as it does in the room today. New here: the eye slides a
  // little with it, so near things pass in front of far ones.
  const v = frameView();
  view = view ? { x: view.x + (v.x - view.x) * Math.min(1, dtReal * 6), y: view.y + (v.y - view.y) * Math.min(1, dtReal * 6), width: view.width + (v.width - view.width) * Math.min(1, dtReal * 6), height: view.height + (v.height - view.height) * Math.min(1, dtReal * 6) } : v;
  const mid = wallX(view.x + view.width / 2) * WALK;
  const want = state.depth ? clamp(mid * 0.55 + state.drag + (still ? 0 : 0.22 * Math.sin(t * 0.33)), -3.2, 3.2) : 0;
  eye += (want - eye) * Math.min(1, dtReal * 5);
  const n = 1;
  const kWalk = n / (CAM.z - SPACE.walkZ);
  const kWall = n / D_WALL;
  cam.position.set(eye, CAM.y, CAM.z);
  cam.updateMatrixWorld();
  cam.projectionMatrix.makePerspective((wallX(view.x) * WALK - eye) * kWalk, (wallX(view.x + view.width) * WALK - eye) * kWalk, (wallY(view.y) - CAM.y) * kWall, (wallY(view.y + view.height) - CAM.y) * kWall, n, 1600);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

  // Outside: the ship is under way, so the far things turn slowly past, the near ones faster.
  runSky(t);
  sheenMesh.material.uniforms.uEye.value = eye;

  drawFrame();

  // The names over the pieces (HTML, as in the room).
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const proj = new THREE.Vector3();
  const spots = pieces.map((p, i) => {
    proj.set(p.pawn.group.position.x, p.pawn.group.position.y + 1.02, SPACE.walkZ).project(cam);
    return { i, x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h };
  });
  // Names over pieces that stand together: each goes up one line above the highest name within 64 px to its left, so three together do not cover one another.
  spots.sort((a, b) => a.x - b.x);
  for (const [k, s] of spots.entries()) {
    s.lvl = 0;
    for (let j = 0; j < k; j++) if (s.x - spots[j].x < 64 && spots[j].lvl >= s.lvl) s.lvl = spots[j].lvl + 1;
    tags[s.i].style.transform = `translate(${s.x}px, ${s.y - s.lvl * 24}px) translate(-50%, -100%)`;
  }

  meter.script.push(performance.now() - t0);
  if (nowMs - meter.shown > 500 && meter.frames.length > 5) {
    const f = meter.frames.slice(-90);
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const worst = Math.max(...f);
    const s = meter.script.slice(-90);
    const sc = s.reduce((a, b) => a + b, 0) / s.length;
    $("meter").textContent = `frame ${avg.toFixed(1)} ms (${Math.round(1000 / avg)} a second) · worst ${worst.toFixed(0)} ms · script ${sc.toFixed(1)} ms · ${sharp.toFixed(2).replace(/\.?0+$/, "")}x`;
    meter.frames = f;
    meter.script = s;
    meter.shown = nowMs;
    // A device that cannot hold sixty a second draws fewer pixels instead: slower than 20 ms for two seconds, and the picture is drawn a step smaller.
    if (avg > 20 && sharp > 1 && !still && !Q.has("fixed")) {
      slowSince ||= nowMs;
      if (nowMs - slowSince > 2000) {
        sharp = Math.max(1, sharp - 0.25);
        slowSince = 0;
        meter.frames = [];
        resize();
      }
    } else slowSince = 0;
    window.__meter = { avg, worst, script: sc, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }
}

// ================================================================== the page round it
function setLook(look) {
  state.look = look;
  document.body.dataset.look = look;
  for (const b of document.querySelectorAll("[data-look-set]")) b.setAttribute("aria-pressed", String(b.dataset.lookSet === look));
  $("before").src = A[state.mode === "closer" ? "beforeCloser" : "beforeRoom"];
  $("meter").hidden = look !== "real";
}
function setMode(mode) {
  state.mode = mode;
  for (const b of document.querySelectorAll("[data-mode-set]")) b.setAttribute("aria-pressed", String(b.dataset.modeSet === mode));
  $("before").src = A[mode === "closer" ? "beforeCloser" : "beforeRoom"];
}
function setDepth(on) {
  if (on !== state.depth) state.drag = 0;
  state.depth = on;
  $("depth").setAttribute("aria-pressed", String(on));
  $("depth").textContent = on ? "Depth: on" : "Depth: off";
}
function wire() {
  for (const b of document.querySelectorAll("[data-look-set]")) b.addEventListener("click", () => setLook(b.dataset.lookSet));
  for (const b of document.querySelectorAll("[data-mode-set]")) b.addEventListener("click", () => setMode(b.dataset.modeSet));
  $("depth").addEventListener("click", () => setDepth(!state.depth));
  $("notes-open").addEventListener("click", () => document.body.classList.toggle("notes-on"));
  $("notes-shut").addEventListener("click", () => document.body.classList.remove("notes-on"));
  // "Send one now": the thing asked for still goes through the timetable, so it waits for an empty sky.
  for (const b of document.querySelectorAll("[data-send]"))
    b.addEventListener("click", () => {
      const name = b.dataset.send === "rock" ? `rock${Math.floor(Math.random() * 3)}` : b.dataset.send;
      const waitsFor = timetable.ask(name, clock.t);
      document.body.classList.remove("notes-on"); // sideways, the notes cover the window: get them out of the way
      const what = name === "star" ? "A shooting star" : `The ${LABEL[name]}`;
      say(waitsFor ? `${what} comes next, a few seconds after the ${LABEL[waitsFor]} has gone.` : `${what} is on its way.`);
    });
  // A touch on the stage: a short one sets something off, a drag moves the eye.
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, drag: state.drag, moved: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // a touch that has already ended: nothing to hold on to
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) > 8) down.moved = true;
    if (down.moved && state.depth) state.drag = clamp(down.drag - ((e.clientX - down.x) / stage.clientWidth) * 7, -3, 3);
  });
  const up = (e) => {
    if (down && !down.moved && e.type === "pointerup") touch(e.clientX, e.clientY);
    down = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => (clock.last = performance.now()));
}

async function start() {
  const image = (name) =>
    new Promise((done, fail) => {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => fail(new Error(`the picture "${name}" did not load`));
      img.src = A[name];
    });
  const OUT = ["sky", "planet", "moon", "rocket", "liner", "saucer", "rock0", "rock1", "rock2"];
  const [base, lights, sheet, env, corkArt, ...outside] = await Promise.all([
    texture("base"),
    texture("lights", { mips: false }),
    texture("cards"),
    texture("env", { mips: false }),
    image("corkArt"),
    ...OUT.map((n) => texture(n, { repeat: ["sky", "planet", "moon"].includes(n) })),
    document.fonts?.load('400 40px "Abril Fatface"').catch(() => null),
    document.fonts?.load('800 40px "Nunito"').catch(() => null),
  ]);
  world = createOutside({ cfg: CFG, tex: Object.fromEntries(OUT.map((n, i) => [n, outside[i]])) });
  if (Q.get("detail") === "off") for (const m of [world.planet, world.moon]) m.material.uniforms.uDetail.value = 0;
  buildShell(base, lights);
  buildWall({ "cork-and-bell": corkArt });
  buildSmall();
  buildChart(sheet);
  buildLamps(sheet);
  buildPieces(env);
  wire();
  resize();
  setMode(state.mode);
  setLook(Q.get("look") === "today" ? "today" : "real");
  setDepth(state.depth);
  if (still) {
    // A fixed moment for a screenshot: two in the first light, one in the third.
    pieces[0].piece.rx = boxCentre(0, N) - 40;
    pieces[1].piece.rx = boxCentre(0, N) + 46;
    pieces[2].piece.rx = boxCentre(2, N) + 10;
    pieces[3].piece.rx = boxCentre(3, N) + 150;
    for (const b of lamps) b.level = b.aim = pieces.some((p) => Math.abs(p.piece.rx - b.cx) <= lightHalf(N)) ? 1 : 0;
  }
  document.body.classList.add("ready");
  // For the checks (shoot.mjs): what the lamps and the pieces are doing.
  window.__leak = leakSweep;
  // What is in the sky this frame: the timetable's word, and (counted separately, from the drawing itself) every passing thing that is switched on.
  window.__sky = () => ({ t: clock.t, passing, drawn: [...world.passers.filter((p) => p.mesh.visible).map((p) => p.name), ...(world.streak.m.visible ? ["star"] : [])] });
  window.__ask = (name) => timetable.ask(name, clock.t);
  // Holds one named thing at one point of its way (or lets go, with no name). A shooting star can be put through a place of the wall (x in the room's metres).
  window.__hold = (name, u, x) => {
    heldEv = name ? { thing: { name }, u, held: true, x: x === undefined ? undefined : x * ((CAM.z + 40) / D_WALL) } : null;
  };
  window.__glass = (on) => {
    shell.u.uProbe.value = on ? 1 : 0;
    for (const o of scene.children) if (o !== shell.group) o.visible = !on;
  };
  window.__probe = () => ({ lamps: lamps.map((b) => ({ level: +b.level.toFixed(2), gain: +shell.u.uGain.value[b.i].toFixed(2), halo: +b.halo.material.opacity.toFixed(2), spot: +b.spot.intensity.toFixed(2) })), pieces: pieces.map((p) => Math.round(p.piece.rx)), eye: +eye.toFixed(2), view });
  window.__ready = true;
  requestAnimationFrame(tick);
}
start().catch((err) => {
  console.error(err);
  $("said").textContent = "This preview could not start: " + err.message;
  $("said").classList.add("on");
});
