/*
 * Painting location tracking + illumination.
 *
 * Each paintingMap is an independently corner-pinned QuadMap that never
 * draws visible content itself (see sketch.js) - it exists purely so its
 * calibrated corners can be read back. getControlPoints() returns each
 * corner's position local to that surface's own (x, y) translation, so
 * pm.x/pm.y must be added back in to get real canvas-space points (this
 * mirrors how p5.mapper itself renders control points: it translates by
 * (x, y) before drawing them). Those absolute points are then run
 * through quadMap's own inverse transform, giving each painting's quad
 * in quadMap's local drawing space - the same space everything visible
 * gets drawn in.
 */

function getPaintingPolygons() {
  return paintingMaps.map((pm) =>
    pm
      .getControlPoints()
      .map((cp) => quadMap.getTransformedCursor(pm.x + cp.x, pm.y + cp.y)),
  );
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

const PAINTING_LIGHT_MODES = ["on", "glow", "outline"];
let paintingLightMode = "on";

function cyclePaintingLightMode() {
  const idx = PAINTING_LIGHT_MODES.indexOf(paintingLightMode);
  paintingLightMode = PAINTING_LIGHT_MODES[(idx + 1) % PAINTING_LIGHT_MODES.length];
}

function drawPaintings(pg) {
  getPaintingPolygons().forEach((poly) => {
    if (paintingLightMode === "outline") {
      drawPolygon(pg, poly, { strokeColor: pg.color(255), weight: 3 });
      return;
    }

    drawPaintingGlow(pg, poly);

    if (paintingLightMode === "glow") {
      const osc = pMapper.getOscillator(4);
      drawPolygon(pg, poly, { fillColor: pg.color(255, 180 + osc * 75) });
    } else {
      drawPolygon(pg, poly, { fillColor: pg.color(255) });
    }
  });
}
