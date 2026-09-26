/*
 * Shared "light state" vocabulary for anything on the wall that can be lit
 * up as a solid shape, a bare outline, softened with a glow halo, or
 * switched off entirely - wing sculptures (js/outlines.js) and paintings
 * (js/paintings.js) both render through this so the two share one small
 * set of state names instead of each having its own bespoke on/off/glow
 * logic. A scene (js/scenes.js) declares which state each surface type
 * should be in via its own `butterflyState`/`paintingState` field; a scene
 * that doesn't set one gets LIGHT_STATE_DEFAULT ("filled" - "all
 * illuminated").
 *
 * A state is either:
 *   - one of the plain mode strings in LIGHT_STATE_KEYFRAMES, held
 *     constant, or
 *   - { mode: "pulse", states: [a, b], period } - a smooth back-and-forth
 *     crossfade between two plain modes over `period` seconds (a
 *     breathing effect), or
 *   - { mode: "switch", states: [...], period } - a hard cut between two
 *     or more plain modes every `period` seconds (a flicker/alternate
 *     effect).
 * `period` is in seconds and timed off millis(), not frameCount, so speed
 * doesn't depend on frame rate.
 *
 * "outline" and "off" are both an opaque *black* fill, not "draw
 * nothing"/"stroke only" - paintings/wing sculptures sit on top of that
 * scene's own generative content (js/wall.js draws drawShow(pg) first),
 * so leaving the fill transparent would let mycelium/particles/etc. show
 * through the silhouette instead of blacking it out. "outline" adds a
 * white stroke on top of that black fill; "off" has no stroke either.
 * "glow" looks identical to "filled" up close (see drawGlow() below for
 * the actual halo) - it's a fill/stroke keyframe like any other so it can
 * sit in LIGHT_STATE_KEYFRAMES and PAINTING_LIGHT_OVERRIDES/
 * BUTTERFLY_LIGHT_OVERRIDES alongside filled/outline/off; only plain
 * string states trigger the halo though (see isGlowMode() below) - inside
 * a pulse/switch descriptor "glow" still resolves its fill/stroke fine but
 * won't draw the halo, since there's no single frame where that composite
 * state "is" glow.
 */

const LIGHT_STATE_DEFAULT = "filled";

const LIGHT_STATE_KEYFRAMES = {
  filled: { fillColor: 255, fillAlpha: 255, strokeAlpha: 0 },
  glow: { fillColor: 255, fillAlpha: 255, strokeAlpha: 0 },
  outline: { fillColor: 0, fillAlpha: 255, strokeAlpha: 255 },
  off: { fillColor: 0, fillAlpha: 255, strokeAlpha: 0 },
};

function lightStateKeyframe(mode) {
  return (
    LIGHT_STATE_KEYFRAMES[mode] || LIGHT_STATE_KEYFRAMES[LIGHT_STATE_DEFAULT]
  );
}

// Short human-readable label for a state descriptor - a plain mode string
// as-is, or "mode(a/b)" for a pulse/switch descriptor. Used by the on-screen
// HUD (js/hud.js) to show what an "auto" override is actually resolving to.
function describeLightState(state) {
  if (!state) return LIGHT_STATE_DEFAULT;
  if (typeof state === "string") return state;
  return `${state.mode}(${state.states.join("/")})`;
}

// Named to avoid colliding with p5's own global lerp() (redeclaring that
// throws "Cannot redefine property: lerp" in global mode).
function lerpValue(a, b, t) {
  return a + (b - a) * t;
}

// Crossfades between two resolved keyframes by `frac` (0 = ka, 1 = kb) -
// shared by resolveLightState's "pulse" mode (which drives frac from a sine
// wave) and any caller that already has its own frac to drive a fade from,
// e.g. js/paintings.js's "wipe" mode fading each painting in/out as the
// sweep passes over it.
function crossfadeKeyframes(ka, kb, frac) {
  return {
    fillColor: lerpValue(ka.fillColor, kb.fillColor, frac),
    fillAlpha: lerpValue(ka.fillAlpha, kb.fillAlpha, frac),
    strokeAlpha: lerpValue(ka.strokeAlpha, kb.strokeAlpha, frac),
  };
}

