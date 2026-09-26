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
 * "outline", "off", or a pulse/switch descriptor between them) plus the
 * spotlight/animated painting-only modes from js/paintings.js ("sequence",
 * "random", "column", "row", "curtain", "wipe", "pulse"). Neither field is
 * required: a scene that omits one gets LIGHT_STATE_DEFAULT ("filled" -
 * everything illuminated), which is why plain scenes below don't set them
 * at all. This is separate from a scene's own init/update/draw -
 * "emanate"'s rippling animation, for instance, plays on top of whatever
 * butterflyState resolves to (default: filled), rather than being that
 * state itself.
 *
 * A scene may also set `overlay(pg)` - content drawn *after* the paintings/
 * outlines' own steady state (drawShowOverlay(), called from
 * js/wall.js's displayWall()), for an effect that needs to sit visibly on
 * top of their opaque fill rather than underneath it, the way `draw` does.
 * "spinner"'s cycling rings and "searchlight"'s beam-highlighted painting
 * both need this: they trace/relight the painting's own silhouette, which a
 * plain `draw` would have already been painted over by the time
 * drawPaintings() ran.
 *
 * Paintings (js/paintings.js) and wing sculptures (js/outlines.js) are
 * drawn on top of every scene from js/wall.js's displayWall(), not listed
 * here - each reads its own current butterflyState/paintingState off
 * currentScene() every frame rather than being scenes themselves.
 */

const SCENES = [
  {
    name: "black",
    duration: 20000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    // paintingState/butterflyState omitted -> default "filled", so the
    // paintings/sculptures still read normally against the plain black
    // field rather than going dark themselves.
  },
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
    name: "emanatePaintings",
    duration: 40000,
    init: () => {},
    update: () => {},
    draw: drawPaintingEmanateRipples, // js/paintings.js
    // paintingState omitted -> defaults to "filled", so the paintings stay
    // solid white while the ripples play on top - same as "emanate" does
    // for the wing sculptures' butterflyState.
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
    name: "nightBirds",
    duration: 35000,
    init: initBirds, // js/birds.js - same boid flock as "birds"
    update: updateBirds,
    draw: (pg) => pg.background(0),
    // drawBirds runs from `overlay` (drawn after drawPaintings(), see
    // js/wall.js's displayWall()) instead of `draw` here, so the flock
    // stays visible sweeping across the lit paintings themselves rather
    // than disappearing behind their opaque fill - same reason
    // "spinner"/"searchlight" below use overlay for their own content.
    overlay: drawBirds,
    paintingState: "filled",
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
  // The following are painting-choreography scenes: a plain black field so
  // each painting mode (js/paintings.js) reads clearly on its own, rather
  // than competing with a generative background.
  {
    name: "curtain",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    paintingState: "curtain",
  },
  {
    name: "wipe",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    paintingState: "wipe",
  },
  {
    name: "column",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    paintingState: "column",
  },
  {
    name: "row",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    paintingState: "row",
  },
  {
    name: "pulse",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    paintingState: "pulse",
  },
  {
    name: "spinner",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    overlay: drawSpinnerOutlines, // js/outlines.js
    paintingState: "off",
    butterflyState: "off",
  },
  {
    name: "searchlight",
    duration: 45000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    // The beam itself has to be drawn here, alongside the highlight, rather
    // than in `draw` - `draw` runs before drawPaintings() paints each
    // painting's opaque "off" (black) fill on top (see js/wall.js's
    // displayWall()), which hid the beam behind every painting it swept
    // near or paused on instead of lighting them up. See js/searchlight.js.
    overlay: (pg) => {
      drawSearchlights(pg);
      drawSearchlightHighlights(pg);
    },
    paintingState: "off",
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

// See the file header note on `overlay` - most scenes don't set one.
function drawShowOverlay(pg) {
  if (currentScene().overlay) currentScene().overlay(pg);
}

// "scene 5/23: mycelium (12s)" - for the HUD (js/hud.js).
function sceneStatusLine() {
  const scene = currentScene();
  const status = showPlaying
    ? `${Math.max(0, Math.ceil((scene.duration - lastElapsedInScene) / 1000))}s`
    : "manual";
  return `scene ${sceneIndex + 1}/${SCENES.length}: ${scene.name} (${status})`;
}
