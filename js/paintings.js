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
// "sequence" is a spotlight mode: unlike the other states (which apply the
// same resolved look to every painting), it lights up a moving *subset* of
// paintings - the rest "off" - sliding a PAINTING_SEQUENCE_FRACTION-sized
// window over the paintingMaps in their plain index order every
// PAINTING_SPOTLIGHT_PERIOD seconds, so the lit band visibly travels down
// the wall. Handled specially in drawPaintings() below since it needs the
// painting count/order, not just a single resolved state.
//
// "myceliumReveal" (the mycelium scene's own paintingState) is driven by
// js/mycelium.js instead of a timer: every painting starts "off" and
// crossfades to "filled" over MYCELIUM_REVEAL_DURATION once mycelium first
// grows into its silhouette (myceliumPaintingRevealFraction) - see
// drawMyceliumRevealPaintings() below.
//
// "random"/"randomOutline" run each painting's own on/off timing via
// curtainOpenFraction() - same PAINTING_CURTAIN_* durations as "curtain"
// below, but each painting gets its own jittered period + phase offset
// rather than a shared schedule - each painting just fades between a low
// state ("off" for "random", "outline" for "randomOutline") and "filled" as
// its own fraction rises and falls, so it needs no group/order bookkeeping
// of its own and naturally looks random since every painting runs on an
// independent timer.
//
// "wipe", "wipeDown", "wipeRadial", and "pulse" are per-painting animated
// modes - each paints its own polygon per painting (pulse offset so paintings
// don't move in lockstep; wipe/wipeDown/wipeRadial travel across all of them
// at once, left-to-right, top-to-bottom, and outward from the wall's center
// respectively) rather than resolving one state for every
// painting alike. "curtain"/"curtainVertical" and "groupPulse" are
// group-based instead: paintings (and, per PULSE_GROUPS, wing sculptures too,
// for "groupPulse") take turns by wall-declared group rather than
// individually - "curtain" adds the expand/collapse animation on top of that
// same group relay; "groupPulse" is a plain crossfade - see
// drawCurtainPaintingsUsing()/drawGroupPulsePaintings() below.
//
// "lookin" writes the "I SEE YOU LOOKIN" lettering across each dark painting
// one letter at a time before fading it up to lit - see js/lookin.js.
const PAINTING_LIGHT_OVERRIDES = [
  "auto",
  "filled",
  "outline",
  "off",
  "sequence",
  "myceliumReveal",
  "random",
  "randomOutline",
  "curtain",
  "curtainVertical",
  "wipe",
  "wipeDown",
  "wipeRadial",
  "dotField",
  "pulse",
  "groupPulse",
  "lookin",
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
  return state === "sequence";
}

