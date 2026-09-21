/*
 * Blackout masks - freeform polygons that paint solid black over part of the
 * screen, e.g. to hide projector light spilling onto exposed wall/ceiling
 * above the paintings. Which shapes exist is wall-specific data (MASK_SPECS,
 * defined by each wall's own sketch.js - an empty list is fine for a wall
 * that doesn't need one).
 *
 * Each mask is a PolyMap (see each wall's sketch.js). Unlike paintingMaps/
 * butterflyMaps, a PolyMap has no corner-pin homography of its own (see
 * p5.mapper's Surface.resolveToScreen) - its points already live in
 * absolute screen space, exactly where they're dragged during calibration.
 * So a mask is intentionally NOT run through panelToLogical()/drawn into any
 * wallPanel's own buffer - that would tie it to one specific panel's
 * corner-pin and its buffer bounds. Instead it's drawn straight onto the
 * main canvas as a final overlay, on top of every panel and every other
 * surface, in drawBlackoutMasksOverlay() (called once per frame after
 * displayWall() - see each wall's draw()). This also matches the mask's own
 * intent: sit fixed over the same physical spot on screen regardless of
 * whether a painting/panel gets re-keystoned.
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
}
