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
 * The order scenes play in within each full pass is shuffled rather than
 * SCENES' own declared order - see js/showClock.js - but the shuffle is
 * seeded from the loop number (elapsed time / total show duration), not
 * Math.random(), so it's the same deterministic
 * function of wall-clock time as everything else here: two unlinked
 * instances still land on the same scene at the same moment, they just
 * don't see "black, mycelium, emanate, ..." in the same order every lap.
 * A scene's `duration` is optional - omit it and it falls back to
 * DEFAULT_SCENE_DURATION (see sceneDuration()).
 *
 * Manual scene changes (arrow keys, see nextScene()/previousScene() below)
 * intentionally step through SCENES in its own plain declared order, not
 * the shuffled one - that's what makes them useful for calibration, going
 * scene-by-scene in a predictable sequence rather than a random one.
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
 * "random", "randomOutline", "curtain", "curtainVertical", "curtainDown", "wipe",
 * "wipeDown", "pulse", "groupPulse", "lookin", "lookinTv").
 * Neither field is required: a scene that omits one gets
 * LIGHT_STATE_DEFAULT ("filled" -
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
 * "spinner"'s cycling rings need this: they trace the painting's own
 * silhouette, which a plain `draw` would have already been painted over by
 * the time drawPaintings() ran.
 *
 * Paintings (js/paintings.js) and wing sculptures (js/outlines.js) are
 * drawn on top of every scene from js/wall.js's displayWall(), not listed
 * here - each reads its own current butterflyState/paintingState off
 * currentScene() every frame rather than being scenes themselves.
 */

// Fallback for any scene entry that omits `duration` - see sceneDuration().
const DEFAULT_SCENE_DURATION = 20000;

const SCENES = [
  {
    name: "mycelium",
    duration: 45000,
    init: initMycelium,
    update: updateMycelium,
    // Mirror masks (js/mirrorMasks.js) sit in "outline mode" here - a stroke
    // drawn outside their own opaque black shape, instead of staying plain
    // black like every other non-special scene - but only once
    // mirrorMaskEffectsEnabled is switched on ("m"); it's a no-op otherwise.
    draw: (pg) => {
      drawMycelium(pg);
      drawMirrorMaskOutlines(pg);
    },
    paintingState: "myceliumReveal",
  },
  {
    name: "hyphae",
    duration: 40000,
    init: initHyphae,
    update: updateHyphae,
    draw: drawHyphae, // js/hyphae.js - grayscale branching network + spores, ignores paintings
  },
  {
    name: "emanate",
    duration: 40000,
    init: () => {},
    update: () => {},
    // On a wall with no wing sculptures (empty butterflyMaps, e.g. the
    // right wall - see js/right/sketch.js), drawEmanateRipples has nothing
    // to ripple around and draws nothing at all, leaving that wall dark
    // for the whole scene. Fall back to the painting-quad version of the
    // same ripple instead of doing nothing - and skip the mirror-mask
    // outline too, so the right wall's "emanate" reads as pure
    // emanatePaintings rather than a mix of the two. (drawMirrorMaskOutlines
    // is a no-op unless mirrorMaskEffectsEnabled is switched on - "m".)
    draw: (pg) => {
      if (butterflyMaps.length === 0) {
        drawPaintingEmanateRipples(pg); // js/paintings.js
      } else {
        drawEmanateRipples(pg); // js/outlines.js
        drawMirrorMaskOutlines(pg); // js/mirrorMasks.js
      }
    },
    // butterflyState omitted -> defaults to "filled", so the sculptures
    // stay solid white while the ripples play on top.
    // Explicit, matching "emanatePaintings" below - relevant here on the
    // fallback wall, where the ripples play on the paintings instead.
    paintingState: "filled",
  },
  {
    name: "emanatePaintings",
    duration: 40000,
    init: () => {},
    update: () => {},
    draw: drawPaintingEmanateRipples, // js/paintings.js
    paintingState: "filled",
    // Explicit rather than relying on the "filled" default, so the
    // paintings' steady state can't drift out of sync with what this
    // scene's ripples assume they're drawn against.
  },
  {
    name: "fireflies",
    duration: 35000,
    init: initParticles,
    update: updateParticles,
    draw: drawParticles,
    paintingState: "random",
    butterflyState: "random",
  },
  {
    name: "vines",
    duration: 35000,
    init: initVines,
    update: updateVines,
    draw: drawVines,
  },
  {
    name: "fronds",
    duration: 35000,
    init: initFronds,
    update: updateFronds,
    draw: drawFronds,
    paintingState: "wipe",
    butterflyState: "wipe",
  },
  {
    name: "grass",
    duration: 35000,
    init: initGrass,
    update: updateGrass,
    draw: drawGrass, // js/grass.js
  },
  {
    name: "birds",
    duration: 35000,
    init: initBirds,
    update: updateBirds,
    draw: drawBirds,
    paintingState: "randomOutline",
  },
  {
    name: "butterflies",
    duration: 35000,
    init: initButterflies,
    update: updateButterflies,
    draw: drawButterflies,
    paintingState: "randomOutline",
  },
  {
    name: "nightBirds",
    duration: 35000,
    init: initNightBirds, // js/birds.js - one confined sub-flock per painting
    update: updateBirds,
    draw: (pg) => pg.background(0),
    // drawBirds runs from `overlay` (drawn after drawPaintings(), see
    // js/wall.js's displayWall()) instead of `draw` here, so the flock
    // stays visible sweeping across the lit paintings themselves rather
    // than disappearing behind their opaque fill - same reason "spinner"
    // below uses overlay for its own content.
    overlay: drawBirds,
    paintingState: "outline",
  },
  {
    name: "fluidFall",
    duration: 35000,
    init: initFluidFall,
    update: updateFluidFall,
    draw: drawFluidFall, // js/fluidFall.js - shader-based
    // Paintings fill from the top down, like the fluid falling onto them.
    paintingState: "curtainDown",
  },
  {
    name: "reactionDiffusion",
    duration: 40000,
    init: initReactionDiffusion,
    update: updateReactionDiffusion,
    draw: drawReactionDiffusion, // js/reactionDiffusion.js - shader-based
    paintingState: "randomOutline",
  },
  {
    name: "stars",
    duration: 35000,
    init: initStars,
    update: updateStars,
    draw: drawStars, // js/stars.js
    paintingState: "curtain",
  },
  {
    name: "sparkleStars",
    duration: 35000,
    init: initSparkleStars,
    update: updateSparkleStars,
    draw: drawSparkleStars, // js/sparkleStars.js
    // Opposite of "stars"' own curtain direction (horizontal) below.
    paintingState: "curtainVertical",
  },
  {
    name: "dotField",
    duration: 35000,
    init: initDotField,
    update: updateDotField,
    draw: drawDotField, // js/dotField.js - grid dots sized by distance to hidden gliding balls
    // Paintings and wing sculptures brighten as the same hidden balls pass near them.
    paintingState: "dotField",
    butterflyState: "dotField",
  },
  {
    name: "spotlight",
    duration: 35000,
    init: initSpotlight,
    update: updateSpotlight,
    draw: drawSpotlight, // js/spotlight.js - two soft two-ring spotlights zig-zagging with fading trails
    // Paintings and wing sculptures light up where the spotlights hit them.
    paintingState: "spotlight",
    butterflyState: "spotlight",
  },
  {
    name: "jasmine",
    duration: 35000,
    init: initJasmine,
    update: updateJasmine,
    draw: drawJasmine, // js/jasmine.js - radial size pulse from the wall center
    // Radial sweep outward from the same wall center the flowers pulse from -
    // paintings and wing sculptures share one sweep basis (see
    // wipeRadialBasisPolygons() in js/paintings.js), so it reads as one wave.
    paintingState: "wipeRadial",
    butterflyState: "wipeRadial",
  },
  {
    name: "lookin",
    duration: 35000,
    init: () => {
      initLookin(); // js/lookin.js - restarts every painting's cycle from a blank page
      initLookinFaces(); // js/lookinFaces.js
    },
    update: updateLookinFaces,
    draw: drawLookinFaces, // tiled faces whose pupils glance around
    // Each painting has "I SEE YOU LOOKIN" written across it, letter by
    // letter, before it fades up to lit - each painting on its own random timer.
    paintingState: "lookin",
    butterflyState: "off",
  },
  {
    name: "lookinTv",
    duration: 45000,
    init: initLookinTv, // js/lookinTv.js - restarts the power-on sequence
    update: () => {},
    draw: (pg) => pg.background(0),
    // Paintings power on one at a time like old TVs onto static, the static
    // fades out on all of them together, "I SEE YOU LOOKIN" is written across
    // them, then each carries on through the "lookin" loop on its own timer.
    paintingState: "lookinTv",
    butterflyState: "off",
  },
  // Painting-choreography scene: a plain black field so its painting mode
  // (js/paintings.js) reads clearly on its own, rather than competing with a
  // generative background.
  {
    name: "spinner",
    duration: 30000,
    init: () => {},
    update: () => {},
    draw: (pg) => pg.background(0),
    overlay: drawSpinnerOutlines, // js/outlines.js - now circles wing sculptures too
    paintingState: "groupPulse",
    butterflyState: "groupPulse",
  },
  // One entry per file in js/video.js's VIDEO_FILES - see that file for
  // why these are generated instead of listed by hand here.
  ...buildVideoScenes(),
];

// A scene's `duration` is optional - this is the one place that matters,
// so every other reader goes through here rather than touching
// scene.duration directly.
function sceneDuration(scene) {
  return scene.duration || DEFAULT_SCENE_DURATION;
}

const SCENE_DURATIONS = SCENES.map(sceneDuration);

let sceneIndex = 0;
let showPlaying = true; // false = held on one scene (arrow keys, or locked from the phone)
let lastElapsedInScene = 0; // for the status readout only

// Set by the phone remote (js/remote.js) and shared by every wall - see
// js/showClock.js. Both default to "just run the clock-driven show", which
// is what a wall does when there's no remote at all.
let showOffsetMs = 0; // the show plays at Date.now() + this; "next" bumps it
let showStopped = false; // "stop": the whole wall goes black
// This machine's clock vs the relay's (js/remote.js measures it), so walls on
// different computers share one timeline even if their clocks disagree.
let showClockSkewMs = 0;
// True when the current hold came from this wall's own keyboard (arrows /
// space) rather than the phone's lock - the remote leaves those alone until
// its next command, but otherwise always pulls a held wall back to the clock.
let showHeldLocally = false;

function currentScene() {
  return SCENES[sceneIndex];
}

// Maps a moment in wall-clock time to a scene index + how far into that
// scene's duration it falls - the one piece of math every instance needs
// to agree on for the show to stay in step without a network link. The
// shuffle-per-loop and the math itself live in js/showClock.js so the
// remote-control relay (server.js) can run the exact same schedule.
function computeShowPosition(nowMs) {
  return showClock.showPosition(SCENE_DURATIONS, nowMs + showClockSkewMs + showOffsetMs);
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
  showHeldLocally = true;
  enterScene(sceneIndex + 1);
}

function previousScene() {
  showPlaying = false;
  showHeldLocally = true;
  enterScene(sceneIndex - 1);
}

function toggleShowPlaying() {
  if (showPlaying) {
    showPlaying = false;
    showHeldLocally = true;
  } else {
    resumeShow();
  }
}

// Same hold as the arrow keys, but jumping straight to a scene by name -
// used by the phone remote's lock (js/remote.js). Leaves the scene running
// rather than restarting it if it's already the one on screen. Returns
// false for a name this wall doesn't have (e.g. walls on different code).
function holdSceneByName(name) {
  const index = SCENES.findIndex((s) => s.name === name);
  if (index < 0) return false;
  showPlaying = false;
  showHeldLocally = false;
  if (index !== sceneIndex) enterScene(index);
  return true;
}

// Back to following the wall clock, snapped to wherever the schedule says
// the show is right now. Leaves the live scene running if the schedule
// agrees it's the one that should be on (e.g. unlocking from the phone).
function resumeShow() {
  showPlaying = true;
  showHeldLocally = false;
  const pos = computeShowPosition(Date.now());
  if (pos.sceneIndex !== sceneIndex) enterScene(pos.sceneIndex);
  lastElapsedInScene = pos.elapsedInScene;
}

// "stop" from the phone: the wall goes black (see each wall's draw()).
// Starting again re-enters the scene fresh rather than un-freezing it.
function setShowStopped(stopped) {
  if (stopped === showStopped) return;
  showStopped = stopped;
  if (!stopped) {
    if (showPlaying) {
      const pos = computeShowPosition(Date.now());
      lastElapsedInScene = pos.elapsedInScene;
      enterScene(pos.sceneIndex);
    } else {
      enterScene(sceneIndex);
    }
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
  if (showStopped) return `scene ${sceneIndex + 1}/${SCENES.length}: ${scene.name} (stopped)`;
  const status = showPlaying
    ? `${Math.max(0, Math.ceil((sceneDuration(scene) - lastElapsedInScene) / 1000))}s`
    : "held";
  return `scene ${sceneIndex + 1}/${SCENES.length}: ${scene.name} (${status})`;
}
