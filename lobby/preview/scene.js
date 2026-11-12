// The lobby concept stills. One 3D room, posed by ?shot= and framed by ?view=.
//   ?shot=vote | countdown | tie | shove     which moment
//   ?view=screen | phone                     big screen (16:9) or a phone held sideways
//   ?theme=workshop | lantern                room mood
// Nothing here is playable: every pose is written down in STATES below.
import * as THREE from "three";
import { generate } from "lean-qr";

const Q = new URLSearchParams(location.search);
const SHOT = Q.get("shot") || "vote";
const PHONE = Q.get("view") === "phone";
const THEME = Q.get("theme") === "lantern" ? "lantern" : "workshop";
document.body.classList.toggle("phone", PHONE);
document.body.classList.toggle("lantern", THEME === "lantern");

const PIN = "4827";
const JOIN_ADDRESS = "games.n8builds.dev";
const SITE_NAME = "n8 Party";

// Seat colours are the party kit's. The names are the chalkboard names from Cork & Bell.
const SEATS = [
  { name: "Mabel", hex: "#c8382c" },
  { name: "Fitch", hex: "#2f6f8f" },
  { name: "Dolly", hex: "#d9a02a" },
  { name: "Tom", hex: "#3f7a4a" },
];
const NEED = {
  any: { color: "#38bdf8", plate: "Any device" },
  phones: { color: "#b39dfc", plate: "A phone each" },
  screen: { color: "#fbbf24", plate: "Phones + big screen" },
};
const GAMES = [
  { id: "cork", name: "Cork & Bell", need: "any", l1: "1 TO 4", l2: "ANY DEVICE" },
  { id: "who", name: "Who Am I?", need: "phones", l1: "2 PLAYERS", l2: "A PHONE EACH" },
  { id: "tin", name: "Tin Derby", need: "screen", l1: "2 TO 4", l2: "BIG SCREEN", tone: "#e2674e" },
  { id: "flood", name: "Flood", need: "phones", l1: "2 TO 4", l2: "A PHONE EACH", tone: "#3f6fd0" },
];
const SPARE = { id: "fox", name: "Fox Trouble", need: "screen", l1: "2 TO 4", l2: "BIG SCREEN", tone: "#5fae57" };

// ---- The room, in metres. x runs along the stage, y is up, z comes toward the viewer.
const ROOM = { w: 14.2, h: 6.8, zBack: -2.5, zFront: 3.0, fasciaH: 1.6 };
const WALK_Z = 0.6;
const POOL_X = [-4.2, -1.4, 1.4, 4.2];
const POOL_R = 1.0;
const LAMP_Y = 5.25;
const CAM = { y: 4.2, z: 17.5 };
const YOU = 2; // on the phone, the player holding it

// ---- What is happening in each picture.
const STATES = {
  vote: {
    votes: [[0, 1], [], [2], []],
    players: [
      { seat: 0, x: -4.66, face: 0.5 },
      { seat: 1, x: -3.74, face: -0.55, bubble: "hi!" },
      { seat: 2, x: 1.4, face: 0.1 },
      { seat: 3, x: 2.82, face: 0.7, lean: -0.13, y: 0.08 },
    ],
    hint: '<span class="k">Vote</span>Stand in a light to pick that game.',
  },
  countdown: {
    votes: [[], [1], [0, 2, 3], []],
    levels: [0.1, 0.42, 1.55, 0.1],
    winner: 2,
    count: 3,
    players: [
      { seat: 1, x: -1.4, face: 0.7 },
      { seat: 0, x: 0.76, face: 0.35 },
      { seat: 2, x: 1.42, face: 0, y: 0.17, squash: 1.05 },
      { seat: 3, x: 2.06, face: -0.35 },
    ],
    hint: "Step out of the light to stop the count.",
  },
  tie: {
    votes: [[], [0, 3], [1, 2], []],
    levels: [0.06, 0.42, 0.42, 0.06],
    swing: { now: 6.5, ghosts: [2.5, -2.5, -7.5] },
    players: [
      { seat: 0, x: -1.82, face: 0.5 },
      { seat: 3, x: -1.02, face: 0.75 },
      { seat: 1, x: 1.02, face: -0.6 },
      { seat: 2, x: 1.82, face: -0.75 },
    ],
    hint: '<span class="k">Tie 2 - 2</span>The lamp swings and stops on one.',
  },
  shove: {
    votes: [[0], [], [1], [3]],
    going: { pool: 2, seat: 2 },
    players: [
      { seat: 0, x: -4.2, face: 0.6 },
      { seat: 1, x: 1.78, face: 0.7, lean: -0.3, squash: 0.95 },
      { seat: 2, x: 2.62, face: 0.2, lean: -0.36, y: 0.13, bubble: "hey!" },
      { seat: 3, x: 4.2, face: -0.6 },
    ],
    hint: '<span class="k">Vote</span>Stand in a light to pick that game.',
  },
};
const S = STATES[SHOT] || STATES.vote;
const LEVEL_BY_VOTES = [0.16, 0.6, 1.25, 1.45, 1.6];
const levels = S.levels || S.votes.map((v) => LEVEL_BY_VOTES[v.length]);

