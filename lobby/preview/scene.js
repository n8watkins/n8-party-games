// The lobby concept stills, round two. One 3D room, posed by ?shot= and framed by ?view=.
//   ?shot=vote | count | bell | tie | bump | skins | scores    which moment
//   ?view=screen | phone                                       big screen (16:9) or a phone held sideways
//   ?room=bar | tech                                           room skin (the warm bar is the lead look)
// Nothing here is playable: every pose is written down in STATES below.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { generate } from "lean-qr";

const Q = new URLSearchParams(location.search);
const SHOT = Q.get("shot") || "vote";
const PHONE = Q.get("view") === "phone";
const ROOM_SKIN = Q.get("room") === "tech" ? "tech" : "bar";
const BAR = ROOM_SKIN === "bar";
document.body.classList.toggle("phone", PHONE);
document.body.classList.toggle("tech", !BAR);

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
  screen: { color: "#fbbf24", plate: PHONE ? "Phones + big screen" : "Phones + this screen" },
};
// The one-line descriptions are placeholders for the three games that are not built yet.
const GAMES = [
  { id: "cork", name: "Cork & Bell", about: "Pop the targets, ring the bell", need: "any", seats: "1-4 players" },
  { id: "who", name: "Who Am I?", about: "Ask questions, guess your name", need: "phones", seats: "2 players" },
  { id: "tin", name: "Tin Derby", about: "Wind up your tin racer and go", need: "screen", seats: "2-4 players" },
  { id: "flood", name: "Flood", about: "Climb before the water rises", need: "phones", seats: "2-4 players" },
];
const SPARE = { id: "fox", name: "Fox Trouble", need: "screen" };
// The night so far: three games played, 3 points for first, 2 for second, 1 for third.
const SCORES = [
  { seat: 2, pts: 7, last: 3 },
  { seat: 0, pts: 5, last: 1 },
  { seat: 3, pts: 4, last: 2 },
  { seat: 1, pts: 2, last: 0 },
];

// ---- The room, in metres. x runs along the stage, y is up, z comes toward the viewer.
const ROOM = { w: 14.2, h: 6.8, zBack: -2.5, zFront: 3.0, fasciaH: 1.6 };
const WALK_Z = 0.6;
const POOL_X = [-3.9, -1.3, 1.3, 3.9];
const POOL_R = 0.95;
const LAMP_Y = 5.25;
const CAM = { y: 4.2, z: 17.5 };
const END_X = 6.05;  // the door and join sign at the left end, the scores and the shelf at the right end
const YOU = 2;       // on the phone, the player holding it
const CH = 0.78;     // character scale: round two's characters are smaller, the boxes larger
const BOX_W = 1.75, BOX_H = 2.45, BOX_D = 0.3, BOX_Y = 3.83;
const BELL_DX = 0.84; // the bell rope hangs this far from the middle of its light

const who = (seat) => `<span class="who"><i style="--seat:${SEATS[seat].hex}"></i>${SEATS[seat].name}</span>`;

// ---- What is happening in each picture.
const STATES = {
  vote: {
    votes: [[0, 1], [], [2], []],
    players: [
      { seat: 0, x: -4.32, face: 0.5 },
      { seat: 1, x: -3.45, face: -0.55, bubble: "hi!" },
      { seat: 2, x: 1.3, face: 0.1 },
      { seat: 3, x: 2.6, face: 0.7, lean: -0.1, y: 0.06, bubble: "hmm..." },
    ],
    hint: `<span class="k">Vote</span>Stand in a light to pick that game.<span class="soft">Waiting for ${who(3)}</span>`,
    mine: "Waiting for Tom",
  },
  count: {
    votes: [[], [1], [0, 2, 3], []],
    levels: [0.1, 0.42, 1.5, 0.1],
    winner: 2,
    count: 3,
    players: [
      { seat: 1, x: -1.3, face: 0.7, bubble: "fine..." },
      { seat: 0, x: 0.72, face: 0.35 },
      { seat: 2, x: 1.34, face: 0, y: 0.2, squash: 1.05 },
      { seat: 3, x: 1.94, face: -0.35 },
    ],
    hint: `<span class="k">Everyone is in a light</span>Tin Derby starts in 3.<span class="soft">Step out of your light to stop the count.</span>`,
  },
  bell: {
    votes: [[], [1], [0, 2, 3], []],
    levels: [0.1, 0.42, 1.5, 0.1],
    winner: 2,
    bell: 2,
    players: [
      { seat: 1, x: -1.3, face: 0.7 },
      { seat: 0, x: 0.66, face: 0.6 },
      { seat: 3, x: 1.28, face: 0.75 },
      { seat: 2, x: POOL_X[2] + BELL_DX, face: 0.1, y: 0.4, squash: 1.07, tagAt: [0.62, 0.42] },
    ],
    hint: `<span class="k">Everyone is in a light</span>Tin Derby leads 3 to 1.<span class="soft">Nothing starts until someone in that light rings the bell.</span>`,
  },
  tie: {
    votes: [[], [0, 3], [1, 2], []],
    levels: [0.06, 0.6, 0.6, 0.06],
    tied: [1, 2],
    players: [
      { seat: 0, x: -1.78, face: 0.6 },
      { seat: 3, x: -1.0, face: 0.8 },
      { seat: 1, x: 1.0, face: -0.8 },
      { seat: 2, x: 1.78, face: -0.6 },
    ],
    hint: `<span class="k">Tie, 2 each</span>A coin toss picks.<span class="soft">Heads is Who Am I?, tails is Tin Derby.</span>`,
  },
  bump: {
    votes: [[0], [], [1], [3]],
    players: [
      { seat: 0, x: -3.9, face: 0.7 },
      { seat: 1, x: 1.52, face: 0.75, lean: -0.3, squash: 0.95 },
      { seat: 2, x: 2.72, face: 0.25, lean: -0.75, y: 0.5, bubble: "hey!", shock: true },
      { seat: 3, x: 4.2, face: -0.7 },
    ],
    hint: `<span class="k">Bump</span>Run into someone to knock them out of their light.<span class="soft">${who(2)} has to walk back in.</span>`,
  },
  skins: {
    votes: [[0], [1, 2], [], [3]],
    players: [
      { seat: 0, x: -3.9, face: 0.2, y: 0.4, squash: 1.06, skin: "pawn", note: "Hops higher", name: "Chess piece" },
      { seat: 1, x: -2.2, face: 1.1, skin: "robot", arm: 0.62, note: "Shoves farther", name: "Robot" },
      { seat: 2, x: -0.82, face: -0.35, lean: -0.06, squash: 0.92, skin: "slime", note: "Hard to shove", name: "Slime" },
      { seat: 3, x: 3.7, face: -0.3, y: 0.3, skin: "ghost", note: "Floats, lands softly", name: "Ghost" },
    ],
    hint: `<span class="k">Skins</span>Pick any look. Each one has its own trick for messing with the vote.`,
  },
  scores: {
    votes: [[], [], [], []],
    levels: [0.3, 0.3, 0.3, 0.3],
    bigBoard: true,
    players: [
      { seat: 0, x: -3.5, face: 0.75 },
      { seat: 3, x: -2.2, face: 0.9 },
      { seat: 2, x: 0, face: 0, crown: true },
      { seat: 1, x: 3.1, face: -0.85, lean: 0.08, bubble: "rematch!" },
    ],
    hint: `<span class="k">Tin Derby is done</span>${who(2)} won it and leads the night.<span class="soft">The next vote opens in a moment.</span>`,
  },
};
const S = STATES[SHOT] || STATES.vote;
const LEVEL_BY_VOTES = [0.16, 0.6, 1.2, 1.4, 1.55];
const levels = S.levels || S.votes.map((v) => LEVEL_BY_VOTES[v.length]);
const isLead = (i) => S.winner === i || (S.tied && S.tied.includes(i));
const isOff = (i) => (S.winner !== undefined || S.tied) && !isLead(i);

