// The rooms, as skins. One description per room, and nothing else in the 3D look knows any
// room by name.
//
// Every room keeps the layout exactly: side view, the join sign and the door at the left end,
// the game boxes along the wall with a lamp and a pool of light each, the Tonight board at the
// right end. A skin changes six things: wall, floor, lamps, lettering, sign style and small extras.
//
// A skin is:
//   name, line     what it is called, and one line on what makes the room itself
//   live           true for a room that can be played in (&room=<id>); the others are concepts,
//                  drawn as stills on the rooms page only
//   light...       the colours of its light and its fittings (hex numbers, as three.js takes them)
//   lamp           "shade" | "ring" | "lantern" | "tube" | "dome" | "globe"
//   frame style    `neon`: a colour per box, for frames that glow. `mount`: "frame" | "hatch"
//   doorway        "door" | "tent" | "hatch" | "none" (painted on the wall instead)
//   words          the lettering and the sign style: CSS custom properties for look3d.css, and
//                  `led` for a lit panel in place of the chalkboard
//   wall, floor    painters. (g, w, h, k, side, L): a 2D canvas context, its size in pixels,
//                  pixels per metre, whether this is a side wall, and the layout L (where the
//                  boxes hang, in metres from the middle of the wall)
//   extras(kit)    optional small 3D things, added through kit.add
import { glow, planks, seeded, speckle, stars } from "./paint.js";

/** A vertical gradient fill over the whole canvas. */
function fade(g, w, h, stops, y0 = 0, y1 = h) {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  for (const [at, colour] of stops) grad.addColorStop(at, colour);
  g.fillStyle = grad;
  g.fillRect(0, y0, w, y1 - y0);
}

const bar = {
  name: "The bar",
  line: "Dark boards, a green dado, red lamp shades and a string of warm bulbs: the back room of a pub on games night.",
  live: true,
  light: 0xffd9a6, accent: 0xf6b35c, hemiSky: 0xb08a72, hemiGround: 0x140b08, hemi: 1.0, fill: 0xffd2b0,
  frame: 0x4a2c1c, panel: 0x241511, shade: 0x7a2f22, fascia: 0x140b08, cord: 0x1a0f0b, door: 0x2a5a4e, plank: 0x6a4028, above: "#120b09",
  lamp: "shade", bulbs: ["#ffd08a"], skirt: true, doorway: "door",
  words: {},
  wall(g, w, h, k) {
    fade(g, w, h, [[0, "#150d0b"], [0.55, "#2b1913"], [1, "#22130e"]]);
    // Tongue-and-groove boards.
    const board = 0.3 * k;
    for (let x = 0, i = 0; x < w; x += board, i++) {
      g.fillStyle = `rgba(255,200,150,${0.012 + ((i * 37) % 5) * 0.008})`;
      g.fillRect(x, 0, board - 2, h);
      g.fillStyle = "rgba(0,0,0,.45)";
      g.fillRect(x + board - 2, 0, 2, h);
    }
    // Painted dado: dark green below the rail.
    const dado = h - 1.25 * k;
    g.fillStyle = "rgba(18,50,44,.78)";
    g.fillRect(0, dado, w, h - dado);
    g.fillStyle = "#b9853f";
    g.fillRect(0, dado - 5, w, 5);
    speckle(g, w, h, 5000, 0.05);
  },
  floor(g, w, h, k) {
    planks(g, w, h, k, 0.22, "#4a3020", "255,210,160");
    speckle(g, w, h, 9000, 0.06);
  },
};

const navy = {
  name: "The navy room",
  line: "Deep blue panels on a thin cyan grid, plain sans lettering and a lit score panel: cool, clean and a little like a game show.",
  live: true,
  light: 0xe6f3ff, accent: 0x38bdf8, hemiSky: 0x7896ea, hemiGround: 0x0a1022, hemi: 1.25, fill: 0xbcd0ff,
  frame: 0x1c2854, panel: 0x101a3c, shade: 0x1d2a56, fascia: 0x060a18, cord: 0x0a1024, door: 0x22336e, plank: 0x2a3a78, above: "#050816",
  lamp: "shade", bulbs: null, skirt: true, doorway: "door",
  words: {
    led: true,
    vars: {
      "--ink": "#eef3ff", "--soft": "#a3b0cf", "--dim": "#7482a6", "--accent": "#38bdf8", "--accent-rgb": "56, 189, 248",
      "--plate": "rgba(8, 13, 30, .93)", "--plate-line": "rgba(132, 160, 230, .34)",
      "--title": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', "--title-w": "800", "--title-size": "0.88", "--title-space": "-.025em",
    },
  },
  wall(g, w, h, k) {
    fade(g, w, h, [[0, "#060a1a"], [0.5, "#0e1a40"], [1, "#0e1a40"]]);
    const dado = h - 1.25 * k;
    fade(g, w, h, [[0, "#16255a"], [1, "#101c48"]], dado, h);
    const step = 0.5 * k;
    for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) {
      g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`;
      g.fillRect(Math.round(x), 0, 1.5, h);
    }
    for (let y = h, i = 0; y > 0; y -= step, i++) {
      g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`;
      g.fillRect(0, Math.round(y), w, 1.5);
    }
    g.fillStyle = "rgba(96,200,255,.75)";
    g.fillRect(0, dado - 3, w, 3);
    fade(g, w, h, [[0, "rgba(56,189,248,0)"], [0.5, "rgba(56,189,248,.13)"], [1, "rgba(56,189,248,0)"]], dado - 46, dado + 46);
    speckle(g, w, h, 4000, 0.03);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#1b2748";
    g.fillRect(0, 0, w, h);
    const step = 0.5 * k;
    for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) {
      g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`;
      g.fillRect(Math.round(x), 0, 2, h);
    }
    for (let y = 0, i = 0; y < h; y += step, i++) {
      g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`;
      g.fillRect(0, Math.round(y), w, 2);
    }
    speckle(g, w, h, 9000, 0.035);
  },
};