const T = {
  workshop: {
    light: 0xe6f3ff, accent: 0x38bdf8, hemiSky: 0x7896ea, hemiGround: 0x0a1022, fill: 0xbcd0ff,
    frame: 0x1c2854, panel: 0x101a3c, shade: 0x1d2a56, fascia: 0x060a18, exposure: 1.0,
  },
  lantern: {
    light: 0xffd9a6, accent: 0xf6b35c, hemiSky: 0xb08a72, hemiGround: 0x140b08, fill: 0xffd2b0,
    frame: 0x4a2c1c, panel: 0x241511, shade: 0x7a2f22, fascia: 0x140b08, exposure: 1.0,
  },
}[THEME];

await Promise.all([
  document.fonts.load('400 40px "Abril Fatface"'),
  document.fonts.load('900 40px "Nunito"'),
  document.fonts.load('700 40px "JetBrains Mono"'),
  document.fonts.load('500 40px "JetBrains Mono"'),
  document.fonts.load('700 40px "Inter"'),
  document.fonts.load('600 40px "Inter"'),
  document.fonts.load('800 40px "Inter"'),
]).catch(() => {});

// ---- Camera. It looks straight ahead and the frame is slid down, the way a building is
// photographed: walls stay upright while the floor still opens up toward the viewer.
const W = innerWidth, H = innerHeight;
const D_WALL = CAM.z - ROOM.zBack;
const D_FRONT = CAM.z - ROOM.zFront;
const wallEq = (y, d) => CAM.y + (y - CAM.y) * D_WALL / d; // where a point at distance d lines up on the back wall
const SCREEN_TOP = 6.25, SCREEN_FASCIA = 0.46, PHONE_FASCIA = 0.82;
const halfW = (SCREEN_TOP - wallEq(-SCREEN_FASCIA, D_FRONT)) * (16 / 9) / 2;
const frameH = 2 * halfW * H / W;
const yBot = wallEq(-(PHONE ? PHONE_FASCIA : SCREEN_FASCIA), D_FRONT);
const yTop = yBot + frameH;
const U = W / (2 * halfW);
document.documentElement.style.setProperty("--u", `${U}px`);
document.documentElement.style.setProperty("--t", PHONE ? "1.5" : "1");

const camera = new THREE.PerspectiveCamera();
camera.position.set(0, CAM.y, CAM.z);
camera.updateMatrixWorld();
{
  const n = 1, k = n / D_WALL;
  camera.projectionMatrix.makePerspective(-halfW * k, halfW * k, (yTop - CAM.y) * k, (yBot - CAM.y) * k, n, 90);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
const tmp = new THREE.Vector3();
function px(x, y, z) {
  tmp.set(x, y, z).project(camera);
  return { x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H };
}

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("gl"), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = T.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050c);

