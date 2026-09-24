/*
 * Blackout masks - freeform shapes that paint solid black over part of the
 * screen, e.g. to hide projector light spilling onto exposed wall/ceiling
 * above the paintings. Which shapes exist is wall-specific data (MASK_SPECS
 * for straight-edged masks, BEZIER_MASK_SPECS for curved ones - both defined
 * by each wall's own sketch.js; an empty list is fine for a wall that
 * doesn't need one).
 *
 * A straight-edged mask is a PolyMap; a curved one is a BezierMap (see each
 * wall's sketch.js). Unlike paintingMaps/butterflyMaps, neither has a
 * corner-pin homography of its own (see p5.mapper's Surface.resolveToScreen)
 * - their points already live in absolute screen space, exactly where
 * they're dragged during calibration. So a mask is intentionally NOT run
 * through panelToLogical()/drawn into any wallPanel's own buffer - that
 * would tie it to one specific panel's corner-pin and its buffer bounds.
 * Instead it's drawn straight onto the main canvas as a final overlay, on
 * top of every panel and every other surface, in
 * drawBlackoutMasksOverlay() (called once per frame after displayWall() -
 * see each wall's draw()). This also matches the mask's own intent: sit
 * fixed over the same physical spot on screen regardless of whether a
 * painting/panel gets re-keystoned.
 *
 * Deliberately NOT included in js/parenting.js's lockable surfaces, for the
 * same reason - a mask is never expressed relative to a panel's local space
 * the way paintingMaps/butterflyMaps are.
 */

function getMaskPolygons() {
  return maskMaps.map((mask) =>
    mask.points.map((cp) => ({ x: mask.x + cp.x, y: mask.y + cp.y })),
  );
}

// Drawn directly onto the main canvas, in the same WEBGL-centered coordinate
// space every surface's points already live in (see p5.mapper's
// MovePoint.toLocal, which stores drag positions relative to canvas center,
// not top-left) - no panel translate, no extra buffer, no re-projection.
function drawBlackoutMasksOverlay() {
  getMaskPolygons().forEach((poly) => {
    push();
    noStroke();
    fill(0);
    beginShape();
    poly.forEach((p) => vertex(p.x, p.y));
    endShape(CLOSE);
    pop();
  });

  // BezierMap already knows how to fill+draw its own curve (defaults to
  // solid black, matching the PolyMap masks above) - wrapped in push/pop
  // since, unlike the PolyMap loop above, its display() leaves noStroke/
  // fill applied on the shared pInst state rather than resetting them.
  bezierMaskMaps.forEach((mask) => {
    push();
    mask.display();
    pop();
  });
}
