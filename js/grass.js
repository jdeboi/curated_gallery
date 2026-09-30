/*
 * "grass" scene - a dense field of grass blades covering the whole wall,
 * swaying in a traveling wind.
 *
 * Rendered entirely in a fragment shader rather than drawn blade by blade:
 * a convincing grass texture needs thousands of blades, and (see
 * js/fronds.js's header) p5 2.0's immediate-mode vertex() is already the
 * frame-rate bottleneck at a few hundred curved shapes. Same shader
 * plumbing as js/fluidFall.js / js/reactionDiffusion.js - a raw
 * createShader() pair on its own WEBGL p5.Graphics, driven via
 * .shader()/.quad(), then image()'d into the wall panel's buffer at
 * WALL_BOUNDS size.
 *
 * The field is stacked rows (GRASS_ROW_SPACING apart, top to bottom of the
 * wall), each row split into narrow cells with one blade rooted per cell at
 * a hashed position/height/lean. Blades are taller than the row spacing, so
 * each row overlaps the rows above it - that overlap is what reads as a
 * continuous texture rather than separate strips. Per pixel, the shader
 * checks only the rows and cells whose blades could reach it, and keeps
 * whichever hit is rooted lowest (i.e. nearest the viewer), which gives
 * correct front-to-back occlusion without sorting anything.
 *
 * A blade bends by an offset that grows with the square of how far up it a
 * point is (stiff base, floppy tip - same cantilever approximation as
 * js/fronds.js). The wind driving that bend is a shared traveling wave
 * sampled at the blade's own root x, so neighboring blades bend together
 * and gusts visibly roll across the wall, plus a slow envelope for gusts.
 *
 * Blades grow up from nothing over GRASS_GROW_MS at scene start, so the
 * scene opens with the lawn sprouting rather than popping in.
 */

const GRASS_BUFFER_SCALE = 1 / 2; // shader resolution vs. WALL_BOUNDS - blades are thin, so higher than fluidFall's 1/3
const GRASS_ROW_SPACING = 42; // logical px between blade rows
const GRASS_CELL_WIDTH = 11; // logical px per blade within a row - smaller = denser
const GRASS_HEIGHT_MIN = 60;
const GRASS_HEIGHT_MAX = 130;
const GRASS_BASE_WIDTH = 2.6; // half-width at the root, logical px
const GRASS_MAX_LEAN = 0.12; // static lean off vertical, as a fraction of blade height
const GRASS_BEND = 0.3; // max wind deflection at the tip, as a fraction of blade height
const GRASS_WIND_SPEED = 1.0;
const GRASS_GROW_MS = 5000;
// Tip and root colors (0-1 RGB). White-on-black to match the other plant
// scenes; roots fade toward black so overlapping rows read with depth.
const GRASS_TIP_COLOR = [1.0, 1.0, 1.0];
const GRASS_ROOT_COLOR = [0.0, 0.0, 0.0];

const GRASS_VERT = `#version 300 es
in vec4 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = aPosition;
}
`;

