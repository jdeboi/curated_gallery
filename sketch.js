/*
 * p5.mapper
 * https://github.com/jdeboi/p5.mapper
 *
 * Jenna deBoisblanc
 * jdeboi.com
 *
 */

let pMapper;
let quadMap;
let paintingMaps = [];
let butterflyMaps = [];

let myFont;
let wallImg;

// Mycelium and fireflies are two separate display modes rather than
// simultaneous layers - cycle between them with the left/right arrow keys.
const DISPLAY_MODES = ["mycelium", "fireflies"];
let displayModeIndex = 0;

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  // p5.js 2.0 removed preload(), so assets are loaded here with callbacks
  loadFont("assets/Roboto.ttf", (font) => {
    myFont = font;
    textFont(myFont);
  });

  loadImage("assets/left_wall.jpeg", (loadedWallImg) => {
    wallImg = loadedWallImg;
  });

  // create mapper object
  pMapper = createProjectionMapper(this);

  // quadMap is the only surface that ever draws visible content - see
  // js/paintings.js and js/outlines.js for why. paintingMaps and
  // butterflyMaps exist purely as corner-pinned geometry references.
  quadMap = pMapper.createQuadMap(870, 700);
  paintingMaps[0] = pMapper.createQuadMap(180, 250, 2);
  paintingMaps[1] = pMapper.createQuadMap(180, 250, 2);
  paintingMaps[2] = pMapper.createQuadMap(250, 180, 2);
  paintingMaps[3] = pMapper.createQuadMap(180, 250, 2);
  paintingMaps[4] = pMapper.createQuadMap(180, 250, 2);

  // Each outline gets a QuadMap sized to its own SVG viewBox, used purely
  // as a corner-pin frame - see js/outlines.js for why the traced shape
  // itself lives separately in outlinePaths rather than on the surface.
  OUTLINE_SPECS.forEach((spec) => {
    butterflyMaps.push(pMapper.createQuadMap(spec.width, spec.height, 2));
  });

  initParticles();
  initMycelium();

  // Trace the butterfly/bird SVGs, then load calibration - in that order,
  // so pMapper.load() has butterflyMaps' QuadMaps ready to receive their
  // saved corner positions (see js/outlines.js for how the traced shape
  // and the corner-pin calibration stay independent of each other).
  loadOutlineSVGs().then(() => {
    pMapper.load("maps/map.json", () => {
      // Reflects whatever was actually saved (paintings/outlines may or may
      // not have been parented to quadMap) rather than assuming unlocked.
      syncParentingLockFromLoadedState();
    });
  });
}

function draw() {
  background(0);

  if (false && wallImg)
    image(
      wallImg,
      -width / 2,
      -height / 2,
      wallImg.width * 0.35,
      wallImg.height * 0.35,
    );

  displayFrameRate();
  displayParentingStatus();
  displayModeStatus();

  const mode = DISPLAY_MODES[displayModeIndex];
  if (mode === "mycelium") updateMycelium();
  if (mode === "fireflies") updateParticles();

  quadMap.displaySketch((pg) => {
    if (mode === "mycelium") drawMycelium(pg);
    if (mode === "fireflies") drawParticles(pg);
    drawPaintings(pg);
    butterflyMaps.forEach((refMap, i) => drawPulsingOutline(pg, i, refMap));
  });

  // Reference-only surfaces: draw nothing, but keep them "displayed" every
  // frame so their corner handles still drag in calibration mode.
  // paintingMaps.forEach((pm) => pm.displaySketch(() => {}));
  butterflyMaps.forEach((bm) => bm.displaySketch(() => {}));
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
      pMapper.load("maps/map.json", () => {
        syncParentingLockFromLoadedState();
      });
      break;
    case "s":
      pMapper.save("map.json");
      break;
    case "i":
      cyclePaintingLightMode();
      break;
    case "p":
      toggleParentingLocked();
      break;
    case "ArrowRight":
      displayModeIndex = (displayModeIndex + 1) % DISPLAY_MODES.length;
      break;
    case "ArrowLeft":
      displayModeIndex =
        (displayModeIndex - 1 + DISPLAY_MODES.length) % DISPLAY_MODES.length;
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

function displayModeStatus() {
  if (!myFont) return;

  fill(255);
  noStroke();
  text(
    `mode: ${DISPLAY_MODES[displayModeIndex]} (arrows to switch)`,
    -width / 2 + 15,
    -height / 2 + 100,
  );
}
