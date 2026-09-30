/*
 * "fluidFall" scene - drops raining from the ceiling, bouncing off the
 * paintings and wing sculptures, rendered as a merging white fluid
 * instead of individual circles.
 *
 * The look is a metaball trick ported from a sibling project
 * (netart/netscapes' "splishsplash" central-coast piece, same author):
 * draw plain circles into a low-res buffer, run a separable Gaussian
 * blur over it (bleeding each circle's edge into its neighbors'), then
 * threshold the blurred result back to a few flat tones - circles close
 * enough together blur into one shared blob instead of staying visibly
 * separate discs. The source piece drew black circles on a blue-tinted
 * background; here that's flipped (white fluid on black) to match this
 * wall's own always-black-background convention.
 *
 * The source piece (p5@1.10.0) ran that blur/threshold via
 * createFilterShader()+.filter(shader) on a plain 2D buffer. Under this
 * wall's p5@2.0.5, that API's hidden WebGL compositor caches its *input*
 * texture from the first .filter() call and never refreshes it - proven
 * with a standalone repro (moving the source circle off-buffer and
 * re-filtering still returned the exact same output) rather than assumed off a
 * changelog - so every later frame just re-blurs one frozen snapshot from
 * scene start, and the drops never visibly move once blurred/thresholded.
 * This uses js/reactionDiffusion.js's shader plumbing instead (this wall's
 * other shader-based scene): a raw createShader() pair on their own WEBGL
 * p5.Graphics, driven by hand via .shader()/.quad() rather than the
 * higher-level filter() API - already proven working every frame in this
 * codebase, and sidesteps that caching bug entirely since there's no
 * hidden compositor layer involved.
 *
 * Physics is a hand-rolled gravity + AABB-bounce sim rather than the
 * source piece's matter-js rigid-body engine - there's no real contact
 * needed here, just "fall, bounce off whatever's in the way, keep
 * falling," so it reuses the exact same nearest-edge bounce approach
 * js/particles.js already runs against getPaintingBounds()/
 * getOutlineBounds() rather than pulling in a physics library for it.
 */

// Density (count x radius) has to be high enough that neighboring drops'
// blurred footprints actually overlap in the low-res buffer - spread thin
// across the wall's full width, individual drops just blur down below
// FLUID_THRESHOLD_FRAG's low end and vanish instead of merging into a
// visible blob (the source piece gets away with far fewer, smaller circles
// only because it confines them to one narrow falling column instead of
// spreading them across an entire wall's width).
const FLUID_DROP_COUNT = 420;
const FLUID_RADIUS = 16; // logical-space units - bigger than particles.js's particle size on purpose, see above
const FLUID_GRAVITY = 0.07;
const FLUID_RESTITUTION = 0.4; // energy kept per bounce - <1 so drops settle/flow instead of bouncing forever
const FLUID_MAX_VY = 8;
const FLUID_BUFFER_SCALE = 1 / 3; // higher than the source piece's own 1/5 - less blocky once scaled back up to wall size

// Passthrough vertex shader for the full-screen quad() passes below -
// verbatim structure of js/reactionDiffusion.js's RD_VERT (own copy so
// this file doesn't reach into another scene's internals).
const FLUID_VERT = `#version 300 es
in vec4 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = aPosition;
}
`;

