/*
 * Wing sculptures (e.g. left wall's bird + 2 butterflies): their steady lit
 * state every scene (filled/outline/off/pulse/switch, via js/lightState.js
 * and each scene's own `butterflyState` - see js/scenes.js), plus the
 * "emanate" scene's own rippling-outline animation, layered on top of that
 * steady state while that scene is live. Which sculptures exist, their
 * SVGs, and which wall panel each is physically mounted on is wall-specific
 * data - that lives in OUTLINE_SPECS, defined by each wall's own sketch.js
 * (an empty list is fine for a wall with no sculptures, e.g. the right
 * wall).
 *
 * Each sculpture gets a QuadMap reference surface (see each wall's
 * sketch.js), sized to that SVG's own viewBox so the traced silhouette
 * points - sampled once from the path and never touched again - sit in
 * the quad's local, un-warped (0,0)-(width,height) rectangle. Calibrating
 * a shape then just means corner-pinning that quad (the same 4-handle
 * drag already used for paintingMaps/the wall's panels) to
 * scale/keystone/position the whole wing or bird onto the physical piece
 * - no per-point dragging needed, because the shape is fixed and only
 * the quad's 4 corners move.
 *
 * refMap.resolveToScreen(localX, localY) is p5.mapper's own forward
 * perspective-warp primitive (the same one it uses to keystone a texture
 * onto a QuadMap) - it maps a point from that local rectangle through the
 * quad's current corner positions to get its true canvas position. That
 * absolute point is then run through the inverse transform of whichever
 * wall panel this outline is physically sitting on - resolvePanelIndex()
 * (see js/wall.js) works that out from refMap's own calibrated position,
 * rather than a hand-declared index - to land in the wall's shared logical
 * drawing space, where both the steady state and the ripples are drawn.
 */

const OUTLINE_LANDMARK_COUNT = 24;

let outlinePaths = [];

// Traces each shape's silhouette into outlinePaths[i], in that SVG's own
// local coordinate space (matching the QuadMap it's warped through - see
// butterflyMaps in sketch.js). Nothing here touches the reference surface
// itself - drawButterflyLightState/drawEmanateRipples read outlinePaths +
// the surface's current corners together at draw time, so a saved
// calibration (the quad's 4 corners) and the traced shape never fight over
// the same data the way a PolyMap's own point array would.
function loadOutlineSVGs() {
  return Promise.all(
    OUTLINE_SPECS.map((spec, i) =>
      fetch(spec.file)
        .then((res) => res.text())
        .then((svgText) => tracePathPoints(svgText, OUTLINE_LANDMARK_COUNT))
        .then((points) => {
          outlinePaths[i] = points;
        })
        .catch((err) => console.error("Failed to load outline SVG:", spec.file, err)),
    ),
  );
}

function tracePathPoints(svgText, numPoints) {
  const d = svgText.match(/<path[^>]*\sd="([^"]+)"/)[1];

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  svg.style.position = "absolute";
  svg.style.left = "-9999px";
  document.body.appendChild(svg);

  const totalLength = path.getTotalLength();
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const pt = path.getPointAtLength((i / numPoints) * totalLength);
    points.push({ x: pt.x, y: pt.y });
  }

  document.body.removeChild(svg);
  return points;
}

// Runs the traced silhouette through refMap's current corner-pin and the
// wall's panel-aware inverse transform - the one computation
// drawButterflyLightState, drawEmanateRipples, drawCalibrationOutline,
// getOutlinePolygons and getOutlineBounds all need, each in the wall's
// shared logical drawing space. Not cached itself (see getOutlinePolygons()
// for the per-frame cache) since each of those only ever calls it once per
// outline per frame anyway.
function outlineLocalPoints(index, refMap) {
  if (!outlinePaths[index]) return null;
  const panel = resolvePanelIndex(refMap);
  return outlinePaths[index].map((p) => {
    const screenPoint = refMap.resolveToScreen(p.x, p.y);
    return panelToLogical(panel, screenPoint.x, screenPoint.y);
  });
}

// One steady, fully-opaque trace of the exact SVG silhouette at its current
// corner-pin position, shown instead of the pulsing rings while calibrating -
// the animated scale/fade makes it harder to judge precisely how the traced
// points line up against the physical sculpture than a plain still outline
// does. A distinct color (not white, not the yellow-on-black id labels from
// drawSurfaceLabels()) so it reads clearly against whatever's already on
// screen.
function drawCalibrationOutline(pg, localPoints) {
  pg.push();
  pg.noFill();
  pg.stroke(0, 255, 160);
  pg.strokeWeight(2);
  pg.beginShape();
  localPoints.forEach((p) => pg.vertex(p.x, p.y));
  pg.endShape(CLOSE);
  pg.pop();
}

// A wing sculpture's lit state normally comes from the live scene's own
// `butterflyState` (js/scenes.js; unset means LIGHT_STATE_DEFAULT - see
// js/lightState.js), same mechanism paintings use (js/paintings.js). "q"
// cycles a manual override on top of that, for previewing a look without
// needing to sit through a specific scene - "auto" (the default) defers
// back to whatever the current scene declares.
const BUTTERFLY_LIGHT_OVERRIDES = ["auto", "filled", "glow", "outline", "off"];
let butterflyLightOverride = "auto";

