/*
 * Locking/unlocking the painting + outline reference surfaces to the main
 * wall quadMap.
 *
 * paintingMaps/butterflyMaps are calibrated in absolute screen space (see
 * sketch.js) so each one can be corner-pinned independently onto its
 * physical painting/sculpture. Once that per-piece calibration is done,
 * locking re-expresses every one of those surfaces relative to quadMap's
 * own local (pre-warp) space via p5.mapper's built-in setParent(). After
 * that, moving/re-keystoning quadMap alone (e.g. because the projector got
 * bumped) carries every painting along with it automatically.
 *
 * Unlocking (setParent(null)) freezes each surface's current resolved
 * position back into its own absolute coordinates - nothing jumps - and
 * restores whole-shape dragging (p5.mapper disables that for parented
 * surfaces; see Surface.selectDraggable()) so a locked calibration can be
 * unlocked for a bigger repositioning, then relocked. Per-point/corner
 * dragging works either way, parented or not, so small tweaks never
 * require unlocking.
 */

let parentingLocked = false;

function getParentableSurfaces() {
  return [...paintingMaps, ...butterflyMaps];
}

function setParentingLocked(locked) {
  const parent = locked ? quadMap : null;
  getParentableSurfaces().forEach((surface) => surface.setParent(parent));
  parentingLocked = locked;
}

function toggleParentingLocked() {
  setParentingLocked(!parentingLocked);
}

// Call after pMapper.load() resolves, so the on-screen lock indicator (and
// any future logic keyed off parentingLocked) reflects what was actually
// saved in map.json rather than the pre-load default.
function syncParentingLockFromLoadedState() {
  const surfaces = getParentableSurfaces();
  parentingLocked =
    surfaces.length > 0 && surfaces.every((s) => s.getParent() === quadMap);
}

function displayParentingStatus() {
  if (!myFont) return;

  fill(255);
  noStroke();
  const label = parentingLocked
    ? "parenting: LOCKED (p to unlock)"
    : "parenting: unlocked (p to lock)";
  text(label, -width / 2 + 15, -height / 2 + 75);
}