// Separable Gaussian blur - a plain-GLSL port of splishsplash's fragSrc1,
// just in the #version 300 es dialect (in/out, texture() rather than
// varying/texture2D) to match FLUID_VERT/js/reactionDiffusion.js's shaders.
const FLUID_BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D tex0;
in vec2 vTexCoord;
uniform vec2 texelSize;
uniform float kernelSize;
uniform vec2 direction;
out vec4 fragColor;
const int MAX_KERNEL_SIZE = 100;
void main() {
  vec2 pos = vTexCoord;
  vec4 accumColor = vec4(0.0);
  float accumWeight = 0.0;
  for (int i = 0; i < MAX_KERNEL_SIZE; i++) {
    if (i >= int(kernelSize)) break;
    float offset = -0.5 * (kernelSize - 1.0) + float(i);
    float weight = exp( -(offset * offset) / (kernelSize * kernelSize) );
    accumColor += weight * texture(tex0, pos + direction * offset * texelSize);
    accumWeight += weight;
  }
  fragColor = accumColor / accumWeight;
}`;

// Thresholds the blurred buffer down to a fluid silhouette - splishsplash's
// fragSrc2 did this as four flat, hard-edged bands (a look that reads as
// blocky/pixelated once a low-res buffer gets scaled back up to full wall
// size), and with the polarity flipped besides (there, low brightness -
// deep inside overlapping circles - was solid black fluid on a white
// background; drops are drawn white on black here, so overlapping drops
// blur toward *high* brightness instead). smoothstep() replaces the
// hard cutoffs with one continuous ramp - still black background to white
// core, just anti-aliased at the transition instead of stair-stepped, which
// is what actually reads as a smooth fluid edge rather than a pixelated one.
const FLUID_THRESHOLD_FRAG = `#version 300 es
precision highp float;
uniform sampler2D tex0;
in vec2 vTexCoord;
out vec4 fragColor;
void main() {
  vec4 color = texture(tex0, vTexCoord);
  float v = smoothstep(0.35, 0.75, color.r);
  fragColor = vec4(v, v, v, 1.0);
}`;

let fluidDrops = [];
// fluidCanvas holds this frame's plain circles; fluidWork is the scratch
// buffer the blur/threshold passes read from and write back into - same
// two-buffer split as js/reactionDiffusion.js's rdCanvas/rdWork, just
// without that scene's own feedback loop (this one redraws fluidCanvas
// from scratch every frame instead of accumulating into it).
let fluidCanvas, fluidWork, fluidBlurShader, fluidThresholdShader;
let fluidTexelSize = [0, 0];

// WALL_BOUNDS (js/wall.js) is fixed once initWallPanels() runs in setup(),
// so in practice this only ever does real work on its first call - same
// guard-not-a-resize-handler pattern as js/reactionDiffusion.js's
// rdEnsureBuffers().
function fluidEnsureBuffers() {
  const w = Math.max(1, Math.round(WALL_BOUNDS.w * FLUID_BUFFER_SCALE));
  const h = Math.max(1, Math.round(WALL_BOUNDS.h * FLUID_BUFFER_SCALE));
  if (fluidCanvas && fluidCanvas.width === w && fluidCanvas.height === h) return;

  fluidCanvas = createGraphics(w, h, WEBGL);
  fluidWork = createGraphics(w, h, WEBGL);
  fluidCanvas.pixelDensity(1);
  fluidWork.pixelDensity(1);
  fluidCanvas.noStroke();
  fluidWork.noStroke();
  fluidTexelSize = [1 / w, 1 / h];

  fluidBlurShader = fluidWork.createShader(FLUID_VERT, FLUID_BLUR_FRAG);
  fluidThresholdShader = fluidWork.createShader(FLUID_VERT, FLUID_THRESHOLD_FRAG);
}

class FluidDrop {
  constructor() {
    this.reset(true);
  }

  // `stagger` spreads drops out above the ceiling on first init so the
  // scene doesn't open with one dense sheet all falling in lockstep -
  // recycled drops (stagger=false) restart just above the top instead, so
  // the "keeps raining" restart reads the same as the fall settling into
  // its own rhythm rather than another burst appearing from way off-screen.
  // Capped at a few hundred logical units above the ceiling either way
  // (not the full wall height) so gravity brings even the highest-staggered
  // drops into view within a second or two of the scene starting, instead
  // of the first frames reading as an empty wall while they're still well
  // off the top of the buffer.
  reset(stagger) {
    this.x = random(WALL_BOUNDS.w);
    this.y = stagger ? random(-300, 0) : random(-200, 0);
    this.vx = random(-0.3, 0.3);
    this.vy = random(0, 1);
  }

  update(bounds) {
    this.vy = Math.min(this.vy + FLUID_GRAVITY, FLUID_MAX_VY);
    this.x += this.vx;
    this.y += this.vy;

    resolveFluidCollisions(this, bounds);

    if (this.x < 0) {
      this.x = 0;
      this.vx = Math.abs(this.vx) * FLUID_RESTITUTION;
    } else if (this.x > WALL_BOUNDS.w) {
      this.x = WALL_BOUNDS.w;
      this.vx = -Math.abs(this.vx) * FLUID_RESTITUTION;
    }

    if (this.y - FLUID_RADIUS > WALL_BOUNDS.h) this.reset(false);
  }

  show(g, scale) {
    g.ellipse(this.x * scale, this.y * scale, FLUID_RADIUS * 2 * scale);
  }
}

// Same nearest-edge AABB push-out as js/particles.js's resolveCollisions,
// plus restitution (a bounce loses energy instead of mirroring speed
// forever) and a little random horizontal spread on a top-of-shape hit, so
// a drop landing on a painting/wing sculpture visibly splashes sideways off
// it rather than bouncing straight back up like a ball.
function resolveFluidCollisions(p, bounds) {
  for (const b of bounds) {
    if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) {
      const distLeft = p.x - b.x;
      const distRight = b.x + b.w - p.x;
      const distTop = p.y - b.y;
      const distBottom = b.y + b.h - p.y;
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);

      if (minDist === distTop) {
        p.y = b.y;
        p.vy = -Math.abs(p.vy) * FLUID_RESTITUTION;
        p.vx += random(-0.6, 0.6);
      } else if (minDist === distBottom) {
        p.y = b.y + b.h;
        p.vy = Math.abs(p.vy) * FLUID_RESTITUTION;
      } else if (minDist === distLeft) {
        p.x = b.x;
        p.vx = -Math.abs(p.vx) * FLUID_RESTITUTION;
      } else {
        p.x = b.x + b.w;
        p.vx = Math.abs(p.vx) * FLUID_RESTITUTION;
      }
    }
  }
}

function initFluidFall() {
  fluidEnsureBuffers();
  fluidDrops = [];
  for (let i = 0; i < FLUID_DROP_COUNT; i++) fluidDrops.push(new FluidDrop());
}

function updateFluidFall() {
  const bounds = getPaintingBounds().concat(getOutlineBounds());
  fluidDrops.forEach((d) => d.update(bounds));
}

function drawFluidFall(pg) {
  fluidEnsureBuffers();

  const scale = fluidCanvas.width / WALL_BOUNDS.w;
  fluidCanvas.push();
  fluidCanvas.clear();
  fluidCanvas.background(0);
  fluidCanvas.translate(-fluidCanvas.width / 2, -fluidCanvas.height / 2);
  fluidCanvas.fill(255);
  fluidDrops.forEach((d) => d.show(fluidCanvas, scale));
  fluidCanvas.pop();

  fluidWork.shader(fluidBlurShader);
  fluidBlurShader.setUniform("texelSize", fluidTexelSize);
  fluidBlurShader.setUniform("kernelSize", 10);
  fluidBlurShader.setUniform("tex0", fluidCanvas);
  fluidBlurShader.setUniform("direction", [1, 0]);
  fluidWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  fluidBlurShader.setUniform("tex0", fluidWork);
  fluidBlurShader.setUniform("direction", [0, 1]);
  fluidWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  fluidWork.shader(fluidThresholdShader);
  fluidThresholdShader.setUniform("tex0", fluidWork);
  fluidWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  pg.image(fluidWork, 0, 0, WALL_BOUNDS.w, WALL_BOUNDS.h);
}