// Loop bounds must be compile-time constants in GLSL ES, so the row/cell
// search windows are baked in from the JS constants above when the shader
// is built (see grassFragSource()).
function grassFragSource() {
  const maxReach = GRASS_HEIGHT_MAX * (GRASS_MAX_LEAN + GRASS_BEND) + GRASS_BASE_WIDTH;
  const rowSteps = Math.ceil(GRASS_HEIGHT_MAX / GRASS_ROW_SPACING) + 1;
  const cellSteps = 2 * Math.ceil(maxReach / GRASS_CELL_WIDTH) + 1;
  const f = (n) => n.toFixed(4);
  return `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 fragColor;
uniform vec2 uWall;
uniform float uTime;
uniform float uGrow;
uniform float uAA;
uniform vec3 uTip;
uniform vec3 uRoot;

const float ROW = ${f(GRASS_ROW_SPACING)};
const float CELL = ${f(GRASS_CELL_WIDTH)};
const float HMIN = ${f(GRASS_HEIGHT_MIN)};
const float HMAX = ${f(GRASS_HEIGHT_MAX)};
const float BASE_W = ${f(GRASS_BASE_WIDTH)};
const float LEAN = ${f(GRASS_MAX_LEAN)};
const float BEND = ${f(GRASS_BEND)};
const float REACH = ${f(maxReach)};
const int ROW_STEPS = ${rowSteps};
const int CELL_STEPS = ${cellSteps};

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, 7.1)), hash(vec2(i + 1.0, 7.1)), u) * 2.0 - 1.0;
}

// Traveling wind wave, -1..1-ish, sampled at a blade's root x.
float wind(float x) {
  float gust = 0.55 + 0.45 * sin(uTime * 0.21);
  float w = 0.6 * sin(x * 0.005 - uTime * 1.1) + 0.5 * vnoise(x * 0.012 - uTime * 0.7);
  return w * gust + 0.25;
}

void main() {
  vec2 p = vTexCoord * uWall;
  float bestRoot = -1.0;
  vec3 color = vec3(0.0);

  int row0 = int(floor(p.y / ROW));
  int cell0 = int(floor((p.x - REACH) / CELL));
  for (int r = 0; r < ROW_STEPS; r++) {
    float row = float(row0 + r);
    for (int c = 0; c < CELL_STEPS; c++) {
      float cell = float(cell0 + c);
      vec2 id = vec2(cell, row);
      float h1 = hash(id);
      float h2 = hash(id + 17.3);
      float h3 = hash(id + 41.9);

      float root = (row + h2) * ROW;
      if (root < p.y || root <= bestRoot) continue;

      float height = mix(HMIN, HMAX, h1) * uGrow;
      float t = (root - p.y) / max(height, 0.001);
      if (t > 1.0) continue;

      float baseX = (cell + h3) * CELL;
      float lean = (h2 - 0.5) * 2.0 * LEAN * height;
      float sway = wind(baseX) * BEND * height * (0.8 + 0.4 * h1);
      float bladeX = baseX + lean * t + sway * t * t;
      float halfW = BASE_W * (0.7 + 0.6 * h3) * (1.0 - t);
      float dx = abs(p.x - bladeX);
      float cover = 1.0 - smoothstep(halfW - uAA, halfW + uAA, dx);
      if (cover <= 0.0) continue;

      // Midrib highlight across the blade, plus per-blade brightness jitter.
      float rib = 0.75 + 0.25 * clamp(1.0 - dx / max(halfW, 0.001), 0.0, 1.0);
      vec3 col = mix(uRoot, uTip, smoothstep(0.0, 0.75, t)) * rib * (0.7 + 0.3 * h1);
      color = mix(color, col, cover);
      if (cover > 0.5) bestRoot = root;
    }
  }
  fragColor = vec4(color, 1.0);
}`;
}

let grassCanvas, grassShader;
let grassStartMs = 0;

// Same guard-not-a-resize-handler pattern as js/fluidFall.js's
// fluidEnsureBuffers() - WALL_BOUNDS is fixed once setup() runs.
function grassEnsureBuffers() {
  const w = Math.max(1, Math.round(WALL_BOUNDS.w * GRASS_BUFFER_SCALE));
  const h = Math.max(1, Math.round(WALL_BOUNDS.h * GRASS_BUFFER_SCALE));
  if (grassCanvas && grassCanvas.width === w && grassCanvas.height === h) return;

  grassCanvas = createGraphics(w, h, WEBGL);
  grassCanvas.pixelDensity(1);
  grassCanvas.noStroke();
  grassShader = grassCanvas.createShader(GRASS_VERT, grassFragSource());
}

function initGrass() {
  grassEnsureBuffers();
  grassStartMs = millis();
}

function updateGrass() {}

function drawGrass(pg) {
  grassEnsureBuffers();

  const elapsed = millis() - grassStartMs;
  const grow = Math.min(1, elapsed / GRASS_GROW_MS);

  grassCanvas.shader(grassShader);
  grassShader.setUniform("uWall", [WALL_BOUNDS.w, WALL_BOUNDS.h]);
  grassShader.setUniform("uTime", (millis() / 1000) * GRASS_WIND_SPEED);
  // Ease-out so the sprout slows as it reaches full height.
  grassShader.setUniform("uGrow", 1 - Math.pow(1 - grow, 3));
  // One buffer pixel of edge softening, expressed in logical units.
  grassShader.setUniform("uAA", 1 / GRASS_BUFFER_SCALE);
  grassShader.setUniform("uTip", GRASS_TIP_COLOR);
  grassShader.setUniform("uRoot", GRASS_ROOT_COLOR);
  grassCanvas.quad(-1, 1, 1, 1, 1, -1, -1, -1);

  pg.image(grassCanvas, 0, 0, WALL_BOUNDS.w, WALL_BOUNDS.h);
}