const T = {
  tech: {
    light: 0xe6f3ff, accent: 0x38bdf8, hemiSky: 0x7896ea, hemiGround: 0x0a1022, fill: 0xbcd0ff,
    frame: 0x1c2854, panel: 0x101a3c, shade: 0x1d2a56, fascia: 0x060a18,
  },
  bar: {
    light: 0xffd9a6, accent: 0xf6b35c, hemiSky: 0xb08a72, hemiGround: 0x140b08, fill: 0xffd2b0,
    frame: 0x4a2c1c, panel: 0x241511, shade: 0x7a2f22, fascia: 0x140b08,
  },
}[ROOM_SKIN];

await Promise.all([
  '400 40px "Abril Fatface"', '900 40px "Nunito"', '700 40px "Caveat"', '600 40px "Caveat"',
  '700 40px "JetBrains Mono"', '500 40px "JetBrains Mono"',
  '500 40px "Inter"', '600 40px "Inter"', '700 40px "Inter"', '800 40px "Inter"',
].map((f) => document.fonts.load(f))).catch(() => {});

// ---- Camera. It looks straight ahead and the frame is slid down, the way a building is
// photographed: walls stay upright while the floor still opens up toward the viewer.
// The phone is a wider, shorter frame, so it stands a little further back to keep the boxes whole.
const W = innerWidth, H = innerHeight;
const D_WALL = CAM.z - ROOM.zBack;
const D_FRONT = CAM.z - ROOM.zFront;
const wallEq = (y, d) => CAM.y + (y - CAM.y) * D_WALL / d; // where a point at distance d lines up on the back wall
const yTop = PHONE ? 5.3 : 6.25;
const yBot = wallEq(-(PHONE ? 0.5 : 0.55), D_FRONT);
const halfW = (yTop - yBot) * (W / H) / 2;
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
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050c);

