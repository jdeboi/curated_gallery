/*
 * Sparkle stars: like js/stars.js's grid (same twinkle-in-place-via-noise,
 * same per-cell scaling from a shared grid) but stamping a hand-drawn-style
 * "sparkle" silhouette instead of js/stars.js's flower.png, modeled on a
 * reference sheet of scribbled 4- and 6-point sparkle stars mixed with
 * small dots. Each star also spins continuously (js/stars.js's stars only
 * pick one fixed rotation and hold it - see that file's header).
 *
 * "Organic" here means each star's own point lengths/angles are jittered
 * once at construction and then reused every frame - a plain drawStar()-
 * style alternating-vertex polygon (see js/stars.js), just with irregular
 * spikes instead of a perfectly regular one. That keeps the per-frame cost
 * identical to a regular polygon (same vertex count, same trig calls) -
 * all the "hand-drawn" irregularity is baked into per-instance data instead
 * of being recomputed or driving any extra draw work.
 */

const SPARKLE_GRID_SPACING = 55; // px between grid cell centers, in WALL_BOUNDS space
const SPARKLE_MAX_SIZE = 34; // outer diameter a sparkle reaches at full noise value
const SPARKLE_NOISE_SPEED = 0.012; // per-frame advance through each sparkle's own twinkle noise lane

const SPARKLE_DOT_CHANCE = 0.18; // fraction of grid cells that render as a plain dot instead of a star, matching the reference sheet's scattered small dots
const SPARKLE_FOUR_POINT_CHANCE = 0.6; // of the non-dot cells, how many get the long 4-point "twinkle" shape vs. a 6-point burst

const SPARKLE_ROTATION_SPEED_MIN = 0.003; // radians/frame
const SPARKLE_ROTATION_SPEED_MAX = 0.014;

let sparkleStars = [];

// Builds the fixed, jittered outline for one star: alternating outer
// (spike tip) / inner (valley) vertices around the circle, each with its
// own small random length/angle offset baked in once so the silhouette
// stays irregular ("organic") but never has to be recomputed.
function buildSparkleSpikes(pointCount, innerRatio) {
  const spikes = [];
  const angleStep = TWO_PI / pointCount;
  for (let i = 0; i < pointCount; i++) {
    const outerAngle = i * angleStep + random(-angleStep * 0.12, angleStep * 0.12);
    spikes.push({ angle: outerAngle, radiusFrac: random(0.85, 1.15) });

    const innerAngle = i * angleStep + angleStep / 2 + random(-angleStep * 0.15, angleStep * 0.15);
    spikes.push({ angle: innerAngle, radiusFrac: innerRatio * random(0.75, 1.25) });
  }
  return spikes;
}

class OrganicSparkle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.noiseOffset = random(1000); // gives every sparkle its own uncorrelated twinkle lane
    this.maxSize = SPARKLE_MAX_SIZE * random(0.7, 1); // slight per-star size variety

    this.isDot = random() < SPARKLE_DOT_CHANCE;
    if (!this.isDot) {
      this.rotation = random(TWO_PI);
      this.rotationSpeed =
        random(SPARKLE_ROTATION_SPEED_MIN, SPARKLE_ROTATION_SPEED_MAX) *
        (random() < 0.5 ? -1 : 1);

      const isFourPoint = random() < SPARKLE_FOUR_POINT_CHANCE;
      // Four-point sparkles read as long thin "twinkle" shapes (low inner
      // ratio -> deep valleys); six-point ones are a blunter, bushier burst.
      this.spikes = isFourPoint
        ? buildSparkleSpikes(4, 0.16)
        : buildSparkleSpikes(6, 0.38);
    }
  }

  update() {
    this.noiseOffset += SPARKLE_NOISE_SPEED;
    if (!this.isDot) this.rotation += this.rotationSpeed;
  }

  display(pg) {
    // Same noise-band stretch as js/stars.js: raw noise() mostly sits in
    // 0.3-0.7, so remapping that band out past [0, 1] and clamping lets a
    // sparkle actually reach fully-shrunk/full-size instead of just
    // approaching it.
    const raw = noise(this.noiseOffset);
    const level = constrain(map(raw, 0.35, 0.65, 0, 1), 0, 1);
    const outerRadius = (this.maxSize / 2) * level;
    if (outerRadius < 0.5) return; // fully shrunk - nothing to draw

    if (this.isDot) {
      pg.circle(this.x, this.y, outerRadius * 0.7);
      return;
    }

    pg.push();
    pg.translate(this.x, this.y);
    pg.rotate(this.rotation);
    pg.beginShape();
    this.spikes.forEach((s) => {
      pg.vertex(Math.cos(s.angle) * outerRadius * s.radiusFrac, Math.sin(s.angle) * outerRadius * s.radiusFrac);
    });
    pg.endShape(CLOSE);
    pg.pop();
  }
}

function initSparkleStars() {
  sparkleStars = [];
  const cols = Math.floor(WALL_BOUNDS.w / SPARKLE_GRID_SPACING);
  const rows = Math.floor(WALL_BOUNDS.h / SPARKLE_GRID_SPACING);
  // Centers the whole grid in WALL_BOUNDS instead of pinning it to the
  // top-left corner, so leftover space is split evenly on both edges.
  const offsetX = (WALL_BOUNDS.w - (cols - 1) * SPARKLE_GRID_SPACING) / 2;
  const offsetY = (WALL_BOUNDS.h - (rows - 1) * SPARKLE_GRID_SPACING) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      sparkleStars.push(new OrganicSparkle(offsetX + col * SPARKLE_GRID_SPACING, offsetY + row * SPARKLE_GRID_SPACING));
    }
  }
}

function updateSparkleStars() {
  sparkleStars.forEach((s) => s.update());
}

function drawSparkleStars(pg) {
  pg.background(0);
  pg.noStroke();
  pg.fill(255);
  sparkleStars.forEach((s) => s.display(pg));
}
