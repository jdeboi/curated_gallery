/*
 * Thick mycelium growth for the grass layer.
 *
 * Branches grow in the wall's shared logical drawing space (WALL_BOUNDS,
 * see js/wall.js) - the same space paintings.js/outlines.js express
 * painting and wing-sculpture geometry in - wrapping around the wall
 * edges (Pac-Man / Asteroids style) rather than dying or bouncing there,
 * and steering away from wing-sculpture polygons (inflated slightly via
 * polygonCentroid, same trick drawGlow uses) so hyphae wrap around
 * sculptures rather than crossing them. On a multi-panel wall this space
 * spans every panel, so a branch can grow right across the seam from one
 * physical panel into the next. Each branch is rendered as one or more
 * tapered ribbon polygons (thick at the root, thinning toward the tip) - a
 * new ribbon segment starts every time the branch wraps an edge, since a
 * single polygon can't jump from one side of the wall to the other without
 * drawing a line straight across it - filled solid opaque white (with a
 * touch of per-branch brightness variation, see MyceliumBranch's
 * `brightness`) so it reads clearly against the dark wall.
 *
 * Paintings are *not* obstacles - branches grow straight through/over a
 * painting's silhouette same as anywhere else, some of that growth ending
 * up hidden under the painting's own opaque fill and some visible beside
 * it (drawPaintings() in js/paintings.js always renders on top of a
 * scene's own draw(), see js/wall.js's displayWall()). The first branch
 * point that lands inside a painting's polygon does start that painting's
 * own reveal though - see myceliumTouchPainting()/
 * myceliumPaintingRevealFraction() below, js/paintings.js's
 * "myceliumReveal" paintingState (crossfading the painting itself from
 * "off" to "filled" over MYCELIUM_REVEAL_DURATION),
 * and myceliumBuildEdgePaths() further down here - a second, mossier
 * ring of growth crawling from that same contact point around the
 * painting's own perimeter in both directions, timed to finish closing
 * exactly as the fade completes, so both read as one continuous
 * "the painting is waking up" effect rather than separate layers. Leaving
 * every painting's reveal to wherever the random roots/forks happen to
 * wander risked some paintings never getting touched at all in a given
 * network's lifetime, so initMycelium() also seeds one dedicated root just
 * outside each painting's own bounds, aimed back toward it (see
 * myceliumSpawnRootNearPainting) - on top of, not instead of, the plain
 * random edge roots - so every painting reliably gets a short, visible
 * crossing into it early in each run.
 *
 * Growth is frame-gated (see MYCELIUM_FRAME_INTERVAL) rather than
 * stepping every frame, so the spread is slow enough to actually watch.
 * The whole network also restarts itself from empty every
 * MYCELIUM_RESTART_INTERVAL (see below), independent of the scene
 * scheduler in js/scenes.js, so a long mycelium scene doesn't end up
 * static and fully clogged with branches for its last stretch.
 */

const MYCELIUM_STEP = 2.2;
// Growth is paced by elapsed time rather than frame count, and the drawn
// tip is extended by the fractional step in progress (see
// myceliumBuildBranchPaths), so it glides smoothly between steps instead of
// hopping forward a whole step at a time.
const MYCELIUM_STEPS_PER_SECOND = 30;
const MYCELIUM_MAX_STEPS_PER_FRAME = 4; // don't lurch forward after a hitch
const MYCELIUM_ROOT_INTERVAL = 200; // frames between new root sprouts
const MYCELIUM_MAX_BRANCHES = 50;
const MYCELIUM_MAX_GENERATION = 3;
const MYCELIUM_OBSTACLE_SCALE = 1.15; // inflate wing-sculpture polygons when steering
const MYCELIUM_AVOID_OUTLINES = true;
const MYCELIUM_RESTART_INTERVAL = 25000; // ms of growth before the network resets
const MYCELIUM_REVEAL_DURATION = 4000; // ms a touched painting takes to fully fade in
const MYCELIUM_EDGE_SAMPLE_STEP = 4; // px spacing between sampled edge points
const MYCELIUM_RIBBON_OUTLINE = 1.5; // px added to ribbon widths in place of a stroke