// ---- Painted surfaces.
function canvasOf(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}
function textureOf(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}
const paint = (w, h, draw) => textureOf(canvasOf(w, h, draw));
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
    if (BAR) {
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
    if (BAR) {
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
const RADIAL = paint(256, 256, (g) => {
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.5)"); r.addColorStop(0.6, "rgba(255,255,255,.12)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
});
// A pool of light: nearly even across, a touch dimmer toward its edge, then a clean stop.
const POOL = paint(256, 256, (g) => {
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.55, "rgba(255,255,255,.8)"); r.addColorStop(0.9, "rgba(255,255,255,.42)"); r.addColorStop(0.985, "rgba(255,255,255,.3)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
});

// ---- Box art. Cork & Bell uses its own screenshot; the others are painted stand-ins.
function fitText(g, text, x, y, maxW, size, font) {
  let s = size;
  do { g.font = font.replace("%", s); s -= 2; } while (g.measureText(text).width > maxW && s > 10);
  g.fillText(text, x, y);
}
async function boxCanvas(game) {
  let img = null;
  if (game.id === "cork") {
    img = new Image();
    img.src = "/cork-and-bell/docs/shots/01-stall.jpg";
    await img.decode().catch(() => { img = null; });
  }
  return canvasOf(700, 980, (g, w, h) => {
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineCap = "round";
    if (game.id === "cork") {
      g.fillStyle = "#6d1512"; g.fillRect(0, 0, w, h);
      const top = 196;
      if (img) {
        const ah = h - top, scale = ah / 1000, sw = w / scale;
        g.drawImage(img, (img.width - sw) / 2 + 4, 40, sw, 1000, 0, top, w, ah);
      }
      const band = g.createLinearGradient(0, 0, 0, top);
      band.addColorStop(0, "#8c1d18"); band.addColorStop(1, "#5c110f");
      g.fillStyle = band; g.fillRect(0, 0, w, top);
      g.fillStyle = "#e2b45a"; g.fillRect(0, top - 8, w, 8);
      g.fillStyle = "#f6dfae";
      fitText(g, "Cork & Bell", w / 2, 100, 620, 124, '400 %px "Abril Fatface", serif');
    } else if (game.id === "who") {
      g.fillStyle = "#fff6ea"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(74,53,181,.09)";
      for (let y = 40; y < h; y += 70) for (let x = 40 + (y / 70 % 2) * 35; x < w; x += 70) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
      g.fillStyle = "#33238a"; g.beginPath(); g.roundRect(160, 150, 380, 420, 88); g.fill();
      g.fillStyle = "#4a35b5"; g.beginPath(); g.roundRect(160, 126, 380, 404, 88); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(350, 328, 124, 0, 7); g.fill();
      g.fillStyle = "#4a35b5"; g.font = '900 190px "Nunito", sans-serif';
      g.fillText("?", 350, 342);
      g.fillStyle = "#1d1830";
      fitText(g, "Who Am I?", w / 2, 760, 600, 132, '900 %px "Nunito", sans-serif');
      g.fillStyle = "#4a35b5"; g.fillRect(250, 850, 200, 12);
    } else if (game.id === "tin") {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#ef7a55"); bg.addColorStop(1, "#b63c2b");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w / 2, 600);
      for (let i = 0; i < 16; i++) { g.rotate(Math.PI / 8); g.fillStyle = "rgba(255,225,170,.11)"; g.beginPath(); g.moveTo(0, 0); g.lineTo(-90, -900); g.lineTo(90, -900); g.fill(); }
      g.restore();
      g.fillStyle = "#fff1cf";
      g.font = '900 168px "Nunito", sans-serif'; g.fillText("TIN", w / 2, 128);
      g.fillText("DERBY", w / 2, 284);
      // A wind-up tin racer.
      g.save(); g.translate(w / 2 + 10, 610);
      g.fillStyle = "rgba(60,10,5,.35)"; g.beginPath(); g.ellipse(0, 132, 250, 22, 0, 0, 7); g.fill();
      g.strokeStyle = "#3a1a12"; g.lineWidth = 16;
      g.beginPath(); g.moveTo(-218, -18); g.lineTo(-268, -18); g.stroke();
      g.beginPath(); g.ellipse(-300, -18, 26, 42, 0, 0, 7); g.stroke();
      g.fillStyle = "#f6d36b"; g.beginPath(); g.roundRect(-220, -60, 440, 150, 60); g.fill();
      g.fillStyle = "#f6d36b"; g.beginPath(); g.roundRect(-110, -150, 210, 130, [70, 70, 0, 0]); g.fill();
      g.fillStyle = "#2a3f6e"; g.beginPath(); g.roundRect(-76, -122, 142, 76, [44, 44, 6, 6]); g.fill();
      g.fillStyle = "#c8382c"; g.fillRect(-220, 6, 440, 30);
      g.fillStyle = "#fff"; g.beginPath(); g.arc(120, 22, 44, 0, 7); g.fill();
      g.fillStyle = "#1b1a17"; g.font = '900 60px "Nunito", sans-serif'; g.fillText("7", 120, 26);
      for (const X of [-128, 128]) {
        g.fillStyle = "#1b1a17"; g.beginPath(); g.arc(X, 96, 58, 0, 7); g.fill();
        g.fillStyle = "#d9d2c0"; g.beginPath(); g.arc(X, 96, 24, 0, 7); g.fill();
      }
      g.strokeStyle = "rgba(255,241,207,.8)"; g.lineWidth = 12;
      for (const [Y, L] of [[-70, 80], [-10, 120], [50, 70]]) { g.beginPath(); g.moveTo(262, Y); g.lineTo(262 + L, Y); g.stroke(); }
      g.restore();
      // Chequered strip.
      const sq = 70;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 10; c++) { g.fillStyle = (r + c) % 2 ? "#1b1a17" : "#fff1cf"; g.fillRect(c * sq, h - 140 + r * sq, sq, sq); }
    } else if (game.id === "flood") {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#132a66"); bg.addColorStop(1, "#2a56b6");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = "#ffe9a8"; g.beginPath(); g.arc(560, 150, 62, 0, 7); g.fill();
      g.fillStyle = "#132a66"; g.beginPath(); g.arc(532, 134, 54, 0, 7); g.fill();
      g.fillStyle = "#fff";
      g.font = '900 190px "Nunito", sans-serif'; g.fillText("FLOOD", w / 2, 330);
      // A house going under.
      g.save(); g.translate(w / 2, 640); g.rotate(-0.07);
      g.fillStyle = "#f3e3c2"; g.fillRect(-120, -60, 240, 240);
      g.fillStyle = "#c8382c"; g.beginPath(); g.moveTo(-160, -56); g.lineTo(0, -190); g.lineTo(160, -56); g.fill();
      g.fillStyle = "#8a2a20"; g.fillRect(60, -170, 40, 80);
      g.fillStyle = "#ffd76a"; g.fillRect(-70, -10, 56, 60); g.fillRect(20, -10, 56, 60);
      g.restore();
      const wave = (y0, amp, len, phase, fill, crest) => {
        g.beginPath(); g.moveTo(0, h);
        for (let x = 0; x <= w; x += 10) g.lineTo(x, y0 + Math.sin(x / len + phase) * amp);
        g.lineTo(w, h); g.closePath(); g.fillStyle = fill; g.fill();
        g.beginPath();
        for (let x = 0; x <= w; x += 10) { const y = y0 + Math.sin(x / len + phase) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.strokeStyle = crest; g.lineWidth = 9; g.stroke();
      };
      wave(676, 22, 52, 0.6, "#4f86e6", "rgba(255,255,255,.85)");
      wave(770, 20, 60, 2.1, "#3a6dcf", "rgba(255,255,255,.55)");
      wave(868, 18, 48, 4.0, "#2a56b6", "rgba(255,255,255,.4)");
    } else {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#3c9460"); bg.addColorStop(1, "#1f5a3a");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = "#fff1cf";
      fitText(g, "Fox Trouble", w / 2, 150, 620, 130, '400 %px "Abril Fatface", serif');
      g.save(); g.translate(w / 2, 590);
      g.fillStyle = "#e57a2e";
      g.beginPath(); g.moveTo(-250, -210); g.lineTo(-90, -120); g.lineTo(-220, 10); g.fill();
      g.beginPath(); g.moveTo(250, -210); g.lineTo(90, -120); g.lineTo(220, 10); g.fill();
      g.beginPath(); g.moveTo(-240, -90); g.lineTo(240, -90); g.lineTo(0, 260); g.fill();
      g.fillStyle = "#fff6ea";
      g.beginPath(); g.moveTo(-200, 0); g.lineTo(-40, 60); g.lineTo(0, 260); g.fill();
      g.beginPath(); g.moveTo(200, 0); g.lineTo(40, 60); g.lineTo(0, 260); g.fill();
      g.fillStyle = "#1b1a17";
      g.beginPath(); g.arc(0, 236, 34, 0, 7); g.fill();
      g.beginPath(); g.ellipse(-92, -6, 20, 30, 0.3, 0, 7); g.fill();
      g.beginPath(); g.ellipse(92, -6, 20, 30, -0.3, 0, 7); g.fill();
      g.restore();
    }
    // A soft printed edge.
    g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  });
}
const SIDE = { cork: "#4a0e0c", who: "#cfc4b2", tin: "#7a2418", flood: "#10224f", fox: "#143d27" };
function makeBox(tex, game, glow) {
  const sideMat = new THREE.MeshStandardMaterial({ color: SIDE[game.id], roughness: 0.7 });
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow });
  return new THREE.Mesh(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), [sideMat, sideMat, sideMat, sideMat, front, sideMat]);
}