// ---- Painted surfaces.
function paint(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}
function speckle(g, w, h, n, alpha) {
  // Deterministic grain so two renders of the same picture match.
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${rnd() * alpha})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}
function wallTexture(metresW, metresH) {
  const k = 150;
  return paint(Math.round(metresW * k), Math.round(metresH * k), (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    if (THEME === "lantern") {
      grad.addColorStop(0, "#150d0b"); grad.addColorStop(0.55, "#2b1913"); grad.addColorStop(1, "#22130e");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // Tongue-and-groove boards.
      const board = 0.3 * k;
      for (let x = 0, i = 0; x < w; x += board, i++) {
        g.fillStyle = `rgba(255,200,150,${0.012 + (i * 37 % 5) * 0.008})`;
        g.fillRect(x, 0, board - 2, h);
        g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(x + board - 2, 0, 2, h);
      }
      // Painted dado: dark green below the rail.
      const dado = h - 1.25 * k;
      g.fillStyle = "rgba(18,50,44,.78)"; g.fillRect(0, dado, w, h - dado);
      g.fillStyle = "#b9853f"; g.fillRect(0, dado - 5, w, 5);
      speckle(g, w, h, 5000, 0.05);
      return;
    }
    grad.addColorStop(0, "#060a1a"); grad.addColorStop(0.5, "#0e1a40"); grad.addColorStop(1, "#0e1a40");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    // Wainscot: a panelled band below one lit rail, a shade lighter than the wall.
    const dado = h - 1.25 * k;
    const panel = g.createLinearGradient(0, dado, 0, h);
    panel.addColorStop(0, "#16255a"); panel.addColorStop(1, "#101c48");
    g.fillStyle = panel; g.fillRect(0, dado, w, h - dado);
    // The lit grid: half-metre squares, every second line a touch stronger.
    const step = 0.5 * k;
    for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) {
      g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`; g.fillRect(Math.round(x), 0, 1.5, h);
    }
    for (let y = h, i = 0; y > 0; y -= step, i++) {
      g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`; g.fillRect(0, Math.round(y), w, 1.5);
    }
    g.fillStyle = "rgba(96,200,255,.75)"; g.fillRect(0, dado - 3, w, 3);
    const glow = g.createLinearGradient(0, dado - 46, 0, dado + 46);
    glow.addColorStop(0, "rgba(56,189,248,0)"); glow.addColorStop(0.5, "rgba(56,189,248,.13)"); glow.addColorStop(1, "rgba(56,189,248,0)");
    g.fillStyle = glow; g.fillRect(0, dado - 46, w, 92);
    speckle(g, w, h, 4000, 0.03);
  });
}
function floorTexture() {
  const k = 150, mw = ROOM.w, md = ROOM.zFront - ROOM.zBack;
  return paint(Math.round(mw * k), Math.round(md * k), (g, w, h) => {
    if (THEME === "lantern") {
      g.fillStyle = "#4a3020"; g.fillRect(0, 0, w, h);
      const plank = 0.22 * k;
      for (let y = 0, i = 0; y < h; y += plank, i++) {
        g.fillStyle = `rgba(${i % 2 ? "255,210,160" : "0,0,0"},${0.03 + (i * 13 % 4) * 0.02})`;
        g.fillRect(0, y, w, plank - 2);
        g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(0, y + plank - 2, w, 2);
        for (let x = ((i * 733) % 400); x < w; x += 2.4 * k) { g.fillRect(x, y, 2, plank); }
      }
      speckle(g, w, h, 9000, 0.06);
      return;
    }
    g.fillStyle = "#1b2748"; g.fillRect(0, 0, w, h);
    const step = 0.5 * k;
    for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) {
      g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`; g.fillRect(Math.round(x), 0, 2, h);
    }
    for (let y = 0, i = 0; y < h; y += step, i++) {
      g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`; g.fillRect(0, Math.round(y), w, 2);
    }
    speckle(g, w, h, 9000, 0.035);
  });
}
function radialTexture() {
  return paint(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.5)"); r.addColorStop(0.6, "rgba(255,255,255,.12)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  });
}
const RADIAL = radialTexture();
// A pool of light: nearly even across, a touch dimmer toward its edge, then a clean stop.
const POOL = paint(256, 256, (g) => {
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.55, "rgba(255,255,255,.8)"); r.addColorStop(0.9, "rgba(255,255,255,.42)"); r.addColorStop(0.985, "rgba(255,255,255,.3)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
});

// ---- Box art, in the landing page's style: a printed strip says what you need.
function needIcon(g, kind, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.lineWidth = 5; g.strokeStyle = "#06101f"; g.fillStyle = "#06101f"; g.lineJoin = "round";
  const rr = (X, Y, w, h, r) => { g.beginPath(); g.roundRect(X, Y, w, h, r); g.stroke(); };
  if (kind === "any") { rr(0, 6, 18, 34, 4); rr(26, 4, 44, 28, 4); g.fillRect(22, 36, 52, 5); }
  if (kind === "phones") { rr(0, 4, 18, 34, 4); rr(26, 4, 18, 34, 4); rr(52, 4, 18, 34, 4); }
  if (kind === "screen") { rr(6, 0, 58, 26, 4); for (const X of [10, 29, 48]) { g.beginPath(); g.roundRect(X, 32, 12, 12, 3); g.fill(); } }
  g.restore();
}
async function boxTexture(game) {
  let img = null;
  if (game.id === "cork") {
    img = new Image();
    img.src = "/cork-and-bell/docs/shots/01-stall.jpg";
    await img.decode().catch(() => { img = null; });
  }
  return paint(600, 840, (g, w, h) => {
    const stripY = 706;
    if (game.id === "cork") {
      g.fillStyle = "#6d1512"; g.fillRect(0, 0, w, h);
      if (img) {
        const top = 150, ah = stripY - top, scale = Math.max(w / img.width, ah / img.height);
        const sw = w / scale, sh = ah / scale;
        g.drawImage(img, (img.width - sw) * 0.5, (img.height - sh) * 0.35, sw, sh, 0, top, w, ah);
      }
      g.fillStyle = "#f3d9a4"; g.font = '400 92px "Abril Fatface", serif'; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("Cork & Bell", w / 2, 80);
    } else if (game.id === "who") {
      g.fillStyle = "#fff6ea"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#33238a"; g.beginPath(); g.roundRect(170, 150, 260, 276, 62); g.fill();
      g.fillStyle = "#4a35b5"; g.beginPath(); g.roundRect(170, 134, 260, 260, 62); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(300, 264, 82, 0, 7); g.fill();
      g.fillStyle = "#4a35b5"; g.font = '900 120px "Nunito", sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("?", 300, 272);
      g.fillStyle = "#1d1830"; g.font = '900 92px "Nunito", sans-serif';
      g.fillText("Who Am I?", w / 2, 560);
    } else {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#27305e"); grad.addColorStop(1, "#141b3c");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.16; g.fillStyle = game.tone; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
      // The typed sticker of a prototype box.
      g.save(); g.translate(w / 2, 350); g.rotate(-0.035);
      g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 24; g.shadowOffsetY = 10;
      g.fillStyle = "#f3ead6"; g.fillRect(-235, -150, 470, 300);
      g.shadowColor = "transparent";
      g.fillStyle = game.tone; g.fillRect(-235, -150, 470, 16);
      g.fillStyle = "#6d6450"; g.font = '500 30px "JetBrains Mono", monospace'; g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillText("P R O T O T Y P E", -200, -72);
      g.fillStyle = "#1b1a17"; g.font = '700 76px "JetBrains Mono", monospace';
      const words = game.name.split(" ");
      if (words.length > 1 && game.name.length > 9) { g.fillText(words[0], -200, 14); g.fillText(words.slice(1).join(" "), -200, 100); }
      else g.fillText(game.name, -200, 50);
      g.restore();
    }
    g.fillStyle = NEED[game.need].color; g.fillRect(0, stripY, w, h - stripY);
    needIcon(g, game.need, 44, stripY + 28, 1.75);
    g.fillStyle = "#06101f"; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = '700 44px "JetBrains Mono", monospace';
    g.fillText(game.l1, 196, stripY + 58);
    g.fillText(game.l2, 196, stripY + 108);
    // A soft printed edge.
    g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
}
const BOX_W = 1.2, BOX_H = 1.68, BOX_D = 0.34;
function makeBox(tex, game, glow) {
  const side = new THREE.Color(game.id === "cork" ? "#4a0e0c" : game.id === "who" ? "#cfc4b2" : "#161d40");
  const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.7 });
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow });
  const m = new THREE.Mesh(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), [sideMat, sideMat, sideMat, sideMat, front, sideMat]);
  m.userData.front = front;
  return m;
}