let myceliumBranches = [];
let myceliumRootTimer = 0;
let myceliumStartTime = 0;
let myceliumStepProgress = 0; // fractional steps accumulated, see updateMycelium
// This frame's painting edge-crawl ribbons, built once in updateMycelium
// (see myceliumBuildEdgePaths) for every panel's drawMycelium to reuse:
// [{ fill, path: Path2D }].
let myceliumEdgePaths = [];
// Sparse, indexed like getPaintingPolygons(): myceliumPaintingTouch[i] is
// { at, s0 } - the millis() timestamp mycelium first reached painting i and
// the arc-length position (see polygonPerimeterInfo) on its perimeter that
// contact was nearest to - or undefined if it hasn't been touched yet. See
// myceliumTouchPainting/myceliumPaintingRevealFraction/
// myceliumBuildEdgePaths.
let myceliumPaintingTouch = [];

class MyceliumBranch {
  constructor(x, y, angle, thickness, generation) {
    // A branch is a list of segments (each a list of points), rather than
    // one flat point list, because wrapping around a wall edge has to
    // start a fresh segment - see the file header note.
    this.segments = [[{ x, y }]];
    this.angle = angle;
    this.thickness = thickness;
    this.generation = generation;
    this.alive = true;
    this.maxLength = random(250, 550) / (generation * 0.35 + 1);
    this.length = 0;
    this.forkCooldown = random(30, 70);
    // A little per-branch brightness variation (rather than flat 255) so a
    // tangle of overlapping hyphae reads with some texture instead of as
    // one flat white mass - see myceliumBuildBranchPaths.
    this.brightness = random(200, 255);
  }

  get points() {
    return this.segments[this.segments.length - 1];
  }