const fair = {
  name: "The fairground",
  line: "Striped canvas under a scalloped edge, bunting, coloured bulbs and sawdust on the boards: the midway Cork & Bell's stall stands on.",
  live: true,
  light: 0xffe6b8, accent: 0xffcf5c, hemiSky: 0xa9a0c8, hemiGround: 0x1a1208, hemi: 1.1, fill: 0xffe0c0,
  frame: 0xc99a3a, panel: 0x3a0f0d, shade: 0xe9d9b4, fascia: 0x0b0f2a, cord: 0x0b0f2a, door: 0x8c1d18, plank: 0xc99a3a, above: "#070b26",
  lamp: "shade", bulbs: ["#ff6b5c", "#ffd45c", "#6fc7ff", "#7fe08a"], skirt: true, doorway: "door",
  words: {
    vars: {
      "--accent": "#ffcf5c", "--accent-rgb": "255, 207, 92", "--plate": "rgba(16, 14, 44, .94)", "--plate-line": "rgba(255, 207, 92, .45)",
      "--ink": "#fff3dc", "--soft": "#d8c7a6", "--dim": "#a8977a",
      "--sign-bg": "#f3e2bd", "--sign-ink": "#7a1512", "--sign-soft": "#5a3a2a", "--sign-line": "#d9a441",
    },
  },
  wall(g, w, h, k) {
    fade(g, w, h, [[0, "#070b26"], [0.3, "#161b52"], [1, "#161b52"]]);
    const top = h - 5.32 * k;
    const stripe = 0.42 * k;
    stars(g, w, top - 20, 160, 11);
    for (let x = 0, i = 0; x < w; x += stripe, i++) {
      g.fillStyle = i % 2 ? "#e4d4ae" : "#9c2720";
      g.fillRect(x, top, stripe + 1, h - top);
    }
    // The canvas sags a little between its poles.
    for (let x = 0; x < w; x += stripe) {
      g.fillStyle = "rgba(0,0,0,.16)";
      g.fillRect(x + stripe - 5, top, 5, h - top);
    }
    fade(g, w, h, [[0, "rgba(12,6,30,.62)"], [0.5, "rgba(12,6,30,.45)"], [1, "rgba(12,6,30,.6)"]], top, h);
    // Scalloped edge and its gold trim.
    for (let x = 0, i = 0; x < w; x += stripe, i++) {
      g.beginPath();
      g.arc(x + stripe / 2, top, stripe / 2, Math.PI, 0);
      g.fillStyle = i % 2 ? "#8f857a" : "#5b1512";
      g.fill();
      g.strokeStyle = "#d9a441";
      g.lineWidth = 4;
      g.stroke();
    }
    g.fillStyle = "#d9a441";
    g.fillRect(0, top - 2, w, 6);
    // Painted boards below the rail, as in the Cork & Bell stall.
    const dado = h - 1.25 * k;
    g.fillStyle = "#141d45";
    g.fillRect(0, dado, w, h - dado);
    for (let x = 0; x < w; x += 0.28 * k) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(x, dado, 2, h - dado);
    }
    g.fillStyle = "#d9a441";
    g.fillRect(0, dado - 7, w, 9);
    speckle(g, w, h, 6000, 0.05);
  },
  floor(g, w, h, k) {
    planks(g, w, h, k, 0.34, "#6b583a", "255,230,170");
    // Sawdust and straw.
    const rnd = seeded(5);
    for (let i = 0; i < 2600; i++) {
      g.strokeStyle = `rgba(240,210,140,${0.08 + rnd() * 0.2})`;
      g.lineWidth = 1.5;
      const x = rnd() * w;
      const y = rnd() * h;
      const a = rnd() * 6.3;
      const l = 4 + rnd() * 9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5);
      g.stroke();
    }
    speckle(g, w, h, 9000, 0.07);
  },
  extras({ THREE, add, room }) {
    // Bunting strung under the lamps: forty flags, one mesh.
    const cols = [0xc8382c, 0xf2c14e, 0x2f6f8f, 0xe9d9b4];
    const flags = new THREE.InstancedMesh(new THREE.ConeGeometry(0.11, 0.24, 3), new THREE.MeshBasicMaterial(), 40);
    const at = new THREE.Object3D();
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      at.position.set((t - 0.5) * (room.w - 0.5), 6.02 + Math.pow(((t * 5) % 1) - 0.5, 2) * 0.9, room.zBack + 0.3);
      at.rotation.set(Math.PI, 0, 0);
      at.scale.set(1, 1, 0.1);
      at.updateMatrix();
      flags.setMatrixAt(i, at.matrix);
      flags.setColorAt(i, new THREE.Color(cols[i % 4]).multiplyScalar(0.75));
    }
    add(flags);
  },
};