// Returns the Set of painting indices lit this frame: a
// PAINTING_SEQUENCE_FRACTION-wide band that slides one step per
// PAINTING_SPOTLIGHT_PERIOD through the paintings in plain index order,
// wrapping around. ("random" doesn't come through here at all - see
// drawRandomPaintings().)
function spotlightLitIndices(count) {
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

// "curtain"/"curtainVertical": paintings open/close by wall-declared
// PULSE_GROUPS turn (same group relay as "groupPulse" - see
// groupPulseFractionFor() below), expanding from their shared centerline out
// to full size, holding lit, then collapsing back to that centerline and
// holding closed before the next group's turn - like a theater curtain, but
// widening instead of parting. "curtain" expands horizontally from the
// vertical centerline (full width); "curtainVertical" expands vertically from
// the horizontal centerline (full height) instead.
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
// `salt` decorrelates one index space from another sharing this same
// function - js/outlines.js's "random" wing-sculpture mode passes
// BUTTERFLY_RANDOM_SALT so butterfly index 0 doesn't land on the exact same
// jitter/phase as painting index 0.
function curtainOpenFraction(i, salt = 0) {
  const key = i + salt;
  const jitter = 0.7 + paintingHash(key, 1) * 0.6; // 0.7x - 1.3x this painting's period
  const period = PAINTING_CURTAIN_BASE_PERIOD * jitter;
  const phaseOffset = paintingHash(key, 2) * period;
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

// Same idea as curtainPolygon() above but collapsing toward the left/right
// edges' midpoints instead of the top/bottom ones, so the painting narrows
// vertically toward its horizontal centerline rather than horizontally
// toward its vertical one.
function curtainPolygonVertical(poly, fraction) {
  const [tl, tr, br, bl] = poly;
  const leftMid = { x: lerpValue(tl.x, bl.x, 0.5), y: lerpValue(tl.y, bl.y, 0.5) };
  const rightMid = { x: lerpValue(tr.x, br.x, 0.5), y: lerpValue(tr.y, br.y, 0.5) };
  return [
    { x: lerpValue(leftMid.x, tl.x, fraction), y: lerpValue(leftMid.y, tl.y, fraction) },
    { x: lerpValue(rightMid.x, tr.x, fraction), y: lerpValue(rightMid.y, tr.y, fraction) },
    { x: lerpValue(rightMid.x, br.x, fraction), y: lerpValue(rightMid.y, br.y, fraction) },
    { x: lerpValue(leftMid.x, bl.x, fraction), y: lerpValue(leftMid.y, bl.y, fraction) },
  ];
}

// Shared by drawCurtainPaintings/drawCurtainVerticalPaintings below - only
// `collapsePolygon` differs between the horizontal and vertical variants.
function drawCurtainPaintingsUsing(pg, polygons, collapsePolygon) {
  const offState = resolveLightState("off");
  const litState = resolveLightState("filled");
  polygons.forEach((poly, i) => {
    // Opaque black base first - same reason "off"/"outline" are opaque
    // black rather than transparent everywhere else in this file: without
    // it, whatever the current scene is drawing behind the painting would
    // show through the collapsed/closed portion of the curtain.
    drawLightShape(pg, poly, offState, { strokeWeight: 9 });
    const fraction = groupPulseFractionFor("paintings", i);
    if (fraction > 0.001) {
      const litPoly = collapsePolygon(poly, fraction);
      drawLightShape(pg, litPoly, litState, { strokeWeight: 9 });
    }
  });
}

function drawCurtainPaintings(pg, polygons) {
  drawCurtainPaintingsUsing(pg, polygons, curtainPolygon);
}

function drawCurtainVerticalPaintings(pg, polygons) {
  drawCurtainPaintingsUsing(pg, polygons, curtainPolygonVertical);
}

// "random"/"randomOutline": every painting independently fades between a
// low state and "filled" on the exact same per-painting timer as "curtain"
// (curtainOpenFraction() - same PAINTING_CURTAIN_* durations, same jittered
// period and phase offset per painting), just without warping the polygon -
// so all three modes share identical on/off timing and only differ in how
// the "off" painting looks: "random" goes fully dark ("off"), while
// "randomOutline" keeps the painting's outline visible instead of vanishing
// into the black background.
function drawRandomFadePaintings(pg, polygons, lowMode) {
  const lowKeyframe = lightStateKeyframe(lowMode);
  const onKeyframe = lightStateKeyframe("filled");
  polygons.forEach((poly, i) => {
    const resolved = crossfadeKeyframes(lowKeyframe, onKeyframe, curtainOpenFraction(i));
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

function drawRandomPaintings(pg, polygons) {
  drawRandomFadePaintings(pg, polygons, "off");
}

function drawRandomOutlinePaintings(pg, polygons) {
  drawRandomFadePaintings(pg, polygons, "outline");
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
const PAINTING_WIPE_CLOSED_HOLD = 0.4; // seconds held fully dark
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

// "wipeDown": same sweep as "wipe" above but normalized against centroid y
// instead of x, so it travels top-to-bottom instead of left-to-right.
// Mirrors wipeBasisPolygons()'s join: paintings when paintingState is
// "wipeDown", wing sculptures when butterflyState is "wipeDown", both/either/
// neither depending on what's currently live, so the two read as one
// continuous downward wave rather than two separately-normalized ones.
function wipeDownBasisPolygons() {
  const polys = [];
  if (currentPaintingState() === "wipeDown") polys.push(...getPaintingPolygons());
  if (currentButterflyState() === "wipeDown") polys.push(...getOutlinePolygons());
  return polys;
}

let _wipeDownStatsCache = null;
let _wipeDownStatsCacheFrame = -1;

function wipeDownStats() {
  if (_wipeDownStatsCacheFrame === frameCount) return _wipeDownStatsCache;
  const ys = wipeDownBasisPolygons().map((poly) => polygonCentroid(poly).y);
  const minY = ys.length ? Math.min(...ys) : 0;
  const span = ys.length ? Math.max(Math.max(...ys) - minY, 1) : 1;
  _wipeDownStatsCache = { minY, span };
  _wipeDownStatsCacheFrame = frameCount;
  return _wipeDownStatsCache;
}

function wipeDownPosition(poly, stats) {
  return (polygonCentroid(poly).y - stats.minY) / stats.span;
}

function wipeDownLitFraction(poly) {
  return wipeFractionAtPosition(wipeDownPosition(poly, wipeDownStats()));
}

// "wipeRadial": same sweep as "wipe" above but normalized against each
// centroid's distance from the wall's center (WALL_BOUNDS' midpoint - the
// same point js/jasmine.js pulses out from), so it travels outward in a ring
// instead of across. Like "wipe", distance is normalized against the
// participants' own nearest/farthest centroid rather than the wall bounds,
// so the ring starts at whichever participant sits closest to the center.
// Joins paintings + wing sculptures the same way wipeBasisPolygons() does.
function wipeRadialBasisPolygons() {
  const polys = [];
  if (currentPaintingState() === "wipeRadial") polys.push(...getPaintingPolygons());
  if (currentButterflyState() === "wipeRadial") polys.push(...getOutlinePolygons());
  return polys;
}

function wipeRadialDistance(poly) {
  const c = polygonCentroid(poly);
  return Math.hypot(c.x - WALL_BOUNDS.w / 2, c.y - WALL_BOUNDS.h / 2);
}

let _wipeRadialStatsCache = null;
let _wipeRadialStatsCacheFrame = -1;

function wipeRadialStats() {
  if (_wipeRadialStatsCacheFrame === frameCount) return _wipeRadialStatsCache;
  const ds = wipeRadialBasisPolygons().map(wipeRadialDistance);
  const minD = ds.length ? Math.min(...ds) : 0;
  const span = ds.length ? Math.max(Math.max(...ds) - minD, 1) : 1;
  _wipeRadialStatsCache = { minD, span };
  _wipeRadialStatsCacheFrame = frameCount;
  return _wipeRadialStatsCache;
}

function wipeRadialLitFraction(poly) {
  const { minD, span } = wipeRadialStats();
  return wipeFractionAtPosition((wipeRadialDistance(poly) - minD) / span);
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

// Shared by drawWipePaintings/drawWipeDownPaintings below - crossfades each
// painting between "off" and "filled" by its own already-computed sweep
// fraction.
function drawPaintingsWithFractions(pg, polygons, fractions) {
  const onKeyframe = lightStateKeyframe("filled");
  const offKeyframe = lightStateKeyframe("off");
  polygons.forEach((poly, i) => {
    const resolved = crossfadeKeyframes(offKeyframe, onKeyframe, fractions[i]);
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

function drawWipePaintings(pg, polygons) {
  drawPaintingsWithFractions(pg, polygons, wipeLitFractions(polygons));
}

function drawWipeDownPaintings(pg, polygons) {
  const fractions = polygons.map(wipeDownLitFraction);
  drawPaintingsWithFractions(pg, polygons, fractions);
}

function drawWipeRadialPaintings(pg, polygons) {
  const fractions = polygons.map(wipeRadialLitFraction);
  drawPaintingsWithFractions(pg, polygons, fractions);
}

// "pulse": every painting cycles black<->white on its own timeline, each
// offset from the next by PAINTING_PULSE_OFFSET_STEP of a cycle so the pulse
// visibly ripples across the paintings in index order rather than every
// painting breathing in lockstep. This is a deliberately asymmetric
// fade-up/hold-on/fade-down/hold-off trapezoid (rather than
// resolveLightState's generic mode:"pulse", a symmetric sine crossfade that
// spends equal time - and equal transition speed - on both halves) so a
// painting can stay lit much longer than it stays dark.
const PAINTING_PULSE_FADE_UP = 0.4; // seconds to fade off -> on
const PAINTING_PULSE_ON_HOLD = 3.5; // seconds held fully on
const PAINTING_PULSE_FADE_DOWN = 0.4; // seconds to fade on -> off
const PAINTING_PULSE_OFF_HOLD = 0.5; // seconds held fully off
const PAINTING_PULSE_PERIOD =
  PAINTING_PULSE_FADE_UP +
  PAINTING_PULSE_ON_HOLD +
  PAINTING_PULSE_FADE_DOWN +
  PAINTING_PULSE_OFF_HOLD;
const PAINTING_PULSE_OFFSET_STEP = 0.15; // fraction of a cycle between neighboring paintings

// Maps elapsed time t (0..PAINTING_PULSE_PERIOD) to this cycle's on-ness
// (0 = fully dark, 1 = fully lit) - see the stage constants above.
function paintingPulseFraction(t) {
  if (t < PAINTING_PULSE_FADE_UP) return t / PAINTING_PULSE_FADE_UP;
  t -= PAINTING_PULSE_FADE_UP;
  if (t < PAINTING_PULSE_ON_HOLD) return 1;
  t -= PAINTING_PULSE_ON_HOLD;
  if (t < PAINTING_PULSE_FADE_DOWN) return 1 - t / PAINTING_PULSE_FADE_DOWN;
  return 0;
}

function drawPulsePaintings(pg, polygons) {
  const onKeyframe = lightStateKeyframe("filled");
  const offKeyframe = lightStateKeyframe("off");
  polygons.forEach((poly, i) => {
    const phaseOffset = i * PAINTING_PULSE_OFFSET_STEP * PAINTING_PULSE_PERIOD;
    const t = (millis() / 1000 + phaseOffset) % PAINTING_PULSE_PERIOD;
    const resolved = crossfadeKeyframes(
      offKeyframe,
      onKeyframe,
      paintingPulseFraction(t)
    );
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

// "groupPulse" (and "curtain"/"curtainVertical" above, which reuse this same
// relay for their own expand/collapse animation): wall-declared PULSE_GROUPS
// (js/left/sketch.js, js/right/sketch.js - each group a set of
// painting/outline indices) take turns being lit, one group at a time: fades
// in, holds, fades out, then the next group's turn starts, cycling back to
// the first once every group has had a turn. Paintings/outlines not listed in
// any group stay off the whole time. The open/hold/close timing here is
// PAINTING_CURTAIN_OPEN/HOLD/CLOSE - shared with "curtain" rather than its
// own separate numbers, so "how long does a group stay lit before fading"
// reads the same for both.
//
// Since a group can span both paintings and wing sculptures (e.g. left
// wall's wing-sculpture group), this needs one shared timeline that both
// js/paintings.js's drawPaintings() and js/outlines.js's
// drawButterflyLightState() read from - groupPulseFractionFor() below,
// keyed by PULSE_GROUPS' own "paintings"/"outlines" property names.
const GROUP_PULSE_PERIOD =
  PAINTING_CURTAIN_OPEN + PAINTING_CURTAIN_HOLD + PAINTING_CURTAIN_CLOSE;

// Which group is having its turn right now, and how lit it is (0 = just
// starting to fade in / just finished fading out, 1 = fully held lit).
// Cached per frame since every painting and every outline reads this same
// answer once each.
let _groupPulseStateCache = null;
let _groupPulseStateCacheFrame = -1;

function groupPulseActiveState() {
  if (_groupPulseStateCacheFrame === frameCount) return _groupPulseStateCache;

  const groups = typeof PULSE_GROUPS !== "undefined" ? PULSE_GROUPS : [];
  let result;
  if (groups.length === 0) {
    result = { groupIndex: -1, fraction: 0 };
  } else {
    const totalPeriod = GROUP_PULSE_PERIOD * groups.length;
    const t = (millis() / 1000) % totalPeriod;
    const groupIndex = Math.floor(t / GROUP_PULSE_PERIOD);
    const localT = t - groupIndex * GROUP_PULSE_PERIOD;

    let fraction;
    if (localT < PAINTING_CURTAIN_OPEN) {
      fraction = localT / PAINTING_CURTAIN_OPEN;
    } else if (localT < PAINTING_CURTAIN_OPEN + PAINTING_CURTAIN_HOLD) {
      fraction = 1;
    } else {
      const closeT = localT - PAINTING_CURTAIN_OPEN - PAINTING_CURTAIN_HOLD;
      fraction = 1 - closeT / PAINTING_CURTAIN_CLOSE;
    }
    result = { groupIndex, fraction };
  }

  _groupPulseStateCache = result;
  _groupPulseStateCacheFrame = frameCount;
  return result;
}

// `kind` is "paintings" or "outlines", matching PULSE_GROUPS' own property
// names - `index` is that item's plain declaration-order index (into
// paintingMaps or butterflyMaps respectively), not a surface-label id.
function groupPulseFractionFor(kind, index) {
  const groups = typeof PULSE_GROUPS !== "undefined" ? PULSE_GROUPS : [];
  const { groupIndex, fraction } = groupPulseActiveState();
  if (groupIndex < 0) return 0;
  const members = (groups[groupIndex] && groups[groupIndex][kind]) || [];
  return members.includes(index) ? fraction : 0;
}

function drawGroupPulsePaintings(pg, polygons) {
  const onKeyframe = lightStateKeyframe("filled");
  const offKeyframe = lightStateKeyframe("off");
  polygons.forEach((poly, i) => {
    const fraction = groupPulseFractionFor("paintings", i);
    const resolved = crossfadeKeyframes(offKeyframe, onKeyframe, fraction);
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

// The mycelium scene's own paintingState (see js/scenes.js): a painting
// crossfades from "off" to "filled" as js/mycelium.js's
// myceliumPaintingRevealFraction() rises from 0 (untouched) to 1 (fully
// revealed), the same crossfadeKeyframes() plumbing drawGroupPulsePaintings
// uses for its own group-driven fraction - plus a drawGlow() halo grown in
// step with that same fraction, so the reveal reads as the painting
// actually illuminating rather than just its fill swapping color. (The
// mossy edge-crawl ring that grows in tandem, around the painting's own
// perimeter, is drawn separately by js/mycelium.js's drawMycelium() - it
// lives on the scene layer underneath this, not here.)
function drawMyceliumRevealPaintings(pg, polygons) {
  const offKeyframe = lightStateKeyframe("off");
  const onKeyframe = lightStateKeyframe("filled");
  polygons.forEach((poly, i) => {
    const fraction = myceliumPaintingRevealFraction(i);
    if (fraction > 0) drawGlow(pg, poly, fraction);
    const resolved = crossfadeKeyframes(offKeyframe, onKeyframe, fraction);
    drawLightShape(pg, poly, resolved, { strokeWeight: 9 });
  });
}

function drawPaintings(pg) {
  const stateValue = currentPaintingState();
  const polygons = getPaintingPolygons();

  if (isSpotlightMode(stateValue)) {
    const litIndices = spotlightLitIndices(polygons.length);
    const onState = resolveLightState("filled");
    const offState = resolveLightState("outline");
    polygons.forEach((poly, i) => {
      const on = litIndices.has(i);
      drawLightShape(pg, poly, on ? onState : offState, { strokeWeight: 9 });
    });
    return;
  }

  if (stateValue === "myceliumReveal")
    return drawMyceliumRevealPaintings(pg, polygons);
  if (stateValue === "curtain") return drawCurtainPaintings(pg, polygons);
  if (stateValue === "curtainVertical")
    return drawCurtainVerticalPaintings(pg, polygons);
  if (stateValue === "random") return drawRandomPaintings(pg, polygons);
  if (stateValue === "randomOutline")
    return drawRandomOutlinePaintings(pg, polygons);
  if (stateValue === "wipe") return drawWipePaintings(pg, polygons);
  if (stateValue === "wipeDown") return drawWipeDownPaintings(pg, polygons);
  if (stateValue === "wipeRadial") return drawWipeRadialPaintings(pg, polygons);
  if (stateValue === "dotField") // js/dotField.js - lit by nearness to its hidden balls
    return drawPaintingsWithFractions(pg, polygons, polygons.map(dotFieldLitFraction));
  if (stateValue === "pulse") return drawPulsePaintings(pg, polygons);
  if (stateValue === "groupPulse") return drawGroupPulsePaintings(pg, polygons);
  if (stateValue === "lookin") return drawLookinPaintings(pg, polygons); // js/lookin.js

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