function cycleButterflyLightMode() {
  const idx = BUTTERFLY_LIGHT_OVERRIDES.indexOf(butterflyLightOverride);
  butterflyLightOverride =
    BUTTERFLY_LIGHT_OVERRIDES[(idx + 1) % BUTTERFLY_LIGHT_OVERRIDES.length];
}

function currentButterflyState() {
  return butterflyLightOverride === "auto"
    ? currentScene().butterflyState
    : butterflyLightOverride;
}

// A wing sculpture's steady, non-animated look every scene - filled,
// outlined, off, or crossfading/switching between them, per
// currentButterflyState() above. Calibration mode overrides this with the
// plain still trace instead, same as before.
function drawButterflyLightState(pg, index, refMap) {
  const localPoints = outlineLocalPoints(index, refMap);
  if (!localPoints) return;

  if (isCalibratingMapper()) {
    drawCalibrationOutline(pg, localPoints);
    return;
  }

  const stateValue = currentButterflyState();
  const resolved = resolveLightState(stateValue);
  if (isLitState(resolved) && isGlowMode(stateValue)) drawGlow(pg, localPoints);
  drawLightShape(pg, localPoints, resolved, { strokeWeight: 9 });
}

const RIPPLE_STROKE_WEIGHT = 10;
const RIPPLE_COUNT = 12;
const RIPPLE_PERIOD_SECONDS = 16; // time for one ripple to cross the whole wall
const RIPPLE_FADE_FRACTION = 0.15; // ripple fades to nothing within this fraction of the sweep, not the whole thing

// The "emanate" scene's own animation (js/scenes.js, set as that scene's
// `draw`) - thin rings expand outward from every wing sculpture's centroid
// at once, fading out quickly (within RIPPLE_FADE_FRACTION of the sweep)
// rather than staying visible the whole way across, then loop. Layered on
// top of drawButterflyLightState's steady state
// (drawn separately, from js/wall.js) rather than replacing it, and runs
// regardless of what that steady state is set to - it's the scene's own
// content, not a property of the sculpture's resting look.
function drawEmanateRipples(pg) {
  butterflyMaps.forEach((refMap, index) => {
    if (isCalibratingMapper()) return;
    const localPoints = outlineLocalPoints(index, refMap);
    if (!localPoints) return;

    const centroid = polygonCentroid(localPoints);

    // Each point rides straight outward along its own direction from the
    // centroid, so the silhouette's shape is preserved as it grows rather
    // than being replaced by a circle. Growth is in absolute wall pixels
    // (not a multiple of the shape's own size) and driven by wall-clock
    // time (not frameCount), so ripple speed stays the same regardless of
    // a sculpture's size or the current frame rate. maxGrowth is the
    // wall's full diagonal, so by the end of one period the ripple has
    // swept clear across every panel, not just faded out a short distance
    // from the wing.
    const directions = localPoints.map((p) => {
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      const dist = Math.hypot(dx, dy) || 1;
      return { ux: dx / dist, uy: dy / dist, dist };
    });
    const maxGrowth = Math.hypot(WALL_BOUNDS.w, WALL_BOUNDS.h);
    const t = millis() / (RIPPLE_PERIOD_SECONDS * 1000);

    for (let r = 0; r < RIPPLE_COUNT; r++) {
      const phase = (t + r / RIPPLE_COUNT) % 1;
      const growth = phase * maxGrowth;
      const alpha = Math.max(0, 255 * (1 - phase / RIPPLE_FADE_FRACTION));

      pg.push();
      pg.noFill();
      pg.stroke(255, alpha);
      pg.strokeWeight(RIPPLE_STROKE_WEIGHT);
      pg.beginShape();
      directions.forEach((d) => {
        pg.vertex(
          centroid.x + d.ux * (d.dist + growth),
          centroid.y + d.uy * (d.dist + growth),
        );
      });
      pg.endShape(CLOSE);
      pg.pop();
    }
  });
}

// Same cache-per-frame pattern as getPaintingPolygons() (js/paintings.js),
// for the same reason: this is the outline-avoidance counterpart paintings
// already had, so particles/snake/mycelium can bounce off a wing sculpture
// the same way they bounce off a painting, and each of those calls
// snakeObstacles()/myceliumObstacles()/updateParticles() once per frame.
// Skips any outline whose SVG hasn't finished loading yet (or, on a wall
// with no OUTLINE_SPECS at all, returns an empty list) via
// outlineLocalPoints()'s own null check.
let _outlinePolygonsCache = null;
let _outlinePolygonsCacheFrame = -1;

function getOutlinePolygons() {
  if (_outlinePolygonsCacheFrame === frameCount) return _outlinePolygonsCache;

  _outlinePolygonsCache = butterflyMaps
    .map((refMap, i) => outlineLocalPoints(i, refMap))
    .filter(Boolean);
  _outlinePolygonsCacheFrame = frameCount;
  return _outlinePolygonsCache;
}

// AABB counterpart to getPaintingBounds() (js/paintings.js), for
// particles.js's box-edge bounce.
function getOutlineBounds() {
  return getOutlinePolygons().map((poly) => {
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
