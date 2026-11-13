// Painting for the 3D look: small canvas helpers, and the picture on each game's box.
//
// Everything that is lit once and never changes is painted here, on a canvas, and used as a
// texture: walls, floors and box art. Nothing in this file knows about three.js.

export function canvasOf(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}

/** Repeatable random numbers, so the same room is painted the same way every time. */
export function seeded(seed = 7) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function speckle(g, w, h, n, alpha) {
  const rnd = seeded();
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${rnd() * alpha})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

export function stars(g, w, yMax, n, seed, y0 = 0) {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`;
    const r = 1 + rnd() * 2.2;
    g.beginPath();
    g.arc(rnd() * w, y0 + rnd() * (yMax - y0), r, 0, 7);
    g.fill();
  }
}

/** Floorboards running left to right, `size` metres deep each. */
export function planks(g, w, h, k, size, base, lightRgb) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const plank = size * k;
  for (let y = 0, i = 0; y < h; y += plank, i++) {
    g.fillStyle = `rgba(${i % 2 ? lightRgb : "0,0,0"},${0.03 + ((i * 13) % 4) * 0.02})`;
    g.fillRect(0, y, w, plank - 2);
    g.fillStyle = "rgba(0,0,0,.5)";
    g.fillRect(0, y + plank - 2, w, 2);
    for (let x = (i * 733) % 400; x < w; x += 2.4 * k) g.fillRect(x, y, 2, plank);
  }
}

/** A soft round glow painted on a wall or a floor. */
export function glow(g, x, y, r, rgb, alpha = 1, squash = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(0.4, `rgba(${rgb},${alpha * 0.4})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.save();
  g.translate(x, y);
  g.scale(1, squash);
  g.translate(-x, -y);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
  g.restore();
}

function fitText(g, text, x, y, maxW, size, font) {
  let s = size;
  do {
    g.font = font.replace("%", s);
    s -= 2;
  } while (g.measureText(text).width > maxW && s > 10);
  g.fillText(text, x, y);
}

// ---------------------------------------------------------------- box art

const W = 700;
const H = 980;
const TITLE = '400 %px "Abril Fatface", Georgia, serif';
const POSTER = '900 %px "Nunito", system-ui, sans-serif';

/**
 * The picture on each game's box, by the box's `art` id (lobby/shared/vote.js, boxFromManifest).
 * Each paints a 700 x 980 canvas. `side` is the colour of the box's edges. A game with no
 * picture here gets its name on a plain panel, so a new game on the list needs nothing from
 * this file to appear.
 */