  step(paintingPolys, outlineObstacles) {
    if (!this.alive) return;

    const tip = this.points[this.points.length - 1];
    let angle = this.angle + random(-0.18, 0.18);
    let next = myceliumNextPoint(tip, angle);

    if (myceliumBlocked(next, outlineObstacles)) {
      let found = false;
      for (let da = 0.15; da <= PI && !found; da += 0.15) {
        for (const sign of [1, -1]) {
          const testAngle = angle + sign * da;
          const testPoint = myceliumNextPoint(tip, testAngle);
          if (!myceliumBlocked(testPoint, outlineObstacles)) {
            angle = testAngle;
            next = testPoint;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        this.stuckSteps = (this.stuckSteps || 0) + 1;
        if (this.stuckSteps > 5) this.alive = false;
        return;
      }
    }
    this.stuckSteps = 0;

    // Crossing into a painting's silhouette doesn't affect growth at all -
    // it just starts (or, on a later contact, no-ops against) that
    // painting's own reveal fade, independent of this branch's own path.
    const hitPaintingIndex = paintingPolys.findIndex((poly) =>
      pointInPolygon(next.x, next.y, poly),
    );
    if (hitPaintingIndex !== -1) myceliumTouchPainting(hitPaintingIndex, next);

    // Wrap around the wall edges instead of bouncing back inward: a branch
    // that grows off one side reappears on the opposite side, continuing
    // in the same direction. Start a new segment on wrap so the ribbon
    // doesn't get drawn as one polygon stretching across the whole wall.
    let wrapped = false;
    if (next.x < 0 || next.x > WALL_BOUNDS.w) {
      next.x = ((next.x % WALL_BOUNDS.w) + WALL_BOUNDS.w) % WALL_BOUNDS.w;
      wrapped = true;
    }
    if (next.y < 0 || next.y > WALL_BOUNDS.h) {
      next.y = ((next.y % WALL_BOUNDS.h) + WALL_BOUNDS.h) % WALL_BOUNDS.h;
      wrapped = true;
    }

    this.angle = angle;
    if (wrapped) {
      this.segments.push([next]);
    } else {
      this.points.push(next);
    }
    this.length += MYCELIUM_STEP;

    if (this.length >= this.maxLength) {
      this.alive = false;
      return;
    }

    this.forkCooldown--;
    if (
      this.forkCooldown <= 0 &&
      this.generation < MYCELIUM_MAX_GENERATION &&
      this.points.length > 8 &&
      myceliumBranches.length < MYCELIUM_MAX_BRANCHES &&
      random() < 0.35
    ) {
      const forkAngle =
        this.angle + (random() < 0.5 ? -1 : 1) * random(0.5, 1.1);
      myceliumBranches.push(
        new MyceliumBranch(
          next.x,
          next.y,
          forkAngle,
          this.thickness * 0.6,
          this.generation + 1,
        ),
      );
      this.forkCooldown = random(50, 100);
    }
  }
}

// Marks painting `i` as touched on first contact only - later contact while
// it's already fading in (or after it's fully revealed) is a no-op. Records
// where on the perimeter contact happened (see polygonPerimeterInfo) so
// myceliumBuildEdgePaths can start its own crawl from that same spot.
function myceliumTouchPainting(i, point) {
  if (myceliumPaintingTouch[i]) return;
  const poly = getPaintingPolygons()[i];
  if (!poly) return;
  const s0 = nearestPerimeterS(polygonPerimeterInfo(poly), point);
  myceliumPaintingTouch[i] = { at: millis(), s0 };
}

// 0 (untouched) to 1 (fully revealed, MYCELIUM_REVEAL_DURATION after first
// touch) - read by js/paintings.js's "myceliumReveal" paintingState to
// crossfade painting `i` from "off" to "filled",
// and by myceliumBuildEdgePaths below to pace that painting's edge-crawl
// so it closes at the same moment.
function myceliumPaintingRevealFraction(i) {
  const touch = myceliumPaintingTouch[i];
  if (!touch) return 0;
  return Math.min(1, (millis() - touch.at) / MYCELIUM_REVEAL_DURATION);
}

function myceliumNextPoint(p, angle) {
  return {
    x: p.x + Math.cos(angle) * MYCELIUM_STEP,
    y: p.y + Math.sin(angle) * MYCELIUM_STEP,
  };
}

function myceliumBlocked(p, obstacles) {
  for (const poly of obstacles) {
    if (pointInPolygon(p.x, p.y, poly)) return true;
  }
  return false;
}

// Precomputes a polygon's edges with their cumulative start distance and
// total perimeter, so a point can be found by (or projected to) a single
// arc-length coordinate `s` along the boundary - see pointAtPerimeterS/
// nearestPerimeterS below. Used only by a painting's edge-crawl reveal
// (myceliumTouchPainting/myceliumBuildEdgePaths).
function polygonPerimeterInfo(poly) {
  const edges = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    edges.push({ a, b, len, start: total });
    total += len;
  }
  return { edges, perimeter: total };
}

// The point at arc-length `s` (wrapped into [0, perimeter)) along a
// polygon's boundary, as precomputed by polygonPerimeterInfo.
function pointAtPerimeterS(info, s) {
  const perimeter = info.perimeter;
  const ss = ((s % perimeter) + perimeter) % perimeter;
  for (const e of info.edges) {
    if (ss <= e.start + e.len) {
      const t = e.len > 0 ? (ss - e.start) / e.len : 0;
      return { x: lerp(e.a.x, e.b.x, t), y: lerp(e.a.y, e.b.y, t) };
    }
  }
  const last = info.edges[info.edges.length - 1];
  return { x: last.b.x, y: last.b.y };
}

// The arc-length position on a polygon's boundary closest to point `p` -
// used once per painting, to seed its edge-crawl from wherever contact
// actually happened rather than snapping to a vertex.
function nearestPerimeterS(info, p) {
  let bestS = 0;
  let bestDist = Infinity;
  for (const e of info.edges) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = e.a.x + dx * t;
    const cy = e.a.y + dy * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestDist) {
      bestDist = d;
      bestS = e.start + t * e.len;
    }
  }
  return bestS;
}

