/*
 * A small flock of boids (Craig Reynolds' classic separate/align/cohere
 * rules), ported from Dan Shiffman's "The Nature of Code" Ch. 6 flocking
 * sketch (https://www.youtube.com/watch?v=IoKfQrlQ7rA). Lives in the wall's
 * shared logical space (WALL_BOUNDS, see js/wall.js) like every other
 * scene, but - unlike snake.js/mycelium.js - doesn't steer around
 * paintings/wing sculptures: birds just fly over them. Plain
 * separate/align/cohere plus a wall-edge turn-back was producing a
 * different failure mode than obstacle collisions - the flock coalescing
 * into small stationary orbiting balls (nearest-neighbor distance and
 * average speed both kept dropping over time, confirmed by sampling the
 * live sim) - which BIRD_MIN_SPEED and wander() below address; see their
 * own comments.
 *
 * Unlike the original Processing sketch's run() order (flock() -> update()
 * -> boundaries(), where boundaries()'s steering computed each frame only
 * lands in vel on the *next* frame's update()), both steering sources are
 * accumulated into accel first and update() applies + resets it once at
 * the end - one steering pass per frame instead of a one-frame-delayed
 * edge response.
 */

const BIRD_COUNT = 90;
const BIRD_MAX_SPEED = 3;
// A floor under how slow a boid's own steering can leave it, applied after
// every other force in update() - see the comment there for why plain
// Reynolds rules need this to avoid collapsing into a static clump.
const BIRD_MIN_SPEED = 1.2;
const BIRD_MAX_FORCE = 0.03; // alignment's own weight
const BIRD_COHESION_FORCE = 0.005; // weaker pull toward the flock's center than alignment's pull toward its heading
const BIRD_SIZE = 6; // triangle half-height unit, see renderBoid()
const BIRD_NEIGHBOR_DIST = 60;
const BIRD_SEP_DIST = 30;
const BIRD_EDGE_MARGIN = 50; // soft-steer back inward within this of a wall edge
const BIRD_EDGE_FORCE = 0.15; // stronger than flocking so an edge always wins

// Flip to false to go back to the plain triangle silhouette (renderBoidTriangle
// below, unchanged) instead of assets/bird_sprite.png - kept side by side
// with the sprite renderer rather than deleted, since which one looks
// better on the actual wall is still an open question.
const BIRD_RENDER_SPRITE = true;
const BIRD_SPRITE_PATH = "assets/bird_sprite.png";
const BIRD_SPRITE_FRAMES = 4; // one wingbeat cycle, laid out left to right in the sheet
const BIRD_SPRITE_FRAME_MS = 90; // time per frame - flap speed
const BIRD_SPRITE_HEIGHT = 40; // drawn height in wall px; width follows the sheet's own per-frame aspect ratio

// p5.js 2.0 removed preload() (see js/left/sketch.js's note on this same
// thing for loadFont/loadImage) - call this from each wall's own setup(),
// same as loadBackgroundVideos(). drawBirds() below falls back to the
// triangle renderer on its own until this resolves, so load order relative
// to initShow()/initBirds() doesn't matter.
let birdSpriteImg = null;

function loadBirdSprite() {
  loadImage(BIRD_SPRITE_PATH, (img) => {
    birdSpriteImg = img;
  });
}

let boids = [];