const ART = {
  "cork-and-bell": {
    side: "#4a0e0c",
    paint(g, box, images) {
      g.fillStyle = "#6d1512";
      g.fillRect(0, 0, W, H);
      const top = 196;
      const img = images["cork-and-bell"];
      if (img) g.drawImage(img, 0, top, W, H - top);
      const band = g.createLinearGradient(0, 0, 0, top);
      band.addColorStop(0, "#8c1d18");
      band.addColorStop(1, "#5c110f");
      g.fillStyle = band;
      g.fillRect(0, 0, W, top);
      g.fillStyle = "#e2b45a";
      g.fillRect(0, top - 8, W, 8);
      g.fillStyle = "#f6dfae";
      fitText(g, box.name, W / 2, 100, 620, 124, TITLE);
    },
  },

  "coin-flip": {
    side: "#0f2f38",
    paint(g, box) {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#226273");
      bg.addColorStop(1, "#123a45");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.save();
      g.translate(W / 2, 420);
      for (let i = 0; i < 12; i++) {
        g.rotate(Math.PI / 6);
        g.fillStyle = "rgba(255,240,190,.07)";
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(-70, -900);
        g.lineTo(70, -900);
        g.fill();
      }
      g.restore();
      g.fillStyle = "rgba(4,20,26,.4)";
      g.beginPath();
      g.ellipse(W / 2 + 14, 446, 212, 212, 0, 0, 7);
      g.fill();
      const coin = g.createRadialGradient(W / 2 - 60, 350, 30, W / 2, 420, 215);
      coin.addColorStop(0, "#ffe89a");
      coin.addColorStop(0.75, "#eeb844");
      coin.addColorStop(1, "#b17a1c");
      g.fillStyle = coin;
      g.beginPath();
      g.arc(W / 2, 420, 210, 0, 7);
      g.fill();
      g.strokeStyle = "#9a6614";
      g.lineWidth = 12;
      g.beginPath();
      g.arc(W / 2, 420, 164, 0, 7);
      g.stroke();
      g.fillStyle = "#9a6614";
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = i % 2 ? 50 : 122;
        g.lineTo(W / 2 + Math.sin(a) * r, 420 - Math.cos(a) * r);
      }
      g.fill();
      g.fillStyle = "#fdf3d6";
      fitText(g, box.name.toUpperCase(), W / 2, 772, 610, 128, POSTER);
      g.fillStyle = "#a9cdd6";
      g.font = '600 44px "Nunito", system-ui, sans-serif';
      g.fillText("luck picks the order", W / 2, 866);
    },
  },

  "who-am-i": {
    side: "#cfc4b2",
    paint(g, box) {
      g.fillStyle = "#fff6ea";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(74,53,181,.09)";
      for (let y = 40; y < H; y += 70)
        for (let x = 40 + ((y / 70) % 2) * 35; x < W; x += 70) {
          g.beginPath();
          g.arc(x, y, 7, 0, 7);
          g.fill();
        }
      g.fillStyle = "#33238a";
      g.beginPath();
      g.roundRect(160, 150, 380, 420, 88);
      g.fill();
      g.fillStyle = "#4a35b5";
      g.beginPath();
      g.roundRect(160, 126, 380, 404, 88);
      g.fill();
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(350, 328, 124, 0, 7);
      g.fill();
      g.fillStyle = "#4a35b5";
      g.font = POSTER.replace("%", 190);
      g.fillText("?", 350, 342);
      g.fillStyle = "#1d1830";
      fitText(g, box.name, W / 2, 760, 600, 132, POSTER);
      g.fillStyle = "#4a35b5";
      g.fillRect(250, 850, 200, 12);
    },
  },

  "tin-derby": {
    side: "#7a2418",
    paint(g, box) {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#ef7a55");
      bg.addColorStop(1, "#b63c2b");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.save();
      g.translate(W / 2, 600);
      for (let i = 0; i < 16; i++) {
        g.rotate(Math.PI / 8);
        g.fillStyle = "rgba(255,225,170,.11)";
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(-90, -900);
        g.lineTo(90, -900);
        g.fill();
      }
      g.restore();
      g.fillStyle = "#fff1cf";
      const words = box.name.toUpperCase().split(" ");
      if (words.length === 2) {
        g.font = POSTER.replace("%", 168);
        g.fillText(words[0], W / 2, 128);
        fitText(g, words[1], W / 2, 284, 640, 168, POSTER);
      } else fitText(g, box.name.toUpperCase(), W / 2, 200, 640, 150, POSTER);
      // A wind-up tin racer.
      g.save();
      g.translate(W / 2 + 10, 610);
      g.fillStyle = "rgba(60,10,5,.35)";
      g.beginPath();
      g.ellipse(0, 132, 250, 22, 0, 0, 7);
      g.fill();
      g.strokeStyle = "#3a1a12";
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(-218, -18);
      g.lineTo(-268, -18);
      g.stroke();
      g.beginPath();
      g.ellipse(-300, -18, 26, 42, 0, 0, 7);
      g.stroke();
      g.fillStyle = "#f6d36b";
      g.beginPath();
      g.roundRect(-220, -60, 440, 150, 60);
      g.fill();
      g.beginPath();
      g.roundRect(-110, -150, 210, 130, [70, 70, 0, 0]);
      g.fill();
      g.fillStyle = "#2a3f6e";
      g.beginPath();
      g.roundRect(-76, -122, 142, 76, [44, 44, 6, 6]);
      g.fill();
      g.fillStyle = "#c8382c";
      g.fillRect(-220, 6, 440, 30);
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(120, 22, 44, 0, 7);
      g.fill();
      g.fillStyle = "#1b1a17";
      g.font = POSTER.replace("%", 60);
      g.fillText("7", 120, 26);
      for (const X of [-128, 128]) {
        g.fillStyle = "#1b1a17";
        g.beginPath();
        g.arc(X, 96, 58, 0, 7);
        g.fill();
        g.fillStyle = "#d9d2c0";
        g.beginPath();
        g.arc(X, 96, 24, 0, 7);
        g.fill();
      }
      g.strokeStyle = "rgba(255,241,207,.8)";
      g.lineWidth = 12;
      for (const [Y, L] of [
        [-70, 80],
        [-10, 120],
        [50, 70],
      ]) {
        g.beginPath();
        g.moveTo(262, Y);
        g.lineTo(262 + L, Y);
        g.stroke();
      }
      g.restore();
      const sq = 70;
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 10; c++) {
          g.fillStyle = (r + c) % 2 ? "#1b1a17" : "#fff1cf";
          g.fillRect(c * sq, H - 140 + r * sq, sq, sq);
        }
    },
  },

  flood: {
    side: "#10224f",
    paint(g, box) {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#132a66");
      bg.addColorStop(1, "#2a56b6");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#ffe9a8";
      g.beginPath();
      g.arc(560, 150, 62, 0, 7);
      g.fill();
      g.fillStyle = "#132a66";
      g.beginPath();
      g.arc(532, 134, 54, 0, 7);
      g.fill();
      g.fillStyle = "#fff";
      fitText(g, box.name.toUpperCase(), W / 2, 330, 640, 190, POSTER);
      // A house going under.
      g.save();
      g.translate(W / 2, 640);
      g.rotate(-0.07);
      g.fillStyle = "#f3e3c2";
      g.fillRect(-120, -60, 240, 240);
      g.fillStyle = "#c8382c";
      g.beginPath();
      g.moveTo(-160, -56);
      g.lineTo(0, -190);
      g.lineTo(160, -56);
      g.fill();
      g.fillStyle = "#8a2a20";
      g.fillRect(60, -170, 40, 80);
      g.fillStyle = "#ffd76a";
      g.fillRect(-70, -10, 56, 60);
      g.fillRect(20, -10, 56, 60);
      g.restore();
      const wave = (y0, amp, len, phase, fill, crest) => {
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += 10) g.lineTo(x, y0 + Math.sin(x / len + phase) * amp);
        g.lineTo(W, H);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.beginPath();
        for (let x = 0; x <= W; x += 10) {
          const y = y0 + Math.sin(x / len + phase) * amp;
          if (x) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.strokeStyle = crest;
        g.lineWidth = 9;
        g.stroke();
      };
      wave(676, 22, 52, 0.6, "#4f86e6", "rgba(255,255,255,.85)");
      wave(770, 20, 60, 2.1, "#3a6dcf", "rgba(255,255,255,.55)");
      wave(868, 18, 48, 4.0, "#2a56b6", "rgba(255,255,255,.4)");
    },
  },

  "fox-trouble": {
    side: "#143d27",
    paint(g, box) {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#3c9460");
      bg.addColorStop(1, "#1f5a3a");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#fff1cf";
      fitText(g, box.name, W / 2, 150, 620, 130, TITLE);
      g.save();
      g.translate(W / 2, 590);
      g.fillStyle = "#e57a2e";
      g.beginPath();
      g.moveTo(-250, -210);
      g.lineTo(-90, -120);
      g.lineTo(-220, 10);
      g.fill();
      g.beginPath();
      g.moveTo(250, -210);
      g.lineTo(90, -120);
      g.lineTo(220, 10);
      g.fill();
      g.beginPath();
      g.moveTo(-240, -90);
      g.lineTo(240, -90);
      g.lineTo(0, 260);
      g.fill();
      g.fillStyle = "#fff6ea";
      g.beginPath();
      g.moveTo(-200, 0);
      g.lineTo(-40, 60);
      g.lineTo(0, 260);
      g.fill();
      g.beginPath();
      g.moveTo(200, 0);
      g.lineTo(40, 60);
      g.lineTo(0, 260);
      g.fill();
      g.fillStyle = "#1b1a17";
      g.beginPath();
      g.arc(0, 236, 34, 0, 7);
      g.fill();
      g.beginPath();
      g.ellipse(-92, -6, 20, 30, 0.3, 0, 7);
      g.fill();
      g.beginPath();
      g.ellipse(92, -6, 20, 30, -0.3, 0, 7);
      g.fill();
      g.restore();
    },
  },
};