// ---- Room shell.
const wallMat = new THREE.MeshBasicMaterial({ map: wallTexture(ROOM.w, ROOM.h) });
const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), wallMat);
back.position.set(0, ROOM.h / 2, ROOM.zBack);
scene.add(back);
const sideTex = wallTexture(ROOM.zFront - ROOM.zBack, ROOM.h);
for (const sgn of [-1, 1]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.zFront - ROOM.zBack, ROOM.h), new THREE.MeshBasicMaterial({ map: sideTex, color: 0x9aa4c4 }));
  m.position.set(sgn * ROOM.w / 2, ROOM.h / 2, (ROOM.zFront + ROOM.zBack) / 2);
  m.rotation.y = -sgn * Math.PI / 2;
  scene.add(m);
}
const FLOOR_TEX = floorTexture();
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM.w, ROOM.zFront - ROOM.zBack),
  new THREE.MeshStandardMaterial({ map: FLOOR_TEX, roughness: 0.78, metalness: 0.0, emissive: 0xffffff, emissiveMap: FLOOR_TEX, emissiveIntensity: 0.22 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, (ROOM.zFront + ROOM.zBack) / 2);
floor.receiveShadow = true;
scene.add(floor);
// The front of the stage, and the lit edge along it.
const fascia = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w + 8, ROOM.fasciaH), new THREE.MeshBasicMaterial({ color: T.fascia }));
fascia.position.set(0, -ROOM.fasciaH / 2, ROOM.zFront);
scene.add(fascia);
const lip = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 8, 0.022, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent).multiplyScalar(0.55) }));
lip.position.set(0, -0.02, ROOM.zFront + 0.02);
scene.add(lip);
// Skirting line where wall meets floor.
const skirt = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.4 }));
skirt.position.set(0, 0.03, ROOM.zBack + 0.02);
scene.add(skirt);

scene.add(new THREE.HemisphereLight(T.hemiSky, T.hemiGround, THEME === "lantern" ? 1.0 : 1.25));
const fill = new THREE.DirectionalLight(T.fill, 1.25);
fill.position.set(-3, 5, 14);
scene.add(fill);

