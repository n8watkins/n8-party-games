// The front page preview: things drifting behind the page, and each game's card showing the game
// itself. A card starts as its poster; where a clip of the game is known (window.N8_CLIPS, by the
// game's id), the poster gives way to the clip, which plays only while the card is on screen.
// The clips are not in this repository yet (the owner picks first); the hosted preview fills
// window.N8_CLIPS, so this page shows posters here.

const FLOATERS = [
  { img: "fl-pawn.webp", w: 60, x: 5, y: 8, dx: 26, dy: -20, drift: 26, bob: 4.2, r: -4 },
  { img: "fl-mask-jester.webp", w: 56, x: 92, y: 14, dx: -26, dy: 22, drift: 27, bob: 4.8, r: -7 },
  { img: "fl-key.webp", w: 46, x: 4, y: 34, dx: 24, dy: 26, drift: 25, bob: 4.4, r: -10 },
  { img: "fl-ghost.webp", w: 56, x: 94, y: 46, dx: -30, dy: 24, drift: 30, bob: 5.0, r: 5 },
  { img: "fl-trophy.webp", w: 44, x: 5, y: 58, dx: 22, dy: -24, drift: 26, bob: 3.9, r: -5 },
  { img: "fl-car-red.webp", w: 76, x: 93, y: 68, dx: -40, dy: 10, drift: 30, bob: 4.0, r: 3 },
  { img: "fl-slime.webp", w: 60, x: 6, y: 74, dx: 28, dy: -20, drift: 24, bob: 3.8, r: -3 },
  { img: "fl-mask-fox.webp", w: 54, x: 4, y: 3, dx: 30, dy: 24, drift: 29, bob: 5.2, r: 6 },
  { img: "fl-card.webp", w: 36, x: 92, y: 30, dx: -26, dy: 24, drift: 25, bob: 4.5, r: -12 },
  { img: "fl-robot.webp", w: 56, x: 94, y: 22, dx: -30, dy: -18, drift: 28, bob: 4.6, r: 4 },
];
// Nothing drifts behind the line about the party room or the footer, where words sit on the bare ground.

const ART = (name) => (window.N8_ART?.[name] ?? `/art/${name}`);
const reduced = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function drawFloaters() {
  const box = document.getElementById("floaters");
  if (!box) return;
  FLOATERS.forEach((f, i) => {
    const d = document.createElement("div");
    d.className = "fl";
    const s = d.style;
    s.width = `${f.w}px`;
    s.left = `calc(${f.x > 50 ? "98%" : "2%"} - ${f.w / 2}px)`;
    s.top = `${f.y}%`;
    s.setProperty("--edge", f.x > 50 ? "40%" : "-40%");
    s.setProperty("--dx", `${f.dx}px`);
    s.setProperty("--dy", `${f.dy}px`);
    s.setProperty("--drift", `${f.drift}s`);
    s.setProperty("--bob", `${f.bob}s`);
    s.setProperty("--r", `${f.r}deg`);
    s.setProperty("--delay", `${-(i * 1.7)}s`);
    const img = document.createElement("img");
    img.src = ART(f.img);
    img.alt = "";
    img.loading = "lazy";
    d.append(img);
    box.append(d);
  });
}

/** Swaps each card's poster for its clip, if one is known, and plays it only while it is seen. */
function wakeDemos() {
  const clips = window.N8_CLIPS ?? {};
  const videos = [];
  for (const card of document.querySelectorAll(".game[data-game]")) {
    const clip = clips[card.dataset.game];
    const demo = card.querySelector(".demo");
    const poster = demo?.querySelector("img");
    if (!clip || !demo || !poster) continue;
    const v = document.createElement("video");
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.preload = "metadata";
    if (clip.poster) v.poster = clip.poster;
    v.src = clip.src;
    v.setAttribute("aria-label", poster.alt);
    poster.replaceWith(v);
    videos.push(v);
  }
  if (!videos.length || reduced()) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.play().catch(() => {});
        else e.target.pause();
      }
    },
    { threshold: 0.35 },
  );
  for (const v of videos) io.observe(v);
}

drawFloaters();
wakeDemos();