// ---- Room shell.
const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), new THREE.MeshBasicMaterial({ map: wallTexture(ROOM.w, ROOM.h) }));
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
const fascia = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w + 10, ROOM.fasciaH), new THREE.MeshBasicMaterial({ color: T.fascia }));
fascia.position.set(0, -ROOM.fasciaH / 2, ROOM.zFront);
scene.add(fascia);
const lip = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 10, 0.022, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent).multiplyScalar(0.55) }));
lip.position.set(0, -0.02, ROOM.zFront + 0.02);
scene.add(lip);
// Skirting line where wall meets floor.
const skirt = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.4 }));
skirt.position.set(0, 0.03, ROOM.zBack + 0.02);
scene.add(skirt);

scene.add(new THREE.HemisphereLight(T.hemiSky, T.hemiGround, BAR ? 1.0 : 1.25));
const fill = new THREE.DirectionalLight(T.fill, 1.25);
fill.position.set(-3, 5, 14);
scene.add(fill);

// ---- Lamps, cones and pools.
const coneMat = (strength, color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uStrength: { value: strength }, uColor: { value: new THREE.Color(color) } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
  // The beam is faint where it crosses the box art and gathers toward the floor.
  fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
    void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
      float along = mix(1.0, 0.3, smoothstep(0.25, 0.75, vH)) * smoothstep(0.0, 0.08, vH);
      gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
});
function makeLampHead(level) {
  const g = new THREE.Group();
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.36, 0.3, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: T.shade, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
  );
  shade.position.y = 0.15;
  g.add(shade);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 20), shade.material);
  cap.position.y = 0.36;
  g.add(cap);
  const bright = Math.min(1, 0.25 + level * 0.7);
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.light).multiplyScalar(bright * 1.6) }));
  bulb.rotation.x = Math.PI / 2;
  bulb.position.y = 0.03;
  g.add(bulb);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: T.light, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.18 + 0.5 * Math.min(level, 1.3) }));
  halo.scale.setScalar(1.1 + level * 0.9);
  halo.position.y = 0.02;
  g.add(halo);
  return g;
}
const cordMat = new THREE.MeshBasicMaterial({ color: BAR ? 0x1a0f0b : 0x0a1024 });
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

  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, POOL_R, LAMP_Y, 64, 1, true), coneMat(Math.min(0.3, 0.06 + 0.18 * level), T.light));
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
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.0), new THREE.MeshBasicMaterial({ map: RADIAL, color: T.light, transparent: true, opacity: 0.1 * level, blending: THREE.AdditiveBlending, depthWrite: false }));
  spill.position.set(x, 0.1, ROOM.zBack + 0.03);
  scene.add(spill);
}
POOL_X.forEach((_, i) => addPool(i));

// ---- The four spots on the wall: a lit frame with the game's box in it.
const NICHE = { w: BOX_W + 0.1, h: BOX_H + 0.1, d: 0.4 };
const frameMat = new THREE.MeshStandardMaterial({ color: T.frame, roughness: 0.6 });
const leadFrameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent) });
const canvases = await Promise.all([...GAMES, SPARE].map(boxCanvas));
const textures = canvases.map(textureOf);
function addNiche(i) {
  const x = POOL_X[i];
  const lead = isLead(i), off = isOff(i);
  const g = new THREE.Group();
  g.position.set(x, BOX_Y, ROOM.zBack);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w, NICHE.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.panel).multiplyScalar(off ? 0.6 : 1.25) }));
  inner.position.z = 0.012;
  g.add(inner);
  const bar = 0.07;
  for (const [w, h, X, Y] of [[bar, NICHE.h + bar * 2, -NICHE.w / 2 - bar / 2, 0], [bar, NICHE.h + bar * 2, NICHE.w / 2 + bar / 2, 0], [NICHE.w, bar, 0, NICHE.h / 2 + bar / 2], [NICHE.w, bar, 0, -NICHE.h / 2 - bar / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, NICHE.d), lead && S.winner === i ? leadFrameMat : frameMat);
    m.position.set(X, Y, NICHE.d / 2);
    g.add(m);
  }
  const box = makeBox(textures[i], GAMES[i], off ? 0.16 : lead ? 0.9 : 0.62);
  box.position.set(0, 0, 0.2);
  g.add(box);
  if (lead && S.winner === i) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w + 1.5, NICHE.h + 1.5), new THREE.MeshBasicMaterial({ map: RADIAL, color: T.accent, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = 0.02;
    g.add(glow);
  }
  scene.add(g);
}
POOL_X.forEach((_, i) => addNiche(i));

// ---- Left end: the door latecomers come through. Right end: the shelf where the fifth game waits.
{
  const x = -END_X, w = 1.0, h = 2.2;
  const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshStandardMaterial({ color: BAR ? 0x2a5a4e : 0x22336e, roughness: 0.55 }));
  door.position.set(x, h / 2, ROOM.zBack + 0.04);
  scene.add(door);
  for (const [bw, bh, X, Y] of [[0.08, h + 0.08, -w / 2 - 0.04, h / 2 + 0.04], [0.08, h + 0.08, w / 2 + 0.04, h / 2 + 0.04], [w + 0.16, 0.08, 0, h + 0.04]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), frameMat);
    m.position.set(x + X, Y, ROOM.zBack + 0.06);
    scene.add(m);
  }
  const warm = new THREE.Color(0xffc777);
  const port = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.MeshBasicMaterial({ color: warm }));
  port.position.set(x, 1.6, ROOM.zBack + 0.075);
  scene.add(port);
  const portRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.175, 40), frameMat);
  portRing.position.copy(port.position); portRing.position.z += 0.002;
  scene.add(portRing);
  const portGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: warm, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22 }));
  portGlow.scale.setScalar(1.2); portGlow.position.set(x, 1.6, ROOM.zBack + 0.1);
  scene.add(portGlow);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 0.7 }));
  knob.position.set(x + 0.36, 1.05, ROOM.zBack + 0.1);
  scene.add(knob);
  const sill = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, 0.03), new THREE.MeshBasicMaterial({ color: warm }));
  sill.position.set(x, 0.02, ROOM.zBack + 0.075);
  scene.add(sill);
}
const SHELF_Y = 1.15, FOX_SCALE = 0.42;
{
  const x = END_X;
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.5), new THREE.MeshBasicMaterial({ color: BAR ? 0x6a4028 : 0x2a3a78 }));
  plank.position.set(x, SHELF_Y, ROOM.zBack + 0.25);
  scene.add(plank);
  for (const dx of [-0.55, 0.55]) {
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.4), frameMat);
    br.position.set(x + dx, SHELF_Y - 0.18, ROOM.zBack + 0.2);
    scene.add(br);
  }
  const fox = makeBox(textures[4], SPARE, 0.34);
  fox.scale.setScalar(FOX_SCALE);
  fox.position.set(x - 0.05, SHELF_Y + 0.035 + BOX_H * FOX_SCALE / 2, ROOM.zBack + 0.25);
  fox.rotation.y = -0.25;
  scene.add(fox);
}