// ---- Lamps, cones and pools.
const coneMat = (strength, color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uStrength: { value: strength }, uColor: { value: new THREE.Color(color) } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
    void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
      float along = mix(0.55, 1.0, vH) * smoothstep(0.0, 0.1, vH);
      gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
});
function makeLampHead(level, opacity = 1) {
  const g = new THREE.Group();
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.36, 0.3, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: T.shade, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide, transparent: opacity < 1, opacity }),
  );
  shade.position.y = 0.15;
  g.add(shade);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 20), shade.material);
  cap.position.y = 0.36;
  g.add(cap);
  const bright = Math.min(1, 0.25 + level * 0.7) * opacity;
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.light).multiplyScalar(bright * 1.6), transparent: opacity < 1, opacity }));
  bulb.rotation.x = Math.PI / 2;
  bulb.position.y = 0.03;
  g.add(bulb);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: T.light, blending: THREE.AdditiveBlending, depthWrite: false, opacity: (0.18 + 0.5 * Math.min(level, 1.3)) * opacity }));
  halo.scale.setScalar(1.1 + level * 0.9);
  halo.position.y = 0.02;
  g.add(halo);
  return g;
}
const cordMat = new THREE.MeshBasicMaterial({ color: THEME === "lantern" ? 0x1a0f0b : 0x0a1024 });
function addPool(i) {
  const x = POOL_X[i], level = levels[i];
  const head = makeLampHead(level);
  head.position.set(x, LAMP_Y, WALK_Z);
  scene.add(head);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 3, 8), cordMat);
  cord.position.set(x, LAMP_Y + 0.4 + 1.5, WALK_Z);
  scene.add(cord);

  const spot = new THREE.SpotLight(T.light, 2.2 + 5.2 * level, 0, Math.atan((POOL_R + 0.04) / LAMP_Y), 0.3, 0);
  spot.position.set(x, LAMP_Y, WALK_Z);
  spot.target.position.set(x, 0, WALK_Z);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0008;
  spot.shadow.radius = 5;
  scene.add(spot, spot.target);
  // A little light thrown back up from the floor, so faces are not black under a top light.
  const bounce = new THREE.PointLight(T.light, 1.5 * level, 4.5, 1.2);
  bounce.position.set(x, 0.5, WALK_Z + 1.9);
  scene.add(bounce);

  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, POOL_R, LAMP_Y, 64, 1, true), coneMat(Math.min(0.16, 0.03 + 0.105 * level), T.light));
  cone.position.set(x, LAMP_Y / 2, WALK_Z);
  scene.add(cone);

  // The pool itself: a clear edge, so "in" and "out" are never in doubt.
  const ring = new THREE.Mesh(new THREE.RingGeometry(POOL_R - 0.018, POOL_R + 0.018, 96), new THREE.MeshBasicMaterial({ color: T.light, transparent: true, opacity: 0.16 + 0.34 * Math.min(level, 1.2), blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.006, WALK_Z);
  scene.add(ring);
  const wash = new THREE.Mesh(new THREE.CircleGeometry(POOL_R, 96), new THREE.MeshBasicMaterial({ map: POOL, color: T.light, transparent: true, opacity: Math.min(0.8, 0.05 + 0.44 * level), blending: THREE.AdditiveBlending, depthWrite: false }));
  wash.rotation.x = -Math.PI / 2;
  wash.position.set(x, 0.004, WALK_Z);
  scene.add(wash);
  // Light spilling up the wall behind a bright pool.
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.4), new THREE.MeshBasicMaterial({ map: RADIAL, color: T.light, transparent: true, opacity: 0.11 * level, blending: THREE.AdditiveBlending, depthWrite: false }));
  spill.position.set(x, 0.1, ROOM.zBack + 0.03);
  scene.add(spill);
}
POOL_X.forEach((_, i) => addPool(i));

// ---- The four spots on the wall: a lit recess with the game's box in it.
const NICHE = { w: 1.55, h: 1.95, y: 3.0, d: 0.44 };
const frameMat = new THREE.MeshStandardMaterial({ color: T.frame, roughness: 0.6 });
const textures = await Promise.all([...GAMES, SPARE].map(boxTexture));
function addNiche(i) {
  const x = POOL_X[i];
  const lead = S.winner === i;
  const off = S.winner !== undefined && !lead;
  const g = new THREE.Group();
  g.position.set(x, NICHE.y, ROOM.zBack);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w, NICHE.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.panel).multiplyScalar(off ? 0.6 : lead ? 2.0 : 1.25) }));
  inner.position.z = 0.012;
  g.add(inner);
  const bar = 0.07;
  for (const [w, h, X, Y] of [[bar, NICHE.h + bar * 2, -NICHE.w / 2 - bar / 2, 0], [bar, NICHE.h + bar * 2, NICHE.w / 2 + bar / 2, 0], [NICHE.w, bar, 0, NICHE.h / 2 + bar / 2], [NICHE.w, bar, 0, -NICHE.h / 2 - bar / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, NICHE.d), frameMat);
    m.position.set(X, Y, NICHE.d / 2);
    g.add(m);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(NICHE.w - 0.2, 0.035, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.light).multiplyScalar(off ? 0.25 : lead ? 1.6 : 0.9) }));
  strip.position.set(0, NICHE.h / 2 - 0.03, NICHE.d - 0.06);
  g.add(strip);
  const box = makeBox(textures[i], GAMES[i], off ? 0.2 : lead ? 0.95 : 0.6);
  box.position.set(0, -NICHE.h / 2 + BOX_H / 2 + 0.005, 0.24);
  box.rotation.y = -Math.sign(x) * 0.1;
  if (lead) { box.position.y += 0.07; box.position.z += 0.1; box.scale.setScalar(1.05); }
  g.add(box);
  scene.add(g);
}
POOL_X.forEach((_, i) => addNiche(i));