// Inflated wing-sculpture polygons, steered away from same as before - see
// getOutlinePolygons(). Paintings no longer go through this at all.
function myceliumInflatedOutlinePolygons() {
  return getOutlinePolygons().map((poly) => {
    const c = polygonCentroid(poly);
    return poly.map((p) => ({
      x: c.x + (p.x - c.x) * MYCELIUM_OBSTACLE_SCALE,
      y: c.y + (p.y - c.y) * MYCELIUM_OBSTACLE_SCALE,
    }));
  });
}

// True if (x, y) already sits inside some painting's own silhouette - a
// root spawned there would trigger that painting's reveal (see
// myceliumTouchPainting) on its very first frame, with no mycelium visibly
// having grown into it yet. myceliumSpawnRoot retries against this so every
// reveal is always preceded by a branch visibly crossing the threshold.
function myceliumInsidePainting(x, y) {
  return getPaintingPolygons().some((poly) => pointInPolygon(x, y, poly));
}

function myceliumSpawnRoot() {
  let x, y, angle;
  for (let attempt = 0; attempt < 20; attempt++) {
    const edge = random();
    if (edge < 0.6) {
      x = random(WALL_BOUNDS.w);
      y = WALL_BOUNDS.h - random(5, 30);
      angle = -HALF_PI + random(-0.6, 0.6);
    } else if (edge < 0.8) {
      x = random(5, 30);
      y = random(WALL_BOUNDS.h);
      angle = random(-0.6, 0.6);
    } else {
      x = WALL_BOUNDS.w - random(5, 30);
      y = random(WALL_BOUNDS.h);
      angle = PI + random(-0.6, 0.6);
    }
    if (!myceliumInsidePainting(x, y)) break;
  }
  myceliumBranches.push(new MyceliumBranch(x, y, angle, random(9, 15), 0));
}

// A dedicated root just outside painting `poly`'s own bounds, aimed back
// toward it - picks its left or right side at random (spawning at that
// side's vertical center, same as the other root spawns' own small
// vertical/angle jitter) and falls back to the other side if the wall
// doesn't have room on the chosen one.
// Every painting gets one of these on every initMycelium() (a fresh scene
// entry or a periodic restart), on top of the plain random edge roots, so
// a network restart doesn't leave any painting's reveal to chance - it's
// only ever a short, visible crossing away from starting.
function myceliumSpawnRootNearPainting(poly) {
  const bounds = polygonBounds(poly);
  const margin = random(20, 45);
  const rightX = bounds.x + bounds.w + margin;
  const leftX = bounds.x - margin;
  const hasRight = rightX <= WALL_BOUNDS.w;
  const hasLeft = leftX >= 0;
  const spawnRight = hasRight && (!hasLeft || random() < 0.5);
  const x = spawnRight ? rightX : Math.max(0, leftX);
  const y = bounds.y + bounds.h / 2 + random(-bounds.h * 0.2, bounds.h * 0.2);
  const angle = (spawnRight ? PI : 0) + random(-0.3, 0.3);
  myceliumBranches.push(new MyceliumBranch(x, y, angle, random(9, 15), 0));
}

function initMycelium() {
  myceliumBranches = [];
  myceliumPaintingTouch = [];
  myceliumRootTimer = 0;
  myceliumStartTime = millis();
  myceliumStepProgress = 0;
  myceliumEdgePaths = [];
  for (let i = 0; i < 5; i++) myceliumSpawnRoot();
  getPaintingPolygons().forEach(myceliumSpawnRootNearPainting);
}

