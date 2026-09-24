/*
 * Multi-panel wall abstraction shared by every installation built on this
 * engine (left wall: 1 panel, right wall: 3 - it bends).
 *
 * A physical wall with a curve/bend can't be corner-pinned as a single
 * flat QuadMap - each flat segment needs its own independent corner-pin.
 * But the generative scenes (mycelium, particles, snake), the rippling
 * emanate outlines, and the painting/outline geometry they steer around,
 * all want to think in one continuous coordinate space so content can flow
 * across the seam between panels rather than being siloed per-panel.
 *
 * wallPanels is that bridge: each entry is { map, x, y } - a corner-pinned
 * QuadMap plus where its own local (0,0) sits inside the wall's shared
 * "logical" space. Everything scene-, painting-, and outline-related is
 * expressed in that shared space; displayWall() below draws the exact
 * same content into every panel, translated by that panel's (x, y) -
 * each panel's own offscreen buffer is only panel.map.width x
 * panel.map.height, so p5 silently clips away whatever falls outside
 * that panel's slice. No surface needs to know which panel it "belongs"
 * to at draw time - the translate + buffer-size clipping does that for
 * free. (Surfaces that must be corner-pinned/parented to one *specific*
 * panel - paintingMaps, butterflyMaps - don't declare which one; see
 * resolvePanelIndex() below. Used for the screen-space -> logical-space
 * inverse transform and for parenting; see js/paintings.js,
 * js/outlines.js, js/parenting.js.)
 */

let wallPanels = [];
let WALL_BOUNDS = { w: 0, h: 0 };

function initWallPanels(panels) {
  wallPanels = panels;
  WALL_BOUNDS = {
    w: Math.max(...panels.map((p) => p.x + p.map.width)),
    h: Math.max(...panels.map((p) => p.y + p.map.height)),
  };

  // Every freshly created QuadMap starts at screen (0,0) regardless of
  // panel (see p5.mapper's Draggable constructor), so with no prior
  // calibration loaded, all of wallPanels' surfaces default to sitting
  // stacked exactly on top of each other. Give them a sane, non-
  // overlapping starting layout instead - laid out left-to-right and
  // centered on screen using the same logical-space (panel.x, panel.y)
  // offsets already computed above, so panel N's default right edge lines
  // up exactly with panel N+1's default left edge before either has ever
  // been dragged. This is what makes syncPanelSeams() (which runs
  // unconditionally, even pre-calibration) nudge sensible geometry instead
  // of forcing together two corners from arbitrary overlapping defaults -
  // real per-installation calibration still happens via dragging/pMapper.load()
  // same as before, this only fixes what "untouched" looks like.
  panels.forEach((panel) => {
    panel.map.set({
      x: panel.x - WALL_BOUNDS.w / 2,
      y: panel.y - WALL_BOUNDS.h / 2,
    });
  });
}

// Every freshly created paintingMap/butterflyMap/maskMap also starts at
// screen (0,0) (see initWallPanels()'s note on this same default), so with
// nothing dragged or loaded yet they all stack exactly on top of each
// other too - and on a multi-panel wall, that shared spot sits squarely
// inside one panel's own body and, being created *after* the wall panels,
// wins every hit-test ahead of it (later-created surfaces are checked
// first - see p5.mapper's checkSurfacesClick()/checkPointsClick()). That
// makes it easy to aim a click at the wall panel underneath and actually
// grab an invisible, still-unpositioned painting or mask instead. This
// just staggers each one's default position diagonally apart so there's
// clear space to reach the panel body, and so each reference surface is
// individually reachable from the start rather than needing to dig one
// out of a pile - it's a starting layout for calibration, not a real
// position, so it doesn't need to be pretty.
function spreadDefaultPositions(
  surfaces,
  { originX = 0, originY = 0, spacing = 40 } = {},
) {
  surfaces.forEach((s, i) =>
    s.set({ x: originX + i * spacing, y: originY + i * spacing }),
  );
}