const roof = {
  name: "The rooftop",
  line: "The city at night behind a brick parapet, each box framed in its own neon colour, ring lamps and wet paving that picks up the glow.",
  live: true,
  light: 0xffd8f2, accent: 0xff5fb0, hemiSky: 0x8a7ad8, hemiGround: 0x100a1e, hemi: 1.15, fill: 0xd8c8ff,
  frame: 0x1a1230, panel: 0x150d2a, shade: 0x2a1a44, fascia: 0x0a0618, cord: 0x0a0618, door: 0x2c3566, plank: 0x3a2f55, above: "#0c0728",
  lamp: "ring", bulbs: null, skirt: false, doorway: "door",
  neon: [0xff5fb0, 0x4fe3ff, 0xffd45c, 0x8f7bff, 0x7fe08a, 0xff8a5c],
  words: {
    led: true,
    neon: true,
    vars: {
      "--accent": "#ff5fb0", "--accent-rgb": "255, 95, 176", "--plate": "rgba(16, 9, 38, .92)", "--plate-line": "rgba(255, 95, 176, .6)",
      "--ink": "#fff0fa", "--soft": "#d3b6d9", "--dim": "#9a82a8",
      "--title": '"Nunito", system-ui, sans-serif', "--title-w": "900",
    },
  },
  wall(g, w, h, k) {
    const horizon = h - 1.25 * k;
    fade(g, w, h, [[0, "#0c0728"], [0.55, "#2c1458"], [0.85, "#7a2a68"], [1, "#c2496a"]], 0, horizon);
    stars(g, w, horizon * 0.45, 150, 23);
    // Two rows of buildings with lit windows.
    const rnd = seeded(31);
    for (const [tone, lo, hi, lit] of [
      ["#1b1140", 2.4, 5.0, 0.3],
      ["#0e0926", 1.5, 3.9, 0.42],
    ]) {
      for (let x = -30; x < w; ) {
        const bw = (0.7 + rnd() * 1.1) * k;
        const bh = (lo + rnd() * (hi - lo)) * k;
        g.fillStyle = tone;
        g.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 16; wy < horizon - 14; wy += 26)
          for (let wx = x + 12; wx < x + bw - 16; wx += 22) {
            if (rnd() > lit) continue;
            g.fillStyle = rnd() > 0.75 ? "rgba(120,225,255,.7)" : "rgba(255,206,120,.75)";
            g.fillRect(wx, wy, 9, 12);
          }
        x += bw + rnd() * 10;
      }
    }
    // The brick parapet at the roof's edge.
    g.fillStyle = "#3a2836";
    g.fillRect(0, horizon, w, h - horizon);
    for (let y = horizon, r = 0; y < h; y += 0.11 * k, r++) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(0, y, w, 2);
      for (let x = (r % 2) * 0.17 * k; x < w; x += 0.34 * k) g.fillRect(x, y, 2, 0.11 * k);
    }
    g.fillStyle = "#6a5670";
    g.fillRect(0, horizon - 4, w, 0.1 * k);
    g.fillStyle = "rgba(255,95,176,.35)";
    g.fillRect(0, horizon - 7, w, 3);
    speckle(g, w, h, 5000, 0.04);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#262330";
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 1.2 * k) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(x, 0, 3, h);
    }
    for (let y = 0; y < h; y += 1.2 * k) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(0, y, w, 3);
    }
    // Wet patches that pick up the neon.
    const rnd = seeded(9);
    for (let i = 0; i < 16; i++) {
      const rx = (0.4 + rnd() * 0.9) * k;
      glow(g, rnd() * w, rnd() * h, rx, i % 2 ? "255,110,190" : "110,220,255", 0.16, 0.25 + rnd() * 0.2);
    }
    speckle(g, w, h, 14000, 0.07);
  },
};

