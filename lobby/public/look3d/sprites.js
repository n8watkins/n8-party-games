// The things that pass by: small pictures painted once on a canvas and flown across a room by
// look3d/life.js. Every one is our own drawing; none is anyone's character or mark.
//
// A painter is (g, w, h, frame): a 2D context, the size of one frame in pixels, and which frame
// of its little animation to paint (0 or 1; most have only one). Each faces right.

const fill = (g, colour) => ((g.fillStyle = colour), g);
function blob(g, x, y, rx, ry, colour, turn = 0) {
  fill(g, colour).beginPath();
  g.ellipse(x, y, rx, ry, turn, 0, 7);
  g.fill();
}
function soft(g, x, y, r, rgb, alpha = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(0.35, `rgba(${rgb},${alpha * 0.45})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
function poly(g, colour, pts) {
  fill(g, colour).beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.fill();
}

export const SPRITES = {
  /** A night flight: a dark airliner with lit windows; its wing light blinks on the second frame. */
  plane: {
    frames: 2,
    paint(g, w, h, frame) {
      blob(g, w * 0.5, h * 0.52, w * 0.4, h * 0.13, "#1a2038");
      poly(g, "#1a2038", [[w * 0.12, h * 0.5], [w * 0.04, h * 0.12], [w * 0.16, h * 0.14], [w * 0.3, h * 0.5]]);
      poly(g, "#10152a", [[w * 0.42, h * 0.55], [w * 0.3, h * 0.92], [w * 0.4, h * 0.92], [w * 0.62, h * 0.55]]);
      for (let i = 0; i < 9; i++) fill(g, "rgba(255,226,150,.95)").fillRect(w * (0.34 + i * 0.05), h * 0.44, w * 0.022, h * 0.07);
      soft(g, w * 0.9, h * 0.5, h * 0.2, "255,255,255", 0.8);
      if (frame) soft(g, w * 0.34, h * 0.9, h * 0.45, "255,60,60", 1);
      else soft(g, w * 0.07, h * 0.14, h * 0.3, "120,255,140", 0.9);
    },
  },

  /** An owl, wings up and wings down. */
  owl: {
    frames: 2,
    paint(g, w, h, frame) {
      const up = frame ? 1 : -1;
      for (const s of [-1, 1]) {
        poly(g, "#4a3524", [[w * 0.5, h * 0.5], [w * (0.5 + s * 0.46), h * (0.5 - up * 0.3)], [w * (0.5 + s * 0.4), h * (0.5 - up * 0.08)], [w * (0.5 + s * 0.2), h * 0.64]]);
        poly(g, "#6b4e34", [[w * 0.5, h * 0.52], [w * (0.5 + s * 0.3), h * (0.5 - up * 0.17)], [w * (0.5 + s * 0.16), h * 0.62]]);
      }
      blob(g, w * 0.5, h * 0.56, w * 0.13, h * 0.3, "#5a4230");
      blob(g, w * 0.5, h * 0.36, w * 0.14, h * 0.2, "#6b4e34");
      poly(g, "#6b4e34", [[w * 0.38, h * 0.24], [w * 0.4, h * 0.08], [w * 0.47, h * 0.22]]);
      poly(g, "#6b4e34", [[w * 0.62, h * 0.24], [w * 0.6, h * 0.08], [w * 0.53, h * 0.22]]);
      for (const s of [-1, 1]) {
        blob(g, w * (0.5 + s * 0.06), h * 0.35, w * 0.05, h * 0.09, "#ffe9a8");
        blob(g, w * (0.5 + s * 0.06), h * 0.36, w * 0.022, h * 0.045, "#1a1208");
      }
      poly(g, "#e0a030", [[w * 0.48, h * 0.42], [w * 0.52, h * 0.42], [w * 0.5, h * 0.5]]);
    },
  },

  /** Five birds in a loose V, far off. */
  birds: {
    frames: 2,
    paint(g, w, h, frame) {
      g.strokeStyle = "rgba(14,12,30,.9)";
      g.lineWidth = Math.max(2, h * 0.035);
      g.lineCap = "round";
      [[0.8, 0.5], [0.62, 0.32], [0.6, 0.7], [0.42, 0.16], [0.38, 0.86]].forEach(([x, y], i) => {
        const dip = (frame + i) % 2 ? 0.07 : -0.05;
        g.beginPath();
        g.moveTo(w * (x - 0.07), h * (y + dip));
        g.quadraticCurveTo(w * (x - 0.03), h * (y - 0.06), w * x, h * y);
        g.quadraticCurveTo(w * (x + 0.03), h * (y - 0.06), w * (x + 0.07), h * (y + dip));
        g.stroke();
      });
    },
  },

  /** A shooting star: a bright head and a tail that thins out behind it. */
  star: {
    frames: 1,
    paint(g, w, h) {
      const tail = g.createLinearGradient(0, 0, w, 0);
      tail.addColorStop(0, "rgba(255,255,255,0)");
      tail.addColorStop(1, "rgba(255,255,255,.95)");
      poly(g, tail, [[0, h * 0.5], [w * 0.92, h * 0.36], [w * 0.92, h * 0.64]]);
      soft(g, w * 0.92, h * 0.5, h * 0.5, "255,255,255", 1);
    },
  },

  /** A comet: a blue-white head and two tails. */
  comet: {
    frames: 1,
    paint(g, w, h) {
      for (const [y, rgb, a] of [[0.3, "150,220,255", 0.5], [0.62, "255,240,200", 0.75]]) {
        const tail = g.createLinearGradient(0, 0, w, 0);
        tail.addColorStop(0, `rgba(${rgb},0)`);
        tail.addColorStop(1, `rgba(${rgb},${a})`);
        poly(g, tail, [[0, h * y], [w * 0.86, h * 0.34], [w * 0.86, h * 0.66]]);
      }
      soft(g, w * 0.86, h * 0.5, h * 0.5, "210,240,255", 1);
      blob(g, w * 0.86, h * 0.5, h * 0.13, h * 0.13, "#ffffff");
    },
  },

  /** A small rocket with a porthole and a flame that gutters between frames. */
  rocket: {
    frames: 2,
    paint(g, w, h, frame) {
      soft(g, w * 0.16, h * 0.5, h * (frame ? 0.5 : 0.36), "255,170,60", 1);
      poly(g, frame ? "#ffe9a8" : "#ffb347", [[w * 0.3, h * 0.36], [w * (frame ? 0.04 : 0.12), h * 0.5], [w * 0.3, h * 0.64]]);
      poly(g, "#d8402a", [[w * 0.3, h * 0.3], [w * 0.2, h * 0.06], [w * 0.46, h * 0.3]]);
      poly(g, "#d8402a", [[w * 0.3, h * 0.7], [w * 0.2, h * 0.94], [w * 0.46, h * 0.7]]);
      fill(g, "#eef3fb").beginPath();
      g.moveTo(w * 0.28, h * 0.28);
      g.lineTo(w * 0.7, h * 0.28);
      g.quadraticCurveTo(w * 0.98, h * 0.5, w * 0.7, h * 0.72);
      g.lineTo(w * 0.28, h * 0.72);
      g.fill();
      fill(g, "#d8402a").fillRect(w * 0.36, h * 0.28, w * 0.05, h * 0.44);
      blob(g, w * 0.62, h * 0.5, h * 0.13, h * 0.13, "#2a3f6e");
      blob(g, w * 0.61, h * 0.47, h * 0.05, h * 0.05, "#9fd8ff");
    },
  },

  /** A saucer with a dome and a ring of lights that chase between frames. */
  saucer: {
    frames: 2,
    paint(g, w, h, frame) {
      soft(g, w * 0.5, h * 0.74, w * 0.4, "140,255,200", 0.5);
      blob(g, w * 0.5, h * 0.4, w * 0.2, h * 0.3, "rgba(170,240,255,.8)");
      blob(g, w * 0.5, h * 0.56, w * 0.46, h * 0.17, "#aab8ce");
      blob(g, w * 0.5, h * 0.52, w * 0.46, h * 0.13, "#dfe8f5");
      for (let i = 0; i < 6; i++) blob(g, w * (0.16 + i * 0.136), h * 0.57, w * 0.028, w * 0.028, (i + frame) % 2 ? "#ffe14f" : "#ff4fd8");
    },
  },

  /** Tumbling rocks. */
  rocks: {
    frames: 1,
    paint(g, w, h) {
      [[0.14, 0.5, 0.11], [0.36, 0.26, 0.07], [0.5, 0.7, 0.14], [0.72, 0.36, 0.09], [0.88, 0.66, 0.06]].forEach(([x, y, r], i) => {
        const pts = [];
        for (let a = 0; a < 8; a++) {
          const k = r * h * (0.75 + ((i * 7 + a * 5) % 6) * 0.07);
          pts.push([w * x + Math.cos((a / 8) * 6.283) * k, h * y + Math.sin((a / 8) * 6.283) * k]);
        }
        poly(g, "#5d5568", pts);
        poly(g, "#8a8296", pts.slice(4).concat([[w * x, h * y]]));
      });
    },
  },

  /** A ringed planet, seen whole. */
  planet: {
    frames: 1,
    paint(g, w, h) {
      const [x, y, r] = [w * 0.5, h * 0.5, h * 0.34];
      soft(g, x, y, r * 1.45, "255,170,110", 0.28);
      const ring = (front) => {
        g.save();
        g.translate(x, y);
        g.rotate(-0.32);
        for (const [k, a, lw] of [[1.72, 0.55, 0.1], [1.45, 0.32, 0.06], [1.92, 0.24, 0.035]]) {
          g.strokeStyle = `rgba(255,226,190,${a})`;
          g.lineWidth = lw * r;
          g.beginPath();
          g.ellipse(0, 0, r * k, r * k * 0.22, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
          g.stroke();
        }
        g.restore();
      };
      ring(false);
      const body = g.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.1, x, y, r);
      body.addColorStop(0, "#ffd9a8");
      body.addColorStop(0.5, "#d98a5a");
      body.addColorStop(1, "#4a2440");
      fill(g, body).beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.clip();
      for (let b = -4; b <= 4; b++) fill(g, `rgba(${b % 2 ? "255,235,200" : "120,50,60"},.13)`).fillRect(x - r, y + b * r * 0.2, r * 2, r * 0.09);
      g.restore();
      ring(true);
    },
  },

  /** A small blue moon. */
  moon: {
    frames: 1,
    paint(g, w, h) {
      const [x, y, r] = [w * 0.5, h * 0.5, h * 0.4];
      soft(g, x, y, r * 1.2, "140,190,255", 0.25);
      const body = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
      body.addColorStop(0, "#dff0ff");
      body.addColorStop(0.6, "#7fa8d8");
      body.addColorStop(1, "#1a2a55");
      fill(g, body).beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
      for (const [cx, cy, cr] of [[-0.3, 0.1, 0.16], [0.25, -0.3, 0.1], [0.3, 0.35, 0.13]]) blob(g, x + cx * r, y + cy * r, cr * r, cr * r * 0.8, "rgba(20,40,90,.28)");
    },
  },

  /** A whale, as a shape in the water. */
  whale: {
    frames: 2,
    paint(g, w, h, frame) {
      const sway = frame ? 0.06 : -0.06;
      poly(g, "#3f7482", [[w * 0.16, h * 0.5], [w * 0.02, h * (0.2 + sway)], [w * 0.1, h * 0.5], [w * 0.02, h * (0.8 + sway)]]);
      fill(g, "#5b93a0").beginPath();
      g.moveTo(w * 0.1, h * 0.5);
      g.quadraticCurveTo(w * 0.5, h * 0.02, w * 0.92, h * 0.4);
      g.quadraticCurveTo(w * 1.0, h * 0.56, w * 0.9, h * 0.66);
      g.quadraticCurveTo(w * 0.5, h * 0.96, w * 0.1, h * 0.5);
      g.fill();
      fill(g, "rgba(225,250,245,.6)").beginPath();
      g.moveTo(w * 0.3, h * 0.62);
      g.quadraticCurveTo(w * 0.6, h * 0.9, w * 0.9, h * 0.66);
      g.quadraticCurveTo(w * 0.6, h * 0.74, w * 0.3, h * 0.62);
      g.fill();
      poly(g, "#3f7482", [[w * 0.58, h * 0.66], [w * 0.5, h * 0.96], [w * 0.68, h * 0.7]]);
      blob(g, w * 0.84, h * 0.47, w * 0.012, w * 0.012, "#0a2028");
    },
  },

  /** A shoal of small fish. */
  fish: {
    frames: 2,
    paint(g, w, h, frame) {
      const cols = ["#ffb347", "#ffd76a", "#ff8a5c"];
      for (let i = 0; i < 11; i++) {
        const x = w * (0.1 + ((i * 37) % 80) / 100);
        const y = h * (0.14 + ((i * 53) % 72) / 100);
        const s = h * 0.07;
        poly(g, cols[i % 3], [[x - s * 1.5, y], [x - s * 2.4, y - s * (0.7 + ((i + frame) % 2) * 0.3)], [x - s * 2.4, y + s * 0.8]]);
        blob(g, x, y, s * 1.5, s * 0.75, cols[i % 3]);
        blob(g, x + s * 0.8, y - s * 0.15, s * 0.16, s * 0.16, "#102028");
      }
    },
  },

  /** A jellyfish that pulses. */
  jelly: {
    frames: 2,
    paint(g, w, h, frame) {
      const wide = frame ? 0.44 : 0.36;
      soft(g, w * 0.5, h * 0.3, w * 0.5, "255,150,220", 0.4);
      fill(g, "rgba(255,170,230,.8)").beginPath();
      g.ellipse(w * 0.5, h * 0.3, w * wide, h * (frame ? 0.2 : 0.25), 0, Math.PI, 0);
      g.fill();
      g.strokeStyle = "rgba(255,190,235,.7)";
      g.lineWidth = w * 0.03;
      for (let i = 0; i < 5; i++) {
        const x = w * (0.5 + (i - 2) * wide * 0.4);
        g.beginPath();
        g.moveTo(x, h * 0.3);
        g.bezierCurveTo(x + w * 0.1 * (frame ? 1 : -1), h * 0.5, x - w * 0.1 * (frame ? 1 : -1), h * 0.7, x, h * 0.94);
        g.stroke();
      }
    },
  },

  /** A train going the other way: a streak of lit windows. */
  express: {
    frames: 1,
    paint(g, w, h) {
      fill(g, "#0a0e1c").fillRect(0, h * 0.1, w, h * 0.8);
      fill(g, "#1c2440").fillRect(0, h * 0.1, w, h * 0.12);
      for (let x = w * 0.01; x < w; x += w * 0.05) {
        fill(g, "#ffe2a0").fillRect(x, h * 0.3, w * 0.036, h * 0.36);
        fill(g, "rgba(120,80,30,.55)").fillRect(x + w * 0.02, h * 0.42, w * 0.01, h * 0.24);
      }
      fill(g, "#c8382c").fillRect(0, h * 0.74, w, h * 0.05);
    },
  },

  /** A searchlight on the clouds with a pawn in the middle of it: the party's own signal. */
  signal: {
    frames: 1,
    paint(g, w, h) {
      const beam = g.createLinearGradient(0, h, 0, 0);
      beam.addColorStop(0, "rgba(255,245,200,0)");
      beam.addColorStop(1, "rgba(255,245,200,.34)");
      poly(g, beam, [[w * 0.46, h], [w * 0.54, h], [w * 0.86, h * 0.3], [w * 0.14, h * 0.3]]);
      blob(g, w * 0.5, h * 0.22, w * 0.4, h * 0.2, "rgba(255,246,205,.85)");
      // The pawn: a round head, a collar, a skirt and a foot.
      const ink = "rgba(20,12,40,.9)";
      blob(g, w * 0.5, h * 0.13, w * 0.07, h * 0.055, ink);
      blob(g, w * 0.5, h * 0.185, w * 0.075, h * 0.014, ink);
      poly(g, ink, [[w * 0.46, h * 0.19], [w * 0.54, h * 0.19], [w * 0.61, h * 0.3], [w * 0.39, h * 0.3]]);
      blob(g, w * 0.5, h * 0.3, w * 0.13, h * 0.018, ink);
    },
  },

  /** A cat out for a walk, two strides. */
  cat: {
    frames: 2,
    paint(g, w, h, frame) {
      const ink = "#0d0907";
      g.strokeStyle = ink;
      g.lineWidth = h * 0.09;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(w * 0.16, h * 0.5);
      g.quadraticCurveTo(w * 0.02, h * 0.4, w * 0.08, h * (frame ? 0.1 : 0.16));
      g.stroke();
      blob(g, w * 0.45, h * 0.52, w * 0.3, h * 0.17, ink);
      blob(g, w * 0.8, h * 0.36, w * 0.11, h * 0.16, ink);
      poly(g, ink, [[w * 0.72, h * 0.26], [w * 0.74, h * 0.06], [w * 0.8, h * 0.22]]);
      poly(g, ink, [[w * 0.82, h * 0.22], [w * 0.88, h * 0.06], [w * 0.9, h * 0.26]]);
      for (const [x, lean] of [[0.24, 1], [0.36, -1], [0.58, 1], [0.68, -1]]) {
        g.beginPath();
        g.moveTo(w * x, h * 0.6);
        g.lineTo(w * (x + lean * (frame ? 0.05 : -0.05)), h * 0.95);
        g.stroke();
      }
      blob(g, w * 0.84, h * 0.34, w * 0.016, h * 0.03, "#ffe14f");
    },
  },

  /** A moth, wings open and half shut. */
  moth: {
    frames: 2,
    paint(g, w, h, frame) {
      const spread = frame ? 0.42 : 0.2;
      for (const s of [-1, 1]) blob(g, w * (0.5 + s * spread * 0.55), h * 0.45, w * spread * 0.55, h * 0.3, "rgba(240,225,190,.85)", s * 0.5);
      blob(g, w * 0.5, h * 0.5, w * 0.06, h * 0.3, "#5a4a34");
    },
  },

  /** Three balloons on strings, let go. */
  balloons: {
    frames: 1,
    paint(g, w, h) {
      [[0.3, 0.26, "#ff7a6b"], [0.55, 0.16, "#5fd6c4"], [0.72, 0.32, "#ffd45c"]].forEach(([x, y, colour]) => {
        g.strokeStyle = "rgba(255,255,255,.5)";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(w * x, h * (y + 0.16));
        g.quadraticCurveTo(w * (x + 0.06), h * 0.6, w * 0.5, h * 0.98);
        g.stroke();
        blob(g, w * x, h * y, w * 0.13, h * 0.16, colour);
        blob(g, w * (x - 0.04), h * (y - 0.06), w * 0.03, h * 0.04, "rgba(255,255,255,.55)");
      });
    },
  },

  /** A firework, burst open. */
  firework: {
    frames: 1,
    paint(g, w, h) {
      soft(g, w * 0.5, h * 0.5, w * 0.5, "255,255,255", 0.35);
      g.lineCap = "round";
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * 6.283;
        const r = w * (i % 2 ? 0.46 : 0.34);
        g.strokeStyle = `rgba(255,255,255,${i % 2 ? 0.95 : 0.6})`;
        g.lineWidth = w * 0.014;
        g.beginPath();
        g.moveTo(w * 0.5 + Math.cos(a) * w * 0.1, h * 0.5 + Math.sin(a) * w * 0.1);
        g.lineTo(w * 0.5 + Math.cos(a) * r, h * 0.5 + Math.sin(a) * r);
        g.stroke();
        blob(g, w * 0.5 + Math.cos(a) * r, h * 0.5 + Math.sin(a) * r, w * 0.016, w * 0.016, "#ffffff");
      }
    },
  },

  /** A little pixel pawn out for a run: the party's own piece, eight pixels wide, two strides. */
  bug: {
    frames: 2,
    paint(g, w, h, frame) {
      const rows = frame ? ["..XXXX..", "..XXXX..", "..XXXX..", ".XXXXXX.", "...XX...", "..XXXX..", ".XXXXXX.", ".XX...XX"] : ["..XXXX..", "..XXXX..", "..XXXX..", ".XXXXXX.", "...XX...", "..XXXX..", ".XXXXXX.", "XX...XX."];
      const s = Math.floor(Math.min(w, h) / 8);
      g.fillStyle = "#7dff6a";
      rows.forEach((row, y) => [...row].forEach((c, x) => c === "X" && g.fillRect((w - s * 8) / 2 + x * s, (h - s * 8) / 2 + y * s, s, s)));
    },
  },

  /** A satellite with two panels and a blinking dish light. */
  satellite: {
    frames: 2,
    paint(g, w, h, frame) {
      for (const x of [0.04, 0.62]) {
        fill(g, "#2a4a9a").fillRect(w * x, h * 0.3, w * 0.34, h * 0.4);
        g.strokeStyle = "rgba(190,215,255,.6)";
        g.lineWidth = 1.5;
        for (let i = 1; i < 4; i++) g.strokeRect(w * x, h * 0.3, (w * 0.34 * i) / 4, h * 0.4);
      }
      fill(g, "#dfe8f5").fillRect(w * 0.4, h * 0.22, w * 0.2, h * 0.56);
      blob(g, w * 0.5, h * 0.16, w * 0.07, h * 0.1, "#aab8ce");
      if (frame) soft(g, w * 0.5, h * 0.12, h * 0.3, "255,80,80", 1);
    },
  },
};
