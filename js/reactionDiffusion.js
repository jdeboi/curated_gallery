/*
 * Reaction-diffusion scene - the first user of shader-based rendering on
 * the wall panel.
 *
 * Every other scene draws straight into the wall panel's own graphics
 * buffer (see js/wall.js's displayWall() -> panel.map.displaySketch(),
 * and js/scenes.js's drawShow(pg)) with plain 2D p5 calls - that buffer is
 * a plain createGraphics() with no WEBGL flag (see p5.mapper's
 * Surface.createBuffer()), so it has no .shader()/.createShader() support.
 * Shaders need a WEBGL-mode graphics context.
 *
 * So this scene keeps its own offscreen WEBGL p5.Graphics pair sized to
 * WALL_BOUNDS, runs a full GLSL reaction-diffusion feedback loop on those
 * every frame, and blits the result into the wall panel's 2D buffer as a
 * plain image in drawReactionDiffusion() - the same "render to a WEBGL
 * texture, then pg.image() it in" trick is the template for any future
 * shader-based scene, not just this one.
 *
 * The reaction-diffusion technique itself (repeated blur + unsharp-mask,
 * fed back into itself frame over frame) is the classic Photoshop/
 * TouchDesigner trick: https://www.youtube.com/watch?v=CzmRMKQBMSw
 * The mouse-drag interaction that technique is normally seeded with is
 * replaced here with a handful of Perlin-noise "wandering pens"
 * (rdUpdateSeeds()) so the pattern keeps evolving with nobody at the wall.
 *
 * The blur/unsharp GLSL below is a plain-<script> port of Zaron Chen's
 * Shox library (https://github.com/ZaronChen/Shox, MIT), vendored inline
 * instead of imported as an ES module - it's what the sharp black/white
 * maze look actually depends on (a weak hand-rolled blur+sharpen just
 * fades to gray instead of converging), so it's ported exactly rather
 * than approximated: rdBlurGLSL() is Shox's `blur(radius)` weight/offset
 * generator, and RD_UNSHARP_GLSL is Shox's `unsharp` convolution overload,
 * both reproduced verbatim.
 */

const RD_SEED_COUNT = 4;
const RD_SEED_JITTER = 0.006; // noise-space step per frame - lower = slower wander

const RD_VERT = `#version 300 es
in vec4 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = aPosition;
}
`;

// --- Ported from Shox's Image Processing/Blur/blur.js ---
// Generates a separable Gaussian blur GLSL function for a given kernel
// radius using linear-sampling weight/offset pairs (ref:
// rastergrid.com/blog/2010/09/efficient-gaussian-blur-with-linear-sampling),
// so a radius-3 blur only costs 7 texture fetches instead of 7-per-tap.
function rdPascalsTriangleRow(n) {
  if (n === 0) return [1];
  const row = [1];
  const prevRow = rdPascalsTriangleRow(n - 1);
  for (let i = 1; i < n; i++) row[i] = prevRow[i - 1] + (prevRow[i] || 0);
  row.push(1);
  return row;
}

function rdGenerateWeightOffset(size) {
  const n = size * 2 + 3;
  const wei = rdPascalsTriangleRow(n - 1).map(
    (e) => e / (2 ** (n - 1) - n * 2),
  );
  const weight = [];
  const offset = [];
  let f = -size + 1;
  for (let i = 2; i <= size - 1; i += 2) {
    const w = wei[i] + wei[i + 1];
    weight.push(w);
    offset.push((f * wei[i] + (f + 1) * wei[i + 1]) / w);
    f += 2;
  }
  weight.push(wei[size + 1]);
  offset.push(0);
  weight.push(...weight.slice(0, weight.length - 1).reverse());
  offset.push(
    ...offset
      .slice(0, offset.length - 1)
      .reverse()
      .map((e) => -e),
  );
  return { weight, offset };
}

// GLSL float literals can't use JS's exponential notation (e.g. "1e-7"),
// which toString() falls back to for very small magnitudes.
function rdGlslFloat(n) {
  return n.toFixed(12);
}