function updateMycelium() {
  // Restart the whole network from empty on a timer, independent of how
  // long the scene scheduler keeps this scene on screen, so a long run
  // doesn't end with the wall fully clogged and static.
  if (millis() - myceliumStartTime > MYCELIUM_RESTART_INTERVAL) {
    initMycelium();
    return;
  }

  myceliumStepProgress = Math.min(
    myceliumStepProgress + (deltaTime / 1000) * MYCELIUM_STEPS_PER_SECOND,
    MYCELIUM_MAX_STEPS_PER_FRAME,
  );
  if (myceliumStepProgress >= 1) {
    const paintingPolys = getPaintingPolygons();
    const outlineObstacles = MYCELIUM_AVOID_OUTLINES
      ? myceliumInflatedOutlinePolygons()
      : [];
    while (myceliumStepProgress >= 1) {
      myceliumStepProgress--;
      myceliumBranches.forEach((b) => b.step(paintingPolys, outlineObstacles));
    }
  }

  // Geometry is built here, once per frame, rather than in drawMycelium,
  // which runs once per wall panel (js/wall.js's displayWall()).
  myceliumBranches.forEach(myceliumBuildBranchPaths);
  myceliumEdgePaths = myceliumBuildEdgePaths();

  myceliumRootTimer++;
  if (
    myceliumRootTimer > MYCELIUM_ROOT_INTERVAL &&
    myceliumBranches.length < MYCELIUM_MAX_BRANCHES
  ) {
    myceliumRootTimer = 0;
    myceliumSpawnRoot();
  }
}

function myceliumRibbonSides(points, thickness) {
  const n = points.length;
  const rootW = thickness;
  const tipW = Math.max(1.5, thickness * 0.45);

  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = n > 1 ? i / (n - 1) : 0;
    const w = lerp(rootW, tipW, t) / 2;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  return { left, right };
}

// Builds a branch's ribbon (one subpath per wrap segment) and tip nodule
// as native Path2Ds, filled per panel in drawMycelium - p5 2.0's
// immediate-mode vertex() is too slow to re-issue every ribbon point once
// per panel per frame (see js/grass.js's header). A dead branch never
// changes again, so its paths are built one last time and then kept.
// Ribbons are widened by MYCELIUM_RIBBON_OUTLINE instead of stroked, which
// looks the same (the stroke was the fill color) at half the draw calls.
function myceliumBuildBranchPaths(branch) {
  if (branch.pathsFinal) return;
  if (!branch.alive) branch.pathsFinal = true;

  // A live branch's tip is drawn partway toward its next step, along its
  // current heading, by the fraction of a step that's elapsed.
  const lastSegment = branch.segments.length - 1;
  let tip = branch.points[branch.points.length - 1];
  if (branch.alive) {
    tip = {
      x: tip.x + Math.cos(branch.angle) * MYCELIUM_STEP * myceliumStepProgress,
      y: tip.y + Math.sin(branch.angle) * MYCELIUM_STEP * myceliumStepProgress,
    };
  }

  const ribbon = new Path2D();
  branch.segments.forEach((points, i) => {
    const segment = branch.alive && i === lastSegment ? [...points, tip] : points;
    if (segment.length < 2) return;
    const { left, right } = myceliumRibbonSides(
      segment,
      branch.thickness + MYCELIUM_RIBBON_OUTLINE,
    );
    myceliumAddRibbon(ribbon, left, right);
  });

  // Bulbous tip nodule where the hypha is actively growing - its own path,
  // since its winding could cancel out the ribbon's where they overlap.
  let nodule = null;
  if (branch.alive) {
    nodule = new Path2D();
    nodule.arc(tip.x, tip.y, Math.max(2, branch.thickness * 0.5) / 2, 0, TWO_PI);
  }

  branch.paths = { fill: myceliumGray(branch.brightness), ribbon, nodule };
}

function myceliumAddRibbon(path, left, right) {
  path.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) path.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i].x, right[i].y);
  path.closePath();
}

function myceliumGray(brightness) {
  const v = Math.round(brightness);
  return `rgb(${v}, ${v}, ${v})`;
}

// Deterministic (same painting index + arc-length `s` -> same value every
// frame) smooth pseudo-random in [0, 1), via p5's Perlin noise() rather
// than random() - lets myceliumBuildEdgePaths recompute each ring's
// whole path fresh every frame straight from the current reveal fraction,
// with no incremental growth history of its own to store.
function myceliumEdgeNoise(paintingIndex, s, salt) {
  return noise(paintingIndex * 133.7 + s * 0.05 + salt * 971);
}

