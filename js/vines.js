/*
 * Vines: a handful of stems that crawl around the wall (bounce-off-edges /
 * fan-out-to-dodge steering around paintings and wing sculptures, the same
 * approach js/mycelium.js uses for its branches), sprouting leaves along
 * their trail as they go. initVines() spaces every vine's starting point at
 * least VINE_MIN_SPAWN_SPACING apart (vineSpawnPoint()), so a modest
 * VINE_COUNT still spreads across the whole wall instead of leaving it to
 * chance where random draws happen to cluster.
 *
 * Each vine grows from a single point up to VINE_TRAIL_LENGTH points, then
 * respawns fresh (respawnVine()) rather than dropping its oldest point to
 * keep crawling forever as a fixed-length sliding window - that sliding
 * window (push a new point, shift the oldest one off) is what used to make
 * every trail point's array index drift by one on every commit, which in
 * turn made leaf placement (originally keyed to array index) visibly hop
 * along the vine each time. Respawning avoids that whole class of bug
 * instead of patching around it: trail[0] is always that vine's true first
 * point for its entire life, so a point's index never changes under it.
 * Every vine shares the same cap and all start from a single point
 * together, so they grow and respawn in lockstep, all at once - tried
 * staggering that (randomized per-vine cap, fast-forwarded starting
 * length) and it read as jolty, so back to the simpler synchronized
 * version.
 *
 * A leaf's size depends only on how far it sits behind the head (see
 * vineLeafLength()) - freshly grown trail near the head starts with tiny
 * leaves that ramp up to full size within VINE_LEAF_GROW_POINTS points,
 * so new growth reads as young/small and everything further back reads as
 * mature, the same way a real vine's newest tendril tip is thin new growth
 * behind a more established stem.
 *
 * The scene's `pg` is actually a plain 2D canvas buffer, not WebGL (p5.mapper
 * renders each QuadMap's sketch into a 2D createGraphics() buffer, then
 * textures that onto a WebGL mesh separately - see ~/Projects/p5/p5.mapper's
 * Surface.displaySketch()). Canvas 2D still pays a real per-call cost for
 * every separate fill()/stroke(), so every leaf across every vine is batched
 * into one beginShape(TRIANGLES)/endShape() pair, and every vine's stem into
 * one beginShape(LINES)/endShape() pair (each LINES vertex *pair* draws as
 * its own disjoint segment, which is what lets many vines' stems share one
 * call) - two draw calls total per frame regardless of VINE_COUNT, instead
 * of one shape call per leaf plus one per vine's stem.
 */

// Fewer vines than before - vineSpawnPoint() below now spaces starting
// points apart deliberately (VINE_MIN_SPAWN_SPACING), so fewer of them
// still cover the wall well instead of clustering by chance the way pure
// random placement could.
const VINE_COUNT = 14;
const VINE_MIN_SPAWN_SPACING = 130; // minimum distance apart for two vines' starting points
// Bigger step + shorter trail keeps roughly the same on-wall vine length
// (70 * 6 =~ 260 * 1.6) with a quarter of the original trail points -
// draw cost scales with trail length (benchmarked: ~15x more expensive to
// draw a vine at 140 points than at 1), so this caps the plateau a fully-
// grown vine's draw cost settles at, not just how fast it ramps up there.
const VINE_STEP = 6;
const VINE_TURN_WANDER = 0.08;
const VINE_OBSTACLE_SCALE = 1.15; // inflate painting polygons when steering, same as mycelium
const VINE_TRAIL_LENGTH = 240; // points a vine grows to before it respawns elsewhere
const VINE_STEM_WEIGHT = 2.2;

const VINE_LEAF_SPACING = 3; // trail points between one leaf and the next
const VINE_LEAF_MIN_LEN = 3; // freshly grown, right behind the head
const VINE_LEAF_MAX_LEN = 15; // fully grown, further back along the trail
const VINE_LEAF_GROW_POINTS = 14; // trail points behind the head it takes a leaf to reach full size
const VINE_LEAF_HALF_WIDTH_FRAC = 0.22; // leaf half-width as a fraction of its length

let vines = [];

function vineObstacles() {
  return getPaintingPolygons()
    .concat(getOutlinePolygons())
    .map((poly) => {
      const c = polygonCentroid(poly);
      return poly.map((p) => ({
        x: c.x + (p.x - c.x) * VINE_OBSTACLE_SCALE,
        y: c.y + (p.y - c.y) * VINE_OBSTACLE_SCALE,
      }));
    });
}

function vineNextPoint(p, angle) {
  return {
    x: p.x + Math.cos(angle) * VINE_STEP,
    y: p.y + Math.sin(angle) * VINE_STEP,
  };
}

function vineInBounds(p) {
  return (
    p.x >= 6 && p.x <= WALL_BOUNDS.w - 6 && p.y >= 6 && p.y <= WALL_BOUNDS.h - 6
  );
}

function vineBlocked(p, obstacles) {
  for (const poly of obstacles) {
    if (pointInPolygon(p.x, p.y, poly)) return true;
  }
  return false;
}

