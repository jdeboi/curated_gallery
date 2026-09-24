/*
 * A small swarm of butterflies - unlike js/birds.js's boids, these don't
 * flock (no separate/align/cohere pulling them toward each other): each
 * butterfly just wanders independently, steered back inward near a wall
 * edge, with a min-speed floor so it never stalls. Drawn from a 4-frame
 * wingbeat sheet (assets/butterfly_sprite.png) the same way js/birds.js
 * animates assets/bird_sprite.png, plus a per-butterfly random size.
 */

const BUTTERFLY_COUNT = 20;
const BUTTERFLY_MAX_SPEED = 3;
const BUTTERFLY_MIN_SPEED = 1.2;
const BUTTERFLY_EDGE_MARGIN = 50; // soft-steer back inward within this of a wall edge
const BUTTERFLY_EDGE_FORCE = 0.15; // stronger than wander so an edge always wins

const BUTTERFLY_SPRITE_PATH = "assets/butterfly_sprite.png";
const BUTTERFLY_SPRITE_FRAMES = 4; // one wingbeat cycle, laid out left to right in the sheet
const BUTTERFLY_SPRITE_FRAME_MS = 120; // time per frame - flap speed (slower than birds.js's 90ms)
const BUTTERFLY_MAX_SIZE = 80; // the biggest butterfly's width, in wall px
const BUTTERFLY_MIN_SIZE_SCALE = 0.4; // smallest butterfly is this fraction of BUTTERFLY_MAX_SIZE

// p5.js 2.0 removed preload() (see js/left/sketch.js's note on this same
// thing for loadFont/loadImage) - call this from each wall's own setup(),
// same as loadBirdSprite(). drawButterflies() below skips drawing until
// this resolves, so load order relative to initShow()/initButterflies()
// doesn't matter.
let butterflySpriteImg = null;

function loadButterflySprite() {
  loadImage(BUTTERFLY_SPRITE_PATH, (img) => {
    butterflySpriteImg = img;
  });
}

let butterflies = [];

class Butterfly {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    const a = random(TWO_PI);
    this.vx = cos(a);
    this.vy = sin(a);
    this.ax = 0;
    this.ay = 0;
    this.wanderNoise = random(1000);
    // 1 = BUTTERFLY_MAX_SIZE (the biggest one, per BUTTERFLY_MAX_SIZE's own
    // doc comment); everyone else scales down from there.
    this.sizeScale = random(BUTTERFLY_MIN_SIZE_SCALE, 1);
    this.spritePhase = random(1000); // ms offset so butterflies don't all flap in unison
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

  keepInBounds() {
    let desiredX = null;
    let desiredY = null;
    if (this.x < BUTTERFLY_EDGE_MARGIN) desiredX = BUTTERFLY_MAX_SPEED;
    else if (this.x > WALL_BOUNDS.w - BUTTERFLY_EDGE_MARGIN)
      desiredX = -BUTTERFLY_MAX_SPEED;
    if (this.y < BUTTERFLY_EDGE_MARGIN) desiredY = BUTTERFLY_MAX_SPEED;
    else if (this.y > WALL_BOUNDS.h - BUTTERFLY_EDGE_MARGIN)
      desiredY = -BUTTERFLY_MAX_SPEED;

    if (desiredX !== null || desiredY !== null) {
      this.steerToward(
        desiredX ?? this.vx,
        desiredY ?? this.vy,
        BUTTERFLY_EDGE_FORCE,
      );
    }
  }

  // Same per-boid noise-drift trick as js/birds.js's wander() - a smoothly
  // varying nudge every frame is this butterfly's only steering (besides
  // keepInBounds()) now that there's no flocking pulling it toward others,
  // so this alone is what keeps it roaming instead of drifting straight.
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
    if (speed > BUTTERFLY_MAX_SPEED) {
      this.vx = (this.vx / speed) * BUTTERFLY_MAX_SPEED;
      this.vy = (this.vy / speed) * BUTTERFLY_MAX_SPEED;
    } else if (speed > 0 && speed < BUTTERFLY_MIN_SPEED) {
      this.vx = (this.vx / speed) * BUTTERFLY_MIN_SPEED;
      this.vy = (this.vy / speed) * BUTTERFLY_MIN_SPEED;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.ax = 0;
    this.ay = 0;

    // Safety clamp - see js/birds.js's own update() for why the soft edge
    // steer above isn't relied on alone to keep it on the wall.
    this.x = constrain(this.x, 0, WALL_BOUNDS.w);
    this.y = constrain(this.y, 0, WALL_BOUNDS.h);
  }
}

// Spread across the whole wall, not clustered - see js/birds.js's
// initBirds() for why a tight starting cluster fragments the flock instead
// of letting it form gradually.
function initButterflies() {
  butterflies = [];
  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    butterflies.push(new Butterfly(random(WALL_BOUNDS.w), random(WALL_BOUNDS.h)));
  }
}

function updateButterflies() {
  butterflies.forEach((b) => {
    b.keepInBounds();
    b.wander();
    b.update();
  });
}

// assets/butterfly_sprite.png: BUTTERFLY_SPRITE_FRAMES equal-width wingbeat
// frames laid out left to right in one sheet.
//
// Unlike birds.js's sheet (a full wingbeat cycle that already loops
// smoothly frame N-1 back to frame 0), this sheet is only half a flap -
// looping it forward-only jump-cuts from the last frame straight back to
// the first. Playing it forward then backward (a ping-pong/triangle wave
// over 2*(FRAMES-1) steps: 0,1,2,3,2,1,0,1,...) turns it back into a
// smooth up-down flap with no visible skip.
function butterflySpriteFrame(b) {
  const period = 2 * (BUTTERFLY_SPRITE_FRAMES - 1);
  const t =
    Math.floor((millis() + b.spritePhase) / BUTTERFLY_SPRITE_FRAME_MS) %
    period;
  return t < BUTTERFLY_SPRITE_FRAMES ? t : period - t;
}

function renderButterfly(pg, b) {
  const frameW = butterflySpriteImg.width / BUTTERFLY_SPRITE_FRAMES;
  const frameH = butterflySpriteImg.height;
  const w = BUTTERFLY_MAX_SIZE * b.sizeScale;
  const h = w * (frameH / frameW);
  const frame = butterflySpriteFrame(b);
  // Stay upright rather than rotating to face the heading (unlike birds.js's
  // sprite, which does rotate) - just mirror horizontally when moving
  // leftward so it still reads as facing its direction of travel.
  const faceLeft = b.vx < 0;

  pg.push();
  pg.translate(b.x, b.y);
  pg.scale(faceLeft ? -1 : 1, 1);
  pg.imageMode(CENTER);
  pg.image(butterflySpriteImg, 0, 0, w, h, frame * frameW, 0, frameW, frameH);
  pg.pop();
}

function drawButterflies(pg) {
  if (!butterflySpriteImg || butterflySpriteImg.width === 0) return;
  pg.push();
  butterflies.forEach((b) => renderButterfly(pg, b));
  pg.pop();
}