class Boid {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    const a = random(TWO_PI);
    this.vx = cos(a);
    this.vy = sin(a);
    this.ax = 0;
    this.ay = 0;
    this.wanderNoise = random(1000);
    this.spritePhase = random(1000); // ms offset so birds don't all flap in unison
  }

  steerToward(desiredX, desiredY, maxForce) {
    let dx = desiredX - this.vx;
    let dy = desiredY - this.vy;
    const mag = Math.hypot(dx, dy);
    if (mag > maxForce) {
      dx = (dx / mag) * maxForce;
      dy = (dy / mag) * maxForce;
    }
    this.ax += dx;
    this.ay += dy;
  }

  flock(others) {
    let sepX = 0,
      sepY = 0,
      sepCount = 0,
      sepDistTotal = 0;
    let aliX = 0,
      aliY = 0,
      aliCount = 0;
    let cohX = 0,
      cohY = 0,
      cohCount = 0;

    for (const other of others) {
      if (other === this) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const d = Math.hypot(dx, dy);
      if (d <= 0) continue;

      if (d < BIRD_SEP_DIST) {
        sepX += dx / d;
        sepY += dy / d;
        sepDistTotal += d;
        sepCount++;
      }
      if (d < BIRD_NEIGHBOR_DIST) {
        aliX += other.vx;
        aliY += other.vy;
        aliCount++;
        cohX += other.x;
        cohY += other.y;
        cohCount++;
      }
    }

    // Separation: steer away from the average heading toward nearby
    // flockmates, harder the closer they are on average.
    if (sepCount > 0) {
      sepX /= sepCount;
      sepY /= sepCount;
      const mag = Math.hypot(sepX, sepY);
      if (mag > 0) {
        const avgDist = sepDistTotal / sepCount;
        const force = map(avgDist, 0, BIRD_SEP_DIST, 0.1, 0);
        this.steerToward(
          (sepX / mag) * BIRD_MAX_SPEED,
          (sepY / mag) * BIRD_MAX_SPEED,
          force,
        );
      }
    }

    // Alignment: steer toward the average heading of nearby flockmates.
    if (aliCount > 0) {
      aliX /= aliCount;
      aliY /= aliCount;
      const mag = Math.hypot(aliX, aliY);
      if (mag > 0) {
        const force = map(mag, 0, 5, 0, BIRD_MAX_FORCE);
        this.steerToward(
          (aliX / mag) * BIRD_MAX_SPEED,
          (aliY / mag) * BIRD_MAX_SPEED,
          force,
        );
      }
    }

    // Cohesion: steer toward the average position of nearby flockmates.
    if (cohCount > 0) {
      cohX /= cohCount;
      cohY /= cohCount;
      let dx = cohX - this.x;
      let dy = cohY - this.y;
      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        const force = map(mag, 0, 5, 0, BIRD_COHESION_FORCE);
        this.steerToward(
          (dx / mag) * BIRD_MAX_SPEED,
          (dy / mag) * BIRD_MAX_SPEED,
          force,
        );
      }
    }
  }

  keepInBounds() {
    let desiredX = null;
    let desiredY = null;
    if (this.x < BIRD_EDGE_MARGIN) desiredX = BIRD_MAX_SPEED;
    else if (this.x > WALL_BOUNDS.w - BIRD_EDGE_MARGIN)
      desiredX = -BIRD_MAX_SPEED;
    if (this.y < BIRD_EDGE_MARGIN) desiredY = BIRD_MAX_SPEED;
    else if (this.y > WALL_BOUNDS.h - BIRD_EDGE_MARGIN)
      desiredY = -BIRD_MAX_SPEED;

    if (desiredX !== null || desiredY !== null) {
      this.steerToward(
        desiredX ?? this.vx,
        desiredY ?? this.vy,
        BIRD_EDGE_FORCE,
      );
    }
  }

  // A tiny, smoothly-varying nudge every frame (same per-boid noise-offset
  // trick particles.js uses for its own drift) - without it, once a local
  // group's headings align and its cohesion/separation reach equilibrium,
  // there's nothing left to disturb that balance, so the group just sits
  // and orbits in place rather than continuing to roam. This keeps every
  // boid's heading gently drifting on its own, which is enough to keep
  // settled groups slowly breaking up and re-forming instead of freezing.
  wander() {
    this.wanderNoise += 0.01;
    const angle = noise(this.wanderNoise) * TWO_PI * 2;
    this.ax += cos(angle) * 0.015;
    this.ay += sin(angle) * 0.015;
  }

  update() {
    this.vx += this.ax;
    this.vy += this.ay;
    let speed = Math.hypot(this.vx, this.vy);
    // Without a floor, a settled flock's velocities can damp toward zero
    // (confirmed live: average speed dropped from ~1.2 to ~0.7 over 20s
    // while nearest-neighbor distance kept shrinking) - separation,
    // alignment and cohesion pull a boid in different directions each
    // frame, and near their equilibrium point those pulls partially cancel
    // rather than reinforce, so the group can brake itself to a near-stop
    // and read as a static clump instead of a moving flock.
    if (speed > BIRD_MAX_SPEED) {
      this.vx = (this.vx / speed) * BIRD_MAX_SPEED;
      this.vy = (this.vy / speed) * BIRD_MAX_SPEED;
    } else if (speed > 0 && speed < BIRD_MIN_SPEED) {
      this.vx = (this.vx / speed) * BIRD_MIN_SPEED;
      this.vy = (this.vy / speed) * BIRD_MIN_SPEED;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.ax = 0;
    this.ay = 0;

    // Safety clamp: the steering above turns a boid back inward well
    // before it reaches an edge, but never lets it actually leave
    // WALL_BOUNDS outright the way the soft steer alone could.
    this.x = constrain(this.x, 0, WALL_BOUNDS.w);
    this.y = constrain(this.y, 0, WALL_BOUNDS.h);
  }
}

