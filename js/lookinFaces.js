/*
 * Background for the "lookin" scene: a tiled grid of the face from the
 * "I SEE YOU LOOKIN" lettering (assets/jasmine/face.svg), white on black,
 * with each face's pupil glancing around inside its O on its own schedule -
 * holding a gaze for a moment, then darting to a new spot, like a wall full
 * of eyes watching the room.
 *
 * The face is split into two pieces at load: the pupil (the smallest path)
 * and everything else. Each is pre-rendered once to its own offscreen canvas
 * and stamped with drawImage per face, rather than filling all seven Path2Ds
 * for every face on every panel every frame. The pupil's travel is limited
 * to an ellipse inside the eye - the smallest other path whose bounding box
 * contains the pupil (see buildLookinFaceArt()).
 *
 * Rows are offset by half a cell (a brick pattern) so the grid reads as a
 * pattern rather than a spreadsheet. Paintings are drawn on top of this
 * (js/wall.js's displayWall()), so the faces only show between paintings and
 * behind ones that are dark.
 */

const LOOKIN_FACES_SVG_PATH = "assets/jasmine/face.svg";
const LOOKIN_FACES_SPACING_X = 120; // px between face centers in a row, in WALL_BOUNDS space
const LOOKIN_FACES_SPACING_Y = 110; // px between rows
const LOOKIN_FACES_SIZE = 70; // face height in px
const LOOKIN_FACES_MAX_TILT = 0.12; // radians of random per-face tilt, either way
const LOOKIN_FACES_GAZE_HOLD_MIN = 0.8; // seconds a pupil holds one spot, at least...
const LOOKIN_FACES_GAZE_HOLD_MAX = 3.5; // ...and at most
const LOOKIN_FACES_SACCADE = 0.3; // fraction of the remaining distance a pupil covers per frame when darting
const LOOKIN_FACES_SPRITE_RES = 2; // offscreen sprites rendered at this multiple of on-wall size

let lookinFaceArt = null; // sprites + pupil geometry once face.svg has loaded
let lookinFaces = [];

// p5.js 2.0 removed preload() - call this once from each wall's own setup().
function loadLookinFaces() {
  fetch(LOOKIN_FACES_SVG_PATH)
    .then((res) => res.text())
    .then((text) => {
      lookinFaceArt = buildLookinFaceArt(text);
    })
    .catch((err) => console.error("lookin: couldn't load " + LOOKIN_FACES_SVG_PATH, err));
}

// Renders `parts` (in SVG viewBox units) into a new offscreen canvas covering
// the viewBox region (x, y, w, h), at `scale` canvas pixels per unit.
function renderLookinSprite(parts, x, y, w, h, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  ctx.fillStyle = "#fff";
  parts.forEach((p) => ctx.fill(p.path));
  return canvas;
}

function buildLookinFaceArt(svgText) {
  const { w, h, parts } = parseSvgParts(svgText); // js/lookin.js
  const byArea = [...parts].sort((a, b) => a.w * a.h - b.w * b.h);
  const pupil = byArea[0];
  const pcx = pupil.x + pupil.w / 2;
  const pcy = pupil.y + pupil.h / 2;
  const eye =
    byArea.slice(1).find((p) => pcx > p.x && pcx < p.x + p.w && pcy > p.y && pcy < p.y + p.h) || byArea[1];

  const scale = (LOOKIN_FACES_SPRITE_RES * LOOKIN_FACES_SIZE) / h;
  const pad = 1; // keeps the anti-aliased edge from being cropped
  const eyeStroke = eye.w * 0.14; // rough thickness of the O's own line, so the pupil stays inside it
  return {
    w,
    h,
    body: renderLookinSprite(
      parts.filter((p) => p !== pupil),
      0,
      0,
      w,
      h,
      scale,
    ),
    pupil: renderLookinSprite([pupil], pupil.x - pad, pupil.y - pad, pupil.w + pad * 2, pupil.h + pad * 2, scale),
    pupilBox: { x: pupil.x - pad, y: pupil.y - pad, w: pupil.w + pad * 2, h: pupil.h + pad * 2 },
    pupilCenter: { x: pcx, y: pcy },
    eyeCenter: { x: eye.x + eye.w / 2, y: eye.y + eye.h / 2 },
    // Radii of the ellipse the pupil's center can roam, in viewBox units.
    gazeRadius: {
      x: Math.max(0, eye.w / 2 - pupil.w / 2 - eyeStroke),
      y: Math.max(0, eye.h / 2 - pupil.h / 2 - eyeStroke),
    },
  };
}

