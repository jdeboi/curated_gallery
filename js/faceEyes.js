/*
 * Face eyes - a tiny corner-pinned QuadMap (one per EYES_SPECS entry,
 * declared by each wall's own sketch.js; an empty list is fine) that sits
 * over a face sculpture and shows a pair of blinking eyes on a solid black
 * ground - i.e. a blackout mask with eyes painted into it.
 *
 * Strictly on/off, toggled with "e" (see each wall's keyPressed()):
 *   - off: nothing is drawn at all - not even the black fill - so the main
 *     projection plays across the sculpture completely untouched. (While
 *     calibrating, only the quad's outline is drawn so it can still be
 *     found and dragged.)
 *   - on: drawn from drawFaceEyesOverlay(), called in each wall's draw()
 *     after drawBlackoutMasksOverlay() (js/masks.js), so it sits on top of
 *     every panel, painting, outline and mask.
 *
 * Unlike a PolyMap mask, this is a QuadMap drawn with displaySketch(), so
 * its content is corner-pinned (keystoned) to the sculpture - drag its 4
 * corners during calibration to fit the eye region. Each wall's setup()
 * creates these LAST, after every other QuadMap, because pMapper.load()
 * matches saved surfaces to live ones by per-type creation order - adding
 * it anywhere earlier would shift every later QuadMap's saved calibration.
 *
 * The two eyes are laid out side by side, each centered in its own half of
 * the quad; blinking is shared so they blink together.
 */

let eyesMaps = [];
let faceEyesOn = false;

function toggleFaceEyes() {
  faceEyesOn = !faceEyesOn;
}

// "eyes: off" - for the HUD (js/hud.js).
function faceEyesStatusLine() {
  return `eyes: ${faceEyesOn ? "on" : "off"}`;
}

const EYE_COLOR = 255;

// Blink timing, in ms. A blink is a fast close, a brief hold shut, then a
// slightly slower reopen; the gap before the next one is randomized so the
// two walls/visits never settle into an obvious rhythm.
const EYE_BLINK_CLOSE_MS = 90;
const EYE_BLINK_HOLD_MS = 40;
const EYE_BLINK_OPEN_MS = 130;
const EYE_BLINK_GAP_MIN_MS = 1800;
const EYE_BLINK_GAP_MAX_MS = 6000;
const EYE_DOUBLE_BLINK_CHANCE = 0.2;

const _eyeBlink = { start: -Infinity, next: 0, inDouble: false };

function createFaceEyes(pMapper, specs) {
  eyesMaps = specs.map((s) => pMapper.createQuadMap(s.w, s.h, 8, 8));
}

// 1 = fully open, 0 = shut.
function faceEyesOpenness(now) {
  if (now >= _eyeBlink.next) {
    _eyeBlink.start = now;
    // A double blink is just a second blink queued right after the first -
    // never a triple, since the follow-up itself can't queue another.
    const double = !_eyeBlink.inDouble && random() < EYE_DOUBLE_BLINK_CHANCE;
    _eyeBlink.inDouble = double;
    const blinkLen = EYE_BLINK_CLOSE_MS + EYE_BLINK_HOLD_MS + EYE_BLINK_OPEN_MS;
    _eyeBlink.next =
      now +
      blinkLen +
      (double ? 60 : random(EYE_BLINK_GAP_MIN_MS, EYE_BLINK_GAP_MAX_MS));
  }

  const t = now - _eyeBlink.start;
  if (t < EYE_BLINK_CLOSE_MS) return 1 - t / EYE_BLINK_CLOSE_MS;
  if (t < EYE_BLINK_CLOSE_MS + EYE_BLINK_HOLD_MS) return 0;
  const openT = t - EYE_BLINK_CLOSE_MS - EYE_BLINK_HOLD_MS;
  if (openT < EYE_BLINK_OPEN_MS) return openT / EYE_BLINK_OPEN_MS;
  return 1;
}

// One almond eye centered at (cx, cy). The lower lid stays put and the
// upper lid sweeps down to meet it, so a blink closes from the top the way
// a real one does. It's a plain white shape on the black ground.
function drawEye(pg, cx, cy, rx, ry, openness) {
  const steps = 24;
  const lowerAmp = ry * 0.6;
  const upperAmp = lerp(lowerAmp, -ry, openness);
  const lineY = cy + ry * 0.2; // lid meeting line, so the open almond centers on cy
  const upper = [];
  const lower = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = cx - rx + 2 * rx * t;
    const s = sin(PI * t);
    upper.push({ x, y: lineY + upperAmp * s });
    lower.push({ x, y: lineY + lowerAmp * s });
  }

  pg.noStroke();
  pg.fill(EYE_COLOR);
  pg.beginShape();
  upper.forEach((p) => pg.vertex(p.x, p.y));
  for (let i = lower.length - 1; i >= 0; i--) pg.vertex(lower[i].x, lower[i].y);
  pg.endShape(CLOSE);
}

function drawFaceEyesOverlay() {
  if (!faceEyesOn) {
    if (isCalibratingMapper()) eyesMaps.forEach((m) => m.displaySketch(() => {}));
    return;
  }

  const now = millis();
  const openness = faceEyesOpenness(now);

  eyesMaps.forEach((m) => {
    m.displaySketch((pg) => {
      pg.background(0);
      const cellW = m.width / 2;
      const rx = cellW * 0.4;
      const ry = m.height * 0.3;
      drawEye(pg, cellW * 0.5, m.height / 2, rx, ry, openness);
      drawEye(pg, cellW * 1.5, m.height / 2, rx, ry, openness);
    });
  });
}
