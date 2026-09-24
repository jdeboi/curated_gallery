/*
 * Painting location tracking + illumination.
 *
 * Each paintingMap is an independently corner-pinned QuadMap that never
 * draws visible content itself (see each wall's sketch.js) - it exists
 * purely so its calibrated corners can be read back. getControlPoints()
 * returns each corner's position local to that surface's own (x, y)
 * translation, so pm.x/pm.y must be added back in to get real
 * canvas-space points (this mirrors how p5.mapper itself renders control
 * points: it translates by (x, y) before drawing them). Those absolute
 * points are then run through the inverse transform of whichever wall
 * panel that painting is physically sitting on - resolvePanelIndex() (see
 * js/wall.js) works that out from the painting's own calibrated position,
 * rather than a hand-declared index - giving each painting's quad in the
 * wall's shared logical drawing space - the same space everything visible
 * gets drawn in, regardless of how many physical panels the wall is split
 * across.
 *
 * This is genuinely expensive per painting (a point-in-polygon panel
 * lookup plus a perspective-inverse transform per corner) and, on a
 * multi-panel wall, gets called several times in the same frame with an
 * identical answer every time - once per panel from displayWall()'s own
 * per-panel drawPaintings() call (drawing the *same* logical-space
 * polygon into each panel's own buffer), plus again from
 * particles.js's getPaintingBounds(). Cached per
 * frame (keyed on p5's frameCount, which only advances outside
 * calibration dragging anyway) so all of those share one computation
 * instead of repeating it - the pre-cache version of this straight-up
 * showed up as a framerate drop on the right wall's 13-painting/3-panel
 * config.
 */
let _paintingPolygonsCache = null;
let _paintingPolygonsCacheFrame = -1;

function getPaintingPolygons() {
  if (_paintingPolygonsCacheFrame === frameCount) return _paintingPolygonsCache;

  _paintingPolygonsCache = paintingMaps.map((pm) => {
    const panel = resolvePanelIndex(pm);
    return pm
      .getControlPoints()
      .map((cp) => panelToLogical(panel, pm.x + cp.x, pm.y + cp.y));
  });
  _paintingPolygonsCacheFrame = frameCount;
  return _paintingPolygonsCache;
}

