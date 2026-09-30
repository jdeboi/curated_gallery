/*
 * Spotlight: two big spotlights on black - each a solid inner disc inside a
 * semi-transparent outer halo, two concentric circles - zig-zagging across
 * the wall. Each travels on a fixed diagonal and reflects off the WALL_BOUNDS
 * edges (sharp corners, no easing), so its path reads as a zig-zag rather
 * than a wander. The lights also bounce off each other the same way (see
 * separateSpotlights()) so they don't drift into a clump.
 *
 * Rendered by a fragment shader into one low-res WEBGL buffer, same raw
 * createShader()/quad() plumbing as js/fluidFall.js (see its header for why
 * not filter()). Each pixel works out its own brightness from every light and
 * trail sample analytically, with smoothstep edges, so the disc -> halo ->
 * black steps are soft ramps rather than hard circle edges. Drawing those as
 * dozens of huge alpha-blended canvas shapes per panel per frame was what
 * made the scene drop frames; the shader runs once per frame
 * (spotlightRenderedFrame) and each panel just copies the result.
 *
 * The trail is a short history of past positions, drawn as faint halo-only
 * ghosts that fade with age, rather than a persistent faded buffer - each
 * wall panel draws into its own pg (see js/wall.js's displayWall()), with the
 * paintings painted into that same pg afterwards, so there's no shared canvas
 * that could carry a trail frame to frame.
 *
 * Paintings and wing sculptures light up where a spotlight hits them (the
 * "spotlight" light mode - see spotlightLitFraction() below).
 */

const SPOTLIGHT_COUNT = 2;
const SPOTLIGHT_INNER_RADIUS = 0.17; // fraction of WALL_BOUNDS.h
const SPOTLIGHT_OUTER_RADIUS = 0.3; // fraction of WALL_BOUNDS.h
const SPOTLIGHT_OUTER_ALPHA = 0.35; // 0-1, the semi-transparent halo
const SPOTLIGHT_EDGE_SOFTNESS = 0.12; // fraction of the outer radius each soft edge ramps over
const SPOTLIGHT_SPEED = 3; // px/frame along the diagonal
const SPOTLIGHT_ANGLE = 0.5; // radians off horizontal - steeper = tighter zig-zag
const SPOTLIGHT_SEPARATION = 0.6; // fraction of WALL_BOUNDS.h - centers closer than this bounce apart

const SPOTLIGHT_TRAIL_EVERY = 6; // frames between trail samples
const SPOTLIGHT_TRAIL_LENGTH = 30; // samples kept per light (~3s at 60fps)
const SPOTLIGHT_TRAIL_ALPHA = 0.05; // newest ghost's alpha, fading to 0 at the oldest

const SPOTLIGHT_BUFFER_SCALE = 1 / 3; // all soft edges, so low-res scales up cleanly
// Upper bounds baked into the shader's uniform arrays.
const SPOTLIGHT_MAX_LIGHTS = 4;
const SPOTLIGHT_MAX_GHOSTS = 128;

const SPOTLIGHT_VERT = `#version 300 es
in vec4 aPosition;
void main() {
  gl_Position = aPosition;
}
`;

// White-over-black "over" compositing of every shape reduces to
// 1 - product(1 - alpha_i), so draw order doesn't matter here.
const SPOTLIGHT_FRAG = `#version 300 es
precision highp float;
uniform vec2 resolution; // buffer px
uniform vec2 wallSize; // WALL_BOUNDS px
uniform float innerR;
uniform float outerR;
uniform float soft; // edge ramp width, wall px
uniform float haloAlpha;
uniform int lightCount;
uniform vec2 lights[${SPOTLIGHT_MAX_LIGHTS}];
uniform int ghostCount;
uniform vec3 ghosts[${SPOTLIGHT_MAX_GHOSTS}]; // x, y, alpha
out vec4 fragColor;
void main() {
  // gl_FragCoord is bottom-up; wall space is top-down.
  vec2 p = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution * wallSize;
  float dark = 1.0;
  for (int i = 0; i < ${SPOTLIGHT_MAX_GHOSTS}; i++) {
    if (i >= ghostCount) break;
    float d = distance(p, ghosts[i].xy);
    dark *= 1.0 - ghosts[i].z * (1.0 - smoothstep(outerR - soft, outerR, d));
  }
  for (int i = 0; i < ${SPOTLIGHT_MAX_LIGHTS}; i++) {
    if (i >= lightCount) break;
    float d = distance(p, lights[i]);
    float core = 1.0 - smoothstep(innerR - soft * 0.5, innerR + soft * 0.5, d);
    float edge = 1.0 - smoothstep(outerR - soft, outerR, d);
    dark *= 1.0 - mix(haloAlpha, 1.0, core) * edge;
  }
  fragColor = vec4(vec3(1.0 - dark), 1.0);
}
`;

let spotlights = [];
let spotlightFrame = 0;
let spotlightBuffer = null;
let spotlightShader = null;
let spotlightRenderedFrame = -1;

// WALL_BOUNDS is fixed after setup(), so this only does real work once -
// same guard pattern as js/fluidFall.js's fluidEnsureBuffers().
function spotlightEnsureBuffer() {
  const w = Math.max(1, Math.round(WALL_BOUNDS.w * SPOTLIGHT_BUFFER_SCALE));
  const h = Math.max(1, Math.round(WALL_BOUNDS.h * SPOTLIGHT_BUFFER_SCALE));
  if (spotlightBuffer && spotlightBuffer.width === w && spotlightBuffer.height === h) return;
  spotlightBuffer = createGraphics(w, h, WEBGL);
  spotlightBuffer.pixelDensity(1);
  spotlightBuffer.noStroke();
  spotlightShader = spotlightBuffer.createShader(SPOTLIGHT_VERT, SPOTLIGHT_FRAG);
}

