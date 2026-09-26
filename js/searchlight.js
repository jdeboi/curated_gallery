/*
 * "searchlight" scene: one or two soft radial beams roam the wall and pause
 * on each painting in turn, like someone sweeping a flashlight across the
 * pieces on a dark wall.
 *
 * Movement is a pure function of wall-clock time rather than stored
 * per-light state (same reason the show's own scene timing is - see
 * js/scenes.js's header comment): each light visits the paintings in index
 * order, pausing SEARCHLIGHT_PAUSE seconds on each and taking
 * SEARCHLIGHT_TRAVEL seconds to ease to the next, for a fixed
 * SEARCHLIGHT_STEP-second cycle per painting - so "where is light N right
 * now" is just millis() mod (paintingCount * SEARCHLIGHT_STEP), with each
 * light offset by its own share of that cycle so multiple lights spread out
 * across the paintings instead of clumping on the same one.
 *
 * Both drawSearchlights() (the beams themselves) and
 * drawSearchlightHighlights() (brightens whichever painting a beam is
 * currently paused on) run from the scene's `overlay` (see js/wall.js's
 * drawShowOverlay()), layered on top of paintings.js's own "off" state
 * (this scene's paintingState) the same way js/outlines.js's spinner effect
 * needs to sit on top rather than under - drawn from a plain `draw` instead,
 * the beams would be painted over by drawPaintings()'s opaque "off" fill
 * whenever they swept near or paused on a painting, instead of lighting it.
 */

const SEARCHLIGHT_COUNT = 2; // independent roaming beams
const SEARCHLIGHT_PAUSE = 2.2; // seconds paused on a painting
const SEARCHLIGHT_TRAVEL = 1.4; // seconds easing to the next painting
const SEARCHLIGHT_STEP = SEARCHLIGHT_PAUSE + SEARCHLIGHT_TRAVEL;
const SEARCHLIGHT_RADIUS = 140;
const SEARCHLIGHT_RING_COUNT = 6;

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 1, 2) / 2;
}

// Where light `lightIndex` (of SEARCHLIGHT_COUNT) sits in its cycle right
// now: which painting it's at/heading toward, and `within` - its progress
// (in seconds) through this cycle's pause+travel step. Shared by both
// drawSearchlights() (uses the eased position) and
// drawSearchlightHighlights() (only cares whether `within` is still in the
// pause window) so they never disagree about where a beam actually is.
function searchlightSchedule(count, lightIndex) {
  if (count === 0) return null;
  const offset = ((lightIndex * count) / SEARCHLIGHT_COUNT) * SEARCHLIGHT_STEP;
  const cyclePos = (millis() / 1000 + offset) % (count * SEARCHLIGHT_STEP);
  const index = Math.floor(cyclePos / SEARCHLIGHT_STEP);
  const within = cyclePos - index * SEARCHLIGHT_STEP;
  return { index, nextIndex: (index + 1) % count, within };
}

function searchlightPosition(centroids, schedule) {
  const from = centroids[schedule.index];
  const to = centroids[schedule.nextIndex];
  if (schedule.within < SEARCHLIGHT_PAUSE) return from;
  const travelT = Math.min(
    (schedule.within - SEARCHLIGHT_PAUSE) / SEARCHLIGHT_TRAVEL,
    1,
  );
  const eased = easeInOutQuad(travelT);
  return { x: lerpValue(from.x, to.x, eased), y: lerpValue(from.y, to.y, eased) };
}

// Soft falloff disc standing in for a flashlight beam - concentric
// semi-transparent circles rather than a hard-edged spotlight, same
// glow-by-layered-rings approach as drawGlow() (js/lightState.js) but
// standalone (not tied to any one polygon's shape).
function drawSearchlightAt(pg, pos) {
  if (!pos) return;
  pg.push();
  pg.noStroke();
  for (let r = SEARCHLIGHT_RING_COUNT; r >= 1; r--) {
    const radius = SEARCHLIGHT_RADIUS * (r / SEARCHLIGHT_RING_COUNT);
    const alpha = 200 * Math.pow(1 - r / (SEARCHLIGHT_RING_COUNT + 1), 2);
    pg.fill(255, alpha);
    pg.ellipse(pos.x, pos.y, radius * 2, radius * 2);
  }
  pg.pop();
}

// Draws every beam's disc at its current roaming/paused position - called
// from the scene's `overlay` (see js/scenes.js) so it renders on top of
// drawPaintings()'s opaque fills instead of being hidden behind them.
function drawSearchlights(pg) {
  const polygons = getPaintingPolygons();
  const n = polygons.length;
  if (n === 0) return;
  const centroids = polygons.map(polygonCentroid);
  for (let i = 0; i < SEARCHLIGHT_COUNT; i++) {
    drawSearchlightAt(pg, searchlightPosition(centroids, searchlightSchedule(n, i)));
  }
}

// Brightens whichever painting(s) a beam is currently paused on, on top of
// this scene's otherwise-dark ("off") paintings - the "discovered by the
// light" moment.
function drawSearchlightHighlights(pg) {
  const polygons = getPaintingPolygons();
  const n = polygons.length;
  if (n === 0) return;
  const litState = resolveLightState("filled");
  for (let i = 0; i < SEARCHLIGHT_COUNT; i++) {
    const schedule = searchlightSchedule(n, i);
    if (schedule.within < SEARCHLIGHT_PAUSE) {
      drawGlow(pg, polygons[schedule.index]);
      drawLightShape(pg, polygons[schedule.index], litState, { strokeWeight: 9 });
    }
  }
}