// ---- The bar only: a string of bulbs, as over the Cork & Bell stall.
if (BAR) {
  const n = 25;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = (t - 0.5) * (ROOM.w - 0.6);
    const sag = Math.pow((t * 4) % 1 - 0.5, 2) * 1.2;
    const y = 5.62 + sag, z = ROOM.zBack + 0.5;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(1.6) }));
    bulb.position.set(x, y, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
    glow.scale.setScalar(0.7); glow.position.set(x, y, z + 0.02);
    scene.add(bulb, glow);
  }
}

// ---- Characters. Every skin is the same size class, wears the seat colour and has the same eyes.
const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.25 });
const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
function addEyes(turn, face, { r, y, spread = 0.33, size = 1, shock = false, visor = false }) {
  for (const s of [-1, 1]) {
    const a = s * spread;
    const at = (rr, yy) => new THREE.Vector3(Math.sin(a) * rr, yy, Math.cos(a) * rr);
    if (visor) {
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xbff3ff }));
      eye.scale.set(0.045 * size, 0.055 * size, 0.015);
      eye.position.set(s * 0.085, y, r);
      turn.add(eye);
      continue;
    }
    if (shock) {
      const white = new THREE.Mesh(eyeGeo, whiteMat);
      white.scale.set(0.06 * size, 0.075 * size, 0.022);
      white.position.copy(at(r, y)); white.rotation.y = a;
      const pupil = new THREE.Mesh(eyeGeo, eyeMat);
      pupil.scale.set(0.022 * size, 0.026 * size, 0.012);
      pupil.position.copy(at(r + 0.018, y)); pupil.rotation.y = a;
      turn.add(white, pupil);
      continue;
    }
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(0.034 * size, 0.052 * size, 0.02);
    eye.position.copy(at(r, y)); eye.rotation.y = a;
    turn.add(eye);
    // The glint is left off an eye that has turned to the edge of the head, where it would float.
    if (Math.abs(face + a) < 0.8) {
      const glint = new THREE.Mesh(eyeGeo, whiteMat);
      glint.scale.set(0.011 * size, 0.013 * size, 0.008);
      glint.position.copy(at(r + 0.014, y + 0.021 * size));
      turn.add(glint);
    }
  }
}
const lathe = (pts, seg = 56) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const pawnBody = lathe([[0, 0], [0.29, 0], [0.325, 0.03], [0.33, 0.08], [0.3, 0.13], [0.235, 0.24], [0.185, 0.4], [0.15, 0.56], [0.145, 0.61], [0.2, 0.645], [0.205, 0.68], [0.15, 0.715], [0, 0.72]]);
const pawnHead = new THREE.SphereGeometry(0.215, 40, 28);
const slimeBody = lathe(Array.from({ length: 26 }, (_, i) => {
  const a = i / 25 * Math.PI / 2;
  // A soft dome that sags outward at the foot.
  return [0.43 * Math.pow(Math.cos(a), 0.62) + 0.05 * Math.pow(1 - i / 25, 6), 0.7 * Math.sin(a)];
}).concat([[0, 0.7]]));
slimeBody.computeVertexNormals();
const ghostBody = lathe([[0.33, 0], [0.335, 0.2], [0.33, 0.5], [0.3, 0.72], [0.24, 0.88], [0.15, 0.98], [0, 1.02]]);
const SKIN_H = { pawn: 1.12, slime: 0.72, robot: 1.4, ghost: 1.04 };
function makeSkin(kind, hex, p) {
  const c = new THREE.Color(hex);
  const face = p.face || 0;
  const mat = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25, emissive: c, emissiveIntensity: 0.3 });
  const turn = new THREE.Group();
  const cast = (m) => { m.castShadow = true; turn.add(m); return m; };
  if (kind === "slime") {
    mat.roughness = 0.12; mat.clearcoat = 1; mat.clearcoatRoughness = 0.05; mat.transparent = true; mat.opacity = 0.93; mat.emissiveIntensity = 0.42;
    cast(new THREE.Mesh(slimeBody, mat));
    // A wet highlight and two drips at the foot.
    const shine = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    shine.scale.set(0.085, 0.04, 0.02); shine.position.set(-0.17, 0.6, 0.2); shine.rotation.set(-0.7, -0.5, 0.5);
    turn.add(shine);
    for (const [X, Z, R] of [[0.47, 0.16, 0.07], [-0.44, 0.24, 0.05]]) { const d = cast(new THREE.Mesh(eyeGeo, mat)); d.scale.set(R, R * 0.6, R); d.position.set(X, R * 0.3, Z); }
    addEyes(turn, face, { r: 0.405, y: 0.34, spread: 0.36, size: 1.5, shock: p.shock });
  } else if (kind === "robot") {
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.5, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.35, metalness: 0.8 });
    const base = cast(new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.16, 0.42, 4, 0.07), dark)); base.position.y = 0.08;
    const body = cast(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 0.38, 5, 0.09), mat)); body.position.y = 0.36;
    const neck = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 16), steel)); neck.position.y = 0.6;
    const head = cast(new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.34, 0.38, 5, 0.1), mat)); head.position.y = 0.8;
    const visor = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.19, 0.06, 4, 0.03), new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.2 })); visor.position.set(0, 0.81, 0.175);
    turn.add(visor);
    const mast = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), steel)); mast.position.y = 1.07;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a })); tip.position.y = 1.19;
    turn.add(tip);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })); plate.position.set(0, 0.38, 0.192);
    turn.add(plate);
    // Arms: the one on the viewer's side shoots out on a spring.
    const near = face > 0 ? -1 : 1;
    for (const s of [-1, 1]) {
      const out = s === near ? (p.arm || 0) : 0;
      const sh = cast(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), dark)); sh.position.set(s * 0.29, 0.44, 0);
      if (out) {
        const len = out + 0.16;
        const rod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 10), steel));
        rod.rotation.x = Math.PI / 2; rod.position.set(s * 0.29, 0.44, len / 2);
        for (let k = 0; k < 7; k++) { const coil = cast(new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.013, 8, 20), steel)); coil.position.set(s * 0.29, 0.44, 0.12 + k * (len - 0.2) / 6); }
        const glove = cast(new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), new THREE.MeshPhysicalMaterial({ color: 0xf3ead6, roughness: 0.4, clearcoat: 0.5 }))); glove.position.set(s * 0.29, 0.44, len + 0.06);
      } else {
        const arm = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 10), dark)); arm.position.set(s * 0.31, 0.3, 0);
        const hand = cast(new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), steel)); hand.position.set(s * 0.31, 0.16, 0);
      }
    }
    addEyes(turn, face, { r: 0.207, y: 0.81, visor: true });
    turn.scale.setScalar(1.13);
  } else if (kind === "ghost") {
    // A pale sheet tinted with the seat colour, so it does not read as a second slime.
    mat.color.lerp(new THREE.Color(0xffffff), 0.6); mat.emissive.lerp(new THREE.Color(0xffffff), 0.25);
    mat.transparent = true; mat.opacity = 0.92; mat.emissiveIntensity = 0.45; mat.roughness = 0.6; mat.clearcoat = 0.1;
    cast(new THREE.Mesh(ghostBody, mat));
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; const b = cast(new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), mat)); b.position.set(Math.sin(a) * 0.235, 0.0, Math.cos(a) * 0.235); }
    for (const s of [-1, 1]) { const hand = cast(new THREE.Mesh(eyeGeo, mat)); hand.scale.set(0.1, 0.075, 0.09); hand.position.set(s * 0.37, 0.5, 0.12); hand.rotation.z = s * 0.5; }
    addEyes(turn, face, { r: 0.315, y: 0.68, spread: 0.36, size: 1.45 });
    const mouth = new THREE.Mesh(eyeGeo, eyeMat); mouth.scale.set(0.05, 0.065, 0.02); mouth.position.set(0, 0.5, 0.333);
    turn.add(mouth);
  } else {
    cast(new THREE.Mesh(pawnBody, mat));
    const head = cast(new THREE.Mesh(pawnHead, mat));
    head.position.y = 0.9;
    addEyes(turn, face, { r: 0.205, y: 0.925, shock: p.shock, size: p.shock ? 0.9 : 1 });
  }
  if (p.crown) {
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.6, emissive: 0xf2c14e, emissiveIntensity: 0.45, side: THREE.DoubleSide });
    const band = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.09, 24, 1, true), gold)); band.position.y = 1.13;
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const spike = cast(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 10), gold)); spike.position.set(Math.sin(a) * 0.145, 1.22, Math.cos(a) * 0.145); }
  }
  turn.rotation.y = face;
  const tilt = new THREE.Group();
  tilt.add(turn);
  tilt.scale.setScalar(CH);
  return tilt;
}
const heightOf = (p) => SKIN_H[p.skin || "pawn"] * CH * (p.squash || 1) + (p.crown ? 0.16 : 0);
const blobMat = new THREE.MeshBasicMaterial({ map: RADIAL, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
for (const p of S.players) {
  const body = makeSkin(p.skin || "pawn", SEATS[p.seat].hex, p);
  body.position.set(p.x, p.y || 0, WALK_Z);
  body.rotation.z = p.lean || 0;
  if (p.squash) body.scale.set(CH / Math.sqrt(p.squash), CH * p.squash, CH / Math.sqrt(p.squash));
  scene.add(body);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5 * CH * (p.skin === "slime" ? 1.3 : 1), 32), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(p.x, 0.008, WALK_Z);
  blob.scale.setScalar(Math.max(0.45, 1 - (p.y || 0) * 0.6));
  scene.add(blob);
  if (PHONE && p.seat === YOU) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.012, WALK_Z);
    scene.add(ring);
  }
}