// ---- Left end: the door latecomers come through. Right end: the shelf where the fifth game waits.
{
  const x = -6.15, w = 1.0, h = 2.25;
  const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshStandardMaterial({ color: THEME === "lantern" ? 0x2a5a4e : 0x22336e, roughness: 0.55 }));
  door.position.set(x, h / 2, ROOM.zBack + 0.04);
  scene.add(door);
  for (const [bw, bh, X, Y] of [[0.08, h + 0.08, -w / 2 - 0.04, h / 2 + 0.04], [0.08, h + 0.08, w / 2 + 0.04, h / 2 + 0.04], [w + 0.16, 0.08, 0, h + 0.04]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), frameMat);
    m.position.set(x + X, Y, ROOM.zBack + 0.06);
    scene.add(m);
  }
  const warm = new THREE.Color(0xffc777);
  const port = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.MeshBasicMaterial({ color: warm }));
  port.position.set(x, 1.62, ROOM.zBack + 0.075);
  scene.add(port);
  const portRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.175, 40), frameMat);
  portRing.position.copy(port.position); portRing.position.z += 0.002;
  scene.add(portRing);
  const portGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: warm, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22 }));
  portGlow.scale.setScalar(1.2); portGlow.position.set(x, 1.62, ROOM.zBack + 0.1);
  scene.add(portGlow);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 0.7 }));
  knob.position.set(x + 0.36, 1.05, ROOM.zBack + 0.1);
  scene.add(knob);
  const sill = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, 0.03), new THREE.MeshBasicMaterial({ color: warm }));
  sill.position.set(x, 0.02, ROOM.zBack + 0.075);
  scene.add(sill);
}
{
  const x = 6.15, y = 2.28;
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.07, 0.5), new THREE.MeshBasicMaterial({ color: THEME === "lantern" ? 0x6a4028 : 0x2a3a78 }));
  plank.position.set(x, y, ROOM.zBack + 0.25);
  scene.add(plank);
  for (const dx of [-0.55, 0.55]) {
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.4), frameMat);
    br.position.set(x + dx, y - 0.18, ROOM.zBack + 0.2);
    scene.add(br);
  }
  const fox = makeBox(textures[4], SPARE, 0.2);
  fox.scale.setScalar(0.8);
  fox.position.set(x - 0.08, y + 0.03 + BOX_H * 0.4, ROOM.zBack + 0.25);
  fox.rotation.y = -0.3;
  scene.add(fox);
}

// ---- Lantern mood only: a string of bulbs, as over the Cork & Bell stall.
if (THEME === "lantern") {
  const n = 23;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = (t - 0.5) * (ROOM.w - 0.6);
    const sag = Math.pow((t * 4) % 1 - 0.5, 2) * 1.5;
    const y = 5.5 + sag, z = ROOM.zBack + 0.5;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(1.6) }));
    bulb.position.set(x, y, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    glow.scale.setScalar(0.75); glow.position.set(x, y, z + 0.02);
    scene.add(bulb, glow);
  }
}

// ---- Characters. A plain playing piece in the seat colour: the place a skin goes later.
const PAWN_H = 1.12;
const pawnProfile = [[0, 0], [0.29, 0], [0.325, 0.03], [0.33, 0.08], [0.3, 0.13], [0.235, 0.24], [0.185, 0.4], [0.15, 0.56], [0.145, 0.61], [0.2, 0.645], [0.205, 0.68], [0.15, 0.715], [0, 0.72]].map(([x, y]) => new THREE.Vector2(x, y));
const pawnBody = new THREE.LatheGeometry(pawnProfile, 56);
const pawnHead = new THREE.SphereGeometry(0.215, 40, 28);
const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.25 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
function makePawn(hex, face) {
  const c = new THREE.Color(hex);
  const mat = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25, emissive: c, emissiveIntensity: 0.3 });
  const turn = new THREE.Group();
  const body = new THREE.Mesh(pawnBody, mat);
  const head = new THREE.Mesh(pawnHead, mat);
  head.position.y = 0.9;
  body.castShadow = head.castShadow = true;
  turn.add(body, head);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(0.034, 0.052, 0.02);
    const a = s * 0.33;
    eye.position.set(Math.sin(a) * 0.205, 0.925, Math.cos(a) * 0.205);
    eye.rotation.y = a;
    const glint = new THREE.Mesh(eyeGeo, glintMat);
    glint.scale.set(0.011, 0.013, 0.008);
    glint.position.set(Math.sin(a + 0.03) * 0.219, 0.946, Math.cos(a + 0.03) * 0.219);
    turn.add(eye);
    // The glint is left off an eye that has turned to the edge of the head, where it would float.
    if (Math.abs(face + a) < 0.8) turn.add(glint);
  }
  const tilt = new THREE.Group();
  tilt.add(turn);
  tilt.userData.turn = turn;
  return tilt;
}
const blobMat = new THREE.MeshBasicMaterial({ map: RADIAL, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
for (const p of S.players) {
  const pawn = makePawn(SEATS[p.seat].hex, p.face || 0);
  pawn.position.set(p.x, p.y || 0, WALK_Z);
  pawn.rotation.z = p.lean || 0;
  pawn.userData.turn.rotation.y = p.face || 0;
  if (p.squash) pawn.scale.set(1 / Math.sqrt(p.squash), p.squash, 1 / Math.sqrt(p.squash));
  scene.add(pawn);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(p.x, 0.008, WALK_Z);
  blob.scale.setScalar(1 - (p.y || 0) * 0.8);
  scene.add(blob);
  if (PHONE && p.seat === YOU) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.5, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.012, WALK_Z);
    scene.add(ring);
  }
}

