/*
 * A small flock of boids (Craig Reynolds' classic separate/align/cohere
 * rules), ported from Dan Shiffman's "The Nature of Code" Ch. 6 flocking
 * sketch (https://www.youtube.com/watch?v=IoKfQrlQ7rA). Lives in the wall's
 * shared logical space (WALL_BOUNDS, see js/wall.js) like every other
 * scene, but - unlike vines.js/mycelium.js - doesn't steer around
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

// nightBirds' painting boxes are small enough, and their whole point is
// visible confinement, that BIRD_EDGE_FORCE's gentle wall-edge nudge reads
// as birds loitering right at (or briefly clamped past) a painting's
// silhouette rather than staying inside it. Confined boids (this.bounds
// set, see initNightBirds) get a harder, penetration-scaled push instead -
// see keepInBounds().
const BIRD_EDGE_FORCE_CONFINED = 0.6;
const BIRD_EDGE_MARGIN_FRAC_CONFINED = 0.35; // fraction of the painting's own w/h

// "nightBirds" (see js/scenes.js) confines the flock to inside each
// painting's own bounds instead of letting it roam the whole wall - one
// small sub-flock per painting, sized by that painting's area so the
// biggest paintings read as more alive than the smallest ones.
const NIGHTBIRDS_MIN_PER_PAINTING = 2;
const NIGHTBIRDS_MAX_PER_PAINTING = 10;

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
      // nightBirds gives every boid a paintingIndex (see initNightBirds) so
      // each painting's handful of birds flocks only among itself, rather
      // than birds in one painting reacting to birds confined to another.
      if (
        this.paintingIndex !== undefined &&
        other.paintingIndex !== this.paintingIndex
      )
        continue;
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
    // this.bounds (set by initNightBirds) confines this boid to one
    // painting's box instead of the whole wall - margin shrinks to fit
    // paintings smaller than a normal BIRD_EDGE_MARGIN would allow.
    const confined = !!this.bounds;
    const b = this.bounds || { x: 0, y: 0, w: WALL_BOUNDS.w, h: WALL_BOUNDS.h };
    const margin = confined
      ? Math.min(b.w, b.h) * BIRD_EDGE_MARGIN_FRAC_CONFINED
      : BIRD_EDGE_MARGIN;

    let desiredX = null;
    let desiredY = null;
    let penetration = 0; // how far past the margin the worst axis is, 0..margin
    if (this.x < b.x + margin) {
      desiredX = BIRD_MAX_SPEED;
      penetration = Math.max(penetration, b.x + margin - this.x);
    } else if (this.x > b.x + b.w - margin) {
      desiredX = -BIRD_MAX_SPEED;
      penetration = Math.max(penetration, this.x - (b.x + b.w - margin));
    }
    if (this.y < b.y + margin) {
      desiredY = BIRD_MAX_SPEED;
      penetration = Math.max(penetration, b.y + margin - this.y);
    } else if (this.y > b.y + b.h - margin) {
      desiredY = -BIRD_MAX_SPEED;
      penetration = Math.max(penetration, this.y - (b.y + b.h - margin));
    }

    if (desiredX !== null || desiredY !== null) {
      // Confined boids ramp from BIRD_EDGE_FORCE_CONFINED up to 3x that as
      // they push deeper past the margin, instead of one flat force a
      // determined flocking pull could keep matching all the way to the
      // hard clamp in update().
      const force = confined
        ? map(penetration, 0, margin, BIRD_EDGE_FORCE_CONFINED, BIRD_EDGE_FORCE_CONFINED * 3, true)
        : BIRD_EDGE_FORCE;
      this.steerToward(desiredX ?? this.vx, desiredY ?? this.vy, force);
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
    // before it reaches an edge, but never lets it actually leave its
    // bounds (WALL_BOUNDS, or one painting's box under nightBirds - see
    // keepInBounds()) outright the way the soft steer alone could.
    const b = this.bounds || { x: 0, y: 0, w: WALL_BOUNDS.w, h: WALL_BOUNDS.h };
    this.x = constrain(this.x, b.x, b.x + b.w);
    this.y = constrain(this.y, b.y, b.y + b.h);
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

// nightBirds' own init (js/scenes.js) - one small flock per painting,
// confined to that painting's axis-aligned box (getPaintingBounds(), js/
// paintings.js) rather than spread across the whole wall. Bird count per
// painting scales linearly with that painting's area between the two
// NIGHTBIRDS_*_PER_PAINTING constants, so the smallest painting on the wall
// gets the minimum and the largest gets the maximum.
function initNightBirds() {
  boids = [];
  const bounds = getPaintingBounds();
  if (bounds.length === 0) return;

  const areas = bounds.map((b) => b.w * b.h);
  const minArea = Math.min(...areas);
  const maxArea = Math.max(...areas);

  bounds.forEach((b, i) => {
    const t = maxArea > minArea ? (areas[i] - minArea) / (maxArea - minArea) : 1;
    const count = Math.round(
      lerp(NIGHTBIRDS_MIN_PER_PAINTING, NIGHTBIRDS_MAX_PER_PAINTING, t),
    );
    for (let j = 0; j < count; j++) {
      const boid = new Boid(b.x + random(b.w), b.y + random(b.h));
      boid.bounds = b;
      boid.paintingIndex = i;
      boids.push(boid);
    }
  });
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
