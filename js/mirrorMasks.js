/*
 * Mirror masks - a hybrid between a blackout mask (js/masks.js) and a wing
 * sculpture outline (js/outlines.js): a freeform PolyMap, calibrated by
 * dragging its points during calibration exactly like a plain mask, that
 * covers a mirror rather than exposed wall - so unlike a plain mask it's
 * never just "hidden", it needs its own generative treatment in the scenes
 * that would otherwise light it up.
 *
 * The blackout fill itself still works exactly like a plain mask - drawn as
 * a final absolute-screen overlay on top of everything, every scene (see
 * mirrorMaskMaps' inclusion in getMaskPolygons(), js/masks.js) - because a
 * mirror must NEVER be illuminated (it would just reflect the projector
 * light back out) regardless of what any scene's paintingState/
 * butterflyState would otherwise resolve to. What varies per scene is only
 * what plays around that fixed black shape, drawn earlier in the frame
 * (inside each wall panel's own buffer, alongside drawShow()/
 * drawShowOverlay() - see js/wall.js's displayWall()) so it's already
 * painted over anywhere it overlaps the mask's own footprint by the time
 * the overlay runs, and only survives outside it:
 *   - "spinner": stars circle it the same way they circle every painting
 *     and wing sculpture (see drawSpinnerOutlines() in js/outlines.js).
 *   - "emanate" (when it's playing the wing-sculpture ripple version, i.e.
 *     butterflyMaps.length > 0) and "mycelium": a white outline stroke,
 *     drawn OUTSIDE the shape via outsetPolygon() (js/lightState.js) -
 *     unlike paintings/outlines' own "outline" light state, which insets
 *     its stroke so it reads as part of a lit shape's edge. A mirror mask's
 *     stroke has to sit outside instead, since the shape itself must stay
 *     opaque black.
 *
 * getMirrorMaskPolygons() mirrors getPaintingPolygons()/getOutlinePolygons()
 * (js/paintings.js / js/outlines.js): a mirror mask's points are calibrated
 * in absolute screen space, same convention as a plain PolyMap mask (see
 * js/masks.js), so they're run through the same resolvePanelIndex() +
 * panelToLogical() (js/wall.js) to land in the wall's shared logical
 * drawing space, where drawShow()/drawShowOverlay() actually draw.
 *
 * mirrorMaskEffectsEnabled gates all of the above (spinner stars, the
 * emanate/mycelium outline) off by default - "m" toggles it (see each
 * wall's sketch.js). With it off, a mirror mask behaves exactly like a
 * plain blackout mask (solid black, every scene) since only the fill from
 * getMaskPolygons() (js/masks.js) ever runs; flip it on to preview the
 * per-scene treatment without touching code.
 */

let mirrorMaskEffectsEnabled = false;

function toggleMirrorMaskEffects() {
  mirrorMaskEffectsEnabled = !mirrorMaskEffectsEnabled;
}

// "mirror fx: off" - for the HUD (js/hud.js).
function mirrorMaskEffectsStatusLine() {
  return `mirror fx: ${mirrorMaskEffectsEnabled ? "on" : "off"}`;
}

let _mirrorMaskPolygonsCache = null;
let _mirrorMaskPolygonsCacheFrame = -1;

function getMirrorMaskPolygons() {
  if (_mirrorMaskPolygonsCacheFrame === frameCount)
    return _mirrorMaskPolygonsCache;

  _mirrorMaskPolygonsCache = mirrorMaskMaps.map((mask) => {
    const panel = resolvePanelIndex(mask);
    return mask.points.map((cp) =>
      panelToLogical(panel, mask.x + cp.x, mask.y + cp.y),
    );
  });
  _mirrorMaskPolygonsCacheFrame = frameCount;
  return _mirrorMaskPolygonsCache;
}

// Same stroke weight as paintings/outlines' own "outline" light state
// (drawLightShape's strokeWeight: 9 - see js/paintings.js/js/outlines.js)
// so a mirror mask's outline reads as part of the same visual language,
// just offset the other way.
const MIRROR_MASK_OUTLINE_STROKE_WEIGHT = 9;

// The "emanate"/"mycelium" treatment (see file header) - called from those
// scenes' own `draw` in js/scenes.js. A no-op while mirrorMaskEffectsEnabled
// is off, leaving the mask plain black like every other scene.
function drawMirrorMaskOutlines(pg) {
  if (!mirrorMaskEffectsEnabled) return;
  getMirrorMaskPolygons().forEach((poly) => {
    const strokePoly = outsetPolygon(poly, MIRROR_MASK_OUTLINE_STROKE_WEIGHT / 2);
    pg.push();
    pg.noFill();
    pg.stroke(255);
    pg.strokeWeight(MIRROR_MASK_OUTLINE_STROKE_WEIGHT);
    pg.beginShape();
    strokePoly.forEach((p) => pg.vertex(p.x, p.y));
    pg.endShape(CLOSE);
    pg.pop();
  });
}