// ---- The tie-break lamp: one lamp on a long cord, swinging between the two tied pools.
const PIVOT_Y = 7.4, SWING_L = 2.75;
function swingHead(deg) {
  const a = deg * Math.PI / 180;
  return { a, x: Math.sin(a) * SWING_L, y: PIVOT_Y - Math.cos(a) * SWING_L, fx: Math.tan(a) * PIVOT_Y };
}
if (S.swing) {
  const all = [{ deg: S.swing.now, o: 1 }, ...S.swing.ghosts.map((deg, i) => ({ deg, o: 0.34 - i * 0.1 }))];
  for (const { deg, o } of all) {
    const h = swingHead(deg);
    const arm = new THREE.Group();
    arm.position.set(0, PIVOT_Y, WALK_Z);
    arm.rotation.z = h.a;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, SWING_L - 0.4, 8), new THREE.MeshBasicMaterial({ color: cordMat.color, transparent: o < 1, opacity: Math.min(1, o * 1.6) }));
    cord.position.y = -(SWING_L - 0.4) / 2;
    const head = makeLampHead(1.3, o);
    head.position.y = -SWING_L;
    const reach = PIVOT_Y / Math.cos(h.a) - SWING_L;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.92, reach, 64, 1, true), coneMat(0.2 * o * o + 0.012, T.light));
    cone.position.y = -SWING_L - reach / 2;
    arm.add(cord, head, cone);
    scene.add(arm);
    // Where the light falls now, and the fading trail of where it has just been.
    const wash = new THREE.Mesh(new THREE.CircleGeometry(0.92, 64), new THREE.MeshBasicMaterial({ map: POOL, color: T.light, transparent: true, opacity: o === 1 ? 0.5 : o * 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    wash.rotation.x = -Math.PI / 2;
    wash.position.set(h.fx, 0.005, WALK_Z);
    scene.add(wash);
    if (o === 1) {
      const spot = new THREE.SpotLight(T.light, 3.5, 0, Math.atan(0.92 / reach), 0.35, 0);
      spot.position.set(h.x, h.y, WALK_Z);
      spot.target.position.set(h.fx, 0, WALK_Z);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0008;
      scene.add(spot, spot.target);
    }
  }
}

renderer.render(scene, camera);

// ---- Words and marks, laid over the render from the same camera.
const over = document.getElementById("over");
function put(cls, html, at, extra = "") {
  const el = document.createElement("div");
  el.className = `at ${cls}`;
  el.innerHTML = html;
  el.style.cssText = `left:${at.x.toFixed(1)}px;top:${at.y.toFixed(1)}px;${extra}`;
  over.append(el);
  return el;
}

// Plates under the boxes.
GAMES.forEach((game, i) => {
  const votes = S.votes[i];
  const pips = [0, 1, 2, 3].map((k) => {
    const seat = votes[k];
    if (seat !== undefined) return `<i class="on" style="--seat:${SEATS[seat].hex}"></i>`;
    if (S.going && S.going.pool === i && k === votes.length) return `<i class="going" style="--seat:${SEATS[S.going.seat].hex}"></i>`;
    return "<i></i>";
  }).join("");
  const state = S.winner === i ? "lead" : S.winner !== undefined ? "off" : "";
  put(`plate down ${state}`, `<b>${game.name.replace("&", "&amp;")}</b><span class="pips">${pips}</span><span class="need" style="--need:${NEED[game.need].color}">${NEED[game.need].plate}</span>`,
    px(POOL_X[i], NICHE.y - NICHE.h / 2 - 0.13, ROOM.zBack));
});

// Name tags.
for (const p of S.players) {
  const seat = SEATS[p.seat];
  const you = PHONE && p.seat === YOU;
  const top = (p.y || 0) + PAWN_H * (p.squash || 1) + (you ? 0.3 : 0.2);
  const leanShift = -(p.lean || 0) * 1.0;
  const inLight = S.votes.some((v) => v.includes(p.seat));
  put(`tag up ${you ? "you" : ""} ${inLight ? "" : "dimmed"}`, `<i style="--seat:${seat.hex}"></i>${you ? "You" : seat.name}${p.bubble ? `<span class="bubble">${p.bubble}</span>` : ""}`, px(p.x + leanShift, top, WALK_Z));
}

// The join sign over the door.
{
  const code = generate(`https://${JOIN_ADDRESS}/?join=${PIN}`);
  const n = code.size, q = 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.get(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
  put("join", `<small>Join in</small><svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><path d="${d}" fill="#060a16"/></svg><div class="pin">${PIN}</div><div class="addr">${JOIN_ADDRESS}</div>`,
    px(-6.15, PHONE ? 2.95 : 3.42, ROOM.zBack));
}
put("shelf-tag down", `On the shelf<b>${SPARE.name}</b>`, px(6.15, 1.9, ROOM.zBack));

// The countdown.
if (S.count) {
  const r = 46, c = 2 * Math.PI * r, left = 0.62;
  put("dial", `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="rgba(5,9,22,.55)" stroke="rgba(150,175,235,.22)" stroke-width="2.4"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--accent)" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${(c * left).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)" style="filter:drop-shadow(0 0 3px var(--accent))"/></svg>
    <div class="what">${GAMES[S.winner].name}</div><div class="num">${S.count}</div>`, px(0, 5.12, ROOM.zBack));
}

// The front of the stage.
{
  const edge = px(0, 0, ROOM.zFront).y;
  const el = document.createElement("div");
  el.className = "fascia";
  el.style.height = `${(H - edge).toFixed(1)}px`;
  if (PHONE) {
    const mine = S.votes.findIndex((v) => v.includes(YOU));
    const arrow = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    el.innerHTML = `<div class="pad"><div class="key">${arrow("M15 5l-7 7 7 7")}</div><div class="key">${arrow("M9 5l7 7-7 7")}</div></div>
      <div class="mine"><small>Your vote</small><b><i style="--seat:${SEATS[YOU].hex}"></i>${mine < 0 ? "Not yet" : GAMES[mine].name}</b><span>party ${PIN}</span></div>
      <div class="pad"><div class="key small"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10.5h-9l-4.5 3.6V16H4z"/><path d="M9 9.2v.6M15 9.2v.6M9 12.2c1.8 1.5 4.2 1.5 6 0"/></svg></div><div class="key jump">${arrow("M5 14l7-7 7 7")}</div></div>`;
  } else {
    el.innerHTML = `<div class="brand"><i></i>${SITE_NAME}</div><div class="hint">${S.hint}</div><div class="here">Party ${PIN} · ${S.players.length} here</div>`;
  }
  over.append(el);
}

// ---- Hand-drawn marks for motion: the shove, and the path of the swinging lamp.
const fx = document.getElementById("fx");
fx.setAttribute("viewBox", `0 0 ${W} ${H}`);
const k = U / 127;
function mark(d, stroke, width, opacity, dash = "") {
  fx.insertAdjacentHTML("beforeend", `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${(width * k).toFixed(2)}" stroke-linecap="round" opacity="${opacity}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`);
}
if (SHOT === "shove") {
  const a = S.players[1], b = S.players[2];
  // Speed lines behind the one who shoves, fading out behind.
  fx.insertAdjacentHTML("beforeend", `<defs><linearGradient id="streak" x1="1" x2="0"><stop offset="0" stop-color="#eaf2ff" stop-opacity=".85"/><stop offset="1" stop-color="#eaf2ff" stop-opacity="0"/></linearGradient></defs>`);
  for (const [y, start, len, h] of [[0.98, 0.42, 0.7, 5], [0.7, 0.5, 1.15, 7], [0.42, 0.52, 0.85, 5], [0.16, 0.5, 0.5, 4]]) {
    const p1 = px(a.x - start, y, WALK_Z), p2 = px(a.x - start - len, y, WALK_Z);
    fx.insertAdjacentHTML("beforeend", `<rect x="${p2.x}" y="${p1.y - h * k / 2}" width="${p1.x - p2.x}" height="${h * k}" rx="${h * k / 2}" fill="url(#streak)"/>`);
  }
  // The bump.
  const hit = px((a.x + b.x) / 2 + 0.1, 0.5, WALK_Z);
  for (let i = 0; i < 7; i++) {
    const ang = -Math.PI / 2 + (i - 3) * 0.42, r1 = 16 * k, r2 = (i % 2 ? 30 : 42) * k;
    mark(`M${hit.x + Math.cos(ang) * r1} ${hit.y + Math.sin(ang) * r1}L${hit.x + Math.cos(ang) * r2} ${hit.y + Math.sin(ang) * r2}`, "#ffffff", 4.5, 0.95);
  }
}
if (S.swing) {
  // Painted on the floor in front of the two tied pools: the light goes back and forth between them.
  const z = WALK_Z + POOL_R + 0.45, x0 = POOL_X[1] + 0.25, x1 = POOL_X[2] - 0.25;
  const a = px(x0, 0.01, z), b = px(x1, 0.01, z);
  mark(`M${a.x} ${a.y}L${b.x} ${b.y}`, "#dcebff", 3, 0.7, `${3 * k} ${12 * k}`);
  for (const [x, dir] of [[x0, 1], [x1, -1]]) {
    const tip = px(x - dir * 0.14, 0.01, z), up = px(x + dir * 0.08, 0.01, z - 0.3), dn = px(x + dir * 0.08, 0.01, z + 0.26);
    mark(`M${up.x} ${up.y}L${tip.x} ${tip.y}L${dn.x} ${dn.y}`, "#ffffff", 3.5, 0.9);
  }
}

document.documentElement.dataset.ready = "1";