// ---- Second lock-in idea: a brass bell on a rope at the edge of the leading light.
const BELL_Y = 1.44;
if (S.bell !== undefined) {
  const x = POOL_X[S.bell] + BELL_DX;
  const brass = new THREE.MeshStandardMaterial({ color: 0xe0a93b, roughness: 0.25, metalness: 0.85, emissive: 0xc98a1e, emissiveIntensity: 0.55, side: THREE.DoubleSide });
  const bell = new THREE.Mesh(lathe([[0.2, 0], [0.19, 0.03], [0.15, 0.08], [0.125, 0.18], [0.11, 0.27], [0.07, 0.33], [0, 0.345]], 40), brass);
  bell.position.set(x, BELL_Y, WALK_Z);
  bell.rotation.z = 0.2;
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), brass);
  clapper.position.set(x + 0.07, BELL_Y - 0.03, WALK_Z);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 6, 8), new THREE.MeshBasicMaterial({ color: BAR ? 0xb89868 : 0x7f95d6 }));
  rope.position.set(x - 0.06, BELL_Y + 0.34 + 3, WALK_Z);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xffc860, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
  halo.scale.setScalar(1.5); halo.position.set(x, BELL_Y + 0.15, WALK_Z + 0.05);
  scene.add(rope, bell, clapper, halo);
}

// ---- A tie: one big coin tossed between the two tied lights, each face one of the two games.
const COIN = { x: 0, y: 3.75, r: 0.4 }; // sized to sit in the gap between the two middle boxes
if (S.tied) {
  const faceTex = paint(512, 512, (g) => {
    const rim = g.createRadialGradient(256, 256, 40, 256, 256, 256);
    rim.addColorStop(0, "#ffe89a"); rim.addColorStop(0.75, "#eeb844"); rim.addColorStop(1, "#b17a1c");
    g.fillStyle = rim; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#9a6614"; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 196, 0, 7); g.stroke();
    g.fillStyle = "#9a6614"; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, r = i % 2 ? 62 : 150; g.lineTo(256 + Math.sin(a) * r, 256 - Math.cos(a) * r); }
    g.fill();
  });
  const edge = new THREE.MeshStandardMaterial({ color: 0xc98f24, roughness: 0.3, metalness: 0.8, emissive: 0x7a5410, emissiveIntensity: 0.7 });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.35, metalness: 0.4, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.8 });
  // Caught mid-spin: tipped back so its face and its thick edge both show.
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(COIN.r, COIN.r, 0.1, 64), [edge, faceMat, faceMat]);
  coin.rotation.set(Math.PI / 2 - 0.8, 0, 0.3);
  coin.position.set(COIN.x, COIN.y, WALK_Z);
  scene.add(coin);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  halo.scale.setScalar(3); halo.position.set(COIN.x, COIN.y, WALK_Z - 0.2);
  scene.add(halo);
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
const esc = (s) => s.replace("&", "&amp;");