// Converts a point in some paintingMap/butterflyMap's own absolute
// screen-space calibration (corner-pinned against wallPanels[panelIndex]
// specifically) into this wall's shared logical drawing space.
function panelToLogical(panelIndex, screenX, screenY) {
  if (!wallPanels || !wallPanels[panelIndex]) return null;
  const panel = wallPanels[panelIndex];
  const local = panel.map.getTransformedCursor(screenX, screenY);
  return { x: local.x + panel.x, y: local.y + panel.y };
}

// Clicking a panel's body (rather than one of its 4 corner handles)
// whole-surface-drags it via p5.mapper's own Draggable machinery
// (Surface.selectDraggable(), tried as ProjectionMapper's fallback when a
// click doesn't land on a control point - see checkSurfacesClick()) -
// normally moving just that one panel. This instead treats all of
// wallPanels as one rigid group for that kind of drag: whichever panel is
// currently being body-dragged, every *other* panel is translated by the
// same per-frame delta, so nudging the whole assembled projection (e.g.
// because the projector got bumped) is one drag instead of re-corner-
// pinning each panel from scratch. Per-corner dragging (reshaping one
// panel's own keystone) is untouched - this only fires for a whole-body
// drag, detected via the surface's own `.isDragging` (Draggable's
// surface-level flag, distinct from any one control point's own).
//
// A plain x/y change needs no calculateMesh() call to take effect: x/y is
// applied as a render-time translate on top of the already-computed local
// mesh (see Surface.displayTexture() -> `p.translate(this.x, this.y)`),
// so moving it alone moves the whole rendered quad - and every downstream
// reader (panelToLogical, resolvePanelIndex, etc.) already reads panel
// positions as `panel.map.x + <local point>`, so it picks up the shift
// automatically too. Applied via Draggable.set() rather than a raw x/y
// assignment - set() also calls onPositionChanged(), which is what fans a
// position change out to any painting/outline currently *locked* (parented
// - see js/parenting.js) to that other panel; skipping it would leave a
// locked piece behind when the panel it's locked to gets moved this way.
let _panelGroupDragLast = null;

function syncPanelGroupDrag() {
  if (!wallPanels) return;
  const dragged = wallPanels.find((panel) => panel.map.isDragging);

  if (!dragged) {
    _panelGroupDragLast = null;
    return;
  }

  if (_panelGroupDragLast && _panelGroupDragLast.panel === dragged) {
    const dx = dragged.map.x - _panelGroupDragLast.x;
    const dy = dragged.map.y - _panelGroupDragLast.y;
    if (dx !== 0 || dy !== 0) {
      wallPanels.forEach((panel) => {
        if (panel === dragged) return;
        panel.map.set({ x: panel.map.x + dx, y: panel.map.y + dy });
      });
    }
  }

  _panelGroupDragLast = { panel: dragged, x: dragged.map.x, y: dragged.map.y };
}