function rdBlurGLSL(radius) {
  const kernelSize = Math.ceil(Math.max(radius, 1)) * 2 + 1;
  const { weight, offset } = rdGenerateWeightOffset(kernelSize);
  const terms = weight
    .map(
      (w, i) =>
        `color += ${rdGlslFloat(w)}*texture(tex, uv+vec2(${rdGlslFloat(offset[i])})*texelSize);`,
    )
    .join("\n  ");
  return `
vec4 blur(vec2 uv, sampler2D tex, vec2 texelSize, vec2 direction) {
  vec4 color = vec4(0.0);
  texelSize *= direction;
  ${terms}
  return color;
}
`;
}

// --- Ported from Shox's Image Processing/Unsharp/unsharp.js ---
// (the convolution overload: unsharp(uv, img, texelSize, strength))
const RD_UNSHARP_GLSL = `
vec4 unsharp(vec2 uv, sampler2D img, vec2 texelSize, float strength) {
  vec4 color = vec4(0.0);
  float center = -220.0 - strength;

  color +=     1.0*texture(img, uv+vec2(-2.0, -2.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2(-1.0, -2.0)*texelSize);
  color +=     6.0*texture(img, uv+vec2( 0.0, -2.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2( 1.0, -2.0)*texelSize);
  color +=     1.0*texture(img, uv+vec2( 2.0, -2.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2(-2.0, -1.0)*texelSize);
  color +=    16.0*texture(img, uv+vec2(-1.0, -1.0)*texelSize);
  color +=    24.0*texture(img, uv+vec2( 0.0, -1.0)*texelSize);
  color +=    16.0*texture(img, uv+vec2( 1.0, -1.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2( 2.0, -1.0)*texelSize);
  color +=     6.0*texture(img, uv+vec2(-2.0,  0.0)*texelSize);
  color +=    24.0*texture(img, uv+vec2(-1.0,  0.0)*texelSize);
  color += center*texture(img, uv+vec2( 0.0,  0.0)*texelSize);
  color +=    24.0*texture(img, uv+vec2( 1.0,  0.0)*texelSize);
  color +=     6.0*texture(img, uv+vec2( 2.0,  0.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2(-2.0,  1.0)*texelSize);
  color +=    16.0*texture(img, uv+vec2(-1.0,  1.0)*texelSize);
  color +=    24.0*texture(img, uv+vec2( 0.0,  1.0)*texelSize);
  color +=    16.0*texture(img, uv+vec2( 1.0,  1.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2( 2.0,  1.0)*texelSize);
  color +=     1.0*texture(img, uv+vec2(-2.0,  2.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2(-1.0,  2.0)*texelSize);
  color +=     6.0*texture(img, uv+vec2( 0.0,  2.0)*texelSize);
  color +=     4.0*texture(img, uv+vec2( 1.0,  2.0)*texelSize);
  color +=     1.0*texture(img, uv+vec2( 2.0,  2.0)*texelSize);

  return color/(-strength);
}
`;

// Separable directional blur - called three times per frame (horizontal,
// vertical, then a slowly-rotating diagonal pass) the same way the
// reference sketch chains them, which is what keeps the pattern
// organic/swirling instead of settling into an axis-aligned blur.
const RD_BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D tex0;
uniform vec2 texelSize;
uniform vec2 direction;
${rdBlurGLSL(3)}
in vec2 vTexCoord;
out vec4 fragColor;
void main() { fragColor = blur(vTexCoord, tex0, texelSize, direction); }
`;

// Unsharp mask - re-adds the high-frequency detail the blur passes just
// removed, at a strength (64) high enough to drive the pattern toward
// stark black/white rather than a subtle sharpen. Blur-then-sharpen,
// repeated forever with a moving direction, is the entire
// reaction-diffusion trick.
const RD_UNSHARP_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D tex0;
uniform vec2 texelSize;
${RD_UNSHARP_GLSL}
in vec2 vTexCoord;
out vec4 fragColor;
void main() { fragColor = unsharp(vTexCoord, tex0, texelSize*7.0, 64.0); }
`;

let rdCanvas, rdWork; // persistent state + scratch buffer, both WEBGL
let rdBlurShader, rdUnsharpShader;
let rdTexelSize = [0, 0];
let rdSeeds = [];