// Signs under the boxes. No vote marks here: the characters standing in the light are the vote.
GAMES.forEach((game, i) => {
  if (S.bigBoard && (i === 1 || i === 2)) return; // hidden behind the big scoreboard
  const state = S.winner === i ? "lead" : isOff(i) ? "off" : S.tied ? "tied" : "";
  const about = S.tied && !isOff(i) ? `<span class="side">${S.tied[0] === i ? "Heads" : "Tails"}</span>` : `<span class="about">${game.about}</span>`;
  put(`sign down ${state}`, `<b>${esc(game.name)}</b>${about}<span class="row"><span class="need" style="--need:${NEED[game.need].color}">${NEED[game.need].plate}</span><span class="seats">${game.seats}</span></span>`,
    px(POOL_X[i], BOX_Y - NICHE.h / 2 - 0.14, ROOM.zBack));
});

// Name tags, added last so they sit over every sign.
function addTags() { for (const p of S.players) {
  const seat = SEATS[p.seat];
  const you = PHONE && p.seat === YOU;
  const top = (p.y || 0) + heightOf(p) * Math.cos(p.lean || 0) + (you ? 0.24 : 0.15);
  const leanShift = -(p.lean || 0) * 0.8;
  const inLight = S.bigBoard || S.votes.some((v) => v.includes(p.seat));
  const at = p.tagAt ? px(p.x + p.tagAt[0], (p.y || 0) + p.tagAt[1], WALK_Z) : px(p.x + leanShift, top, WALK_Z);
  const label = p.note ? `<span>${seat.name}<em>${p.name} - ${p.note}</em></span>` : (you ? "You" : seat.name);
  put(`tag ${p.tagAt ? "" : "up"} ${p.note ? "skin" : ""} ${you ? "you" : ""} ${inLight ? "" : "dimmed"}`, `<i style="--seat:${seat.hex}"></i>${label}${p.bubble ? `<span class="bubble">${p.bubble}</span>` : ""}`, at);
} }

