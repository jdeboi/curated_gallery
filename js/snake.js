/*
 * A handful of lines that wind around the wall's shared logical space,
 * steering around paintings and wing sculptures like an obstacle course.
 *
 * Reuses the exact bounce-off-edges / fan-out-to-dodge approach
 * js/mycelium.js uses for its branches (myceliumBlocked/myceliumNextPoint),
 * but for a fixed small set of endless heads instead of a forking network -
 * each snake's trail is capped at SNAKE_TRAIL_LENGTH points and old points
 * drop off the tail as new ones are pushed at the head, so every snake
 * always reads as the same length winding through the space rather than
 * mycelium's branches, which grow once to maxLength and then stop. Snakes
 * don't avoid each other, only paintings/wing sculptures - same as
 * mycelium's branches, which don't avoid other branches either.
 */

const SNAKE_COUNT = 5;
const SNAKE_STEP = 2.4;
const SNAKE_TRAIL_LENGTH = 160; // points kept behind each head
const SNAKE_THICKNESS = 14;
const SNAKE_OBSTACLE_SCALE = 1.15; // inflate painting polygons when steering, same as mycelium
const SNAKE_TURN_WANDER = 0.12;

let snakes = [];

function snakeObstacles() {
  return getPaintingPolygons()
    .concat(getOutlinePolygons())
    .map((poly) => {
      const c = polygonCentroid(poly);
      return poly.map((p) => ({
        x: c.x + (p.x - c.x) * SNAKE_OBSTACLE_SCALE,
        y: c.y + (p.y - c.y) * SNAKE_OBSTACLE_SCALE,
      }));
    });
}

function snakeNextPoint(p, angle) {
  return {
    x: p.x + Math.cos(angle) * SNAKE_STEP,
    y: p.y + Math.sin(angle) * SNAKE_STEP,
  };
}

function snakeInBounds(p) {
  return (
    p.x >= 6 && p.x <= WALL_BOUNDS.w - 6 && p.y >= 6 && p.y <= WALL_BOUNDS.h - 6
  );
}

function snakeBlocked(p, obstacles) {
  for (const poly of obstacles) {
    if (pointInPolygon(p.x, p.y, poly)) return true;
  }
  return false;
}

// A spawn point picked without checking obstacles can land inside a
// painting - and since drawPaintings() draws on top of the snake scene
// every frame (see js/wall.js's displayWall()), a snake stuck there isn't
// just motionless, it's invisible: fully hidden under the painting's own
// opaque fill, with every escape attempt in stepSnake() blocked on all
// sides forever. Retrying random points until one lands clear avoids that
// trap entirely, same as mycelium.js sidesteps it structurally by only
// ever spawning roots along the wall's outer edge.
function snakeSpawnPoint(obstacles) {
  for (let i = 0; i < 50; i++) {
    const p = {
      x: random(20, WALL_BOUNDS.w - 20),
      y: random(20, WALL_BOUNDS.h - 20),
    };
    if (!snakeBlocked(p, obstacles)) return p;
  }
  return { x: 10, y: 10 }; // paintings covering the whole wall - last resort
}

function makeSnake(obstacles) {
  const { x, y } = snakeSpawnPoint(obstacles);
  const head = { x, y, angle: random(TWO_PI) };
  return { head, trail: [{ x, y }] };
}

function initSnake() {
  const obstacles = snakeObstacles();
  snakes = [];
  for (let i = 0; i < SNAKE_COUNT; i++) snakes.push(makeSnake(obstacles));
}

function stepSnake(snake, obstacles) {
  const { head } = snake;
  let angle = head.angle + random(-SNAKE_TURN_WANDER, SNAKE_TURN_WANDER);
  let next = snakeNextPoint(head, angle);

  // Bounce back inward off the wall edges instead of running off it.
  if (next.x < 6 || next.x > WALL_BOUNDS.w - 6) {
    angle = PI - angle;
    next = snakeNextPoint(head, angle);
  }
  if (next.y < 6 || next.y > WALL_BOUNDS.h - 6) {
    angle = -angle;
    next = snakeNextPoint(head, angle);
  }

  // A painting's in the way - fan outward from the current heading to find
  // the nearest clear angle around it, same search mycelium's step() uses.
  if (snakeBlocked(next, obstacles)) {
    let found = false;
    for (let da = 0.15; da <= PI && !found; da += 0.15) {
      for (const sign of [1, -1]) {
        const testAngle = angle + sign * da;
        const testPoint = snakeNextPoint(head, testAngle);
        if (snakeInBounds(testPoint) && !snakeBlocked(testPoint, obstacles)) {
          angle = testAngle;
          next = testPoint;
          found = true;
          break;
        }
      }
    }
    // Boxed in on all sides (shouldn't happen on a real wall layout) - just
    // hold position this frame rather than punching through a painting.
    if (!found) return;
  }

  head.angle = angle;
  head.x = next.x;
  head.y = next.y;

  snake.trail.push({ x: next.x, y: next.y });
  if (snake.trail.length > SNAKE_TRAIL_LENGTH) snake.trail.shift();
}

function updateSnake() {
  const obstacles = snakeObstacles();
  snakes.forEach((snake) => stepSnake(snake, obstacles));
}

// Stamps overlapping circles along the trail rather than building one
// filled ribbon polygon (the approach myceliumRibbonSides/drawMyceliumBranch
// use in js/mycelium.js). A mycelium branch's outline offset holds up
// because each branch grows in a fairly gentle arc, but a snake's own
// obstacle-dodge search (see stepSnake's fan-out above) can turn it sharply
// enough that consecutive trail points fold back on each other - a single
// ribbon polygon there self-intersects, and WebGL's tessellator renders a
// self-crossing contour as a sparse wireframe instead of solid fill.
// Circles can't self-intersect no matter how tightly the path curls, so
// this stays solid regardless. SNAKE_STEP is well under SNAKE_THICKNESS so
// consecutive stamps overlap into one continuous line.
function drawSnakeBody(pg, snake) {
  const { trail, head } = snake;
  if (trail.length < 2) return;

  const n = trail.length;
  for (let i = 0; i < n; i++) {
    const p = trail[i];
    // Taper the tail end so it reads as a moving worm with a trailing
    // point, not a rod of uniform width.
    const t = n > 1 ? i / (n - 1) : 1;
    const d = SNAKE_THICKNESS * Math.min(1, t * 3 + 0.15);
    pg.circle(p.x, p.y, d);
  }

  // Head: a slightly larger circle so the direction of travel reads clearly.
  pg.circle(head.x, head.y, SNAKE_THICKNESS * 1.15);
}

function drawSnake(pg) {
  pg.push();
  pg.noStroke();
  pg.fill(255);
  snakes.forEach((snake) => drawSnakeBody(pg, snake));
  pg.pop();
}
