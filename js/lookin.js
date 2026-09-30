/*
 * "I SEE YOU LOOKIN" - hand-lettered text (assets/jasmine/lookin.svg) written
 * across each painting, one letter at a time, before that painting turns on.
 *
 * The SVG's own paths are drawn straight onto the panel's 2D canvas as
 * Path2D objects (rather than stamping the PNG), so the letters stay crisp at
 * whatever size a painting's quad needs and each path can animate on its own.
 * At load, every path is measured (getBBox) and sorted into two groups:
 *   - letters: written left-to-right, each unmasked left-to-right while it
 *     rises and fades into place - reads like the phrase being penned.
 *   - face parts (the pupil, eyebrows, smile, flourish around "LOOKIN"'s Os):
 *     anything much smaller than a letter, or sitting well above/below the
 *     text line (see classifyLookinParts()). These pop in last, smallest
 *     first, so the face "wakes up" once the words are done.
 *
 * Painting mode "lookin" (dispatched from js/paintings.js's drawPaintings())
 * then runs each painting through: dark + writing -> hold the text -> fade up
 * to "filled" (white fill swallows the white text) -> hold lit -> fade back
 * to dark -> loop. Paintings start staggered by LOOKIN_PAINTING_STAGGER in
 * left-to-right order, so the writing travels across the wall.
 *
 * Timing is measured from lookinStartMs, which the "lookin" scene's init()
 * resets, so every painting starts from a blank page when the scene comes up
 * rather than mid-cycle. (Picking "lookin" via the "w" override instead just
 * runs off whatever lookinStartMs last was.)
 */

const LOOKIN_SVG_PATH = "assets/jasmine/lookin.svg";

// Writing
const LOOKIN_LETTER_STAGGER = 0.16; // seconds between consecutive letters starting
const LOOKIN_LETTER_DRAW = 0.45; // seconds for one letter to fully appear
const LOOKIN_LETTER_RISE = 0.35; // how far a letter rises into place, as a fraction of its own height
const LOOKIN_FACE_PAUSE = 0.3; // beat between the last letter and the first face part
const LOOKIN_FACE_STAGGER = 0.2; // seconds between face parts starting
const LOOKIN_FACE_POP = 0.4; // seconds for one face part's pop-in

// Per-painting cycle, after the writing itself
const LOOKIN_TEXT_HOLD = 1.5; // seconds the finished text sits on the dark painting
const LOOKIN_FILL_FADE = 1.2; // seconds to fade dark -> lit
const LOOKIN_LIT_HOLD = 6; // seconds held lit
const LOOKIN_UNFILL_FADE = 1.2; // seconds to fade lit -> dark
const LOOKIN_DARK_HOLD = 1; // seconds dark before writing again
const LOOKIN_PAINTING_STAGGER = 0.5; // seconds between neighboring paintings (left-to-right) starting

// Text size within a painting - it's fit to whichever of these is tighter.
const LOOKIN_FIT_WIDTH = 0.85; // max fraction of the painting's width
const LOOKIN_FIT_HEIGHT = 0.8; // max fraction of the painting's height

let lookinArt = null; // { w, h, parts, writeDuration } once the SVG has loaded
let lookinStartMs = 0;

// p5.js 2.0 removed preload() - call this once from each wall's own setup(),
// same as loadJasmineSprites() (js/jasmine.js).
function loadLookinText() {
  fetch(LOOKIN_SVG_PATH)
    .then((res) => res.text())
    .then((text) => {
      lookinArt = buildLookinArt(text);
    })
    .catch((err) => console.error("lookin: couldn't load " + LOOKIN_SVG_PATH, err));
}

// Parses the SVG, measures every path's bounding box (getBBox only works on
// an element that's actually in the rendered document - hence the briefly
// attached, invisible copy), and assigns each part its start time within the
// write phase.
function buildLookinArt(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  const [, , w, h] = (svg.getAttribute("viewBox") || "0 0 100 100").split(/[\s,]+/).map(Number);

  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  holder.appendChild(document.importNode(svg, true));
  document.body.appendChild(holder);
  const parts = [...holder.querySelectorAll("path")].map((el) => {
    const b = el.getBBox();
    return { path: new Path2D(el.getAttribute("d")), x: b.x, y: b.y, w: b.width, h: b.height };
  });
  holder.remove();

  const { letters, face } = classifyLookinParts(parts);
  letters.sort((a, b) => a.x - b.x);
  face.sort((a, b) => a.w * a.h - b.w * b.h); // smallest first: pupil, eyebrows, ..., smile

  letters.forEach((p, i) => {
    p.kind = "letter";
    p.start = i * LOOKIN_LETTER_STAGGER;
  });
  const lettersEnd = letters.length ? (letters.length - 1) * LOOKIN_LETTER_STAGGER + LOOKIN_LETTER_DRAW : 0;
  face.forEach((p, i) => {
    p.kind = "face";
    p.start = lettersEnd + LOOKIN_FACE_PAUSE + i * LOOKIN_FACE_STAGGER;
  });
  const writeDuration = face.length ? face[face.length - 1].start + LOOKIN_FACE_POP : lettersEnd;

  return { w, h, parts: [...letters, ...face], writeDuration };
}

function lookinMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Letters outnumber face parts, so the median height/center-line is a
// letter's - anything far shorter than that (the pupil) or whose center sits
// well off that line (eyebrows above, smile/flourish below) is face.
function classifyLookinParts(parts) {
  const medH = lookinMedian(parts.map((p) => p.h));
  const medCy = lookinMedian(parts.map((p) => p.y + p.h / 2));
  const letters = [];
  const face = [];
  parts.forEach((p) => {
    const offLine = Math.abs(p.y + p.h / 2 - medCy) > medH * 0.5;
    const tiny = p.h < medH * 0.4;
    (offLine || tiny ? face : letters).push(p);
  });
  return { letters, face };
}