// The join sign over the door.
{
  const code = generate(`https://${JOIN_ADDRESS}/?join=${PIN}`);
  const n = code.size, q = 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.get(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
  put(PHONE ? "join" : "join down", `<small>${PHONE ? "Party code" : "Scan or type the code"}</small><svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><path d="${d}" fill="#140c08"/></svg><div class="pin">${PIN}</div><div class="addr">${JOIN_ADDRESS}</div>`,
    px(-END_X, PHONE ? 3.6 : 5.12, ROOM.zBack));
}
put("shelf-tag down", `Up next<b>${SPARE.name}</b>`, px(END_X, SHELF_Y - 0.4, ROOM.zBack));

// The night's scores.
const rows = (big) => SCORES.map((s, i) => `<div class="line"><u>${i + 1}</u><i style="--seat:${SEATS[s.seat].hex}"></i><span>${SEATS[s.seat].name}</span>${big ? `<span class="up">${s.last ? `+${s.last}` : ""}</span>` : ""}<s>${s.pts}</s></div>`).join("");
if (S.bigBoard) {
  const top = px(0, 5.36, ROOM.zBack);
  for (const dx of [-1.9, 1.9]) {
    const a = px(dx, 5.36, ROOM.zBack);
    const chain = document.createElement("div");
    chain.className = "chain";
    chain.style.cssText = `left:${a.x - 1.5}px;top:0;height:${a.y + 4}px`;
    over.append(chain);
  }
  put("board big down", `<h3>Tonight's scores</h3><div class="rule"></div>${rows(true)}<small>After 3 games<br>Every game gives 3 for 1st, 2 for 2nd, 1 for 3rd</small>`, top);
  put("hook-patch down", "", px(END_X, 5.12, ROOM.zBack));
} else {
  put("board down", `<h3>Tonight</h3><div class="rule"></div>${rows(false)}<small>after 3 games<br>1st 3 pts, 2nd 2, 3rd 1</small>`, px(END_X, 5.12, ROOM.zBack));
}

// Locking in, first idea: a count on the corner of the winning box.
if (S.count) {
  const r = 46, c = 2 * Math.PI * r, left = 0.6;
  put("count", `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="#160c06" stroke="rgba(255,255,255,.25)" stroke-width="6"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * left).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
    <small>Starts in</small><b>${S.count}</b>`, px(POOL_X[S.winner] + BOX_W / 2 + 0.22, BOX_Y + BOX_H / 2, ROOM.zBack));
}
// Second idea: the bell.
if (S.bell !== undefined) put("callout right", "Jump to ring it", px(POOL_X[S.bell] + BELL_DX + 0.38, BELL_Y + 0.17, WALK_Z));
// The tie.
if (S.tied) put("banner", `<b>Tie!</b><span>Coin toss decides</span>`, px(0, 5.52, ROOM.zBack));

addTags();

// The front of the stage.
{
  const edge = px(0, 0, ROOM.zFront).y;
  const el = document.createElement("div");
  el.className = "fascia";
  el.style.height = `${(H - edge).toFixed(1)}px`;
  if (PHONE) {
    const mine = S.votes.findIndex((v) => v.includes(YOU));
    const icon = (d, w = 3) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    el.innerHTML = `<div class="pad l"><div class="key">${icon("M15 5l-7 7 7 7")}</div><div class="key">${icon("M9 5l7 7-7 7")}</div></div>
      <div class="mine" style="height:${(H - edge).toFixed(1)}px"><span>Your vote</span><b><i style="--seat:${SEATS[YOU].hex}"></i>${mine < 0 ? "Not yet" : GAMES[mine].name}</b>${S.mine ? `<span class="sep"></span><span>${S.mine}</span>` : ""}</div>
      <div class="pad r"><div class="key small">${icon("M4 5.5h16v10.5h-9l-4.5 3.6V16H4z M9 9.2v.6 M15 9.2v.6 M9 12.2c1.8 1.5 4.2 1.5 6 0", 2.2)}</div><div class="key">${icon("M4 12h9 M10 7l5 5-5 5 M19 5v14")}</div><div class="key jump">${icon("M5 14l7-7 7 7")}</div></div>`;
  } else {
    el.innerHTML = `<div class="brand"><i></i>${SITE_NAME}</div><div class="hint">${S.hint}</div><div class="code"><span>Join<br>code</span><b>${PIN}</b></div>`;
  }
  over.append(el);
}

// ---- Hand-drawn marks for motion.
const fx = document.getElementById("fx");
fx.setAttribute("viewBox", `0 0 ${W} ${H}`);
const k = U / 127;
const INK = BAR ? "#fff3e2" : "#eaf2ff";
function mark(d, stroke, width, opacity, dash = "") {
  fx.insertAdjacentHTML("beforeend", `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${(width * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`);
}
fx.insertAdjacentHTML("beforeend", `<defs><linearGradient id="streak" x1="1" x2="0"><stop offset="0" stop-color="${INK}" stop-opacity=".85"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient></defs>`);
function streaks(x, list) {
  for (const [y, start, len, h] of list) {
    const p1 = px(x - start, y, WALK_Z), p2 = px(x - start - len, y, WALK_Z);
    fx.insertAdjacentHTML("beforeend", `<rect x="${p2.x}" y="${p1.y - h * k / 2}" width="${p1.x - p2.x}" height="${h * k}" rx="${h * k / 2}" fill="url(#streak)"/>`);
  }
}
function burst(at, n, r1, r2, from = -Math.PI / 2, step = 0.42) {
  for (let i = 0; i < n; i++) {
    const ang = from + (i - (n - 1) / 2) * step, a = r1 * k, b = (i % 2 ? r2 * 0.7 : r2) * k;
    mark(`M${at.x + Math.cos(ang) * a} ${at.y + Math.sin(ang) * a}L${at.x + Math.cos(ang) * b} ${at.y + Math.sin(ang) * b}`, "#ffffff", 4.5, 0.95);
  }
}
if (SHOT === "bump") {
  const a = S.players[1], b = S.players[2];
  streaks(a.x, [[0.78, 0.36, 0.7, 5], [0.56, 0.42, 1.15, 7], [0.34, 0.44, 0.85, 5], [0.13, 0.42, 0.5, 4]]);
  burst(px(a.x + 0.66, 0.5, WALK_Z), 7, 16, 44);
  // The arc of the one who got bumped: from where they stood, up and out of the light.
  const from = px(a.x + 0.74, 0.5, WALK_Z), mid = px((a.x + b.x) / 2 + 0.5, 1.25, WALK_Z), to = px(b.x - 0.2, b.y + 0.62, WALK_Z);
  mark(`M${from.x} ${from.y}Q${mid.x} ${mid.y} ${to.x} ${to.y}`, INK, 3.5, 0.75, `${2 * k} ${11 * k}`);
  // Little stars knocked loose.
  for (const [dx, dy, s] of [[0.62, 0.2, 9], [0.95, 0.62, 6], [0.3, -0.12, 6]]) {
    const c = px(b.x + dx, b.y + dy, WALK_Z), r = s * k;
    mark(`M${c.x - r} ${c.y}L${c.x + r} ${c.y}M${c.x} ${c.y - r}L${c.x} ${c.y + r}`, "#ffd27a", 3.5, 0.95);
  }
}
if (SHOT === "skins") {
  const [pawn, robot, slime, ghost] = S.players;
  // The chess piece's high hop.
  for (const dx of [-0.2, 0, 0.2]) {
    const p1 = px(pawn.x + dx, pawn.y - 0.08, WALK_Z), p2 = px(pawn.x + dx, pawn.y - (dx ? 0.3 : 0.42), WALK_Z);
    mark(`M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, INK, 4, 0.6);
  }
  // The robot's long shove landing on a slime that does not move.
  burst(px(slime.x - 0.4, 0.36, WALK_Z), 5, 12, 30, Math.PI * 1.2, 0.45);
  for (const dx of [0.5, 0.62]) {
    const p1 = px(slime.x + dx, 0.5, WALK_Z), p2 = px(slime.x + dx + 0.03, 0.12, WALK_Z), m = px(slime.x + dx + 0.09, 0.32, WALK_Z);
    mark(`M${p1.x} ${p1.y}Q${m.x} ${m.y} ${p2.x} ${p2.y}`, INK, 3, 0.55);
  }
  // The ghost hangs in the air.
  for (const dx of [-0.2, 0.02, 0.24]) {
    const p1 = px(ghost.x + dx, ghost.y - 0.2, WALK_Z), m = px(ghost.x + dx + 0.07, ghost.y - 0.3, WALK_Z), p2 = px(ghost.x + dx - 0.02, ghost.y - 0.42, WALK_Z);
    mark(`M${p1.x} ${p1.y}Q${m.x} ${m.y} ${p2.x} ${p2.y}`, INK, 3, 0.5);
  }
}
if (S.bell !== undefined) burst(px(POOL_X[S.bell] + BELL_DX - 0.05, BELL_Y + 0.14, WALK_Z), 3, 34, 54, Math.PI, 0.4);
if (S.tied) {
  // Tossed up from the floor between the two tied lights, and still spinning.
  const p1 = px(COIN.x - 0.1, 0.25, WALK_Z), m = px(COIN.x - 0.5, 1.6, WALK_Z), p2 = px(COIN.x - 0.12, COIN.y - 0.62, WALK_Z);
  mark(`M${p1.x} ${p1.y}Q${m.x} ${m.y} ${p2.x} ${p2.y}`, INK, 3.5, 0.6, `${2 * k} ${11 * k}`);
  const c = px(COIN.x, COIN.y, WALK_Z), rx = 76 * k, ry = 66 * k;
  for (const s of [-1, 1]) {
    const a = { x: c.x + s * rx * 0.62, y: c.y - s * ry * 0.92 }, b = { x: c.x + s * rx, y: c.y + s * ry * 0.3 };
    const arc = `M${a.x} ${a.y}A${rx} ${ry} 0 0 1 ${b.x} ${b.y}`;
    const head = `M${b.x - s * 15 * k} ${b.y - s * 9 * k}L${b.x} ${b.y}L${b.x + s * 13 * k} ${b.y - s * 12 * k}`;
    // A dark line under the white one, so the arrows hold up over pale box art.
    mark(arc, "#1a0f08", 9, 0.75); mark(head, "#1a0f08", 9, 0.75);
    mark(arc, "#ffffff", 4.5, 1); mark(head, "#ffffff", 4.5, 1);
  }
}
if (S.count) {
  // A happy hop in the winning light.
  const p = S.players[2];
  for (const dx of [-0.16, 0.16]) {
    const p1 = px(p.x + dx, 0.14, WALK_Z), p2 = px(p.x + dx * 1.4, 0.02, WALK_Z);
    mark(`M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, INK, 3.5, 0.6);
  }
}

document.documentElement.dataset.ready = "1";