const camp = {
  name: "The campfire",
  line: "A clearing in the pines: the boxes hang between the trunks, paper lanterns for lamps, a tent for a door, fireflies and a fire that flickers.",
  live: true,
  light: 0xffc98a, accent: 0xff9d4a, hemiSky: 0x6f8fb0, hemiGround: 0x0a120a, hemi: 1.0, fill: 0xbfd2e6,
  frame: 0x5a3f26, panel: 0x1a140c, shade: 0xff9d4a, fascia: 0x070d0a, cord: 0x3a2a18, door: 0x000000, plank: 0x5a3f26, above: "#050d1c",
  lamp: "lantern", bulbs: null, skirt: false, doorway: "tent",
  words: {
    vars: {
      "--accent": "#ff9d4a", "--accent-rgb": "255, 157, 74", "--plate": "rgba(20, 16, 10, .94)", "--plate-line": "rgba(255, 190, 130, .36)",
      "--ink": "#fff1dc", "--soft": "#d6c2a2", "--dim": "#a08e72",
      "--sign-bg": "#4f3722", "--sign-line": "#7a5a38", "--sign-border": "2", "--sign-radius": "4",
    },
  },
  wall(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#050d1c"], [0.5, "#0b2230"], [1, "#0f2a1e"]]);
    stars(g, w, h * 0.4, 170, 41);
    const rnd = seeded(17);
    const pines = (tone, lo, hi, step) => {
      for (let x = -40; x < w + 40; x += step * k * (0.7 + rnd() * 0.6)) {
        const ph = (lo + rnd() * (hi - lo)) * k;
        const pw = ph * 0.3;
        g.fillStyle = tone;
        for (let t = 0; t < 4; t++) {
          const y0 = h - ph + t * ph * 0.2;
          const half = pw * (0.35 + t * 0.22);
          g.beginPath();
          g.moveTo(x, y0);
          g.lineTo(x + half, y0 + ph * 0.34);
          g.lineTo(x - half, y0 + ph * 0.34);
          g.fill();
        }
        g.fillRect(x - 5, h - ph * 0.3, 10, ph * 0.3);
      }
    };
    pines("#0c2a2a", 3.0, 4.6, 0.8);
    pines("#081c1a", 3.6, 5.8, 1.5);
    // Mist low between the trees.
    fade(g, w, h, [[0, "rgba(120,170,160,0)"], [1, "rgba(120,170,160,.16)"]], h - 1.8 * k, h);
    if (!side) {
      // The near trunks the boxes are strung between.
      for (const xm of L.gaps) {
        const x = (xm + L.wallW / 2) * k;
        const tw = 0.3 * k;
        const bark = g.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
        bark.addColorStop(0, "#1c120b");
        bark.addColorStop(0.5, "#3a281a");
        bark.addColorStop(1, "#150d08");
        g.fillStyle = bark;
        g.fillRect(x - tw / 2, 0, tw, h);
        for (let y = 10; y < h; y += 34) {
          g.fillStyle = "rgba(0,0,0,.35)";
          g.fillRect(x - tw / 2 + ((y * 7) % 20), y, 3, 20);
        }
      }
      // The tent latecomers crawl out of.
      const tx = (L.doorX + L.wallW / 2) * k;
      const half = 1.2 * k;
      const apex = h - 2.45 * k;
      g.fillStyle = "#c4672d";
      g.beginPath();
      g.moveTo(tx, apex);
      g.lineTo(tx + half, h);
      g.lineTo(tx - half, h);
      g.fill();
      g.fillStyle = "rgba(0,0,0,.28)";
      g.beginPath();
      g.moveTo(tx, apex);
      g.lineTo(tx + half, h);
      g.lineTo(tx, h);
      g.fill();
      const inside = g.createLinearGradient(0, h - 1.9 * k, 0, h);
      inside.addColorStop(0, "#3a1c08");
      inside.addColorStop(1, "#ffb45c");
      g.fillStyle = inside;
      g.beginPath();
      g.moveTo(tx, h - 1.95 * k);
      g.lineTo(tx + 0.5 * k, h);
      g.lineTo(tx - 0.5 * k, h);
      g.fill();
      g.strokeStyle = "#f2c9a0";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(tx - half, h);
      g.lineTo(tx, apex);
      g.lineTo(tx + half, h);
      g.stroke();
    }
    // Fireflies.
    for (let i = 0; i < 46; i++) glow(g, rnd() * w, h - (0.4 + rnd() * 3.4) * k, 9 + rnd() * 8, "220,255,130", 0.95);
    speckle(g, w, h, 5000, 0.04);
  },
  floor(g, w, h, k, side, L) {
    g.fillStyle = "#1d2c1a";
    g.fillRect(0, 0, w, h);
    // The trodden path the lights fall on.
    const y0 = (L.walkZ - 1.3 - L.zBack) * k;
    const y1 = (L.walkZ + 1.4 - L.zBack) * k;
    fade(g, w, h, [[0, "rgba(72,56,38,0)"], [0.2, "rgba(72,56,38,.95)"], [0.8, "rgba(72,56,38,.95)"], [1, "rgba(72,56,38,0)"]], y0, y1);
    const rnd = seeded(3);
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const onPath = y > y0 + 40 && y < y1 - 40;
      if (onPath && rnd() > 0.12) continue;
      g.strokeStyle = `rgba(${90 + rnd() * 60},${150 + rnd() * 60},${80 + rnd() * 30},${0.2 + rnd() * 0.3})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 8, y - 6 - rnd() * 9);
      g.stroke();
    }
    speckle(g, w, h, 14000, 0.09);
  },
  extras({ THREE, add, radial, L, flicker }) {
    // The campfire, behind the walking line, in a dark gap between two lights.
    const at = new THREE.Vector3(L.gapsWalk[Math.floor(L.gapsWalk.length / 2)], 0, L.walkZ - 1.85);
    const log = new THREE.MeshLambertMaterial({ color: 0x3a2414 });
    for (const a of [0.5, -0.6, 1.7]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 8), log);
      m.rotation.set(Math.PI / 2 - 0.25, a, 0, "YXZ");
      m.position.copy(at).setY(0.14);
      add(m);
    }
    const stones = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshLambertMaterial({ color: 0x5a5a58 }), 9);
    const o = new THREE.Object3D();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      o.position.set(at.x + Math.sin(a) * 0.5, 0.06, at.z + Math.cos(a) * 0.38);
      o.scale.set(1, 0.7, 1);
      o.updateMatrix();
      stones.setMatrixAt(i, o.matrix);
    }
    add(stones);
    const flames = [];
    for (const [dx, hgt, r, col] of [
      [0, 0.95, 0.2, 0xff8a2a],
      [-0.14, 0.62, 0.15, 0xffb03a],
      [0.15, 0.7, 0.14, 0xffb03a],
      [0.02, 0.5, 0.1, 0xfff0a0],
    ]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(r, hgt, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), transparent: true, opacity: 0.92 }));
      flame.position.set(at.x + dx, 0.18 + hgt / 2, at.z + (col === 0xff8a2a ? 0 : 0.06));
      flame.userData = { h: hgt, y: 0.18 };
      add(flame);
      flames.push(flame);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: 0xff8a3a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
    halo.scale.setScalar(3.6);
    halo.position.set(at.x, 0.6, at.z + 0.1);
    add(halo);
    // The fire breathes: each flame stretches on its own beat, and the glow follows.
    flicker((t) => {
      flames.forEach((f, i) => {
        const s = 1 + 0.16 * Math.sin(t * (7 + i * 2.3) + i) + 0.08 * Math.sin(t * 17.3 + i * 4);
        f.scale.set(1, s, 1);
        f.position.y = f.userData.y + (f.userData.h * s) / 2;
      });
      halo.material.opacity = 0.68 + 0.1 * Math.sin(t * 9.1) + 0.05 * Math.sin(t * 23);
    });
  },
};

// ---------------------------------------------------------------- concepts (stills only)

const arcade = {
  name: "The arcade",
  line: "1986, after closing: every game is a cabinet with a glowing marquee, the carpet is that carpet, and the light comes down in tubes of pink and cyan.",
  live: false,
  light: 0xd9c8ff, accent: 0xff4fd8, hemiSky: 0x7a5ad8, hemiGround: 0x0a0618, hemi: 1.1, fill: 0xc8b8ff,
  frame: 0x0c0a16, panel: 0x05040c, shade: 0x1a1430, fascia: 0x07040f, cord: 0x05040c, door: 0x1a1430, plank: 0x2a2148, above: "#07040f",
  lamp: "tube", bulbs: null, skirt: false, doorway: "none",
  neon: [0xff4fd8, 0x35e8ff, 0xffe14f, 0x7dff6a, 0xff7a3a, 0x9a7bff],
  words: {
    led: true,
    neon: true,
    vars: {
      "--accent": "#ff4fd8", "--accent-rgb": "255, 79, 216", "--plate": "rgba(10, 6, 24, .94)", "--plate-line": "rgba(53, 232, 255, .55)",
      "--ink": "#f6efff", "--soft": "#b9a8de", "--dim": "#8a7ab0",
      "--title": 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', "--title-w": "800", "--title-size": "0.74", "--title-case": "uppercase", "--title-space": ".02em",
    },
  },
  wall(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#07040f"], [0.6, "#150a2e"], [1, "#1c0d3a"]]);
    // A grid of neon triangles and squiggles, as on the wallpaper of the time.
    const rnd = seeded(86);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w;
      const y = rnd() * (h - 1.4 * k);
      const s = (0.12 + rnd() * 0.16) * k;
      g.strokeStyle = ["rgba(255,79,216,.28)", "rgba(53,232,255,.26)", "rgba(255,225,79,.22)"][i % 3];
      g.lineWidth = 3;
      g.beginPath();
      if (i % 3 === 0) {
        g.moveTo(x, y - s);
        g.lineTo(x + s, y + s * 0.7);
        g.lineTo(x - s, y + s * 0.7);
        g.closePath();
      } else if (i % 3 === 1) {
        for (let t = 0; t <= 4; t++) g.lineTo(x + (t - 2) * s * 0.5, y + (t % 2 ? -s * 0.35 : s * 0.35));
      } else g.arc(x, y, s * 0.6, 0, 7);
      g.stroke();
    }
    if (!side) {
      // Each box is the screen of a cabinet: a lit marquee over it, a control deck under its sign, a body down to the floor.
      L.xs.forEach((xm, i) => {
        const x = (xm + L.wallW / 2) * k;
        const half = (L.bw / 2 + 0.2) * k;
        const top = h - (L.by + L.bh / 2 + 0.62) * k;
        const col = ["255,79,216", "53,232,255", "255,225,79", "125,255,106", "255,122,58", "154,123,255"][i % 6];
        g.fillStyle = "#0b0816";
        g.beginPath();
        g.roundRect(x - half, top, half * 2, h - top, [0.16 * k, 0.16 * k, 0, 0]);
        g.fill();
        g.fillStyle = `rgba(${col},.14)`;
        g.fillRect(x - half, top, 0.07 * k, h - top);
        g.fillRect(x + half - 0.07 * k, top, 0.07 * k, h - top);
        // The marquee.
        glow(g, x, top + 0.26 * k, half * 1.5, col, 0.3, 0.45);
        g.fillStyle = `rgba(${col},.92)`;
        g.beginPath();
        g.roundRect(x - half + 0.1 * k, top + 0.09 * k, half * 2 - 0.2 * k, 0.34 * k, 0.05 * k);
        g.fill();
        g.fillStyle = "rgba(10,6,24,.82)";
        for (let s = -3; s <= 3; s++) g.fillRect(x + s * half * 0.24 - 0.03 * k, top + 0.18 * k, 0.06 * k, 0.16 * k);
        // The control deck: a stick and three buttons.
        const deck = h - 1.2 * k;
        g.fillStyle = "#1b1532";
        g.beginPath();
        g.moveTo(x - half, deck);
        g.lineTo(x + half, deck);
        g.lineTo(x + half - 0.06 * k, deck + 0.3 * k);
        g.lineTo(x - half + 0.06 * k, deck + 0.3 * k);
        g.fill();
        g.fillStyle = "#e9e4f5";
        g.fillRect(x - half * 0.55 - 3, deck + 0.02 * k, 6, 0.14 * k);
        g.fillStyle = "#ff3b4e";
        g.beginPath();
        g.arc(x - half * 0.55, deck + 0.02 * k, 0.06 * k, 0, 7);
        g.fill();
        ["255,225,79", "53,232,255", "255,79,216"].forEach((c, b) => {
          g.fillStyle = `rgb(${c})`;
          g.beginPath();
          g.arc(x + half * (0.05 + b * 0.27), deck + 0.14 * k, 0.05 * k, 0, 7);
          g.fill();
        });
        // The coin door.
        g.fillStyle = "#05040c";
        g.fillRect(x - 0.2 * k, h - 0.66 * k, 0.4 * k, 0.42 * k);
        g.fillStyle = `rgba(${col},.85)`;
        g.fillRect(x - 0.03 * k, h - 0.56 * k, 0.06 * k, 0.12 * k);
      });
      // The way out: a lit EXIT over a dark doorway.
      const dx = (L.doorX + L.wallW / 2) * k;
      g.fillStyle = "#04030a";
      g.fillRect(dx - 0.5 * k, h - 2.2 * k, k, 2.2 * k);
      glow(g, dx, h - 2.42 * k, 0.7 * k, "125,255,106", 0.35, 0.5);
      g.fillStyle = "#7dff6a";
      g.font = `800 ${0.2 * k}px ui-monospace, Menlo, Consolas, monospace`;
      g.textAlign = "center";
      g.fillText("EXIT", dx, h - 2.34 * k);
    }
    g.fillStyle = "rgba(255,79,216,.8)";
    g.fillRect(0, h - 0.06 * k, w, 0.03 * k);
    speckle(g, w, h, 5000, 0.04);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#120a26";
    g.fillRect(0, 0, w, h);
    // That carpet: confetti shapes on dark purple.
    const rnd = seeded(1986);
    const cols = ["#ff4fd8", "#35e8ff", "#ffe14f", "#7dff6a", "#ff7a3a"];
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const s = (0.05 + rnd() * 0.08) * k;
      g.save();
      g.translate(x, y);
      g.rotate(rnd() * 6.3);
      g.globalAlpha = 0.5 + rnd() * 0.3;
      g.strokeStyle = g.fillStyle = cols[i % 5];
      g.lineWidth = 4;
      g.beginPath();
      if (i % 4 === 0) g.fillRect(-s / 2, -s / 2, s, s * 0.4);
      else if (i % 4 === 1) {
        g.moveTo(0, -s);
        g.lineTo(s * 0.8, s * 0.6);
        g.lineTo(-s * 0.8, s * 0.6);
        g.fill();
      } else if (i % 4 === 2) {
        g.arc(0, 0, s * 0.7, 0, 4);
        g.stroke();
      } else {
        for (let t = 0; t <= 3; t++) g.lineTo((t - 1.5) * s * 0.6, t % 2 ? -s * 0.4 : s * 0.4);
        g.stroke();
      }
      g.restore();
    }
    speckle(g, w, h, 12000, 0.06);
  },
};

const submarine = {
  name: "The submarine",
  line: "Riveted steel and brass, pipes and gauges along the hull, every game behind a hatch window, and the light a slow underwater green.",
  live: false,
  light: 0xc8ffe6, accent: 0xffb347, hemiSky: 0x5fa89a, hemiGround: 0x06100f, hemi: 1.05, fill: 0xb8e6d8,
  frame: 0xa9772c, panel: 0x08201f, shade: 0x8a6a2a, fascia: 0x050d0d, cord: 0x1c2a2a, door: 0x35504c, plank: 0x6b5a34, above: "#0a1a1b",
  lamp: "dome", bulbs: null, skirt: false, doorway: "hatch", mount: "hatch",
  words: {
    led: true,
    vars: {
      "--accent": "#ffb347", "--accent-rgb": "255, 179, 71", "--plate": "rgba(8, 24, 24, .94)", "--plate-line": "rgba(255, 190, 110, .5)",
      "--ink": "#eafff6", "--soft": "#a8cdc2", "--dim": "#7a9f96",
      "--title": '"Nunito", system-ui, sans-serif', "--title-w": "900", "--title-size": "0.86", "--title-case": "uppercase", "--title-space": ".03em",
      "--sign-bg": "#b98a3a", "--sign-ink": "#1a1206", "--sign-soft": "#3a2a10", "--sign-line": "#e6c27a", "--sign-radius": "3",
    },
  },
  wall(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#0e2424"], [0.5, "#1c3f3c"], [1, "#16302e"]]);
    // Hull plates and their rivets.
    const plate = 1.42 * k;
    for (let x = 0, i = 0; x < w + plate; x += plate, i++) {
      g.fillStyle = `rgba(160,230,210,${0.02 + (i % 3) * 0.018})`;
      g.fillRect(x, 0, plate - 3, h);
      g.fillStyle = "rgba(0,0,0,.5)";
      g.fillRect(x - 3, 0, 3, h);
      for (let y = 0.2 * k; y < h; y += 0.3 * k) {
        g.fillStyle = "rgba(0,0,0,.45)";
        g.beginPath();
        g.arc(x + 0.09 * k + 1, y + 2, 0.028 * k, 0, 7);
        g.fill();
        g.fillStyle = "rgba(190,240,225,.3)";
        g.beginPath();
        g.arc(x + 0.09 * k, y, 0.026 * k, 0, 7);
        g.fill();
      }
    }
    // Ribs, and the pipes that run the length of the boat.
    for (const [ym, t, tone, hi] of [
      [6.2, 0.16, "#7a5a26", "rgba(255,220,150,.5)"],
      [5.95, 0.07, "#28504c", "rgba(190,240,225,.35)"],
      [1.25, 0.12, "#7a5a26", "rgba(255,220,150,.5)"],
      [0.98, 0.06, "#8c2f24", "rgba(255,190,170,.4)"],
    ]) {
      const y = h - ym * k;
      g.fillStyle = tone;
      g.fillRect(0, y, w, t * k);
      g.fillStyle = hi;
      g.fillRect(0, y + t * k * 0.18, w, t * k * 0.14);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(0, y + t * k, w, 5);
    }
    g.fillStyle = "rgba(4,14,14,.5)";
    g.fillRect(0, h - 0.92 * k, w, 0.92 * k);
    if (!side) {
      // Gauges and a valve wheel in the gaps between the hatch windows.
      L.gaps.slice(1).forEach((xm, i) => {
        const x = (xm + L.wallW / 2) * k;
        const y = h - (i % 2 ? 3.1 : 4.55) * k;
        const r = 0.15 * k;
        g.fillStyle = "#a9772c";
        g.beginPath();
        g.arc(x, y, r * 1.22, 0, 7);
        g.fill();
        g.fillStyle = "#f1ead6";
        g.beginPath();
        g.arc(x, y, r, 0, 7);
        g.fill();
        g.strokeStyle = "#1a1206";
        g.lineWidth = 2;
        for (let t = 0; t < 9; t++) {
          const a = Math.PI * (0.85 + (t / 8) * 1.3);
          g.beginPath();
          g.moveTo(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72);
          g.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
          g.stroke();
        }
        g.strokeStyle = "#c8382c";
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(-0.9 - i) * r * 0.7, y + Math.sin(-0.9 - i) * r * 0.7);
        g.stroke();
      });
      // The round hatch at the left end, where the door is in other rooms.
      const dx = (L.doorX + L.wallW / 2) * k;
      const dy = h - 1.18 * k;
      g.fillStyle = "#0a1a1a";
      g.beginPath();
      g.ellipse(dx, dy, 0.62 * k, 1.02 * k, 0, 0, 7);
      g.fill();
      g.fillStyle = "#35504c";
      g.beginPath();
      g.ellipse(dx, dy, 0.52 * k, 0.92 * k, 0, 0, 7);
      g.fill();
      g.strokeStyle = "#a9772c";
      g.lineWidth = 0.07 * k;
      g.beginPath();
      g.ellipse(dx, dy, 0.57 * k, 0.97 * k, 0, 0, 7);
      g.stroke();
      g.lineWidth = 0.035 * k;
      g.beginPath();
      g.arc(dx, dy, 0.22 * k, 0, 7);
      g.stroke();
      for (let a = 0; a < 3; a++) {
        g.beginPath();
        g.moveTo(dx - Math.cos((a * Math.PI) / 3) * 0.22 * k, dy - Math.sin((a * Math.PI) / 3) * 0.22 * k);
        g.lineTo(dx + Math.cos((a * Math.PI) / 3) * 0.22 * k, dy + Math.sin((a * Math.PI) / 3) * 0.22 * k);
        g.stroke();
      }
    }
    speckle(g, w, h, 7000, 0.05);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#1f3432";
    g.fillRect(0, 0, w, h);
    // Deck grating.
    for (let x = 0; x < w; x += 0.12 * k) {
      g.fillStyle = "rgba(0,0,0,.42)";
      g.fillRect(x, 0, 0.05 * k, h);
    }
    for (let y = 0; y < h; y += 0.6 * k) {
      g.fillStyle = "rgba(160,230,210,.16)";
      g.fillRect(0, y, w, 0.05 * k);
      g.fillStyle = "rgba(0,0,0,.5)";
      g.fillRect(0, y + 0.05 * k, w, 4);
    }
    for (let x = 0; x < w; x += 2.4 * k) {
      g.fillStyle = "rgba(169,119,44,.5)";
      g.fillRect(x, 0, 0.06 * k, h);
    }
    speckle(g, w, h, 12000, 0.07);
  },
};

const train = {
  name: "The night train",
  line: "A sleeper's lounge car: the games are travel posters over the seats, brass luggage racks, reading lamps, and a moonlit country going by the windows.",
  live: false,
  light: 0xffe2b0, accent: 0xe8b04a, hemiSky: 0x9a8a72, hemiGround: 0x120c08, hemi: 1.0, fill: 0xffdcb8,
  frame: 0x8a6a2a, panel: 0x1c120c, shade: 0xe8d3a0, fascia: 0x0d0806, cord: 0x8a6a2a, door: 0x5a2f22, plank: 0x8a6a2a, above: "#1a110c",
  lamp: "globe", bulbs: null, skirt: true, doorway: "door",
  words: {
    vars: {
      "--accent": "#e8b04a", "--accent-rgb": "232, 176, 74", "--plate": "rgba(28, 17, 12, .94)", "--plate-line": "rgba(232, 176, 74, .5)",
      "--ink": "#fff1d8", "--soft": "#d8c09a", "--dim": "#a48f6c",
      "--sign-bg": "#efe2c4", "--sign-ink": "#3a1410", "--sign-soft": "#5a4030", "--sign-line": "#c9a25a", "--sign-radius": "3",
    },
  },
  wall(g, w, h, k, side, L) {
    // Walnut panelling above, a curved cream ceiling at the very top.
    fade(g, w, h, [[0, "#3a2a1c"], [0.08, "#4a2c1a"], [1, "#3a2114"]]);
    fade(g, w, h, [[0, "#d9c9a4"], [1, "#8a7650"]], 0, h - 6.25 * k);
    g.fillStyle = "#8a6a2a";
    g.fillRect(0, h - 6.25 * k, w, 0.06 * k);
    for (let x = 0, i = 0; x < w; x += 0.71 * k, i++) {
      g.fillStyle = `rgba(255,190,130,${0.02 + (i % 3) * 0.015})`;
      g.fillRect(x, h - 6.19 * k, 0.71 * k - 3, 6.19 * k);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(x - 3, h - 6.19 * k, 3, 6.19 * k);
    }
    if (!side) {
      // Windows in the gaps between the posters: a moonlit country going by.
      const rnd = seeded(77);
      for (const xm of L.gaps) {
        const x = (xm + L.wallW / 2) * k;
        const ww = Math.max(0.22, L.slot - L.bw - 0.52) * k;
        const top = h - 5.0 * k;
        const bottom = h - 2.75 * k;
        g.save();
        g.beginPath();
        g.roundRect(x - ww / 2, top, ww, bottom - top, 0.1 * k);
        g.clip();
        fade(g, w, h, [[0, "#0a1230"], [0.7, "#2a3a6a"], [1, "#4a5a86"]], top, bottom);
        stars(g, w, bottom - 0.6 * k, 300, 100 + Math.abs(Math.round(xm * 10)), top);
        g.fillStyle = "#0c1326";
        g.beginPath();
        g.moveTo(x - ww, bottom);
        for (let t = -1; t <= 1.01; t += 0.1) g.lineTo(x + t * ww, bottom - (0.35 + 0.22 * Math.sin(t * 5 + xm) + rnd() * 0.05) * k);
        g.lineTo(x + ww, bottom);
        g.fill();
        g.restore();
        g.strokeStyle = "#8a6a2a";
        g.lineWidth = 0.05 * k;
        g.beginPath();
        g.roundRect(x - ww / 2, top, ww, bottom - top, 0.1 * k);
        g.stroke();
      }
      // The moon, in the first window.
      const mx = (L.gaps[0] + L.wallW / 2) * k;
      glow(g, mx, h - 4.5 * k, 0.3 * k, "255,244,214", 0.9);
      // The luggage rack: a brass rail over everything, with a case and a hat box on it.
      const rack = h - 5.52 * k;
      g.fillStyle = "#b08a3a";
      g.fillRect(0.3 * k, rack, w - 0.6 * k, 0.045 * k);
      g.fillRect(0.3 * k, rack + 0.14 * k, w - 0.6 * k, 0.03 * k);
      for (let x = 0.3 * k; x < w; x += 1.1 * k) g.fillRect(x, rack, 0.03 * k, 0.17 * k);
      for (const [xm, bw, bh, tone] of [
        [L.xs[0] + 0.1, 0.9, 0.36, "#6a3a22"],
        [L.xs[L.xs.length - 1] - 0.2, 0.7, 0.3, "#2f4a3a"],
        [L.gaps[Math.floor(L.gaps.length / 2)], 0.42, 0.4, "#8a2a24"],
      ]) {
        const x = (xm + L.wallW / 2) * k;
        g.fillStyle = tone;
        g.beginPath();
        g.roundRect(x - (bw * k) / 2, rack - bh * k, bw * k, bh * k, 0.05 * k);
        g.fill();
        g.fillStyle = "rgba(232,176,74,.8)";
        g.fillRect(x - (bw * k) / 2 + 0.1 * k, rack - bh * k, 0.04 * k, bh * k);
        g.fillRect(x + (bw * k) / 2 - 0.14 * k, rack - bh * k, 0.04 * k, bh * k);
      }
    }
    // The seat backs: buttoned green plush below the rail, with a white antimacassar behind each head.
    const seat = h - 1.25 * k;
    fade(g, w, h, [[0, "#1f4a3a"], [1, "#12301f"]], seat, h);
    for (let x = 0, i = 0; x < w; x += 0.36 * k, i++) {
      g.fillStyle = "rgba(0,0,0,.28)";
      g.fillRect(x, seat, 3, h - seat);
      for (let y = seat + 0.2 * k; y < h; y += 0.36 * k) {
        g.fillStyle = "rgba(232,176,74,.65)";
        g.beginPath();
        g.arc(x + (Math.round(y) % 2 ? 0.18 * k : 0), y, 0.02 * k, 0, 7);
        g.fill();
      }
    }
    g.fillStyle = "#8a6a2a";
    g.fillRect(0, seat - 0.07 * k, w, 0.08 * k);
    speckle(g, w, h, 6000, 0.05);
  },
  floor(g, w, h, k, side, L) {
    planks(g, w, h, k, 0.2, "#3f2a1c", "255,205,150");
    // A carpet runner down the aisle, under the lights.
    const y0 = (L.walkZ - 0.95 - L.zBack) * k;
    const y1 = (L.walkZ + 1.05 - L.zBack) * k;
    g.fillStyle = "#6a1f24";
    g.fillRect(0, y0, w, y1 - y0);
    g.fillStyle = "#c9a25a";
    g.fillRect(0, y0 + 0.1 * k, w, 0.04 * k);
    g.fillRect(0, y1 - 0.14 * k, w, 0.04 * k);
    for (let x = 0.4 * k; x < w; x += 0.8 * k) {
      g.fillStyle = "rgba(201,162,90,.4)";
      g.beginPath();
      g.moveTo(x, (y0 + y1) / 2 - 0.3 * k);
      g.lineTo(x + 0.22 * k, (y0 + y1) / 2);
      g.lineTo(x, (y0 + y1) / 2 + 0.3 * k);
      g.lineTo(x - 0.22 * k, (y0 + y1) / 2);
      g.fill();
    }
    speckle(g, w, h, 12000, 0.07);
  },
};

const ship = {
  name: "The star lounge",
  line: "The observation deck of a slow ship: one long window on a ringed planet, the games as floating panels of light, and a floor that glows where you may stand.",
  live: false,
  light: 0xcfe8ff, accent: 0x6ee7ff, hemiSky: 0x7fa8ff, hemiGround: 0x05070f, hemi: 1.2, fill: 0xc4d8ff,
  frame: 0xdfe8f5, panel: 0x05070f, shade: 0xe8eef8, fascia: 0x04060c, cord: 0x9fb4d0, door: 0xb9c6da, plank: 0xb9c6da, above: "#04060c",
  lamp: "ring", bulbs: null, skirt: true, doorway: "none",
  neon: [0x6ee7ff, 0x9d8bff, 0x7dffb8, 0xffc76e, 0xff8fd0, 0x6ea8ff],
  words: {
    led: true,
    neon: true,
    vars: {
      "--accent": "#6ee7ff", "--accent-rgb": "110, 231, 255", "--plate": "rgba(6, 10, 22, .9)", "--plate-line": "rgba(110, 231, 255, .6)",
      "--ink": "#f0f8ff", "--soft": "#a9c0dc", "--dim": "#7b90ac",
      "--title": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', "--title-w": "300", "--title-size": "0.82", "--title-case": "uppercase", "--title-space": ".12em",
    },
  },
  wall(g, w, h, k, side, L) {
    // Space, through one long window.
    fade(g, w, h, [[0, "#02030a"], [0.6, "#070b20"], [1, "#0d1230"]]);
    stars(g, w, h - 1.3 * k, side ? 120 : 520, side ? 3 : 61);
    if (!side) {
      // A far nebula and a ringed planet rising at the right.
      glow(g, w * 0.28, h - 4.6 * k, 2.6 * k, "120,90,220", 0.22, 0.5);
      glow(g, w * 0.4, h - 3.9 * k, 1.8 * k, "70,170,230", 0.16, 0.6);
      const px = w * 0.8;
      const py = h - 2.6 * k;
      const pr = 2.3 * k;
      glow(g, px, py, pr * 1.5, "255,170,110", 0.2);
      const body = g.createRadialGradient(px - pr * 0.4, py - pr * 0.5, pr * 0.1, px, py, pr);
      body.addColorStop(0, "#ffd9a8");
      body.addColorStop(0.5, "#d98a5a");
      body.addColorStop(1, "#4a2440");
      g.fillStyle = body;
      g.beginPath();
      g.arc(px, py, pr, 0, 7);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(px, py, pr, 0, 7);
      g.clip();
      for (let b = -4; b <= 4; b++) {
        g.fillStyle = `rgba(${b % 2 ? "255,235,200" : "120,50,60"},.12)`;
        g.fillRect(px - pr, py + b * pr * 0.2, pr * 2, pr * 0.09);
      }
      g.restore();
      g.save();
      g.translate(px, py);
      g.rotate(-0.32);
      for (const [r, a, lw] of [
        [1.9, 0.5, 0.11],
        [1.62, 0.3, 0.07],
        [2.12, 0.22, 0.04],
      ]) {
        g.strokeStyle = `rgba(255,226,190,${a})`;
        g.lineWidth = lw * k;
        g.beginPath();
        g.ellipse(0, 0, pr * r, pr * r * 0.2, 0, 0.14, Math.PI - 0.14);
        g.stroke();
      }
      g.restore();
    }
    // The window's frame: white ribs, and a sill with a line of light under it.
    for (let x = side ? 0.6 * k : ((w / 2) % (3.55 * k)) - 3.55 * k; x < w + k; x += 3.55 * k) {
      const rib = g.createLinearGradient(x - 0.11 * k, 0, x + 0.11 * k, 0);
      rib.addColorStop(0, "#8a98b0");
      rib.addColorStop(0.4, "#eef3fb");
      rib.addColorStop(1, "#6a7890");
      g.fillStyle = rib;
      g.fillRect(x - 0.11 * k, 0, 0.22 * k, h);
    }
    const sill = h - 1.25 * k;
    fade(g, w, h, [[0, "#e4ebf6"], [0.12, "#aab8ce"], [1, "#56647e"]], sill, h);
    for (let x = 0; x < w; x += 1.775 * k) {
      g.fillStyle = "rgba(0,0,0,.22)";
      g.fillRect(x, sill + 0.14 * k, 3, h - sill);
    }
    g.fillStyle = "#6ee7ff";
    g.fillRect(0, sill + 0.08 * k, w, 0.035 * k);
    glow(g, w / 2, sill + 0.1 * k, w * 0.6, "110,231,255", 0.2, 0.05);
    fade(g, w, h, [[0, "#cfd8e8"], [1, "#7c8aa4"]], 0, h - 6.3 * k);
    speckle(g, w, h, 4000, 0.03);
  },
  floor(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#39435a"], [1, "#222a3c"]]);
    // Hexagonal deck plates, and a lit strip either side of where you walk.
    const s = 0.42 * k;
    g.strokeStyle = "rgba(190,215,255,.16)";
    g.lineWidth = 2.5;
    for (let row = 0, y = 0; y < h + s; y += s * 0.87, row++)
      for (let x = (row % 2) * s * 1.5; x < w + s; x += s * 3) {
        g.beginPath();
        for (let a = 0; a < 6; a++) g.lineTo(x + Math.cos((a * Math.PI) / 3) * s, y + Math.sin((a * Math.PI) / 3) * s * 0.87);
        g.closePath();
        g.stroke();
      }
    for (const z of [L.walkZ - 1.25, L.walkZ + 1.3]) {
      const y = (z - L.zBack) * k;
      glow(g, w / 2, y, w * 0.6, "110,231,255", 0.22, 0.03);
      g.fillStyle = "rgba(110,231,255,.9)";
      g.fillRect(0, y - 2, w, 4);
    }
    speckle(g, w, h, 10000, 0.05);
  },
};

export const SKINS = { bar, navy, roof, camp, fair, arcade, submarine, train, ship };
for (const [id, skin] of Object.entries(SKINS)) skin.id = id;

export const DEFAULT_SKIN = "bar";

/** The skin a live room uses for `id`: a live skin by that name, or the bar. */
export function liveSkin(id) {
  return SKINS[id]?.live ? SKINS[id] : SKINS[DEFAULT_SKIN];
}