class LookinFace {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.tilt = random(-LOOKIN_FACES_MAX_TILT, LOOKIN_FACES_MAX_TILT);
    // Gaze is a point in the unit disc, scaled to gazeRadius at draw time.
    this.gaze = this.randomGaze();
    this.target = { ...this.gaze };
    this.nextGlanceMs = millis() + random(LOOKIN_FACES_GAZE_HOLD_MIN, LOOKIN_FACES_GAZE_HOLD_MAX) * 1000;
  }

  randomGaze() {
    const a = random(TWO_PI);
    const r = Math.sqrt(random()); // sqrt -> uniform over the disc, not bunched at the center
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  update() {
    if (millis() >= this.nextGlanceMs) {
      this.target = this.randomGaze();
      this.nextGlanceMs = millis() + random(LOOKIN_FACES_GAZE_HOLD_MIN, LOOKIN_FACES_GAZE_HOLD_MAX) * 1000;
    }
    this.gaze.x += (this.target.x - this.gaze.x) * LOOKIN_FACES_SACCADE;
    this.gaze.y += (this.target.y - this.gaze.y) * LOOKIN_FACES_SACCADE;
  }

  display(ctx, art) {
    const s = LOOKIN_FACES_SIZE / art.h;
    // Where the pupil's center should be, minus where it sits in the SVG.
    const dx = art.eyeCenter.x + this.gaze.x * art.gazeRadius.x - art.pupilCenter.x;
    const dy = art.eyeCenter.y + this.gaze.y * art.gazeRadius.y - art.pupilCenter.y;
    const box = art.pupilBox;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.tilt);
    ctx.scale(s, s);
    ctx.translate(-art.w / 2, -art.h / 2);
    ctx.drawImage(art.body, 0, 0, art.w, art.h);
    ctx.drawImage(art.pupil, box.x + dx, box.y + dy, box.w, box.h);
    ctx.restore();
  }
}

function initLookinFaces() {
  lookinFaces = [];
  const cols = Math.floor(WALL_BOUNDS.w / LOOKIN_FACES_SPACING_X);
  const rows = Math.floor(WALL_BOUNDS.h / LOOKIN_FACES_SPACING_Y);
  // Centered in WALL_BOUNDS, same as js/jasmine.js's grid.
  const offsetX = (WALL_BOUNDS.w - (cols - 1) * LOOKIN_FACES_SPACING_X) / 2;
  const offsetY = (WALL_BOUNDS.h - (rows - 1) * LOOKIN_FACES_SPACING_Y) / 2;

  for (let row = 0; row < rows; row++) {
    // Odd rows shift half a cell and get one extra face so both edges stay covered.
    const shift = row % 2 ? -LOOKIN_FACES_SPACING_X / 2 : 0;
    const count = row % 2 ? cols + 1 : cols;
    for (let col = 0; col < count; col++) {
      lookinFaces.push(
        new LookinFace(offsetX + shift + col * LOOKIN_FACES_SPACING_X, offsetY + row * LOOKIN_FACES_SPACING_Y),
      );
    }
  }
}

function updateLookinFaces() {
  lookinFaces.forEach((f) => f.update());
}

function drawLookinFaces(pg) {
  pg.background(0);
  if (!lookinFaceArt) return; // still loading
  const ctx = pg.drawingContext;
  lookinFaces.forEach((f) => f.display(ctx, lookinFaceArt));
}
