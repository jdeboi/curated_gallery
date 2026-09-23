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

// Soft halo that bleeds onto the grass around a painting - layered,
// growing, fading copies of the same polygon offset from its centroid.
function drawPaintingGlow(pg, poly) {
  const centroid = polygonCentroid(poly);
  const numRings = 4;
  for (let r = numRings; r >= 1; r--) {
    const scale = 1 + r * 0.12;
    const alpha = 40 * (1 - r / (numRings + 1));
    const ringPoly = poly.map((p) => ({
      x: centroid.x + (p.x - centroid.x) * scale,
      y: centroid.y + (p.y - centroid.y) * scale,
    }));
    drawPolygon(pg, ringPoly, { fillColor: pg.color(255, alpha) });
  }
}

// A painting's lit state normally comes from the live scene's own
// `paintingState` (js/scenes.js; unset means LIGHT_STATE_DEFAULT - see
// js/lightState.js), same mechanism as the wing sculptures in
// js/outlines.js (whose analogous override is "q" - see
// cycleButterflyLightMode()). "w" cycles a manual override on top of this
// one, for previewing a look (e.g. checking corner-pin alignment in
// "outline") without needing to sit through a specific scene - "auto"
// (the default) defers back to whatever the current scene declares.
const PAINTING_LIGHT_OVERRIDES = ["auto", "filled", "outline", "off"];
let paintingLightOverride = "auto";

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

function drawPaintings(pg) {
  const resolved = resolveLightState(currentPaintingState());
  // "off" is an opaque *black* fill (see js/lightState.js), not the
  // absence of one - only count it as lit, and worth a glow halo, when
  // there's actually light-colored fill/stroke showing.
  const lit =
    (resolved.fillAlpha > 0 && resolved.fillColor > 0) ||
    resolved.strokeAlpha > 0;

  getPaintingPolygons().forEach((poly) => {
    if (lit) drawPaintingGlow(pg, poly);
    drawLightShape(pg, poly, resolved, { strokeWeight: 3 });
  });
}
