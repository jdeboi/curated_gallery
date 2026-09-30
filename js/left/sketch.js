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

// "groupPulse" (js/paintings.js + js/outlines.js): which paintings/outlines
// take a turn together, one group at a time - fades in, holds, fades out,
// then the next group's turn starts, cycling. Indices are plain declaration
// order into PAINTING_SPECS/OUTLINE_SPECS above (0-based), not the on-screen
// surface-label ids (which additionally count the wall panel(s) ahead of
// them). Anything not listed in any group just stays off for the whole
// scene. Left wall's wing sculptures (bird + both butterflies) share one
// group here even though they're visually distinct pieces.
const PULSE_GROUPS = [
  { paintings: [0, 1, 3, 4] },
  { outlines: [0, 1, 2] },
  { paintings: [2] },
];

// One entry per blackout mask - a freeform polygon painted solid black,
// drawn as a screen-space overlay on top of every panel (see js/masks.js).
// `numPoints` sets how many draggable vertices it starts with - drag them
// during calibration (press "c") to trace the exact area to cover. See
// js/right/sketch.js's own MASK_SPECS for more on the convention.
const MASK_SPECS = [];

// A mirror mask (js/mirrorMasks.js): same freeform blackout PolyMap as
// MASK_SPECS above, but calibrated over a mirror rather than exposed wall -
// so instead of just staying invisible, it gets stars circling it in
// "spinner" and an outside-drawn outline in "emanate"/"mycelium" rather than
// ever being lit. This was surface id 9 (a plain MASK_SPECS entry) before
// that conversion - kept as the sole/first PolyMap created in setup() below
// so it keeps that same id and its existing maps/left/map.json calibration.
const MIRROR_MASK_SPECS = [{ numPoints: 11 }];

// Same idea as MASK_SPECS, but a smooth freeform BezierMap instead of a
// straight-edged PolyMap - see js/right/sketch.js's BEZIER_MASK_SPECS.
const BEZIER_MASK_SPECS = [];

// Literal divisions-per-axis for the wall panel itself (see
// js/right/sketch.js's WALL_PANEL_RES for why this is separate from
// PAINTING_SPECS' res - this panel displays real textured content, unlike
// the solid-fill painting/outline reference quads).
const WALL_PANEL_RES = 16;

// Blinking eyes over a face sculpture (js/faceEyes.js) - one small
// corner-pinned QuadMap per entry, both eyes side by side inside it. `w`/`h`
// are the buffer size in px, so keep the aspect roughly that of the eye
// region on the sculpture. Hidden entirely until "e" toggles it on.
const EYES_SPECS = [];

let pMapper;
let paintingMaps = [];
let butterflyMaps = [];
let maskMaps = [];
let mirrorMaskMaps = [];
let bezierMaskMaps = [];

let myFont;
let wallImg;
let showWallImage = false; // toggled with "b" - reference photo of the physical wall, for calibration

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
  loadStarFlowerSprite(); // js/stars.js
  loadJasmineSprites(); // js/jasmine.js
  loadLookinText(); // js/lookin.js
  loadLookinTvStatic(); // js/lookinTv.js
  loadLookinFaces(); // js/lookinFaces.js

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

  // Created before maskMaps (empty on left wall) so this stays the first
  // PolyMap created - see MIRROR_MASK_SPECS above for why that matters.
  mirrorMaskMaps = MIRROR_MASK_SPECS.map((spec) =>
    pMapper.createPolyMap(spec.numPoints),
  );
  spreadDefaultPositions(mirrorMaskMaps, {
    originX: -900,
    originY: -350,
    spacing: 40,
  });

  maskMaps = MASK_SPECS.map((spec) => pMapper.createPolyMap(spec.numPoints));

  // Created after every other surface so it doesn't shift any existing
  // QuadMap's saved calibration - see js/faceEyes.js.
  createFaceEyes(pMapper, EYES_SPECS);
  spreadDefaultPositions(eyesMaps, { originX: -80, originY: -30 });

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

  if (showWallImage && wallImg)
    image(
      wallImg,
      -width / 2,
      -height / 2,
      wallImg.width * 0.35,
      wallImg.height * 0.35,
    );

  updateShow();
  displayWall();
  drawBlackoutMasksOverlay();
  drawFaceEyesOverlay(); // js/faceEyes.js - on top of the masks too
  drawSurfaceLabels();

  // Drawn last so it always sits on top of the wall content instead of
  // getting painted over by it - paintings/outlines/generative scenes can
  // all cover screen area up near the top-left corner where the HUD lives.
  displayHUD();
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
    case "h":
      toggleHUD();
      break;
    case "b":
      showWallImage = !showWallImage;
      break;
    case "m":
      toggleMirrorMaskEffects(); // js/mirrorMasks.js
      break;
    case "e":
      toggleFaceEyes(); // js/faceEyes.js
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
