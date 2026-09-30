/*
 * Painting mode "lookinTv" - an intro onto the "lookin" cycle (js/lookin.js):
 * the paintings power on one at a time like old CRT TVs, each settling on
 * TV static (assets/video_static.gif) while the rest keep coming online.
 * Once every painting is on, the static fades out on all of them together,
 * "I SEE YOU LOOKIN" is written across each one at once, and from there
 * every painting carries on through the regular lookin loop (hold text ->
 * fade up to lit -> hold -> dark -> write again ...) on its own jittered
 * timer, so they drift apart the way "lookin" paintings do.
 *
 * Turn-on order is scattered rather than left-to-right: it starts at the
 * top-right-most painting, and each next one is whichever painting sits
 * farthest from all the ones already on (see lookinTvOrder()) - so it hops
 * top right -> left -> bottom ... across the wall. The gaps between turn-ons
 * are uneven too (LOOKIN_TV_GAP_MIN..MAX, via paintingHash()).
 *
 * The CRT power-on (drawLookinTvStatic()): a bright dot at the painting's
 * center stretches into a horizontal line, then the line opens vertically to
 * reveal the static, washed out in white that fades as it opens.
 *
 * Timing is measured from lookinTvStartMs, which the "lookinTv" scene's
 * init() resets.
 */

const LOOKIN_TV_GIF_PATH = "assets/video_static.gif";

const LOOKIN_TV_START_DELAY = 1; // seconds of dark before the first painting turns on
const LOOKIN_TV_GAP_MIN = 0.6; // seconds between consecutive paintings turning on, at least...
const LOOKIN_TV_GAP_MAX = 1.8; // ...and at most
const LOOKIN_TV_LINE = 0.1; // seconds for the center dot to stretch into a line
const LOOKIN_TV_OPEN = 0.3; // seconds for the line to open up to the full painting
const LOOKIN_TV_STATIC_HOLD = 1.5; // seconds every painting sits on static after the last one turns on
const LOOKIN_TV_STATIC_FADE = 1.5; // seconds for the static to fade out, all together
const LOOKIN_TV_STATIC_ALPHA = 0.85; // static's opacity once on - a little below full so it reads as a glow on black
const LOOKIN_TV_FRAME_MS = 60; // ms per static frame, overriding the gif's own delay so every painting ticks in step

let lookinTvFrames = null; // one canvas per gif frame once loaded
let lookinTvStartMs = 0;
let lookinTvOrderCache = { key: null, order: null };

// p5.js 2.0 removed preload() - call this once from each wall's own setup().
// Each gif frame is copied out to its own canvas up front, so drawing a
// painting's current frame is a plain drawImage rather than p5's
// putImageData-per-setFrame().
function loadLookinTvStatic() {
  loadImage(LOOKIN_TV_GIF_PATH, (img) => {
    const frames = img.gifProperties ? img.gifProperties.frames.map((f) => f.image) : null;
    if (!frames) {
      lookinTvFrames = [img.canvas];
      return;
    }
    lookinTvFrames = frames.map((imageData) => {
      const canvas = document.createElement("canvas");
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvas.getContext("2d").putImageData(imageData, 0, 0);
      return canvas;
    });
  });
}

function initLookinTv() {
  lookinTvStartMs = millis();
}

// Painting indices in turn-on order - see file header. Cached on the
// painting count + first corner so it isn't recomputed every frame, but
// still follows calibration drags.
function lookinTvOrder(polygons) {
  const key = polygons.length + ":" + (polygons[0] ? polygons[0][0].x + "," + polygons[0][0].y : "");
  if (lookinTvOrderCache.key === key) return lookinTvOrderCache.order;

  const centers = polygons.map(polygonCentroid);
  const remaining = centers.map((_, i) => i);
  const order = [];
  if (remaining.length) {
    // Top right = largest x - y (y grows downward).
    let first = remaining.reduce((a, b) => (centers[b].x - centers[b].y > centers[a].x - centers[a].y ? b : a));
    order.push(first);
    remaining.splice(remaining.indexOf(first), 1);
  }
  while (remaining.length) {
    let best = remaining[0];
    let bestDist = -1;
    remaining.forEach((i) => {
      const d = Math.min(...order.map((j) => Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y)));
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    });
    order.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  lookinTvOrderCache = { key, order };
  return order;
}

