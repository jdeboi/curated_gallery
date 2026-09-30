/*
 * Jasmine grid: the same regular, centered grid as js/stars.js's flower
 * stamps, but using the assets/jasmine/ sprites (one picked at random per
 * cell) and sized by a radial pulse instead of per-cell noise - rings of
 * swelling blossoms ripple outward from the wall's center, so every
 * flower's size depends only on its distance from the center and the
 * current pulse phase. Each flower keeps its own fixed random rotation;
 * only size animates.
 */

const JASMINE_GRID_SPACING = 50; // px between grid cell centers, in WALL_BOUNDS space
const JASMINE_MAX_SIZE = 46; // tallest a flower gets at the crest of a pulse ring
const JASMINE_MIN_LEVEL = 0.15; // size fraction in the troughs between rings (0 = vanish)
const JASMINE_WAVELENGTH = 320; // px between consecutive pulse rings
const JASMINE_PULSE_SPEED = 0.035; // radians/frame the rings advance outward
const JASMINE_SPRITE_PATHS = ["assets/jasmine/0.png", "assets/jasmine/1.png", "assets/jasmine/2.png"];

// p5.js 2.0 removed preload() (see js/birds.js's loadBirdSprite() for the
// same pattern) - call this once from each wall's own setup().
let jasmineImgs = [];

function loadJasmineSprites() {
  jasmineImgs = [];
  JASMINE_SPRITE_PATHS.forEach((path, i) => {
    loadImage(path, (img) => {
      jasmineImgs[i] = img;
    });
  });
}

let jasmineFlowers = [];
let jasminePhase = 0;
let jasmineCenter = { x: 0, y: 0 };

class JasmineFlower {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.spriteIndex = Math.floor(random(JASMINE_SPRITE_PATHS.length));
    this.rotation = random(TWO_PI); // fixed per flower - only size animates, not spin
    this.maxSize = JASMINE_MAX_SIZE * random(0.85, 1); // slight per-flower size variety
    // Distance from the center is fixed per flower, so its position in the
    // wave is precomputed once rather than a sqrt every frame.
    this.wavePhase = (dist(x, y, jasmineCenter.x, jasmineCenter.y) / JASMINE_WAVELENGTH) * TWO_PI;
  }

  display(pg) {
    const img = jasmineImgs[this.spriteIndex];
    if (!img || img.width === 0) return; // sprite still loading

    // Subtracting the growing global phase from each flower's distance
    // phase makes the crests travel outward from the center over time.
    const wave = 0.5 + 0.5 * Math.cos(this.wavePhase - jasminePhase);
    const level = JASMINE_MIN_LEVEL + (1 - JASMINE_MIN_LEVEL) * wave * wave; // squared = sharper, narrower crests
    const h = this.maxSize * level;
    if (h < 0.5) return;
    const w = h * (img.width / img.height); // keep the sprite's own aspect ratio

    pg.push();
    pg.translate(this.x, this.y);
    pg.rotate(this.rotation);
    pg.imageMode(CENTER);
    pg.image(img, 0, 0, w, h);
    pg.pop();
  }
}

function initJasmine() {
  jasmineFlowers = [];
  jasminePhase = 0;
  jasmineCenter = { x: WALL_BOUNDS.w / 2, y: WALL_BOUNDS.h / 2 };
  const cols = Math.floor(WALL_BOUNDS.w / JASMINE_GRID_SPACING);
  const rows = Math.floor(WALL_BOUNDS.h / JASMINE_GRID_SPACING);
  // Centers the whole grid in WALL_BOUNDS instead of pinning it to the
  // top-left corner, so leftover space is split evenly on both edges.
  const offsetX = (WALL_BOUNDS.w - (cols - 1) * JASMINE_GRID_SPACING) / 2;
  const offsetY = (WALL_BOUNDS.h - (rows - 1) * JASMINE_GRID_SPACING) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      jasmineFlowers.push(new JasmineFlower(offsetX + col * JASMINE_GRID_SPACING, offsetY + row * JASMINE_GRID_SPACING));
    }
  }
}

function updateJasmine() {
  jasminePhase += JASMINE_PULSE_SPEED;
}

function drawJasmine(pg) {
  pg.background(0);
  jasmineFlowers.forEach((f) => f.display(pg));
}