function initSpotlight() {
  spotlightEnsureBuffer();
  spotlights = [];
  for (let i = 0; i < SPOTLIGHT_COUNT; i++) {
    const heading = SPOTLIGHT_ANGLE * (random() < 0.5 ? -1 : 1) + (random() < 0.5 ? 0 : PI);
    spotlights.push({
      // Each starts in its own vertical slice of the wall so they don't
      // begin stacked on top of each other.
      x: ((i + random(0.2, 0.8)) / SPOTLIGHT_COUNT) * WALL_BOUNDS.w,
      y: random(WALL_BOUNDS.h),
      vx: Math.cos(heading) * SPOTLIGHT_SPEED,
      vy: Math.sin(heading) * SPOTLIGHT_SPEED,
      trail: [],
    });
  }
  spotlightFrame = 0;
  spotlightRenderedFrame = -1;
}

function updateSpotlight() {
  const sample = spotlightFrame++ % SPOTLIGHT_TRAIL_EVERY === 0;
  for (const s of spotlights) {
    s.x += s.vx;
    s.y += s.vy;

    // Reflect the center off the wall edges, so each light is always at
    // least half on the wall.
    if (s.x < 0 || s.x > WALL_BOUNDS.w) {
      s.vx = -s.vx;
      s.x = constrain(s.x, 0, WALL_BOUNDS.w);
    }
    if (s.y < 0 || s.y > WALL_BOUNDS.h) {
      s.vy = -s.vy;
      s.y = constrain(s.y, 0, WALL_BOUNDS.h);
    }

    if (sample) {
      s.trail.push({ x: s.x, y: s.y });
      if (s.trail.length > SPOTLIGHT_TRAIL_LENGTH) s.trail.shift();
    }
  }
  separateSpotlights();
}

// Any two lights closer than SPOTLIGHT_SEPARATION turn to head directly away
// from each other on both axes - same sharp, speed-preserving flip as a wall
// bounce, so the zig-zag angle never changes.
function separateSpotlights() {
  const minDist = SPOTLIGHT_SEPARATION * WALL_BOUNDS.h;
  for (let i = 0; i < spotlights.length; i++) {
    for (let j = i + 1; j < spotlights.length; j++) {
      const a = spotlights[i];
      const b = spotlights[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy >= minDist * minDist) continue;
      const sx = dx >= 0 ? 1 : -1;
      const sy = dy >= 0 ? 1 : -1;
      a.vx = sx * Math.abs(a.vx);
      b.vx = -sx * Math.abs(b.vx);
      a.vy = sy * Math.abs(a.vy);
      b.vy = -sy * Math.abs(b.vy);
    }
  }
}

function renderSpotlightBuffer() {
  const lights = spotlights.slice(0, SPOTLIGHT_MAX_LIGHTS);
  const ghosts = [];
  for (const s of lights) {
    const n = s.trail.length;
    s.trail.forEach((p, i) => ghosts.push(p.x, p.y, SPOTLIGHT_TRAIL_ALPHA * ((i + 1) / n)));
  }
  const ghostData = ghosts.slice(0, SPOTLIGHT_MAX_GHOSTS * 3);
  const lightData = lights.flatMap((s) => [s.x, s.y]);

  const outer = SPOTLIGHT_OUTER_RADIUS * WALL_BOUNDS.h;
  spotlightBuffer.shader(spotlightShader);
  spotlightShader.setUniform("resolution", [spotlightBuffer.width, spotlightBuffer.height]);
  spotlightShader.setUniform("wallSize", [WALL_BOUNDS.w, WALL_BOUNDS.h]);
  spotlightShader.setUniform("innerR", SPOTLIGHT_INNER_RADIUS * WALL_BOUNDS.h);
  spotlightShader.setUniform("outerR", outer);
  spotlightShader.setUniform("soft", SPOTLIGHT_EDGE_SOFTNESS * outer);
  spotlightShader.setUniform("haloAlpha", SPOTLIGHT_OUTER_ALPHA);
  spotlightShader.setUniform("lightCount", lights.length);
  spotlightShader.setUniform("lights", lightData);
  spotlightShader.setUniform("ghostCount", ghostData.length / 3);
  spotlightShader.setUniform("ghosts", ghostData);
  spotlightBuffer.quad(-1, 1, 1, 1, 1, -1, -1, -1);
}

function drawSpotlight(pg) {
  spotlightEnsureBuffer();
  // drawShow() runs once per wall panel; only the first one each frame
  // needs to re-render.
  if (spotlightRenderedFrame !== frameCount) {
    renderSpotlightBuffer();
    spotlightRenderedFrame = frameCount;
  }
  pg.image(spotlightBuffer, 0, 0, WALL_BOUNDS.w, WALL_BOUNDS.h);
}

// "spotlight" painting/wing-sculpture light mode (js/paintings.js,
// js/outlines.js): a shape is fully lit while any light's solid disc touches
// it, easing off to dark as the halo's outer edge leaves it. Distance is to
// the shape itself (distanceToPolygon() in js/dotField.js), so a big painting
// lights as soon as a light reaches its edge.
function spotlightLitFraction(poly) {
  if (spotlights.length === 0) return 0;
  const inner = SPOTLIGHT_INNER_RADIUS * WALL_BOUNDS.h;
  const outer = SPOTLIGHT_OUTER_RADIUS * WALL_BOUNDS.h;
  const d = Math.min(...spotlights.map((s) => distanceToPolygon(s.x, s.y, poly)));
  const t = constrain((d - inner) / (outer - inner), 0, 1);
  return 1 - t * t * (3 - 2 * t); // smoothstep, inverted - hit = lit
}
