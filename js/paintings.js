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
// "sequence", "column", and "row" are spotlight modes: unlike the other
// states (which apply the same resolved look to every painting), these
// light up a moving *subset* of paintings - the rest "off" - stepping every
// PAINTING_SPOTLIGHT_PERIOD (or PAINTING_GROUP_PERIOD) seconds:
//   - "sequence" slides a PAINTING_SEQUENCE_FRACTION-sized window over the
//     paintingMaps in their plain index order, so the lit band visibly
//     travels down the wall.
//   - "column"/"row" light up one whole column/row at a time (paintings
//     grouped by physical position - see computePaintingGroups() below),
//     stepping to the next column/row in wall order, so the lit band
//     sweeps across (column) or down (row) the wall.
// All three are handled specially in drawPaintings() below since they need
// the painting count/order, not just a single resolved state.
//
// "random" shares the "curtain" mode's own per-painting on/off timing (same
// PAINTING_CURTAIN_* durations, same jittered period + phase offset per
// painting via curtainOpenFraction()) rather than a shared stepped window -
// each painting just fades between "off" and "filled" as its own fraction
// rises and falls, so it needs no group/order bookkeeping of its own and
// naturally looks random since every painting runs on an independent timer.
//
// "curtain", "wipe", and "pulse" are per-painting animated modes - each
// paints its own polygon per painting (curtain/pulse offset so paintings
// don't move in lockstep; wipe travels left-to-right across all of them at
// once) rather than resolving one state for every painting alike.
const PAINTING_LIGHT_OVERRIDES = [
  "auto",
  "filled",
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
  return state === "sequence" || state === "column" || state === "row";
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

// Returns the Set of painting indices lit this frame: a
// PAINTING_SEQUENCE_FRACTION-wide band that slides one step per
// PAINTING_SPOTLIGHT_PERIOD through the paintings in plain index order,
// wrapping around. ("column"/"row" delegate to groupLitIndices() instead;
// "random" doesn't come through here at all - see drawRandomPaintings().)
function spotlightLitIndices(mode, count) {
  if (mode === "column" || mode === "row") {
    return groupLitIndices(mode === "column" ? "x" : "y");
  }
  if (count <= 0) return new Set();
  const slot = Math.floor(millis() / (PAINTING_SPOTLIGHT_PERIOD * 1000));
  const windowSize = Math.max(1, Math.round(count * PAINTING_SEQUENCE_FRACTION));
  const step = slot % count;

  const lit = new Set();
  for (let i = 0; i < windowSize; i++) lit.add((step + i) % count);
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
const PAINTING_CURTAIN_HOLD = 8; // seconds held fully open
const PAINTING_CURTAIN_CLOSE = 1.2; // seconds to fully close
const PAINTING_CURTAIN_CLOSED_HOLD = 6; // seconds held fully closed
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

// Interpolates each corner toward its own edge's midpoint - top corners
// toward the top edge's midpoint, bottom corners toward the bottom edge's
// midpoint - by `fraction`: 1 is the untouched polygon, 0 collapses it to a
// zero-length line connecting those two midpoints. Relies on poly being a
// QUAD's four getControlPoints() corners in their p5.mapper order: TL, TR,
// BR, BL.
//
// This used to collapse every corner toward the polygon's centroid x while
// holding y fixed, which looked fine for an axis-aligned rectangle but not
// for a corner-pinned quad, where the top and bottom edges are rarely
// perfectly horizontal - as the curtain narrowed, that fixed y-gap between
// e.g. TL and TR stayed constant while the x-gap between them shrank toward
// zero, so the top/bottom edges visibly swung to a steep angle right before
// closing. Collapsing each corner along its own edge instead keeps that
// edge's angle constant all the way down to a point.
function curtainPolygon(poly, fraction) {
  const [tl, tr, br, bl] = poly;
  const topMid = { x: lerpValue(tl.x, tr.x, 0.5), y: lerpValue(tl.y, tr.y, 0.5) };
  const bottomMid = { x: lerpValue(bl.x, br.x, 0.5), y: lerpValue(bl.y, br.y, 0.5) };
  return [
    { x: lerpValue(topMid.x, tl.x, fraction), y: lerpValue(topMid.y, tl.y, fraction) },
    { x: lerpValue(topMid.x, tr.x, fraction), y: lerpValue(topMid.y, tr.y, fraction) },
    { x: lerpValue(bottomMid.x, br.x, fraction), y: lerpValue(bottomMid.y, br.y, fraction) },
    { x: lerpValue(bottomMid.x, bl.x, fraction), y: lerpValue(bottomMid.y, bl.y, fraction) },
  ];
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
      drawLightShape(pg, litPoly, litState, { strokeWeight: 9 });
    }
  });
}

