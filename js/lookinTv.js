/*
 * Painting mode "lookinTv" - an intro onto the "lookin" cycle (js/lookin.js):
 * the paintings power on one at a time like old CRT TVs, each settling on
 * TV static (assets/video_static.gif, color-inverted at load so it reads as
 * dark specks on white - "white noise") while the rest keep coming online.
 * Once every painting is on, they all sit on static for
 * LOOKIN_TV_STATIC_HOLD, the static fades out on all of them together, "I SEE
 * YOU LOOKIN" is written across each one at once, and the finished text
 * holds for LOOKIN_TV_TEXT_HOLD - then the scene ends and the show moves on.
 *
 * Turn-on order is a fresh random shuffle each time the scene starts (see
 * lookinTvOrder()). Every turn-on lands inside the same LOOKIN_TV_TURN_ON
 * window whatever the wall's painting count, with uneven gaps between them
 * (paintingHash()), so the whole sequence has a fixed length -
 * LOOKIN_TV_DURATION, which js/scenes.js uses as the scene's duration so
 * both walls hand off to the next scene together.
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
const LOOKIN_TV_TURN_ON = 15; // seconds from the first painting turning on to the last
const LOOKIN_TV_GAP_JITTER = 2; // the longest gap between turn-ons can be up to this many times the shortest
const LOOKIN_TV_LINE = 0.1; // seconds for the center dot to stretch into a line
const LOOKIN_TV_OPEN = 0.3; // seconds for the line to open up to the full painting
const LOOKIN_TV_STATIC_HOLD = 10; // seconds every painting sits on static after the last one turns on
const LOOKIN_TV_STATIC_FADE = 1.5; // seconds for the static to fade out, all together
const LOOKIN_TV_WRITE = 4; // seconds allowed for the writing - js/lookin.js's writeDuration is ~3.9s
const LOOKIN_TV_TEXT_HOLD = 15; // seconds the finished text holds before the scene ends
const LOOKIN_TV_STATIC_ALPHA = 0.85; // static's opacity once on - a little below full so it reads as a glow on black
const LOOKIN_TV_FRAME_MS = 60; // ms per static frame, overriding the gif's own delay so every painting ticks in step

const LOOKIN_TV_FADE_START =
  LOOKIN_TV_START_DELAY + LOOKIN_TV_TURN_ON + LOOKIN_TV_LINE + LOOKIN_TV_OPEN + LOOKIN_TV_STATIC_HOLD;
// The whole sequence, in ms - the "lookinTv" scene's duration (js/scenes.js).
const LOOKIN_TV_DURATION =
  (LOOKIN_TV_FADE_START + LOOKIN_TV_STATIC_FADE + LOOKIN_TV_WRITE + LOOKIN_TV_TEXT_HOLD) * 1000;

let lookinTvFrames = null; // one canvas per gif frame once loaded
let lookinTvStartMs = 0;
let lookinTvOrderCache = null; // shuffled painting indices, reset by initLookinTv()

// p5.js 2.0 removed preload() - call this once from each wall's own setup().
// Each gif frame is copied out to its own canvas up front, so drawing a
// painting's current frame is a plain drawImage rather than p5's
// putImageData-per-setFrame(). Frames are inverted (255 - each channel) on
// the way in, turning the grey-on-dark static into dark-on-white.
function loadLookinTvStatic() {
  loadImage(LOOKIN_TV_GIF_PATH, (img) => {
    const frames = img.gifProperties ? img.gifProperties.frames.map((f) => f.image) : null;
    if (!frames) {
      lookinTvFrames = [invertedCanvas(img.canvas)];
      return;
    }
    lookinTvFrames = frames.map((imageData) => {
      const canvas = document.createElement("canvas");
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvas.getContext("2d").putImageData(imageData, 0, 0);
      return invertedCanvas(canvas);
    });
  });
}

// Inverts a canvas's colors in place (alpha untouched) and returns it.
function invertedCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let k = 0; k < px.length; k += 4) {
    px[k] = 255 - px[k];
    px[k + 1] = 255 - px[k + 1];
    px[k + 2] = 255 - px[k + 2];
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function initLookinTv() {
  lookinTvStartMs = millis();
  lookinTvOrderCache = null;
}

// Painting indices in turn-on order: a random shuffle, made once per scene
// start (initLookinTv() clears it) and redone if the painting count changes.
function lookinTvOrder(polygons) {
  if (lookinTvOrderCache && lookinTvOrderCache.length === polygons.length) return lookinTvOrderCache;
  lookinTvOrderCache = shuffle(polygons.map((_, i) => i)); // p5's shuffle() - returns a new array
  return lookinTvOrderCache;
}

// Seconds after the scene starts that each painting (by index) turns on,
// plus when the static starts fading and when the writing starts. Gaps are
// random weights in 1..LOOKIN_TV_GAP_JITTER, scaled to fill LOOKIN_TV_TURN_ON.
function lookinTvSchedule(polygons) {
  const order = lookinTvOrder(polygons);
  const weights = order.slice(1).map((_, k) => 1 + paintingHash(k, 7) * (LOOKIN_TV_GAP_JITTER - 1));
  const total = weights.reduce((x, y) => x + y, 0) || 1;
  const onAt = new Array(polygons.length);
  let t = LOOKIN_TV_START_DELAY;
  order.forEach((i, k) => {
    if (k > 0) t += (weights[k - 1] / total) * LOOKIN_TV_TURN_ON;
    onAt[i] = t;
  });
  return { onAt, fadeStart: LOOKIN_TV_FADE_START, writeStart: LOOKIN_TV_FADE_START + LOOKIN_TV_STATIC_FADE };
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
  const elapsed = (millis() - lookinTvStartMs) / 1000;
  const { onAt, fadeStart, writeStart } = lookinTvSchedule(polygons);
  const staticAlpha = 1 - Math.min(Math.max((elapsed - fadeStart) / LOOKIN_TV_STATIC_FADE, 0), 1);

  polygons.forEach((poly, i) => {
    if (elapsed < writeStart) {
      // Intro: dark until this painting turns on, then static over its outline.
      const u = elapsed - onAt[i];
      drawPaintingShape(pg, poly, u < 0 ? offKeyframe : outlineKeyframe, { strokeWeight: LOOKIN_OUTLINE_WEIGHT });
      if (u >= 0) drawLookinTvStatic(pg, poly, i, u, staticAlpha);
      return;
    }
    // Then the text is written across every painting at once and held, on
    // the outline left up from the intro, until the scene ends.
    drawPaintingShape(pg, poly, outlineKeyframe, { strokeWeight: LOOKIN_OUTLINE_WEIGHT });
    drawLookinText(pg, poly, elapsed - writeStart); // js/lookin.js
  });
}