// A spawn point inside a painting would be invisible and stuck - paintings
// draw on top every frame, and every dodge direction from stepVine() would
// also be blocked. Also rejects anything closer than VINE_MIN_SPAWN_SPACING
// to an already-placed vine's start, so a handful of vines still spreads
// out across the whole wall instead of clustering wherever the random
// draws happen to land.
function vineSpawnPoint(obstacles, existingStarts) {
  for (let i = 0; i < 50; i++) {
    const p = {
      x: random(20, WALL_BOUNDS.w - 20),
      y: random(20, WALL_BOUNDS.h - 20),
    };
    if (vineBlocked(p, obstacles)) continue;
    const tooClose = existingStarts.some(
      (s) =>
        (p.x - s.x) ** 2 + (p.y - s.y) ** 2 <
        VINE_MIN_SPAWN_SPACING * VINE_MIN_SPAWN_SPACING,
    );
    if (!tooClose) return p;
  }
  // Couldn't find a spaced-out spot in budget (e.g. a small/crowded wall) -
  // fall back to any unblocked point rather than force a collision.
  for (let i = 0; i < 50; i++) {
    const p = {
      x: random(20, WALL_BOUNDS.w - 20),
      y: random(20, WALL_BOUNDS.h - 20),
    };
    if (!vineBlocked(p, obstacles)) return p;
  }
  return { x: 10, y: 10 }; // paintings covering the whole wall - last resort
}

function makeVine(obstacles, existingStarts) {
  const { x, y } = vineSpawnPoint(obstacles, existingStarts);
  existingStarts.push({ x, y });
  return { head: { x, y, angle: random(TWO_PI) }, trail: [{ x, y }] };
}

// Resets a vine back to a single fresh point elsewhere on the wall - see
// this file's header note on why growing to a cap and restarting replaced
// the original fixed-length sliding-trail approach.
function respawnVine(vine, obstacles, existingStarts) {
  const { x, y } = vineSpawnPoint(obstacles, existingStarts);
  vine.head.x = x;
  vine.head.y = y;
  vine.head.angle = random(TWO_PI);
  vine.trail = [{ x, y }];
}

function initVines() {
  const obstacles = vineObstacles();
  vines = [];
  const existingStarts = [];
  for (let i = 0; i < VINE_COUNT; i++)
    vines.push(makeVine(obstacles, existingStarts));
}

// Same bounce/dodge shape js/mycelium.js's branches use to steer around
// obstacles.
function stepVine(vine, obstacles) {
  const { head } = vine;
  let angle = head.angle + random(-VINE_TURN_WANDER, VINE_TURN_WANDER);
  let next = vineNextPoint(head, angle);

  if (next.x < 6 || next.x > WALL_BOUNDS.w - 6) {
    angle = PI - angle;
    next = vineNextPoint(head, angle);
  }
  if (next.y < 6 || next.y > WALL_BOUNDS.h - 6) {
    angle = -angle;
    next = vineNextPoint(head, angle);
  }

  if (vineBlocked(next, obstacles)) {
    let found = false;
    for (let da = 0.15; da <= PI && !found; da += 0.15) {
      for (const sign of [1, -1]) {
        const testAngle = angle + sign * da;
        const testPoint = vineNextPoint(head, testAngle);
        if (vineInBounds(testPoint) && !vineBlocked(testPoint, obstacles)) {
          angle = testAngle;
          next = testPoint;
          found = true;
          break;
        }
      }
    }
    if (!found) return; // boxed in - hold position this frame
  }

  head.angle = angle;
  head.x = next.x;
  head.y = next.y;

  vine.trail.push({ x: next.x, y: next.y });
}

// Throttles crawl speed by skipping frames rather than shrinking VINE_STEP -
// VINE_STEP sets how much trail-point arc-length one step covers, which the
// fps pass above tuned against VINE_TRAIL_LENGTH to keep vertex count down
// (see that constant's comment); slowing speed by making steps smaller
// would undo that tuning by packing more points into the same on-wall
// length. Skipping updates instead leaves point spacing untouched - a real
// simulation step only happens every VINE_UPDATES_PER_STEP frames, which is
// what used to make the head visibly freeze then jump each time one landed;
// vineDisplayTrail() below smooths that back out for rendering.
const VINE_UPDATES_PER_STEP = 8; // 1 = full speed, 2 = half speed, etc.
let vineUpdateCounter = 0;

function updateVines() {
  vineUpdateCounter++;
  if (vineUpdateCounter % VINE_UPDATES_PER_STEP !== 0) return;

  const obstacles = vineObstacles();
  // Every other vine's current head, so a respawn still lands away from
  // whatever's currently active - same spacing check initVines() uses at
  // startup (vineSpawnPoint()), just re-run per respawn instead of once.
  const existingStarts = vines.map((v) => ({ x: v.head.x, y: v.head.y }));
  vines.forEach((v) => {
    if (v.trail.length >= VINE_TRAIL_LENGTH) {
      respawnVine(v, obstacles, existingStarts);
    } else {
      stepVine(v, obstacles);
    }
  });
}