// Spread across the whole wall (same as particles.js's initParticles()),
// not clustered into a tight ring - at BIRD_COUNT's density a ring's own
// circumference puts neighboring birds well inside BIRD_NEIGHBOR_DIST/
// BIRD_SEP_DIST of each other, so every bird starts already "flocked" with
// just its immediate ring-neighbors, fragmenting into isolated pockets that
// never discover each other. A uniform spread gives most birds no
// neighbors at all at first, so flocks form gradually as they wander into
// range instead of being pre-fragmented at spawn.
function initBirds() {
  boids = [];
  for (let i = 0; i < BIRD_COUNT; i++) {
    boids.push(new Boid(random(WALL_BOUNDS.w), random(WALL_BOUNDS.h)));
  }
}

function updateBirds() {
  boids.forEach((b) => {
    b.flock(boids);
    b.keepInBounds();
    b.wander();
    b.update();
  });
}

// Small kite-shaped silhouette (matches the Processing sketch's render()),
// oriented along the boid's current heading. BIRD_RENDER_SPRITE's fallback,
// and what it reverts to if flipped off.
function renderBoidTriangle(pg, b) {
  const heading = Math.atan2(b.vy, b.vx) + HALF_PI;
  pg.push();
  pg.translate(b.x, b.y);
  pg.rotate(heading);
  pg.beginShape();
  pg.vertex(0, -BIRD_SIZE * 2);
  pg.vertex(-BIRD_SIZE * 1.5, BIRD_SIZE * 1.25);
  pg.vertex(0, 0);
  pg.vertex(BIRD_SIZE * 1.5, BIRD_SIZE * 1.25);
  pg.endShape(CLOSE);
  pg.pop();
}

// assets/bird_sprite.png: BIRD_SPRITE_FRAMES equal-width wingbeat frames
// laid out left to right in one sheet, bird facing +x (rightward) at rest -
// rotating by the boid's own heading (no extra offset, unlike the
// triangle's +HALF_PI) points it the same way it's already drawn facing.
function renderBoidSprite(pg, b) {
  const frameW = birdSpriteImg.width / BIRD_SPRITE_FRAMES;
  const frameH = birdSpriteImg.height;
  const h = BIRD_SPRITE_HEIGHT;
  const w = h * (frameW / frameH);
  const frame =
    Math.floor((millis() + b.spritePhase) / BIRD_SPRITE_FRAME_MS) % BIRD_SPRITE_FRAMES;

  pg.push();
  pg.translate(b.x, b.y);
  pg.rotate(Math.atan2(b.vy, b.vx));
  pg.imageMode(CENTER);
  pg.image(birdSpriteImg, 0, 0, w, h, frame * frameW, 0, frameW, frameH);
  pg.pop();
}

function drawBirds(pg) {
  pg.push();
  if (BIRD_RENDER_SPRITE && birdSpriteImg && birdSpriteImg.width > 0) {
    boids.forEach((b) => renderBoidSprite(pg, b));
  } else {
    pg.noStroke();
    pg.fill(255);
    boids.forEach((b) => renderBoidTriangle(pg, b));
  }
  pg.pop();
}