// Keeps each panel's left edge pixel-for-pixel identical to its left
// neighbor's right edge, instead of leaving two independently-dragged
// corners per seam to be eyeballed into alignment by hand. wallPanels is
// already ordered left-to-right (see how right/sketch.js builds it). A
// QuadMap's 4 corners come back from getControlPoints() as
// [TL, TR, BR, BL] (see p5.mapper's CornerPinSurface); calculateMesh() is
// what a corner drag normally triggers to rebuild the homography from the
// new corners (see MeshPoint.moveTo()) - called here directly on whichever
// side we're overwriting programmatically, since it isn't going through an
// actual drag. Corners are set via plain x/y assignment rather than
// MeshPoint.set() - set() also resets u/v to 0 when not given, which would
// corrupt that corner's texture UV mapping.
//
// The two seam corners sit exactly on top of each other on screen, so
// whichever one you happen to grab during calibration needs to work -
// syncSeamCorner() checks `.isDragging` (set for the whole mouse-down/
// mouse-up gesture, not just the frame the drag started) to find out which
// side is actually under the mouse *this* drag and drives the other side
// from it; with neither side being dragged, the right panel is the
// default follower (arbitrary - they're already equal then, so it doesn't
// matter which way copies over which).
//
// Runs every frame, calibrating or not - not just while dragging. A
// saved map.json can have its seam corners not-quite-equal (e.g. anything
// saved before this sync existed, or a hand-edited file), and this is
// what makes the seam self-healing regardless: gating it to
// isCalibratingMapper() would mean a stale saved mismatch only ever looks
// right *while calibrating*, and comes back the moment you're just
// viewing the show.
//
// calculateMesh() is only called when a corner's value is actually
// changing - never unconditionally every frame. calculateMesh() sets
// _geomDirty = true (see QuadMap.displaySurface()), which forces that
// panel's WebGL geometry to be freed and rebuilt (buildGeometry()/
// freeGeometry()) on its very next draw - calling that every single frame
// for 2 of the right wall's 3 panels, even with unchanged corner values,
// reproduced the exact "drag a corner fast -> screen goes white" failure
// js/debug.js was already tracking (see its own comment) - just
// constantly instead of only during a fast drag, because it's the same
// GPU-buffer churn either way. Comparing before writing keeps this at
// its old, safe frequency: once per real corner move (a drag, or the one
// frame after load/positioning where a stale value needs correcting),
// not once per frame forever.
//
// If the physical panels don't actually butt together edge-to-edge, this
// will still force the *projected content* to line up at the seam - mask
// over whatever real gap/step that leaves (see js/masks.js).
function syncSeamCorner(leftSurface, leftPoint, rightSurface, rightPoint) {
  if (rightPoint.isDragging) {
    const nx = rightSurface.x + rightPoint.x - leftSurface.x;
    const ny = rightSurface.y + rightPoint.y - leftSurface.y;
    if (nx !== leftPoint.x || ny !== leftPoint.y) {
      leftPoint.x = nx;
      leftPoint.y = ny;
      leftSurface.calculateMesh();
    }
  } else {
    const nx = leftSurface.x + leftPoint.x - rightSurface.x;
    const ny = leftSurface.y + leftPoint.y - rightSurface.y;
    if (nx !== rightPoint.x || ny !== rightPoint.y) {
      rightPoint.x = nx;
      rightPoint.y = ny;
      rightSurface.calculateMesh();
    }
  }
}

function syncPanelSeams() {
  if (!wallPanels) return;
  for (let i = 1; i < wallPanels.length; i++) {
    const left = wallPanels[i - 1].map;
    const right = wallPanels[i].map;
    const [, leftTR, leftBR] = left.getControlPoints();
    const [rightTL, , , rightBL] = right.getControlPoints();

    syncSeamCorner(left, leftTR, right, rightTL);
    syncSeamCorner(left, leftBR, right, rightBL);
  }
}

// Draws the show + paintings + outlines once per panel, each seeing the
// same logical-space content cropped to its own slice. Blackout masks are
// deliberately NOT drawn here - see js/masks.js for why they're a separate,
// screen-space overlay instead (drawBlackoutMasksOverlay(), called from each
// wall's draw() after this).
function displayWall() {
  if (!wallPanels) return;
  syncPanelGroupDrag();
  syncPanelSeams();

  wallPanels.forEach((panel) => {
    panel.map.displaySketch((pg) => {
      pg.push();
      pg.translate(-panel.x, -panel.y);
      drawShow(pg);
      drawPaintings(pg);
      butterflyMaps.forEach((refMap, i) =>
        drawButterflyLightState(pg, i, refMap),
      );
      pg.pop();
    });
  });

  // Reference-only surfaces: draw nothing themselves. Their corner-drag
  // handles are drawn/hit-tested independently of this (see
  // ProjectionMapper.displayControlPoints(), called every frame regardless
  // - that's what actually makes them draggable), so the only reason to
  // call displaySketch() here at all is to also get their outline/grid -
  // which itself only renders while calibrating (see Surface.displayTexture
  // -> displayCalibration()). So this whole pass is skipped outside
  // calibration mode: with 13 paintings + several masks, doing it
  // unconditionally meant a WebGL texture upload for each of them every
  // single frame during normal playback, for zero visible result.
  if (isCalibratingMapper()) {
    paintingMaps.forEach((pm) => pm.displaySketch(() => {}));
    butterflyMaps.forEach((bm) => bm.displaySketch(() => {}));
    maskMaps.forEach((mm) => mm.displaySketch(() => {}));
  }
}

