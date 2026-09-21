/*
 * Floating particle system for the grass layer.
 *
 * Particles live in the wall's shared logical drawing space (WALL_BOUNDS,
 * see js/wall.js) - the same space paintings.js expresses painting
 * geometry in - so collision against painting bounds is a same-space
 * check with no extra coordinate conversion. On a multi-panel wall this
 * space spans every panel, so particles drift across the seam between
 * them rather than being confined to one.
 */

const PARTICLE_COUNT = 80;

let particles = [];

class Particle {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = random(WALL_BOUNDS.w);
    this.y = random(WALL_BOUNDS.h);
    this.vx = random(-0.3, 0.3);
    this.vy = random(-0.3, 0.3);
    this.size = random(7, 14);
    this.alpha = random(120, 220);
    this.noiseOffset = random(1000);
    this.pulsePhase = random(TWO_PI);
    this.pulseSpeed = random(0.02, 0.05);
  }

  update(paintingBounds) {
    this.pulsePhase += this.pulseSpeed;
    this.noiseOffset += 0.005;
    this.vx += (noise(this.noiseOffset) - 0.5) * 0.02;
    this.vy += (noise(this.noiseOffset + 500) - 0.5) * 0.02;
    this.vx = constrain(this.vx, -0.6, 0.6);
    this.vy = constrain(this.vy, -0.6, 0.6);

    this.x += this.vx;
    this.y += this.vy;

    resolveCollisions(this, paintingBounds);

    if (this.x < 0) this.x = WALL_BOUNDS.w;
    if (this.x > WALL_BOUNDS.w) this.x = 0;
    if (this.y < 0) this.y = WALL_BOUNDS.h;
    if (this.y > WALL_BOUNDS.h) this.y = 0;
  }

  display(pg) {
    // Soft outer glow plus a brighter core, both breathing in and out
    // with the particle's own phase - reads as a pulsing firefly rather
    // than a flat dot.
    const pulse = (Math.sin(this.pulsePhase) + 1) / 2; // 0..1
    const glowSize = lerp(this.size * 1.8, this.size * 3.2, pulse);
    const glowAlpha = lerp(this.alpha * 0.15, this.alpha * 0.4, pulse);
    const coreSize = lerp(this.size * 0.7, this.size, pulse);
    const coreAlpha = lerp(this.alpha * 0.6, this.alpha, pulse);

    pg.noStroke();
    pg.fill(255, glowAlpha);
    pg.circle(this.x, this.y, glowSize);
    pg.fill(255, coreAlpha);
    pg.circle(this.x, this.y, coreSize);
  }
}

function initParticles() {
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }
}

// First-pass AABB bounce off each painting's bounding box - pushes the
// particle back out through whichever edge it's closest to and reflects
// that axis of velocity. Good enough to look intentional; upgrade to a
// polygon-accurate reflection later with paintings.js's pointInPainting.
function resolveCollisions(p, bounds) {
  for (const b of bounds) {
    if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) {
      const distLeft = p.x - b.x;
      const distRight = b.x + b.w - p.x;
      const distTop = p.y - b.y;
      const distBottom = b.y + b.h - p.y;
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);

      if (minDist === distLeft) {
        p.x = b.x;
        p.vx = -Math.abs(p.vx);
      } else if (minDist === distRight) {
        p.x = b.x + b.w;
        p.vx = Math.abs(p.vx);
      } else if (minDist === distTop) {
        p.y = b.y;
        p.vy = -Math.abs(p.vy);
      } else {
        p.y = b.y + b.h;
        p.vy = Math.abs(p.vy);
      }
    }
  }
}

function updateParticles() {
  const bounds = getPaintingBounds();
  particles.forEach((p) => p.update(bounds));
}

function drawParticles(pg) {
  particles.forEach((p) => p.display(pg));
}
