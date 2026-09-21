/*
 * Locking/unlocking the painting + outline reference surfaces to
 * whichever wall panel each is physically corner-pinned against.
 *
 * paintingMaps/butterflyMaps are calibrated in absolute screen space (see
 * each wall's sketch.js) so each one can be corner-pinned independently
 * onto its physical painting/sculpture. Once that per-piece calibration
 * is done, locking re-expresses every one of those surfaces relative to
 * its own panel's local (pre-warp) space via p5.mapper's built-in
 * setParent() - resolvePanelIndex() (see js/wall.js) works out which panel
 * that is from each surface's own calibrated position, rather than a
 * hand-declared index. After that, moving/re-keystoning
 * a panel alone (e.g. because the projector got bumped) carries every
 * painting/outline mounted on it along automatically - on a multi-panel
 * wall, only that panel's own pieces move, since each is parented to its
 * own panel rather than to the wall as a whole.
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
  return [
    ...paintingMaps.map((surface) => ({
      surface,
      panel: resolvePanelIndex(surface),
    })),
    ...butterflyMaps.map((surface) => ({
      surface,
      panel: resolvePanelIndex(surface),
    })),
  ];
}

function setParentingLocked(locked) {
  getParentableSurfaces().forEach(({ surface, panel }) => {
    surface.setParent(locked ? wallPanels[panel].map : null);
  });
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
    surfaces.length > 0 &&
    surfaces.every(({ surface, panel }) => surface.getParent() === wallPanels[panel].map);
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
