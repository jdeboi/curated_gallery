/*
 * right wall - config/setup for this specific installation.
 *
 * The physical wall has a curve/bend in it, so it can't be corner-pinned
 * as a single flat QuadMap the way left wall is - it's split into 3 flat
 * panels here, each independently calibrated, but stitched into one
 * shared logical drawing space (see js/wall.js) so the generative scenes
 * (mycelium, fireflies, emanate - all in js/) can grow/drift right across
 * the seams between panels rather than being confined to one each.
 *
 * All 3 panels share the same height; the outer two (0 and 2) are 1/3
 * the width of the center one (1), matching how the physical wall bends
 * inward on either side. These are placeholders - measure the actual
 * physical panels and adjust.
 *
 * PAINTING_SPECS/OUTLINE_SPECS are empty starter lists - add an entry per
 * painting/sculpture the same way left wall does (see js/left/sketch.js).
 * Neither needs to say which of the 3 panels below it's physically
 * mounted on - that's worked out at draw/lock time from wherever you
 * actually drag it during calibration (see resolvePanelIndex() in
 * js/wall.js), so it stays correct even if a piece ends up straddling a
 * different panel than you expected.
 */

const PANEL_HEIGHT = 700;
const CENTER_PANEL_WIDTH = 870;
const SIDE_PANEL_WIDTH = CENTER_PANEL_WIDTH / 3;

// Literal divisions-per-axis for the wall panels themselves (passed as
// both res/resY to createQuadMap, which bypasses the pixel-spacing default
// and takes this as-is - see js/right/sketch.js's setup()). Unlike
// PAINTING_SPECS' res (a solid-color fill, so resolution is irrelevant),
// these panels display real textured generative content, and a coarser
// mesh trades warp smoothness for fewer triangles per frame.
//
// This matters most right at a seam between two panels: each panel is
// corner-pinned independently (a different keystone amount on each, since
// the physical wall bends), so within a coarse mesh cell the true
// (projective) warp only gets approximated by a flat affine triangle -
// two adjacent panels approximate that warp slightly differently near
// their shared edge, so content crossing close to (not exactly on) the
// seam can visibly land at a different height on each side even though
// the seam's own corner points are pinned pixel-exact (see
// syncPanelSeams() in js/wall.js). A finer mesh shrinks that per-cell
// error; it can't fully eliminate it for a genuinely bent physical wall.
// calculateMesh() (real per-vertex interpolation) only re-runs when a
// corner actually moves, not every frame (see syncSeamCorner() in
// js/wall.js), so there's real headroom above this before it costs
// anything at rest - raise further if seam misalignment or faceting is
// still visible, lower again if framerate drops during calibration
// dragging specifically (that's the one time this size still matters
// every frame).
const WALL_PANEL_RES = 32;

// One entry per painting, corner-pinned in absolute screen space. 13
// placeholders below - adjust w/h per painting and drag each into place
// during calibration (press "c"); which panel it ends up on is figured
// out automatically from where you drop it.
const PAINTING_SPECS = [
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
];

// One entry per wing sculpture (if any), e.g.:
//   { name: "moth", file: "assets/right/moth.svg", width: 300, height: 260 },
const OUTLINE_SPECS = [];

// One entry per blackout mask - a freeform polygon painted solid black to
// hide projector light spilling past the paintings (e.g. onto exposed wall
// or ceiling above them). Drawn as a screen-space overlay on top of every
// panel (see js/masks.js), not tied to any one panel. `numPoints` sets how
// many draggable vertices it starts with - drag them during calibration
// (press "c") to trace the exact area to cover.
const MASK_SPECS = [{ numPoints: 6 }, { numPoints: 4 }, { numPoints: 4 }];

let pMapper;
let paintingMaps = [];
let butterflyMaps = [];
let maskMaps = [];