/** A game with no picture of its own: its name on a plain panel, in a colour drawn from its id. */
function plainArt(g, box) {
  let hash = 0;
  for (const ch of box.id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `hsl(${hash} 42% 34%)`);
  bg.addColorStop(1, `hsl(${(hash + 24) % 360} 48% 19%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,241,207,.5)";
  g.lineWidth = 6;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.fillStyle = "#fff1cf";
  const words = box.name.split(" ");
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : words;
  lines.forEach((line, i) => fitText(g, line, W / 2, H / 2 + (i - (lines.length - 1) / 2) * 150, 580, 140, TITLE));
}

/** The pictures the box art needs before it can be painted: {art id: address}. */
export const ART_IMAGES = { "cork-and-bell": new URL("./art/cork-and-bell.jpg", import.meta.url).href };

/** The colour of a box's edges. */
export function boxSide(box) {
  return ART[box.art]?.side ?? "#2a2230";
}

/** Paints a box's picture: {canvas}. `images` is {art id: a loaded image}, for the art that uses one. */
export function boxArt(box, images = {}) {
  return canvasOf(W, H, (g) => {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineCap = "round";
    if (ART[box.art]) ART[box.art].paint(g, box, images);
    else plainArt(g, box);
    if (box.test) {
      // A corner ribbon, so nobody takes the placeholder for a real game.
      g.save();
      g.translate(W - 130, 130);
      g.rotate(Math.PI / 4);
      g.fillStyle = "#f6ead2";
      g.fillRect(-260, -40, 520, 80);
      g.fillStyle = "#1e1410";
      g.font = '700 44px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      g.fillText("TEST GAME", 0, 4);
      g.restore();
    }
    if (box.soon) {
      g.fillStyle = "rgba(18,11,8,.92)";
      g.fillRect(0, H - 132, W, 132);
      g.fillStyle = "#f6ead2";
      g.font = '700 50px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      g.letterSpacing = "10px";
      g.fillText("COMING SOON", W / 2 + 5, H - 62);
      g.letterSpacing = "0px";
    }
    // A soft printed edge.
    g.strokeStyle = "rgba(255,255,255,.16)";
    g.lineWidth = 8;
    g.strokeRect(4, 4, W - 8, H - 8);
  });
}