// A surface's `id` is just its creation order within p5.mapper (see
// ProjectionMapper.createQuadMap()/createPolyMap() - `this.surfaces.length`
// at the time each was created), the same id saved into maps/*.json and
// used by parenting. With 3 wall panels + 13 paintings + masks all
// overlapping on screen during calibration, telling them apart by shape
// alone gets hard fast - this labels each one at its own centroid so you
// can match what you're dragging to its PAINTING_SPECS/MASK_SPECS index.
// Drawn directly on the main canvas (see js/masks.js for why: every
// surface's points already live in WEBGL-centered coordinates, same as the
// canvas itself - no panel translate needed).
function surfaceLabelAnchor(surface) {
  const pts = surface.points || surface.getControlPoints();
  const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
  const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  return { x: surface.x + cx, y: surface.y + cy };
}

// Which wallPanel a painting/outline is physically sitting on, read
// straight off its own calibrated position instead of a hand-declared
// `panel` index in PAINTING_SPECS/OUTLINE_SPECS - so dragging a piece onto
// a different panel during calibration (or not knowing yet which panel
// it'll land on) just works, with nothing to keep in sync by hand. Reuses
// pointInPolygon (js/paintings.js) against each wallPanel's own current
// on-screen quad (its 4 corner-pin control points ARE its on-screen
// polygon, correct whether or not that panel has been re-keystoned since).
// Falls back to panel 0 if the surface's centroid isn't over any panel
// (e.g. it's still sitting at its pre-calibration default position).
//
// resolvePanelIndex() runs once per painting/outline per frame (more on a
// multi-panel wall - see getPaintingPolygons()'s cache in js/paintings.js
// for why), so rebuilding every panel's polygon from scratch on every one
// of those calls was pure waste - a panel's own corners only move during
// calibration dragging. Cached per frame instead, same pattern as
// getPaintingPolygons().
let _panelPolygonsCache = null;
let _panelPolygonsCacheFrame = -1;

function getWallPanelScreenPolygons() {
  if (_panelPolygonsCacheFrame !== frameCount) {
    _panelPolygonsCache = wallPanels.map((panel) =>
      panel.map
        .getControlPoints()
        .map((cp) => ({ x: panel.map.x + cp.x, y: panel.map.y + cp.y })),
    );
    _panelPolygonsCacheFrame = frameCount;
  }
  return _panelPolygonsCache;
}

function resolvePanelIndex(surface) {
  const { x, y } = surfaceLabelAnchor(surface);
  const index = getWallPanelScreenPolygons().findIndex((poly) =>
    pointInPolygon(x, y, poly),
  );
  return index === -1 ? 0 : index;
}

function drawSurfaceLabels() {
  if (!isCalibratingMapper() || !myFont) return;

  const surfaces = [
    ...wallPanels.map((p) => p.map),
    ...paintingMaps,
    ...butterflyMaps,
    ...maskMaps,
    ...bezierMaskMaps,
  ];

  push();
  // Black outline + white fill (rather than a single flat color) so the id
  // stays legible over any fill color a surface happens to be sitting on
  // (paintings tint their own quad - see js/paintings.js).
  strokeWeight(4);
  stroke(0);
  fill(255, 255, 0);
  textAlign(CENTER, CENTER);
  textSize(28);
  textStyle(BOLD);
  surfaces.forEach((s) => {
    const { x, y } = surfaceLabelAnchor(s);
    text(s.id, x, y);
  });
  pop();
}