// "random": every painting independently fades between "off" and "filled" on
// the exact same per-painting timer as "curtain" (curtainOpenFraction() -
// same PAINTING_CURTAIN_* durations, same jittered period and phase offset
// per painting), just without warping the polygon - so the two modes share
// identical on/off timing and only differ in how the "on" painting looks.
function drawRandomPaintings(pg, polygons) {
  const offKeyframe = lightStateKeyframe("off");
  const onKeyframe = lightStateKeyframe("filled");
  polygons.forEach((poly, i) => {
    const resolved = crossfadeKeyframes(offKeyframe, onKeyframe, curtainOpenFraction(i));
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

// "wipe": a wave sweeps left-to-right across the paintings fading them in,
// holds them all lit, sweeps left-to-right again fading them out, holds
// them all dark, then loops. Position is normalized against the wipe
// participants' own leftmost/rightmost centroid (not the wall bounds), so
// the wave visibly starts at the actual leftmost participant and ends at
// the actual rightmost one regardless of how much wall space surrounds
// them. "Participants" is paintings alone unless the wing sculptures
// (js/outlines.js) are *also* set to "wipe" (scene-declared or via the "q"
// override) - see wipeBasisPolygons() - in which case both join one shared
// sweep instead of each running its own independently-normalized one.
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
// wipeBasisStats()) the fade band trailing the sweep edge is - a painting
// crossfades from off to on (or on to off) over this much of the sweep's
// travel instead of snapping the instant the edge reaches it.
const PAINTING_WIPE_BAND = 0.18;

// Every polygon that should share the current "wipe" sweep this frame -
// paintings when paintingState is "wipe", wing sculptures when
// butterflyState is "wipe" (js/outlines.js), both/either/neither depending
// on what's currently live. Cached per frame since both drawPaintings() and
// every drawButterflyLightState() call (one per sculpture) need the same
// answer.
let _wipeBasisStatsCache = null;
let _wipeBasisStatsCacheFrame = -1;

function wipeBasisPolygons() {
  const polys = [];
  if (currentPaintingState() === "wipe") polys.push(...getPaintingPolygons());
  if (currentButterflyState() === "wipe") polys.push(...getOutlinePolygons());
  return polys;
}

function wipeBasisStats() {
  if (_wipeBasisStatsCacheFrame === frameCount) return _wipeBasisStatsCache;
  const xs = wipeBasisPolygons().map((poly) => polygonCentroid(poly).x);
  const minX = xs.length ? Math.min(...xs) : 0;
  const span = xs.length ? Math.max(Math.max(...xs) - minX, 1) : 1;
  _wipeBasisStatsCache = { minX, span };
  _wipeBasisStatsCacheFrame = frameCount;
  return _wipeBasisStatsCache;
}

// A single polygon's centroid x normalized 0 (leftmost participant) to 1
// (rightmost participant) against this frame's shared wipe basis.
function wipePosition(poly) {
  const { minX, span } = wipeBasisStats();
  return (polygonCentroid(poly).x - minX) / span;
}

// Maps elapsed time t (0..duration) to a sweep position padded by
// PAINTING_WIPE_BAND on both ends, so a participant at position 0 starts
// the sweep already fully faded out and one at position 1 ends it fully
// faded in (without the padding, the fade band would only be half-crossed
// at either edge of the 0..1 span).
function paintingWipeSweep(t, duration) {
  return lerpValue(-PAINTING_WIPE_BAND, 1 + PAINTING_WIPE_BAND, t / duration);
}

// A single participant's on-ness (0 = fully dark, 1 = fully lit) for the
// current moment in the wipe cycle described above, crossfading over
// PAINTING_WIPE_BAND as the sweep edge passes its own normalized position.
function wipeFractionAtPosition(position) {
  const t = (millis() / 1000) % PAINTING_WIPE_PERIOD;

  if (t < PAINTING_WIPE_ON_DURATION) {
    const sweep = paintingWipeSweep(t, PAINTING_WIPE_ON_DURATION);
    return constrain((sweep - position) / PAINTING_WIPE_BAND + 0.5, 0, 1);
  }
  if (t < PAINTING_WIPE_ON_DURATION + PAINTING_WIPE_HOLD_DURATION) return 1;
  if (
    t <
    PAINTING_WIPE_ON_DURATION +
      PAINTING_WIPE_HOLD_DURATION +
      PAINTING_WIPE_OFF_DURATION
  ) {
    const tOff = t - PAINTING_WIPE_ON_DURATION - PAINTING_WIPE_HOLD_DURATION;
    const sweep = paintingWipeSweep(tOff, PAINTING_WIPE_OFF_DURATION);
    return 1 - constrain((sweep - position) / PAINTING_WIPE_BAND + 0.5, 0, 1);
  }
  return 0;
}

function wipeLitFraction(poly) {
  return wipeFractionAtPosition(wipePosition(poly));
}

function wipeLitFractions(polygons) {
  return polygons.map(wipeLitFraction);
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
    const onState = resolveLightState("filled");
    const offState = resolveLightState("outline");
    polygons.forEach((poly, i) => {
      const on = litIndices.has(i);
      drawLightShape(pg, poly, on ? onState : offState, { strokeWeight: 9 });
    });
    return;
  }

  if (stateValue === "curtain") return drawCurtainPaintings(pg, polygons);
  if (stateValue === "random") return drawRandomPaintings(pg, polygons);
  if (stateValue === "wipe") return drawWipePaintings(pg, polygons);
  if (stateValue === "pulse") return drawPulsePaintings(pg, polygons);

  const resolved = resolveLightState(stateValue);

  polygons.forEach((poly) => {
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
