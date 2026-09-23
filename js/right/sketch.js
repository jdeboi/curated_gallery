/*
 * right wall - config/setup for this specific installation.
 *
 * Currently one single flat QuadMap, same as left wall - simplified down
 * from an earlier 3-panel version (one full-width panel plus two narrower
 * side panels, corner-pinned independently to handle a curve/bend in the
 * physical wall and stitched into one shared logical drawing space). That
 * version is preserved on the `right-wall-3-panel` git branch/tag if the
 * physical wall turns out to need it after all - js/wall.js's
 * multi-panel machinery (panelToLogical(), syncPanelSeams(),
 * syncPanelGroupDrag(), resolvePanelIndex()) is unchanged and already
 * generic over wallPanels.length, so reintroducing more panels here is
 * just a matter of restoring that setup() block, not touching the shared
 * engine again.
 *
 * PAINTING_SPECS/OUTLINE_SPECS are empty starter lists - add an entry per
 * painting/sculpture the same way left wall does (see js/left/sketch.js).
 */

const WALL_WIDTH = 1450;
const WALL_HEIGHT = 700;

// Literal divisions-per-axis for the wall panel itself (see
// js/left/sketch.js's WALL_PANEL_RES for why this is separate from
// PAINTING_SPECS' res - this panel displays real textured content, unlike
// the solid-fill painting/outline reference quads).
const WALL_PANEL_RES = 16;

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

  loadBackgroundVideos(); // js/video.js - one <video> element per VIDEO_FILES entry

  pMapper = createProjectionMapper(this);

  initWallPanels([
    {
      map: pMapper.createQuadMap(WALL_WIDTH, WALL_HEIGHT, WALL_PANEL_RES, WALL_PANEL_RES),
      x: 0,
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
  if (!myFont) return;

  fill(255);
  noStroke();
  text(round(frameRate()), -width / 2 + 15, -height / 2 + 50);
}