// WALL_BOUNDS (js/wall.js) is fixed once initWallPanels() runs in setup(),
// so in practice this only ever does real work on its first call - it's a
// guard, not a per-frame resize handler.
function rdEnsureBuffers() {
  const w = Math.max(1, Math.round(WALL_BOUNDS.w));
  const h = Math.max(1, Math.round(WALL_BOUNDS.h));
  if (rdCanvas && rdCanvas.width === w && rdCanvas.height === h) return;

  rdCanvas = createGraphics(w, h, WEBGL);
  rdWork = createGraphics(w, h, WEBGL);
  rdCanvas.pixelDensity(1);
  rdWork.pixelDensity(1);
  rdCanvas.noStroke();
  rdWork.noStroke();
  rdTexelSize = [1 / w, 1 / h];

  rdBlurShader = rdWork.createShader(RD_VERT, RD_BLUR_FRAG);
  rdUnsharpShader = rdWork.createShader(RD_VERT, RD_UNSHARP_FRAG);

  rdSeedCanvas();
}

// Scatters an initial handful of dots to react off of - without this the
// feedback loop starts from flat black and has nothing to blur/sharpen
// into a pattern until the wandering pens (rdUpdateSeeds) happen to drift
// somewhere.
function rdSeedCanvas() {
  rdCanvas.push();
  rdCanvas.background(0);
  rdCanvas.translate(-rdCanvas.width / 2, -rdCanvas.height / 2);
  rdCanvas.fill(255);
  for (let i = 0; i < 250; i++) {
    rdCanvas.circle(
      random(rdCanvas.width),
      random(rdCanvas.height),
      random(2, 6),
    );
  }
  rdCanvas.pop();
}

function rdInitSeeds() {
  rdSeeds = [];
  for (let i = 0; i < RD_SEED_COUNT; i++) {
    rdSeeds.push({
      nx: random(1000),
      ny: random(1000),
      ink: random() < 0.5 ? 255 : 0,
      size: random(4, 10),
    });
  }
}

// Stands in for the mouse-drag interaction the reference sketch is built
// around: each seed just walks its own Perlin-noise path around the
// canvas (in the same WALL_BOUNDS logical space every other scene uses)
// and lays down ink as it goes, so the reaction-diffusion loop always has
// something fresh to chew on instead of converging to a static blur.
function rdUpdateSeeds() {
  const w = rdCanvas.width;
  const h = rdCanvas.height;
  rdCanvas.push();
  rdCanvas.translate(-w / 2, -h / 2);
  rdSeeds.forEach((s) => {
    s.nx += RD_SEED_JITTER;
    s.ny += RD_SEED_JITTER;
    const x = noise(s.nx) * w;
    const y = noise(s.ny) * h;
    rdCanvas.fill(s.ink);
    rdCanvas.circle(x, y, s.size);
  });
  rdCanvas.pop();
}

function rdRunPasses() {
  const t = frameCount * 0.01;
  const diagonalDirection = [Math.sin(t), Math.cos(t)];

  rdWork.shader(rdBlurShader);
  rdBlurShader.setUniform("texelSize", rdTexelSize);
  rdBlurShader.setUniform("tex0", rdCanvas);
  rdBlurShader.setUniform("direction", [1, 0]);
  rdWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  rdWork.shader(rdBlurShader);
  rdBlurShader.setUniform("texelSize", rdTexelSize);
  rdBlurShader.setUniform("tex0", rdWork);
  rdBlurShader.setUniform("direction", [0, 1]);
  rdWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  rdWork.shader(rdBlurShader);
  rdBlurShader.setUniform("texelSize", rdTexelSize);
  rdBlurShader.setUniform("tex0", rdWork);
  rdBlurShader.setUniform("direction", diagonalDirection);
  rdWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  rdWork.shader(rdUnsharpShader);
  rdUnsharpShader.setUniform("texelSize", rdTexelSize);
  rdUnsharpShader.setUniform("tex0", rdWork);
  rdWork.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  // Close the feedback loop: next frame's blur chain reads this frame's
  // sharpened result, same as the reference sketch re-drawing its `gfx`
  // scratch buffer onto its `cnv` canvas at the end of every draw().
  rdCanvas.image(rdWork, -rdCanvas.width / 2, -rdCanvas.height / 2);
}

function initReactionDiffusion() {
  rdEnsureBuffers();
  rdInitSeeds();
}

function updateReactionDiffusion() {
  rdUpdateSeeds();
  rdRunPasses();
}

function drawReactionDiffusion(pg) {
  pg.image(rdCanvas, 0, 0, WALL_BOUNDS.w, WALL_BOUNDS.h);
}