function initLookin() {
  lookinStartMs = millis();
}

function lookinEaseOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Overshoots past 1 before settling - gives the face parts a little bounce.
function lookinEaseOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Where one painting is in its cycle `t` seconds after its own (staggered)
// start: how lit it is (0-1), and how many seconds into the writing its text
// should be drawn at (null = no text showing).
function lookinPhase(t) {
  if (t < 0) return { fill: 0, writeT: null }; // this painting's turn hasn't come up yet
  const w = lookinArt ? lookinArt.writeDuration : 0;
  const period = w + LOOKIN_TEXT_HOLD + LOOKIN_FILL_FADE + LOOKIN_LIT_HOLD + LOOKIN_UNFILL_FADE + LOOKIN_DARK_HOLD;
  t %= period;

  if (t < w) return { fill: 0, writeT: t };
  t -= w;
  if (t < LOOKIN_TEXT_HOLD) return { fill: 0, writeT: w };
  t -= LOOKIN_TEXT_HOLD;
  if (t < LOOKIN_FILL_FADE) return { fill: t / LOOKIN_FILL_FADE, writeT: w };
  t -= LOOKIN_FILL_FADE;
  if (t < LOOKIN_LIT_HOLD) return { fill: 1, writeT: null };
  t -= LOOKIN_LIT_HOLD;
  if (t < LOOKIN_UNFILL_FADE) return { fill: 1 - t / LOOKIN_UNFILL_FADE, writeT: null };
  return { fill: 0, writeT: null };
}

function drawLookinPart(ctx, part, localT) {
  if (localT <= 0) return;
  ctx.save();
  if (part.kind === "letter") {
    const e = lookinEaseOutCubic(Math.min(localT / LOOKIN_LETTER_DRAW, 1));
    ctx.globalAlpha = e;
    ctx.translate(0, (1 - e) * part.h * LOOKIN_LETTER_RISE);
    // Unmask left-to-right, padded so the stroke's anti-aliased edge isn't
    // clipped once fully revealed.
    const pad = 2;
    ctx.beginPath();
    ctx.rect(part.x - pad, part.y - pad, (part.w + pad * 2) * e, part.h + pad * 2);
    ctx.clip();
  } else {
    const p = Math.min(localT / LOOKIN_FACE_POP, 1);
    const scale = Math.max(lookinEaseOutBack(p), 0.001);
    const cx = part.x + part.w / 2;
    const cy = part.y + part.h / 2;
    ctx.globalAlpha = Math.min(p * 2, 1);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }
  ctx.fill(part.path);
  ctx.restore();
}

// Fits the text inside the painting's quad, centered on its centroid and
// following the quad's average edge directions (so it tilts/shears with a
// corner-pinned painting). A 2D canvas can only do affine transforms, so this
// is a parallelogram approximation of the quad rather than a true
// perspective warp - plenty for the near-rectangular quads it runs on.
// Relies on poly being the quad's four corners in p5.mapper order: TL, TR,
// BR, BL.
function drawLookinText(pg, poly, writeT) {
  if (!lookinArt) return;
  const [tl, tr, br, bl] = poly;
  const ex = { x: (tr.x - tl.x + br.x - bl.x) / 2, y: (tr.y - tl.y + br.y - bl.y) / 2 };
  const ey = { x: (bl.x - tl.x + br.x - tr.x) / 2, y: (bl.y - tl.y + br.y - tr.y) / 2 };
  const exLen = Math.hypot(ex.x, ex.y) || 1;
  const eyLen = Math.hypot(ey.x, ey.y) || 1;
  const s = Math.min((exLen * LOOKIN_FIT_WIDTH) / lookinArt.w, (eyLen * LOOKIN_FIT_HEIGHT) / lookinArt.h);
  const c = polygonCentroid(poly);

  const ctx = pg.drawingContext;
  ctx.save();
  ctx.transform((ex.x / exLen) * s, (ex.y / exLen) * s, (ey.x / eyLen) * s, (ey.y / eyLen) * s, c.x, c.y);
  ctx.translate(-lookinArt.w / 2, -lookinArt.h / 2);
  ctx.fillStyle = "#fff";
  lookinArt.parts.forEach((part) => drawLookinPart(ctx, part, writeT - part.start));
  ctx.restore();
}

// Painting mode "lookin" - see file header.
function drawLookinPaintings(pg, polygons) {
  const offKeyframe = lightStateKeyframe("off");
  const onKeyframe = lightStateKeyframe("filled");

  // Rank each painting left-to-right by centroid so the stagger travels
  // across the wall regardless of paintingMaps' declaration order.
  const rank = [];
  polygons
    .map((poly, i) => ({ i, x: polygonCentroid(poly).x }))
    .sort((a, b) => a.x - b.x)
    .forEach((o, r) => (rank[o.i] = r));

  const elapsed = (millis() - lookinStartMs) / 1000;
  polygons.forEach((poly, i) => {
    const { fill, writeT } = lookinPhase(elapsed - rank[i] * LOOKIN_PAINTING_STAGGER);
    drawLightShape(pg, poly, crossfadeKeyframes(offKeyframe, onKeyframe, fill), { strokeWeight: 9 });
    if (writeT !== null) drawLookinText(pg, poly, writeT);
  });
}