// Samples painting `i`'s own perimeter from its touch point `s0` out to
// `dist` in `direction` (+1 clockwise/-1 counterclockwise), each point
// nudged along its own outward normal - approximated, same trick
// js/lightState.js's drawGlow uses, as the line from the painting's
// centroid through it - and carrying its own wandering width, both via
// myceliumEdgeNoise so the ring reads as a raggedy, organically thick
// coating rather than a ruler-straight traced outline.
function myceliumEdgePoints(info, centroid, s0, dist, direction, i, salt) {
  const points = [];
  for (let d = 0; d <= dist; d += MYCELIUM_EDGE_SAMPLE_STEP) {
    const s = s0 + direction * d;
    const p = pointAtPerimeterS(info, s);
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const len = Math.hypot(dx, dy) || 1;
    const wobble = (myceliumEdgeNoise(i, s, salt) - 0.35) * 9;
    const width = 3 + myceliumEdgeNoise(i, s, salt + 1) * 7;
    points.push({
      x: p.x + (dx / len) * wobble,
      y: p.y + (dy / len) * wobble,
      w: width,
    });
  }
  return points;
}

// Same normal-offset trick as myceliumRibbonSides, but each point carries
// its own stored half-width (see myceliumEdgePoints) instead of one value
// tapered smoothly root-to-tip.
function myceliumEdgeRibbonSides(points) {
  const n = points.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = (p.w + MYCELIUM_RIBBON_OUTLINE) / 2;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  return { left, right };
}

// The "mossy edge" ring: two ribbons crawling from each touched painting's
// own contact point around its perimeter, one clockwise and one
// counterclockwise, paced by myceliumPaintingRevealFraction so together
// they close - meeting on the painting's far side - at the exact moment
// its fill (js/paintings.js's drawMyceliumRevealPaintings) finishes
// fading in. Drawn as part of the scene layer, same as the branches, so it
// sits *underneath* drawPaintings()'s own opaque fill - only the portion
// that wobbles outside the painting's real edge (see myceliumEdgePoints)
// reads as a mossy border once that fill is drawn on top.
//
// Built as Path2Ds once per frame (see myceliumBuildBranchPaths for why),
// and a fully closed ring is kept on its touch record rather than
// resampled every frame, since it no longer changes.
function myceliumBuildEdgePaths() {
  const polygons = getPaintingPolygons();
  const paths = [];
  myceliumPaintingTouch.forEach((touch, i) => {
    const poly = polygons[i];
    if (!touch || !poly) return;
    if (touch.closedPath) return paths.push(touch.closedPath);

    const fraction = myceliumPaintingRevealFraction(i);
    const info = polygonPerimeterInfo(poly);
    const centroid = polygonCentroid(poly);
    const halfDist = (fraction * info.perimeter) / 2;
    const brightness = 200 + myceliumEdgeNoise(i, 0, 99) * 55;

    const path = new Path2D();
    [1, -1].forEach((direction, salt) => {
      const points = myceliumEdgePoints(
        info, centroid, touch.s0, halfDist, direction, i, salt,
      );
      if (points.length < 2) return;
      const { left, right } = myceliumEdgeRibbonSides(points);
      myceliumAddRibbon(path, left, right);
    });
    const entry = { fill: myceliumGray(brightness), path };
    if (fraction >= 1) touch.closedPath = entry;
    paths.push(entry);
  });
  return paths;
}

function drawMycelium(pg) {
  const ctx = pg.drawingContext;
  ctx.save();
  myceliumBranches.forEach(({ paths }) => {
    if (!paths) return;
    ctx.fillStyle = paths.fill;
    ctx.fill(paths.ribbon);
    if (paths.nodule) ctx.fill(paths.nodule);
  });
  myceliumEdgePaths.forEach(({ fill, path }) => {
    ctx.fillStyle = fill;
    ctx.fill(path);
  });
  ctx.restore();
}