// Resolves a state descriptor (see file header) to a concrete
// { fillAlpha, strokeAlpha } to render this frame.
function resolveLightState(state) {
  if (!state) state = LIGHT_STATE_DEFAULT;
  if (typeof state === "string") return lightStateKeyframe(state);

  // phaseOffset (in units of `period`s, i.e. 1.0 = one full cycle) lets
  // callers stagger several surfaces through the same pulse/switch
  // descriptor instead of them all landing on the same keyframe in lockstep
  // - see js/paintings.js's "pulse" painting mode for why.
  const { mode, states, period, phaseOffset = 0 } = state;
  const t = millis() / (Math.max(period, 0.01) * 1000) + phaseOffset;

  if (mode === "switch") {
    const index = Math.floor(t) % states.length;
    return lightStateKeyframe(states[index]);
  }

  // "pulse": smooth crossfade back and forth between exactly two states.
  const ka = lightStateKeyframe(states[0]);
  const kb = lightStateKeyframe(states[1]);
  const wave = 0.5 + 0.5 * Math.sin(t * TWO_PI);
  return crossfadeKeyframes(ka, kb, wave);
}

// "off" is an opaque *black* fill, not the absence of one - only count a
// state as lit (worth a glow halo, see below) when there's actually
// light-colored fill/stroke showing.
function isLitState(resolved) {
  return (
    (resolved.fillAlpha > 0 && resolved.fillColor > 0) ||
    resolved.strokeAlpha > 0
  );
}

// True for the plain "glow" state string - not for a pulse/switch
// descriptor that merely includes "glow" among its states (see file header
// note on why the halo doesn't try to track those). Callers combine this
// with isLitState() before drawing the halo.
function isGlowMode(state) {
  return state === "glow";
}

// Soft halo that bleeds onto whatever's behind a lit shape - layered,
// growing, fading copies of the same polygon offset from its centroid.
// Shared by paintings (js/paintings.js) and wing sculptures
// (js/outlines.js) so both render through the same glow look rather than
// each having its own bespoke halo.
function drawGlow(pg, poly) {
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

// Shrinks poly inward by `dist` along each vertex's edge bisector - used so
// a stroke drawn on the result (see drawLightShape below) lands entirely
// inside poly's own boundary instead of straddling it (p5 always centers a
// stroke on the path it's given). Standard mitered polygon offset: each
// edge's inward normal is found from the polygon's overall winding (via
// signed area), then each vertex moves along the averaged normal of its two
// adjacent edges, scaled by 1/cos(half the corner angle) so both edges end
// up offset by exactly `dist`. That scale blows up near a sharp/reflex
// corner, so it's floored at 0.35 (capping the move at ~2.9x dist) rather
// than left to spike arbitrarily - fine for the near-rectangular quads and
// gently-curved silhouettes this runs on.
function insetPolygon(poly, dist) {
  const n = poly.length;
  if (n < 3 || dist <= 0) return poly;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;

  const edgeNormals = poly.map((_, i) => {
    const a = poly[i],
      b = poly[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len,
      uy = dy / len;
    return sign >= 0 ? { x: -uy, y: ux } : { x: uy, y: -ux };
  });

  return poly.map((p, i) => {
    const nPrev = edgeNormals[(i - 1 + n) % n];
    const nCur = edgeNormals[i];
    let bx = nPrev.x + nCur.x;
    let by = nPrev.y + nCur.y;
    const bLen = Math.hypot(bx, by);
    if (bLen < 1e-6) {
      return { x: p.x + nCur.x * dist, y: p.y + nCur.y * dist };
    }
    bx /= bLen;
    by /= bLen;
    const cosHalf = bx * nCur.x + by * nCur.y;
    const miter = dist / Math.max(cosHalf, 0.35);
    return { x: p.x + bx * miter, y: p.y + by * miter };
  });
}

// Renders poly filled/outlined/off (or any crossfade between them) per
// `resolved` - the one draw routine both butterflies and paintings render
// through so they read as the same visual language. Fill (when present)
// covers the full poly; stroke (when present) is drawn on an inset copy
// (see insetPolygon above) so it sits inside poly's boundary rather than
// straddling it.
function drawLightShape(pg, poly, resolved, { strokeWeight = 3 } = {}) {
  pg.push();
  if (resolved.fillAlpha > 0) {
    pg.noStroke();
    pg.fill(resolved.fillColor, resolved.fillAlpha);
    pg.beginShape();
    poly.forEach((p) => pg.vertex(p.x, p.y));
    pg.endShape(CLOSE);
  }
  if (resolved.strokeAlpha > 0) {
    pg.noFill();
    pg.stroke(255, resolved.strokeAlpha);
    pg.strokeWeight(strokeWeight);
    const strokePoly = insetPolygon(poly, strokeWeight / 2);
    pg.beginShape();
    strokePoly.forEach((p) => pg.vertex(p.x, p.y));
    pg.endShape(CLOSE);
  }
  pg.pop();
}
