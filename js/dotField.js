/*
 * Dot field: a regular grid of jasmine flowers (js/jasmine.js's sprites, one
 * picked at random per cell, each slowly spinning at its own speed) on black that
 * swell and shrink in place (never moving off their own grid cell), driven by
 * a few invisible "attractor" balls gliding around the wall. Each flower's size comes from its
 * distance to the *nearest* ball - right on top of a ball it's at
 * DOTFIELD_MAX_SIZE, beyond DOTFIELD_FAR it's at DOTFIELD_MIN_SIZE, clamped
 * on both ends - so the balls read as soft travelling swells in the grid
 * without ever being drawn themselves.
 *
 * Ball motion is a constant-speed glide whose heading is steered by each
 * ball's own Perlin noise lane (smooth, but not predictable), reflecting off
 * the WALL_BOUNDS edges so they never leave the wall.
 */

const DOTFIELD_GRID_SPACING = 50; // px between grid cell centers, in WALL_BOUNDS space
const DOTFIELD_MIN_SIZE = 6; // flower height far from every ball
const DOTFIELD_MAX_SIZE = 48; // flower height directly under a ball
const DOTFIELD_NEAR = 30; // distance at/below which a flower is full size
const DOTFIELD_FAR = 340; // distance at/above which a flower is min size

const DOTFIELD_SPIN_SPEED_MIN = 0.002; // radians/frame
const DOTFIELD_SPIN_SPEED_MAX = 0.008;

const DOTFIELD_BALL_COUNT = 3;
const DOTFIELD_BALL_SPEED = 1.6; // px/frame
const DOTFIELD_TURN_NOISE_SPEED = 0.004; // per-frame advance through each ball's heading noise lane

let dotFieldDots = [];
let dotFieldBalls = [];

class DotFieldBall {
  constructor() {
    this.x = random(WALL_BOUNDS.w);
    this.y = random(WALL_BOUNDS.h);
    this.noiseOffset = random(1000);
    this.heading = random(TWO_PI);
  }

  update() {
    this.noiseOffset += DOTFIELD_TURN_NOISE_SPEED;
    // noise() hovers around 0.5, so centering it gives a turn rate that
    // drifts smoothly between gentle left and right curves.
    this.heading += (noise(this.noiseOffset) - 0.5) * 0.08;

    this.x += Math.cos(this.heading) * DOTFIELD_BALL_SPEED;
    this.y += Math.sin(this.heading) * DOTFIELD_BALL_SPEED;

    // Reflect off the wall edges so the ball stays on the wall.
    if (this.x < 0 || this.x > WALL_BOUNDS.w) {
      this.heading = PI - this.heading;
      this.x = constrain(this.x, 0, WALL_BOUNDS.w);
    }
    if (this.y < 0 || this.y > WALL_BOUNDS.h) {
      this.heading = -this.heading;
      this.y = constrain(this.y, 0, WALL_BOUNDS.h);
    }
  }
}

function initDotField() {
  dotFieldDots = [];
  const cols = Math.floor(WALL_BOUNDS.w / DOTFIELD_GRID_SPACING);
  const rows = Math.floor(WALL_BOUNDS.h / DOTFIELD_GRID_SPACING);
  // Centered in WALL_BOUNDS, same as js/sparkleStars.js's grid.
  const offsetX = (WALL_BOUNDS.w - (cols - 1) * DOTFIELD_GRID_SPACING) / 2;
  const offsetY = (WALL_BOUNDS.h - (rows - 1) * DOTFIELD_GRID_SPACING) / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      dotFieldDots.push({
        x: offsetX + col * DOTFIELD_GRID_SPACING,
        y: offsetY + row * DOTFIELD_GRID_SPACING,
        spriteIndex: Math.floor(random(JASMINE_SPRITE_PATHS.length)),
        rotation: random(TWO_PI),
        // Each flower spins slowly at its own speed and direction.
        spinSpeed: random(DOTFIELD_SPIN_SPEED_MIN, DOTFIELD_SPIN_SPEED_MAX) * (random() < 0.5 ? -1 : 1),
      });
    }
  }

  dotFieldBalls = [];
  for (let i = 0; i < DOTFIELD_BALL_COUNT; i++) dotFieldBalls.push(new DotFieldBall());
}

function updateDotField() {
  dotFieldBalls.forEach((b) => b.update());
  dotFieldDots.forEach((d) => (d.rotation += d.spinSpeed));
}

function drawDotField(pg) {
  pg.background(0);
  pg.imageMode(CENTER);
  const nearSq = DOTFIELD_NEAR * DOTFIELD_NEAR;
  const farSq = DOTFIELD_FAR * DOTFIELD_FAR;
  for (const d of dotFieldDots) {
    // Squared distances until the one sqrt we actually need.
    let minSq = Infinity;
    for (const b of dotFieldBalls) {
      const dx = d.x - b.x;
      const dy = d.y - b.y;
      const sq = dx * dx + dy * dy;
      if (sq < minSq) minSq = sq;
    }
    let size = DOTFIELD_MIN_SIZE;
    if (minSq <= nearSq) {
      size = DOTFIELD_MAX_SIZE;
    } else if (minSq < farSq) {
      const t = (Math.sqrt(minSq) - DOTFIELD_NEAR) / (DOTFIELD_FAR - DOTFIELD_NEAR);
      const eased = t * t * (3 - 2 * t); // smoothstep - softer shoulders at both caps
      size = DOTFIELD_MAX_SIZE + (DOTFIELD_MIN_SIZE - DOTFIELD_MAX_SIZE) * eased;
    }
    const img = jasmineImgs[d.spriteIndex];
    if (!img || img.width === 0) continue; // sprite still loading (js/jasmine.js's loadJasmineSprites())
    pg.push();
    pg.translate(d.x, d.y);
    pg.rotate(d.rotation);
    pg.image(img, 0, 0, size * (img.width / img.height), size); // keep the sprite's own aspect ratio
    pg.pop();
  }
}

// "dotField" painting/wing-sculpture light mode (js/paintings.js,
// js/outlines.js): each shape crossfades off->filled by its distance to the
// nearest hidden ball, same capped-both-ends falloff as the flowers. Distance is
// measured to the shape itself (0 when a ball is inside it), not to its
// centroid, so a big painting lights as soon as a ball reaches its edge.
// Its own NEAR/FAR since shapes are much bigger than grid cells.
const DOTFIELD_LIGHT_NEAR = 0;
const DOTFIELD_LIGHT_FAR = 350;

function distanceToPolygon(x, y, poly) {
  if (pointInPolygon(x, y, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;
    const t = constrain(((x - a.x) * dx + (y - a.y) * dy) / lenSq, 0, 1);
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best;
}

function dotFieldLitFraction(poly) {
  if (dotFieldBalls.length === 0) return 0;
  const d = Math.min(...dotFieldBalls.map((b) => distanceToPolygon(b.x, b.y, poly)));
  const t = constrain((d - DOTFIELD_LIGHT_NEAR) / (DOTFIELD_LIGHT_FAR - DOTFIELD_LIGHT_NEAR), 0, 1);
  return 1 - t * t * (3 - 2 * t); // smoothstep, inverted - near = lit
}
