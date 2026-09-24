/*
 * left wall - config/setup for this specific installation.
 *
 * This is the only wall-specific file for left wall: it declares its
 * paintings (PAINTING_SPECS), wing sculptures (OUTLINE_SPECS), and its
 * single wall panel, then hands everything else to the shared engine in
 * js/ (mycelium.js, particles.js, scenes.js, paintings.js,
 * outlines.js, parenting.js, wall.js). See js/right/sketch.js for the
 * 3-panel curved-wall counterpart - same engine, different config.
 *
 * p5.mapper
 * https://github.com/jdeboi/p5.mapper
 *
 * Jenna deBoisblanc
 * jdeboi.com
 */

// One painting per paintingMap, corner-pinned in absolute screen space.
// Left wall only has one panel, so every painting lands on it regardless -
// see js/right/sketch.js for the multi-panel case, where which panel a
// piece is on is worked out automatically from where it's dragged (see
// resolvePanelIndex() in js/wall.js) rather than declared here.
const PAINTING_SPECS = [
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 250, h: 180, res: 2 },
  { w: 180, h: 250, res: 2 },
  { w: 180, h: 250, res: 2 },
];

// One wing sculpture per butterflyMap, same convention as above.
const OUTLINE_SPECS = [
  { name: "bird", file: "assets/left/bird.svg", width: 322.5, height: 294.49 },
  {
    name: "butterfly0",
    file: "assets/left/butterfly0.svg",
    width: 328.97,
    height: 242.07,
  },
  {
    name: "butterfly1",
    file: "assets/left/butterfly1.svg",
    width: 276.61,
    height: 272.9,
  },
];

// No blackout masks needed on left wall yet - see js/right/sketch.js for
// how to add one (a freeform PolyMap painted solid black, drawn as a
// screen-space overlay on top of every panel - see js/masks.js).
const MASK_SPECS = [];

// Same idea as MASK_SPECS, but a smooth freeform BezierMap instead of a
// straight-edged PolyMap - see js/right/sketch.js's BEZIER_MASK_SPECS.
const BEZIER_MASK_SPECS = [];

// Literal divisions-per-axis for the wall panel itself (see
// js/right/sketch.js's WALL_PANEL_RES for why this is separate from
// PAINTING_SPECS' res - this panel displays real textured content, unlike
// the solid-fill painting/outline reference quads).
const WALL_PANEL_RES = 16;

let pMapper;
let paintingMaps = [];
let butterflyMaps = [];
let maskMaps = [];
let bezierMaskMaps = [];

let myFont;
let wallImg;

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  // p5.js 2.0 removed preload(), so assets are loaded here with callbacks
  loadFont("assets/Roboto.ttf", (font) => {
    myFont = font;
    textFont(myFont);
  });

  loadImage("assets/left/left_wall.jpeg", (loadedWallImg) => {
    wallImg = loadedWallImg;
  });

  loadBackgroundVideos(); // js/video.js - one <video> element per VIDEO_FILES entry
  loadBirdSprite(); // js/birds.js
  loadButterflySprite(); // js/butterflies.js

  // create mapper object
  pMapper = createProjectionMapper(this);

  // The wall panel is the only surface that ever draws visible content -
  // see js/paintings.js and js/outlines.js for why. paintingMaps and
  // butterflyMaps exist purely as corner-pinned geometry references.
  initWallPanels([
    {
      map: pMapper.createQuadMap(870, 700, WALL_PANEL_RES, WALL_PANEL_RES),
      x: 0,
      y: 0,
    },
  ]);

  // p5.mapper 3.0.0+: a single res is now a target pixel spacing, not a
  // division count, so `s.res` (e.g. 2) must be passed twice to get the
  // old literal flat grid back - these never draw their own content (see
  // note above), so there's no reason to pay for interior vertices.
  paintingMaps = PAINTING_SPECS.map((s) =>
    pMapper.createQuadMap(s.w, s.h, s.res, s.res),
  );

  // Each outline gets a QuadMap sized to its own SVG viewBox, used purely
  // as a corner-pin frame - see js/outlines.js for why the traced shape
  // itself lives separately in outlinePaths rather than on the surface.
  // resolveToScreen() (how outlines.js reads these back) uses the exact
  // homography, not the interior mesh, so resolution is irrelevant here -
  // pass 2 twice (p5.mapper 3.0.0+: a single res is now a pixel spacing,
  // not a division count) to keep these at the cheapest possible flat grid.
  butterflyMaps = OUTLINE_SPECS.map((spec) =>
    pMapper.createQuadMap(spec.width, spec.height, 2, 2),
  );

  initShow();

  // Trace the butterfly/bird SVGs, then load calibration - in that order,
  // so pMapper.load() has butterflyMaps' QuadMaps ready to receive their
  // saved corner positions (see js/outlines.js for how the traced shape
  // and the corner-pin calibration stay independent of each other).
  loadOutlineSVGs().then(() => {
    pMapper.load("maps/left/map.json", () => {
      // Reflects whatever was actually saved (paintings/outlines may or may
      // not have been parented to their panel) rather than assuming unlocked.
      syncParentingLockFromLoadedState();
    });
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
      pMapper.load("maps/left/map.json", () => {
        syncParentingLockFromLoadedState();
      });
      break;
    case "s":
      // Downloads to the browser's Downloads folder - move it into
      // maps/left/map.json to persist it (see README).
      pMapper.save("left-map.json");
      break;
    case "q":
      cycleButterflyLightMode();
      break;
    case "w":
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
  if (!myFont) return; // font hasn't finished loading yet

  fill(255);
  noStroke();
  text(round(frameRate()), -width / 2 + 15, -height / 2 + 50);
}