let myFont;
let wallImg;

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  loadFont("assets/Roboto.ttf", (font) => {
    myFont = font;
    textFont(myFont);
  });

  pMapper = createProjectionMapper(this);

  // 3 flat panels laid left-to-right in the wall's shared logical space,
  // each positioned at the running sum of the widths before it. Adjust
  // the x/y offsets here if the panels aren't simply side-by-side (e.g.
  // one set back or overlapping) once you see how the curve actually reads.
  initWallPanels([
    {
      map: pMapper.createQuadMap(
        SIDE_PANEL_WIDTH,
        PANEL_HEIGHT,
        WALL_PANEL_RES,
        WALL_PANEL_RES,
      ),
      x: 0,
      y: 0,
    },
    {
      map: pMapper.createQuadMap(
        CENTER_PANEL_WIDTH,
        PANEL_HEIGHT,
        WALL_PANEL_RES,
        WALL_PANEL_RES,
      ),
      x: SIDE_PANEL_WIDTH,
      y: 0,
    },
    {
      map: pMapper.createQuadMap(
        SIDE_PANEL_WIDTH,
        PANEL_HEIGHT,
        WALL_PANEL_RES,
        WALL_PANEL_RES,
      ),
      x: SIDE_PANEL_WIDTH + CENTER_PANEL_WIDTH,
      y: 0,
    },
  ]);

  // p5.mapper 3.0.0+: a single res is now a target pixel spacing, not a
  // division count, so `s.res` (e.g. 2) must be passed twice to get the
  // old literal flat grid back - these never draw their own content, so
  // there's no reason to pay for interior vertices.
  paintingMaps = PAINTING_SPECS.map((s) =>
    pMapper.createQuadMap(s.w, s.h, s.res, s.res),
  );
  // Spread apart at their default position so they aren't all stacked on
  // top of each other (and of the wall panel underneath) before you've
  // dragged any of them - see spreadDefaultPositions() in js/wall.js.
  spreadDefaultPositions(paintingMaps, { originX: -700, originY: -300, spacing: 40 });

  // butterflyMaps = OUTLINE_SPECS.map((spec) =>
  //   pMapper.createQuadMap(spec.width, spec.height, 2, 2),
  // );

  maskMaps = MASK_SPECS.map((spec) => pMapper.createPolyMap(spec.numPoints));
  spreadDefaultPositions(maskMaps, { originX: -700, originY: 200, spacing: 40 });

  initShow();

  // loadOutlineSVGs().then(() => {
  //   pMapper.load("maps/right/map.json", () => {
  //     syncParentingLockFromLoadedState();
  //   });
  // });

  loadImage("assets/right/right.jpeg", (img) => {
    img.resize(img.width, img.height);
    wallImg = img;
  });
}

function draw() {
  background(0);

  if (wallImg)
    image(
      wallImg,
      -width / 2,
      -height / 2,
      wallImg.width * 0.35,
      wallImg.height * 0.35,
    );

  displayFrameRate();
  displayParentingStatus();
  displayShowStatus();

  updateShow();
  displayWall();
  drawBlackoutMasksOverlay();
  drawSurfaceLabels();
}

function keyPressed() {
  switch (key) {
    case "c":
      pMapper.toggleCalibration();
      break;
    case "f": {
      let fs = fullscreen();
      fullscreen(!fs);
      break;
    }
    case "l":
      pMapper.load("maps/right/map.json", () => {
        syncParentingLockFromLoadedState();
      });
      break;
    case "s":
      // Downloads to the browser's Downloads folder - move it into
      // maps/right/map.json to persist it (see README).
      pMapper.save("right-map.json");
      break;
    case "i":
      cyclePaintingLightMode();
      break;
    case "p":
      toggleParentingLocked();
      break;
    case "ArrowRight":
      nextScene();
      break;
    case "ArrowLeft":
      previousScene();
      break;
    case " ":
      toggleShowPlaying();
      break;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function displayFrameRate() {
  if (!myFont) return;

  fill(255);
  noStroke();
  text(round(frameRate()), -width / 2 + 15, -height / 2 + 50);
}
