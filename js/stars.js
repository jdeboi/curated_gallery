/*
 * Sparkling star grid - a generative stand-in for video.js's
 * sparklediamond.mp4: a regular grid of shapes on a black background that
 * twinkle by growing/shrinking in place (each one staying centered on its
 * own grid cell as it scales) via smooth per-shape Perlin noise, not by
 * moving or by a hard on/off blink. Same idea, star silhouette instead of
 * a diamond, drawn straight into the wall panel's own pg buffer like
 * particles.js/vines.js do rather than needing a WEBGL side-buffer.
 *
 * STAR_RENDER_FLOWER (currently true, "for now" per request) swaps the
 * drawn star polygon for assets/flower.png instead - same grid/noise/size
 * logic, just a different per-cell stamp, each at its own fixed random
 * rotation. Kept side by side with the polygon renderer (same toggle
 * pattern as BIRD_RENDER_SPRITE in js/birds.js) so flipping back to plain
 * stars, or trying another swapped-in image later, is a one-line change -
 * drawStar() also still doubles as the fallback until flower.png loads.
 */

const STAR_GRID_SPACING = 50; // px between grid cell centers, in WALL_BOUNDS space
const STAR_MAX_SIZE = 40; // outer diameter a star reaches at full noise value
const STAR_INNER_RATIO = 0.45; // inner/outer radius ratio - higher = blunter points
const STAR_NOISE_SPEED = 0.012; // per-frame advance through each star's own noise lane

const STAR_RENDER_FLOWER = true;
const STAR_FLOWER_SPRITE_PATH = "assets/flower.png";

// p5.js 2.0 removed preload() (see js/birds.js's loadBirdSprite() for the
// same pattern) - call this once from each wall's own setup().
let starFlowerImg = null;

function loadStarFlowerSprite() {
  loadImage(STAR_FLOWER_SPRITE_PATH, (img) => {
    starFlowerImg = img;
  });
}

let stars = [];

class SparkleStar {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.noiseOffset = random(1000); // gives every star its own uncorrelated noise lane
    this.rotation = random(TWO_PI); // fixed per star - only size animates, not spin
    this.maxSize = STAR_MAX_SIZE * random(0.7, 1); // slight per-star size variety
  }

  update() {
    this.noiseOffset += STAR_NOISE_SPEED;
  }

  display(pg) {
    // Raw noise() sits mostly in the 0.3-0.7 band, which would keep every
    // star a mid-size blob and never let one twinkle all the way down to
    // nothing or up to full size - stretching that narrower band out past
    // [0, 1] and clamping means the low/high tails of that band actually
    // clip to fully-shrunk/full-size instead of just approaching it.
    const raw = noise(this.noiseOffset);
    const level = constrain(map(raw, 0.35, 0.65, 0, 1), 0, 1);
    const outerRadius = (this.maxSize / 2) * level;
    if (outerRadius < 0.5) return; // fully shrunk - nothing to draw

    if (STAR_RENDER_FLOWER && starFlowerImg && starFlowerImg.width > 0) {
      drawFlower(pg, this.x, this.y, outerRadius * 2, this.rotation);
    } else {
      drawStar(pg, this.x, this.y, outerRadius, outerRadius * STAR_INNER_RATIO, this.rotation);
    }
  }
}

// assets/flower.png drawn centered on (x, y) at `size` (diameter) square,
// rotated by the star's own fixed per-instance rotation.
function drawFlower(pg, x, y, size, rotation) {
  pg.push();
  pg.translate(x, y);
  pg.rotate(rotation);
  pg.imageMode(CENTER);
  pg.image(starFlowerImg, 0, 0, size, size);
  pg.pop();
}

// Five-pointed star centered on (x, y), alternating outer/inner vertices
// around the circle so it scales from its own center rather than a corner.
function drawStar(pg, x, y, outerRadius, innerRadius, rotation = 0) {
  const points = 5;
  const angleStep = TWO_PI / points;
  pg.beginShape();
  for (let i = 0; i < points; i++) {
    const outerAngle = rotation + i * angleStep;
    pg.vertex(x + Math.cos(outerAngle) * outerRadius, y + Math.sin(outerAngle) * outerRadius);
    const innerAngle = outerAngle + angleStep / 2;
    pg.vertex(x + Math.cos(innerAngle) * innerRadius, y + Math.sin(innerAngle) * innerRadius);
  }
  pg.endShape(CLOSE);
}

function initStars() {
  stars = [];
  const cols = Math.floor(WALL_BOUNDS.w / STAR_GRID_SPACING);
  const rows = Math.floor(WALL_BOUNDS.h / STAR_GRID_SPACING);
  // Centers the whole grid in WALL_BOUNDS instead of pinning it to the
  // top-left corner, so leftover space is split evenly on both edges.
  const offsetX = (WALL_BOUNDS.w - (cols - 1) * STAR_GRID_SPACING) / 2;
  const offsetY = (WALL_BOUNDS.h - (rows - 1) * STAR_GRID_SPACING) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      stars.push(new SparkleStar(offsetX + col * STAR_GRID_SPACING, offsetY + row * STAR_GRID_SPACING));
    }
  }
}

function updateStars() {
  stars.forEach((s) => s.update());
}

function drawStars(pg) {
  pg.background(0);
  pg.noStroke();
  pg.fill(255);
  stars.forEach((s) => s.display(pg));
}
