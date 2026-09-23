/*
 * Video-loop scenes: each file in VIDEO_FILES becomes its own scene in the
 * shared SCENES rotation (js/scenes.js), looping full-bleed across the
 * whole wall the same way js/reactionDiffusion.js/js/circleWobble.js fill
 * it with a shader - draw straight into the wall panel's own 2D graphics
 * buffer via pg.image(), since a p5.MediaElement (what createVideo()
 * returns) can be drawn with image() same as any other texture source, no
 * WEBGL side-buffer needed here.
 *
 * Every video element is created up front (loadBackgroundVideos(), called
 * once from setup()) but only the active scene's video is actually
 * playing - enterVideoScene() pauses every other one - so having 9+ of
 * these in rotation doesn't mean 9 videos decoding at once.
 *
 * convergetriangles.mov was ProRes (assets/video/*.mov), which no browser
 * decodes - it's been transcoded to assets/video/convergetriangles.mp4
 * (H.264) and that's the file listed below; the original .mov is left in
 * place untouched. Any new video dropped into assets/video needs to be
 * H.264 (or another browser-supported codec) for the same reason - check
 * with `ffprobe -select_streams v:0 -show_entries stream=codec_name
 * <file>` if a newly-added one doesn't show up.
 *
 * `tile` (default 1) repeats the same looping video into an NxN grid
 * instead of one full-wall cover-fit image - each cell is 1/N the width
 * and height (so tile: 2 -> 4 cells, each 1/4 the area), independently
 * cover-fit within its own cell so per-tile aspect ratio still isn't
 * distorted. All N*N tiles read the same underlying <video> element/
 * decoded frame, so tiling costs extra draw calls, not extra videos
 * decoding.
 */

const VIDEO_FILES = [
  { path: "assets/video/checkers.mp4" },
  { path: "assets/video/convergetriangles.mp4" },
  { path: "assets/video/noisewaves.mp4" },
  { path: "assets/video/ovalspin.mp4" },
  { path: "assets/video/pixels.mp4", tile: 2 },
  { path: "assets/video/rectspin.mp4" },
  { path: "assets/video/sparklediamond.mp4" },
  { path: "assets/video/waves.mp4" },
  { path: "assets/video/wavyvertlines.mp4" },
];

const VIDEO_SCENE_DURATION = 25000; // ms per video scene - same ballpark as the other scenes

let videoElements = []; // one p5.MediaElement per VIDEO_FILES entry, index-aligned

// p5.js 2.0 removed preload() (see js/left/sketch.js's note on this same
// thing for loadFont/loadImage), so this just fires all the createVideo()
// calls from setup() and lets each element populate itself
// asynchronously - drawVideoScene() below guards against reading one
// before its metadata (width/height) has loaded.
function loadBackgroundVideos() {
  videoElements = VIDEO_FILES.map(({ path }) => {
    const v = createVideo(path);
    v.hide(); // createVideo() attaches a real <video> DOM element - we draw it ourselves via pg.image(), so keep the actual element off-screen
    v.volume(0); // muted: autoplay/looping without a user gesture requires it, and the wall has no audio output anyway
    v.pause();
    return v;
  });
}

// Called from each video scene's own init() - see buildVideoScenes().
// Stops every other video so only the one actually on screen is decoding.
function enterVideoScene(index) {
  videoElements.forEach((v, i) => {
    if (i === index) {
      v.time(0);
      v.loop();
    } else {
      v.pause();
    }
  });
}

// CSS object-fit: cover - scale so the video's own aspect ratio fills the
// given box on both axes with no distortion, cropping whichever axis
// overflows, centered within it. pg is exactly WALL_BOUNDS-sized (see
// js/wall.js's displayWall()), so anything this draws past pg's own edges
// is silently clipped by p5 itself - no manual crop/mask needed there.
function drawVideoCover(pg, v, boxX, boxY, boxW, boxH) {
  const scale = Math.max(boxW / v.width, boxH / v.height);
  const w = v.width * scale;
  const h = v.height * scale;
  pg.image(v, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h);
}

function drawVideoScene(pg, index) {
  const v = videoElements[index];
  if (!v || v.width === 0) return; // metadata/first frame not loaded yet

  const tile = VIDEO_FILES[index].tile || 1;
  const cellW = WALL_BOUNDS.w / tile;
  const cellH = WALL_BOUNDS.h / tile;
  for (let row = 0; row < tile; row++) {
    for (let col = 0; col < tile; col++) {
      drawVideoCover(pg, v, col * cellW, row * cellH, cellW, cellH);
    }
  }
}

// One SCENES entry per VIDEO_FILES entry, generated rather than
// hand-written so adding/removing a file there is the only edit needed
// to change what's in rotation.
function buildVideoScenes() {
  return VIDEO_FILES.map(({ path }, i) => ({
    name: `video: ${path.split("/").pop()}`,
    duration: VIDEO_SCENE_DURATION,
    init: () => enterVideoScene(i),
    update: () => {},
    draw: (pg) => drawVideoScene(pg, i),
  }));
}
