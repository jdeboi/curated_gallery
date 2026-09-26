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

// Axis-aligned bounding box of a single polygon - shared by getPaintingBounds()
// below (every painting) as the cover-fit box for content that doesn't warp
// to the painting's actual (possibly non-rectangular) corner-pinned quad.
function polygonBounds(poly) {
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
}

function getPaintingBounds() {
  return getPaintingPolygons().map(polygonBounds);
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
// "sequence", "random", "column", and "row" are spotlight modes: unlike the
// other states (which apply the same resolved look to every painting),
// these light up a moving *subset* of paintings - the rest "off" - stepping
// every PAINTING_SPOTLIGHT_PERIOD (or PAINTING_GROUP_PERIOD) seconds:
//   - "sequence" slides a PAINTING_SEQUENCE_FRACTION-sized window over the
//     paintingMaps in their plain index order, so the lit band visibly
//     travels down the wall.
//   - "random" slides a (larger) PAINTING_RANDOM_FRACTION-sized window over
//     a freshly shuffled order each time it's cycled all the way through,
//     so which paintings are lit looks random step to step while every
//     painting still gets an even share of lit time overall (a plain
//     independent-coinflip-per-step version could leave some painting dark
//     for a long stretch by chance, or light the same one twice running).
//   - "column"/"row" light up one whole column/row at a time (paintings
//     grouped by physical position - see computePaintingGroups() below),
//     stepping to the next column/row in wall order, so the lit band
//     sweeps across (column) or down (row) the wall.
// All four are handled specially in drawPaintings() below since they need
// the painting count/order, not just a single resolved state.
//
// "curtain", "wipe", and "pulse" are per-painting animated modes - each
// paints its own polygon per painting (curtain/pulse offset so paintings
// don't move in lockstep; wipe travels left-to-right across all of them at
// once) rather than resolving one state for every painting alike.
const PAINTING_LIGHT_OVERRIDES = [
  "auto",
  "filled",
  "glow",
  "outline",
  "off",
  "sequence",
  "random",
  "column",
  "row",
  "curtain",
  "wipe",
  "pulse",
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

// "painting 3/12: auto (curtain)" - for the HUD (js/hud.js). Shows what
// "auto" actually resolves to (the current scene's own paintingState)
// rather than just the word "auto", since that's the more useful thing to
// know at a glance.
function paintingModeStatusLine() {
  const idx = PAINTING_LIGHT_OVERRIDES.indexOf(paintingLightOverride);
  const label =
    paintingLightOverride === "auto"
      ? `auto (${describeLightState(currentPaintingState())})`
      : paintingLightOverride;
  return `painting ${idx + 1}/${PAINTING_LIGHT_OVERRIDES.length}: ${label}`;
}

function isSpotlightMode(state) {
  return (
    state === "sequence" ||
    state === "random" ||
    state === "column" ||
    state === "row"
  );
}

// Groups painting indices by physical position along `axis` ("x" for
// columns, "y" for rows) - two paintings land in the same group when their
// centroids are within half the average painting size along that axis, so
// a real grid of paintings clusters into its actual columns/rows without
// needing that layout declared by hand anywhere. Read fresh off
// getPaintingPolygons()/getPaintingBounds() each call rather than cached -
// cheap relative to the polygon math those already cache, and only ever
// called from the "column"/"row" branch below (at most a couple of times a
// frame, never the many-panels-times-many-paintings fan-out that made
// getPaintingPolygons() itself worth caching).
function computePaintingGroups(axis) {
  const polygons = getPaintingPolygons();
  if (polygons.length === 0) return [];

  const bounds = getPaintingBounds();
  const centroids = polygons.map(polygonCentroid);
  const avgSize =
    bounds.reduce((sum, b) => sum + (axis === "x" ? b.w : b.h), 0) /
    bounds.length;
  const threshold = avgSize * 0.5;

  const order = centroids
    .map((c, i) => ({ i, v: axis === "x" ? c.x : c.y }))
    .sort((a, b) => a.v - b.v);

  const groups = [];
  order.forEach(({ i, v }) => {
    const last = groups[groups.length - 1];
    if (last && v - last.v < threshold) {
      last.indices.push(i);
      last.v = v;
    } else {
      groups.push({ v, indices: [i] });
    }
  });
  return groups.map((g) => g.indices);
}

const PAINTING_GROUP_PERIOD = 1.8; // seconds a column/row stays lit before the next

// Returns the Set of painting indices in whichever column/row is lit this
// frame - one group at a time, in physical order, wrapping around.
function groupLitIndices(axis) {
  const groups = computePaintingGroups(axis);
  if (groups.length === 0) return new Set();
  const slot = Math.floor(millis() / (PAINTING_GROUP_PERIOD * 1000));
  return new Set(groups[slot % groups.length]);
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
  if (mode === "column" || mode === "row") {
    return groupLitIndices(mode === "column" ? "x" : "y");
  }
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

// Cheap deterministic pseudo-random in [0, 1) for painting `i` - used to
// jitter the "curtain" mode's per-painting timing (see below) without
// needing any stored per-painting state: every reader that passes the same
// (i, salt) gets the same answer, so it's stable frame to frame on its own.
function paintingHash(i, salt) {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// "curtain": each painting opens/closes independently, expanding
// horizontally from its own vertical centerline out to full width, holding
// lit, then collapsing back to that centerline and holding closed - like a
// theater curtain, but widening instead of parting. Every painting runs its
// own cycle length (jittered +/-30% via paintingHash) and starts at its own
// random point in that cycle, so they open/close at "random intervals
// relative to one another" per the ask, and since their periods differ
// they keep drifting out of step rather than ever settling into sync.
const PAINTING_CURTAIN_OPEN = 1.2; // seconds to fully open
const PAINTING_CURTAIN_HOLD = 2.5; // seconds held fully open
const PAINTING_CURTAIN_CLOSE = 1.2; // seconds to fully close
const PAINTING_CURTAIN_CLOSED_HOLD = 1.5; // seconds held fully closed
const PAINTING_CURTAIN_BASE_PERIOD =
  PAINTING_CURTAIN_OPEN +
  PAINTING_CURTAIN_HOLD +
  PAINTING_CURTAIN_CLOSE +
  PAINTING_CURTAIN_CLOSED_HOLD;

// Returns how open painting `i`'s curtain is right now: 0 (fully collapsed
// to its centerline) to 1 (fully open).
function curtainOpenFraction(i) {
  const jitter = 0.7 + paintingHash(i, 1) * 0.6; // 0.7x - 1.3x this painting's period
  const period = PAINTING_CURTAIN_BASE_PERIOD * jitter;
  const phaseOffset = paintingHash(i, 2) * period;
  const t = (millis() / 1000 + phaseOffset) % period;

  const openEnd = PAINTING_CURTAIN_OPEN * jitter;
  const holdEnd = openEnd + PAINTING_CURTAIN_HOLD * jitter;
  const closeEnd = holdEnd + PAINTING_CURTAIN_CLOSE * jitter;

  if (t < openEnd) return t / openEnd;
  if (t < holdEnd) return 1;
  if (t < closeEnd) return 1 - (t - holdEnd) / (closeEnd - holdEnd);
  return 0;
}

// Interpolates poly's points toward its own centroid x (keeping y fixed) by
// `fraction` - 1 is the untouched polygon, 0 collapses it to a zero-width
// vertical line down its center.
function curtainPolygon(poly, fraction) {
  const centroid = polygonCentroid(poly);
  return poly.map((p) => ({ x: lerpValue(centroid.x, p.x, fraction), y: p.y }));
}

function drawCurtainPaintings(pg, polygons) {
  const offState = resolveLightState("off");
  const litState = resolveLightState("filled");
  polygons.forEach((poly, i) => {
    // Opaque black base first - same reason "off"/"outline" are opaque
    // black rather than transparent everywhere else in this file: without
    // it, whatever the current scene is drawing behind the painting would
    // show through the collapsed/closed portion of the curtain.
    drawLightShape(pg, poly, offState, { strokeWeight: 9 });
    const fraction = curtainOpenFraction(i);
    if (fraction > 0.001) {
      const litPoly = curtainPolygon(poly, fraction);
      drawGlow(pg, litPoly);
      drawLightShape(pg, litPoly, litState, { strokeWeight: 9 });
    }
  });
}

// "wipe": a wave sweeps left-to-right across the paintings fading them in,
// holds them all lit, sweeps left-to-right again fading them out, holds
// them all dark, then loops. Position is normalized against the paintings'
// own leftmost/rightmost centroid (not the wall bounds), so the wave
// visibly starts at the actual leftmost painting and ends at the actual
// rightmost one regardless of how much wall space surrounds them.
const PAINTING_WIPE_ON_DURATION = 2.5; // seconds for the on-sweep to cross every painting
const PAINTING_WIPE_HOLD_DURATION = 3; // seconds held fully lit
const PAINTING_WIPE_OFF_DURATION = 2.5; // seconds for the off-sweep to cross every painting
const PAINTING_WIPE_CLOSED_HOLD = 1.5; // seconds held fully dark
const PAINTING_WIPE_PERIOD =
  PAINTING_WIPE_ON_DURATION +
  PAINTING_WIPE_HOLD_DURATION +
  PAINTING_WIPE_OFF_DURATION +
  PAINTING_WIPE_CLOSED_HOLD;
// How wide (in normalized position units, same 0-1 scale as
// paintingWipePositions()) the fade band trailing the sweep edge is - a
// painting crossfades from off to on (or on to off) over this much of the
// sweep's travel instead of snapping the instant the edge reaches it.
const PAINTING_WIPE_BAND = 0.18;

// Each painting's centroid x, normalized 0 (leftmost painting) to 1
// (rightmost painting).
function paintingWipePositions(polygons) {
  const xs = polygons.map((poly) => polygonCentroid(poly).x);
  const minX = Math.min(...xs);
  const span = Math.max(Math.max(...xs) - minX, 1);
  return xs.map((x) => (x - minX) / span);
}

// Maps elapsed time t (0..duration) to a sweep position padded by
// PAINTING_WIPE_BAND on both ends, so a painting at position 0 starts the
// sweep already fully faded out and a painting at position 1 ends it fully
// faded in (without the padding, the fade band would only be half-crossed
// at either edge of the 0..1 span).
function paintingWipeSweep(t, duration) {
  return lerpValue(-PAINTING_WIPE_BAND, 1 + PAINTING_WIPE_BAND, t / duration);
}

// Returns each painting's on-ness (0 = fully dark, 1 = fully lit) for the
// current moment in the wipe cycle described above, crossfading over
// PAINTING_WIPE_BAND as the sweep edge passes each painting's position.
function wipeLitFractions(polygons) {
  const positions = paintingWipePositions(polygons);
  const t = (millis() / 1000) % PAINTING_WIPE_PERIOD;

  if (t < PAINTING_WIPE_ON_DURATION) {
    const sweep = paintingWipeSweep(t, PAINTING_WIPE_ON_DURATION);
    return positions.map((p) =>
      constrain((sweep - p) / PAINTING_WIPE_BAND + 0.5, 0, 1),
    );
  }
  if (t < PAINTING_WIPE_ON_DURATION + PAINTING_WIPE_HOLD_DURATION) {
    return positions.map(() => 1);
  }
  if (
    t <
    PAINTING_WIPE_ON_DURATION +
      PAINTING_WIPE_HOLD_DURATION +
      PAINTING_WIPE_OFF_DURATION
  ) {
    const tOff = t - PAINTING_WIPE_ON_DURATION - PAINTING_WIPE_HOLD_DURATION;
    const sweep = paintingWipeSweep(tOff, PAINTING_WIPE_OFF_DURATION);
    return positions.map(
      (p) => 1 - constrain((sweep - p) / PAINTING_WIPE_BAND + 0.5, 0, 1),
    );
  }
  return positions.map(() => 0);
}

function drawWipePaintings(pg, polygons) {
  const fractions = wipeLitFractions(polygons);
  const onKeyframe = lightStateKeyframe("filled");
  const offKeyframe = lightStateKeyframe("off");
  polygons.forEach((poly, i) => {
    const resolved = crossfadeKeyframes(offKeyframe, onKeyframe, fractions[i]);
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

// "pulse": every painting fades black<->white on its own sinusoidal cycle,
// each offset from the next by PAINTING_PULSE_OFFSET_STEP of a cycle (via
// resolveLightState's phaseOffset - js/lightState.js) so the pulse visibly
// ripples across the paintings in index order rather than every painting
// breathing in lockstep.
const PAINTING_PULSE_PERIOD = 4; // seconds for one full black<->white cycle
const PAINTING_PULSE_OFFSET_STEP = 0.15; // fraction of a cycle between neighboring paintings

function drawPulsePaintings(pg, polygons) {
  polygons.forEach((poly, i) => {
    const resolved = resolveLightState({
      mode: "pulse",
      states: ["off", "filled"],
      period: PAINTING_PULSE_PERIOD,
      phaseOffset: i * PAINTING_PULSE_OFFSET_STEP,
    });
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
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

  if (stateValue === "curtain") return drawCurtainPaintings(pg, polygons);
  if (stateValue === "wipe") return drawWipePaintings(pg, polygons);
  if (stateValue === "pulse") return drawPulsePaintings(pg, polygons);

  const resolved = resolveLightState(stateValue);
  const lit = isLitState(resolved);

  polygons.forEach((poly) => {
    if (lit && isGlowMode(stateValue)) drawGlow(pg, poly);
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

// The "emanatePaintings" scene's own animation (js/scenes.js, set as that
// scene's `draw`) - same rippling-ring effect as "emanate" (js/outlines.js's
// drawEmanateRipples), just around every painting's own quad instead of a
// wing sculpture's silhouette. Layered on top of drawPaintings' steady state
// (drawn separately, from js/wall.js) rather than replacing it, and skipped
// while calibrating so the ripples don't obscure judging a painting's
// corner-pin alignment - same reasoning as drawEmanateRipples.
function drawPaintingEmanateRipples(pg) {
  if (isCalibratingMapper()) return;
  getPaintingPolygons().forEach((poly) => drawEmanateRipplesOnPolygon(pg, poly));
}
