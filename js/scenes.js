/*
 * Show orchestration: cycles the wall through a sequence of scenes.
 *
 * Which scene is live is derived from the system clock (Date.now()),
 * not from when this page happened to load - the whole SCENES list has
 * a fixed total duration, and "now mod that total" gives a timeline
 * position every independently-running instance agrees on, as long as
 * their clocks are in sync (NTP). That's what lets a second wall, with
 * no network link to this one, run the same show in step: same code,
 * same SCENES durations, same wall-clock second -> same scene index and
 * the same elapsed-in-scene offset.
 *
 * This syncs *timing* only - which scene, and how far into its
 * duration - not the generative content itself. Each scene's own
 * random growth/particle motion still runs its own independent
 * unseeded randomness per process, so e.g. the mycelium branches will
 * be in different specific shapes on each wall even though both are
 * "40% through the mycelium scene" at the same moment. Getting the
 * actual pixels to match too would mean seeding each scene's RNG from
 * the clock as well and switching their per-frame growth to a
 * fixed-timestep sim (so frame-rate differences between the two
 * machines don't desync the random call sequence) - a bigger change,
 * worth doing as a follow-up if the two walls need to look pixel-
 * identical rather than just "same scene, same phase."
 *
 * Each entry owns its own init/update/draw triplet and is otherwise
 * unaware of the others - the manager here only decides which one is
 * live. Entering a scene always calls its init() so switching mid-show
 * (auto-advance or manual) never leaves stale state (e.g. a half-grown
 * mycelium network) bleeding into the next scene; each scene restarts its
 * own arc from empty every time it comes up. A page that loads mid-scene
 * (e.g. a wall computer rebooted mid-show) will start that scene from
 * empty too, rather than fast-forwarding visually to where it "should" be
 * - it'll be back in phase with the other wall at the next scene
 * boundary, same fixed-timestep work as above would be needed to catch a
 * scene up instantly. ("emanate" has no state of its own to reset - see
 * below.)
 *
 * A scene entry may also set `butterflyState` and/or `paintingState` -
 * how the wing sculptures / paintings should sit while that scene is
 * live, in the shared vocabulary from js/lightState.js ("filled",
 * "outline", "off", or a pulse/switch descriptor between them). Neither
 * field is required: a scene that omits one gets LIGHT_STATE_DEFAULT
 * ("filled" - everything illuminated), which is why plain scenes below
 * don't set them at all. This is separate from a scene's own
 * init/update/draw - "emanate"'s rippling animation, for instance, plays
 * on top of whatever butterflyState resolves to (default: filled),
 * rather than being that state itself.
 *
 * Paintings (js/paintings.js) and wing sculptures (js/outlines.js) are
 * drawn on top of every scene from js/wall.js's displayWall(), not listed
 * here - each reads its own current butterflyState/paintingState off
 * currentScene() every frame rather than being scenes themselves.
 */

const SCENES = [
  {
    name: "mycelium",
    duration: 45000,
    init: initMycelium,
    update: updateMycelium,
    draw: drawMycelium,
  },
  {
    name: "emanate",
    duration: 40000,
    init: () => {},
    update: () => {},
    draw: drawEmanateRipples, // js/outlines.js
    // butterflyState omitted -> defaults to "filled", so the sculptures
    // stay solid white while the ripples play on top.
  },
  {
    name: "fireflies",
    duration: 35000,
    init: initParticles,
    update: updateParticles,
    draw: drawParticles,
  },
  {
    name: "snake",
    duration: 35000,
    init: initSnake,
    update: updateSnake,
    draw: drawSnake,
  },
  {
    name: "birds",
    duration: 35000,
    init: initBirds,
    update: updateBirds,
    draw: drawBirds,
  },
  {
    name: "butterflies",
    duration: 35000,
    init: initButterflies,
    update: updateButterflies,
    draw: drawButterflies,
  },
  {
    name: "reactionDiffusion",
    duration: 40000,
    init: initReactionDiffusion,
    update: updateReactionDiffusion,
    draw: drawReactionDiffusion, // js/reactionDiffusion.js - shader-based
  },
  {
    name: "circleWobble",
    duration: 40000,
    init: initCircleWobble,
    update: updateCircleWobble,
    draw: drawCircleWobble, // js/circleWobble.js - shader-based
  },
  // One entry per file in js/video.js's VIDEO_FILES - see that file for
  // why these are generated instead of listed by hand here.
  ...buildVideoScenes(),
];

const SHOW_TOTAL_DURATION = SCENES.reduce((sum, s) => sum + s.duration, 0);

let sceneIndex = 0;
let showPlaying = true;
let lastElapsedInScene = 0; // for the status readout only

function currentScene() {
  return SCENES[sceneIndex];
}

// Maps a moment in wall-clock time to a scene index + how far into that
// scene's duration it falls - the one piece of math every instance needs
// to agree on for the show to stay in step without a network link.
function computeShowPosition(nowMs) {
  let t = nowMs % SHOW_TOTAL_DURATION;
  for (let i = 0; i < SCENES.length; i++) {
    if (t < SCENES[i].duration) return { sceneIndex: i, elapsedInScene: t };
    t -= SCENES[i].duration;
  }
  // Floating-point edge case at the exact wraparound instant.
  const last = SCENES.length - 1;
  return { sceneIndex: last, elapsedInScene: SCENES[last].duration - 1 };
}

function enterScene(index) {
  sceneIndex = ((index % SCENES.length) + SCENES.length) % SCENES.length;
  currentScene().init();
}

function initShow() {
  showPlaying = true;
  const pos = computeShowPosition(Date.now());
  enterScene(pos.sceneIndex);
  lastElapsedInScene = pos.elapsedInScene;
}

// Arrow-key scene changes are a local preview/calibration override - they
// stop following the wall clock so you can sit on one scene as long as
// you like. Space resumes clock-following, snapping back to wherever the
// schedule says the show should be right now (see toggleShowPlaying).
function nextScene() {
  showPlaying = false;
  enterScene(sceneIndex + 1);
}

function previousScene() {
  showPlaying = false;
  enterScene(sceneIndex - 1);
}

function toggleShowPlaying() {
  showPlaying = !showPlaying;
  if (showPlaying) {
    const pos = computeShowPosition(Date.now());
    enterScene(pos.sceneIndex);
    lastElapsedInScene = pos.elapsedInScene;
  }
}

function updateShow() {
  if (showPlaying) {
    const pos = computeShowPosition(Date.now());
    if (pos.sceneIndex !== sceneIndex) enterScene(pos.sceneIndex);
    lastElapsedInScene = pos.elapsedInScene;
  }
  currentScene().update();
}

function drawShow(pg) {
  currentScene().draw(pg);
}

function displayShowStatus() {
  if (!myFont) return;

  const scene = currentScene();
  const status = showPlaying
    ? `${Math.max(0, Math.ceil((scene.duration - lastElapsedInScene) / 1000))}s`
    : "manual";

  fill(255);
  noStroke();
  text(
    `scene: ${scene.name} (${status}) — arrows to switch, space to ${showPlaying ? "pause" : "sync & play"}`,
    -width / 2 + 15,
    -height / 2 + 100,
  );
}