// Seconds after the scene starts that each painting (by index) turns on,
// plus when the static starts fading and when the writing starts.
function lookinTvSchedule(polygons) {
  const order = lookinTvOrder(polygons);
  const onAt = new Array(polygons.length);
  let t = LOOKIN_TV_START_DELAY;
  order.forEach((i, k) => {
    if (k > 0) t += LOOKIN_TV_GAP_MIN + paintingHash(k, 7) * (LOOKIN_TV_GAP_MAX - LOOKIN_TV_GAP_MIN);
    onAt[i] = t;
  });
  const fadeStart = t + LOOKIN_TV_LINE + LOOKIN_TV_OPEN + LOOKIN_TV_STATIC_HOLD;
  const writeStart = fadeStart + LOOKIN_TV_STATIC_FADE;
  return { onAt, fadeStart, writeStart };
}

// Draws painting `i`'s static, `u` seconds after it turned on, at `alpha`.
function drawLookinTvStatic(pg, poly, i, u, alpha) {
  if (!lookinTvFrames || alpha <= 0) return;
  const { ex, ey, exLen, eyLen, c } = paintingAffineFrame(poly); // js/lookin.js
  const ctx = pg.drawingContext;
  ctx.save();

  // Clip to the painting's true quad, then work in its own frame (origin at
  // the centroid, x along its top/bottom edges, y along its sides).
  ctx.beginPath();
  poly.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.clip();
  ctx.transform(ex.x, ex.y, ey.x, ey.y, c.x, c.y);

  // CRT power-on: dot -> horizontal line -> opens vertically.
  const lineT = Math.min(u / LOOKIN_TV_LINE, 1);
  const openT = Math.min(Math.max((u - LOOKIN_TV_LINE) / LOOKIN_TV_OPEN, 0), 1);
  const bandW = Math.max(exLen * lookinEaseOutCubic(lineT), 3);
  const bandH = Math.max(eyLen * lookinEaseOutCubic(openT), 3);
  ctx.beginPath();
  ctx.rect(-bandW / 2, -bandH / 2, bandW, bandH);
  ctx.clip();

  // Cover-fit the static, each painting on its own frame offset (and some
  // mirrored) so neighbours don't show the identical noise.
  const frame = lookinTvFrames[
    (Math.floor(millis() / LOOKIN_TV_FRAME_MS) + Math.floor(paintingHash(i, 8) * lookinTvFrames.length)) %
      lookinTvFrames.length
  ];
  const s = Math.max(exLen / frame.width, eyLen / frame.height);
  ctx.save();
  if (paintingHash(i, 9) < 0.5) ctx.scale(-1, 1);
  // A slight flicker while the tube warms up.
  const flicker = openT < 1 ? 1 : 0.9 + 0.1 * Math.random();
  ctx.globalAlpha = alpha * LOOKIN_TV_STATIC_ALPHA * flicker;
  ctx.drawImage(frame, (-frame.width * s) / 2, (-frame.height * s) / 2, frame.width * s, frame.height * s);
  ctx.restore();

  // White wash: full on the line, fading out as it opens.
  const wash = 1 - openT;
  if (wash > 0) {
    ctx.globalAlpha = wash * alpha;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-bandW / 2, -bandH / 2, bandW, bandH);
  }
  ctx.restore();
}

// Painting mode "lookinTv" - see file header.
function drawLookinTvPaintings(pg, polygons) {
  const offKeyframe = lightStateKeyframe("off");
  const outlineKeyframe = lightStateKeyframe("outline");
  const onKeyframe = lightStateKeyframe("filled");
  const elapsed = (millis() - lookinTvStartMs) / 1000;
  const { onAt, fadeStart, writeStart } = lookinTvSchedule(polygons);
  const staticAlpha = 1 - Math.min(Math.max((elapsed - fadeStart) / LOOKIN_TV_STATIC_FADE, 0), 1);

  polygons.forEach((poly, i) => {
    if (elapsed < writeStart) {
      // Intro: dark until this painting turns on, then static over its outline.
      const u = elapsed - onAt[i];
      drawLightShape(pg, poly, u < 0 ? offKeyframe : outlineKeyframe, { strokeWeight: LOOKIN_OUTLINE_WEIGHT });
      if (u >= 0) drawLookinTvStatic(pg, poly, i, u, staticAlpha);
      return;
    }
    // Then every painting runs the regular lookin cycle from a shared start.
    // The outline is already up from the intro, so skip lookinPhase()'s own
    // outline fade-in on the first write.
    const t = elapsed - writeStart;
    const phase = lookinPhase(t, i); // js/lookin.js
    if (lookinArt && t < lookinArt.writeDuration) phase.outline = 1;
    const base = crossfadeKeyframes(offKeyframe, outlineKeyframe, phase.outline);
    const resolved = crossfadeKeyframes(base, onKeyframe, phase.fill);
    drawLightShape(pg, poly, resolved, { strokeWeight: LOOKIN_OUTLINE_WEIGHT });
    if (phase.writeT !== null) drawLookinText(pg, poly, phase.writeT);
  });
}