// A real step only lands every VINE_UPDATES_PER_STEP frames, which used to
// mean the head sat frozen for several frames and then visibly jumped the
// full VINE_STEP distance the moment one did. This smooths that out for
// display only (the underlying trail array, and everything stepVine() bases
// obstacle-avoidance on, still only gains a new committed point at the slow
// rate) - it swaps the trail's last point for one that glides from the
// previous committed point toward the latest one, based on how far through
// the current VINE_UPDATES_PER_STEP window this frame falls. Right after a
// real step lands, that fraction is 0 (draw at the older point, one frame
// "behind" the true state); it reaches ~1 just before the next step commits
// (drawing almost exactly at the true head) - so motion always reads as a
// continuous glide rather than a hitch every few frames, at the cost of
// trailing the true position by up to one step interval.
function vineDisplayTrail(vine) {
  const { trail } = vine;
  const n = trail.length;
  if (n < 2) return trail;

  const frac =
    (vineUpdateCounter % VINE_UPDATES_PER_STEP) / VINE_UPDATES_PER_STEP;
  const a = trail[n - 2];
  const b = trail[n - 1];
  const display = trail.slice(0, n - 1);
  display.push({ x: lerp(a.x, b.x, frac), y: lerp(a.y, b.y, frac) });
  return display;
}

// Appends one vine's stem as disjoint segments to an already-open
// beginShape(LINES) - see drawVines(). LINES mode draws each consecutive
// vertex *pair* as its own independent segment rather than one connected
// strip, which is exactly what lets every vine's stem live in a single
// shared beginShape/endShape call (a plain beginShape() polyline can't be
// split into separate per-vine strokes within one call - the previous
// version used one beginShape() per vine for that reason, which meant
// VINE_COUNT separate stroke draws every frame).
function addVineStemLines(pg, trail) {
  for (let i = 0; i < trail.length - 1; i++) {
    pg.vertex(trail[i].x, trail[i].y);
    pg.vertex(trail[i + 1].x, trail[i + 1].y);
  }
}

// Small near the head (index n-1, freshly grown), ramping up to full size
// within VINE_LEAF_GROW_POINTS points behind it, then staying full size the
// rest of the way back along the trail.
function vineLeafLength(index, n) {
  const distFromHead = n - 1 - index;
  const growFrac = constrain(distFromHead / VINE_LEAF_GROW_POINTS, 0, 1);
  return lerp(VINE_LEAF_MIN_LEN, VINE_LEAF_MAX_LEN, growFrac);
}

// Appends one leaf - a single slender triangle from (bx,by) out to a point
// at (tx,ty) - to an already-open beginShape(TRIANGLES). A simpler stand-in
// for the previous rounded-base teardrop (a tangent-to-a-circle fan of
// several triangles): at the on-wall sizes these leaves render at, the
// rounded base wasn't visibly distinguishable from a plain corner, so it
// wasn't worth its extra trig (acos/atan2 per leaf) and 4x more vertices.
function emitLeafTriangle(pg, bx, by, tx, ty, halfWidth) {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * halfWidth;
  const py = (dx / len) * halfWidth;
  pg.vertex(tx, ty);
  pg.vertex(bx + px, by + py);
  pg.vertex(bx - px, by - py);
}

// One leaf per VINE_LEAF_SPACING trail points, alternating sides as it goes
// so they read as an alternating vine leaf pattern rather than symmetric
// fern pinnae. trail[0] is always a given vine's true first point for its
// whole life now (see respawnVine()), so a point's array index doubles as
// a stable identity - no need for the separate absolute-index bookkeeping
// an earlier, since-reverted fix needed to work around index drift from a
// sliding trail window.
function addVineLeaves(pg, trail) {
  const n = trail.length;
  for (let i = 0; i < n; i += VINE_LEAF_SPACING) {
    const p = trail[i];
    const next = trail[i + 1] || p;
    const prev = trail[i - 1] || p;
    const tangent = Math.atan2(next.y - prev.y, next.x - prev.x);
    const perpX = Math.cos(tangent + HALF_PI);
    const perpY = Math.sin(tangent + HALF_PI);

    const len = vineLeafLength(i, n);
    const halfWidth = Math.max(len * VINE_LEAF_HALF_WIDTH_FRAC, 0.6);
    const side = (i / VINE_LEAF_SPACING) % 2 === 0 ? 1 : -1;

    emitLeafTriangle(
      pg,
      p.x,
      p.y,
      p.x + perpX * len * side,
      p.y + perpY * len * side,
      halfWidth,
    );
  }
}

function drawVines(pg) {
  // Computed once per vine per frame and reused for both passes below,
  // rather than re-deriving the smoothed tip separately for stems and
  // leaves.
  const displayTrails = vines.map(vineDisplayTrail);

  pg.push();

  pg.noFill();
  pg.stroke(255);
  pg.strokeWeight(VINE_STEM_WEIGHT);
  pg.beginShape(LINES);
  displayTrails.forEach((trail) => addVineStemLines(pg, trail));
  pg.endShape();

  pg.noStroke();
  pg.fill(255);
  pg.beginShape(TRIANGLES);
  displayTrails.forEach((trail) => addVineLeaves(pg, trail));
  pg.endShape();

  pg.pop();
}