function getPaintingBounds() {
  return getPaintingPolygons().map((poly) => {
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
  });
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPainting(x, y) {
  const polygons = getPaintingPolygons();
  for (let i = 0; i < polygons.length; i++) {
    if (pointInPolygon(x, y, polygons[i])) return i;
  }
  return -1;
}

function polygonCentroid(poly) {
  let x = 0;
  let y = 0;
  poly.forEach((p) => {
    x += p.x / poly.length;
    y += p.y / poly.length;
  });
  return { x, y };
}

function drawPolygon(pg, poly, { fillColor, strokeColor, weight } = {}) {
  pg.push();
  if (fillColor) pg.fill(fillColor);
  else pg.noFill();
  if (strokeColor) {
    pg.stroke(strokeColor);
    pg.strokeWeight(weight || 1);
  } else {
    pg.noStroke();
  }
  pg.beginShape();
  poly.forEach((p) => pg.vertex(p.x, p.y));
  pg.endShape(CLOSE);
  pg.pop();
}

// A painting's lit state normally comes from the live scene's own
// `paintingState` (js/scenes.js; unset means LIGHT_STATE_DEFAULT - see
// js/lightState.js), same mechanism as the wing sculptures in
// js/outlines.js (whose analogous override is "q" - see
// cycleButterflyLightMode()). "w" cycles a manual override on top of this
// one, for previewing a look (e.g. checking corner-pin alignment in
// "outline") without needing to sit through a specific scene - "auto"
// (the default) defers back to whatever the current scene declares.
//
// "sequence" and "random" are spotlight modes: unlike the other states
// (which apply the same resolved look to every painting), these light up a
// moving *subset* of paintings - the rest "off" - stepping every
// PAINTING_SPOTLIGHT_PERIOD seconds. Both are a sliding window over some
// order of the paintings, differing only in what order they slide over and
// how big the window is:
//   - "sequence" slides a PAINTING_SEQUENCE_FRACTION-sized window over the
//     paintingMaps in their plain index order, so the lit band visibly
//     travels down the wall.
//   - "random" slides a (larger) PAINTING_RANDOM_FRACTION-sized window over
//     a freshly shuffled order each time it's cycled all the way through,
//     so which paintings are lit looks random step to step while every
//     painting still gets an even share of lit time overall (a plain
//     independent-coinflip-per-step version could leave some painting dark
//     for a long stretch by chance, or light the same one twice running).
// Both are handled specially in drawPaintings() below since they need the
// painting count/order, not just a single resolved state.
const PAINTING_LIGHT_OVERRIDES = [
  "auto",
  "filled",
  "glow",
  "outline",
  "off",
  "sequence",
  "random",
];
let paintingLightOverride = "auto";
const PAINTING_SPOTLIGHT_PERIOD = 1.5; // seconds between steps
const PAINTING_SEQUENCE_FRACTION = 1 / 3; // fraction of paintings lit at once
const PAINTING_RANDOM_FRACTION = 1 / 2; // fraction of paintings lit at once

function cyclePaintingLightMode() {
  const idx = PAINTING_LIGHT_OVERRIDES.indexOf(paintingLightOverride);
  paintingLightOverride =
    PAINTING_LIGHT_OVERRIDES[(idx + 1) % PAINTING_LIGHT_OVERRIDES.length];
}

function currentPaintingState() {
  return paintingLightOverride === "auto"
    ? currentScene().paintingState
    : paintingLightOverride;
}

function isSpotlightMode(state) {
  return state === "sequence" || state === "random";
}

function shuffledIndices(count) {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Reshuffled once per full pass through the paintings (see comment above),
// keyed on `cycle` so repeated calls within the same pass reuse it.
let _spotlightShuffle = { order: [], cycle: -1, count: -1 };

// Returns the Set of painting indices lit this frame: a `windowSize`-wide
// band that slides one step per PAINTING_SPOTLIGHT_PERIOD through either
// plain (0,1,2,...) or shuffled order, wrapping around.
function spotlightLitIndices(mode, count) {
  if (count <= 0) return new Set();
  const slot = Math.floor(millis() / (PAINTING_SPOTLIGHT_PERIOD * 1000));

  let order;
  let windowSize;
  let step;
  if (mode === "sequence") {
    order = Array.from({ length: count }, (_, i) => i);
    windowSize = Math.max(1, Math.round(count * PAINTING_SEQUENCE_FRACTION));
    step = slot % count;
  } else {
    windowSize = Math.max(1, Math.round(count * PAINTING_RANDOM_FRACTION));
    const cycle = Math.floor(slot / count);
    if (cycle !== _spotlightShuffle.cycle || count !== _spotlightShuffle.count) {
      _spotlightShuffle = { order: shuffledIndices(count), cycle, count };
    }
    order = _spotlightShuffle.order;
    step = slot % count;
  }

  const lit = new Set();
  for (let i = 0; i < windowSize; i++) lit.add(order[(step + i) % count]);
  return lit;
}

function drawPaintings(pg) {
  const stateValue = currentPaintingState();
  const polygons = getPaintingPolygons();

  if (isSpotlightMode(stateValue)) {
    const litIndices = spotlightLitIndices(stateValue, polygons.length);
    const onState = resolveLightState("glow");
    const offState = resolveLightState("outline");
    polygons.forEach((poly, i) => {
      const on = litIndices.has(i);
      if (on) drawGlow(pg, poly);
      drawLightShape(pg, poly, on ? onState : offState, { strokeWeight: 9 });
    });
    return;
  }

  const resolved = resolveLightState(stateValue);
  const lit = isLitState(resolved);

  polygons.forEach((poly) => {
    if (lit && isGlowMode(stateValue)) drawGlow(pg, poly);
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}
