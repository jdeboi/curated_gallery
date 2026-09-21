/*
 * Thick mycelium growth for the grass layer.
 *
 * Branches grow in the wall's shared logical drawing space (WALL_BOUNDS,
 * see js/wall.js) - the same space paintings.js expresses painting
 * geometry in - bouncing back inward at the wall edges, and steering
 * away from painting polygons (inflated slightly via polygonCentroid,
 * same trick drawPaintingGlow uses) so hyphae wrap around frames rather
 * than crossing them. On a multi-panel wall this space spans every
 * panel, so a branch can grow right across the seam from one physical
 * panel into the next. Each branch is rendered as a single tapered
 * ribbon polygon (thick at the root, thinning toward the tip), filled
 * solid opaque white so it reads clearly against the dark wall.
 *
 * Growth is frame-gated (see MYCELIUM_FRAME_INTERVAL) rather than
 * stepping every frame, so the spread is slow enough to actually watch.
 */

const MYCELIUM_STEP = 2.2;
const MYCELIUM_FRAME_INTERVAL = 2; // advance growth once every N frames
const MYCELIUM_ROOT_INTERVAL = 200; // frames between new root sprouts
const MYCELIUM_MAX_BRANCHES = 50;
const MYCELIUM_MAX_GENERATION = 3;
const MYCELIUM_OBSTACLE_SCALE = 1.15; // inflate painting polygons when steering
const MYCELIUM_AVOID_PAINTINGS = false;

let myceliumBranches = [];
let myceliumRootTimer = 0;

class MyceliumBranch {
  constructor(x, y, angle, thickness, generation) {
    this.points = [{ x, y }];
    this.angle = angle;
    this.thickness = thickness;
    this.generation = generation;
    this.alive = true;
    this.maxLength = random(250, 550) / (generation * 0.35 + 1);
    this.length = 0;
    this.forkCooldown = random(30, 70);
  }

  step(obstacles) {
    if (!this.alive) return;

    const tip = this.points[this.points.length - 1];
    let angle = this.angle + random(-0.18, 0.18);

    // Bounce back inward off the wall edges instead of dying there, so
    // growth keeps spreading across the whole surface.
    let next = myceliumNextPoint(tip, angle);
    if (next.x < 6 || next.x > WALL_BOUNDS.w - 6) {
      angle = PI - angle;
      next = myceliumNextPoint(tip, angle);
    }
    if (next.y < 6 || next.y > WALL_BOUNDS.h - 6) {
      angle = -angle;
      next = myceliumNextPoint(tip, angle);
    }

    if (myceliumBlocked(next, obstacles)) {
      let found = false;
      for (let da = 0.15; da <= PI && !found; da += 0.15) {
        for (const sign of [1, -1]) {
          const testAngle = angle + sign * da;
          const testPoint = myceliumNextPoint(tip, testAngle);
          if (
            myceliumInBounds(testPoint) &&
            !myceliumBlocked(testPoint, obstacles)
          ) {
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

    this.angle = angle;
    this.points.push(next);
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

function myceliumNextPoint(p, angle) {
  return {
    x: p.x + Math.cos(angle) * MYCELIUM_STEP,
    y: p.y + Math.sin(angle) * MYCELIUM_STEP,
  };
}

function myceliumInBounds(p) {
  return (
    p.x >= 6 &&
    p.x <= WALL_BOUNDS.w - 6 &&
    p.y >= 6 &&
    p.y <= WALL_BOUNDS.h - 6
  );
}

function myceliumBlocked(p, obstacles) {
  for (const poly of obstacles) {
    if (pointInPolygon(p.x, p.y, poly)) return true;
  }
  return false;
}

function myceliumObstacles() {
  return getPaintingPolygons().map((poly) => {
    const c = polygonCentroid(poly);
    return poly.map((p) => ({
      x: c.x + (p.x - c.x) * MYCELIUM_OBSTACLE_SCALE,
      y: c.y + (p.y - c.y) * MYCELIUM_OBSTACLE_SCALE,
    }));
  });
}

function myceliumSpawnRoot() {
  const edge = random();
  let x, y, angle;
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
  myceliumBranches.push(new MyceliumBranch(x, y, angle, random(9, 15), 0));
}

function initMycelium() {
  myceliumBranches = [];
  myceliumRootTimer = 0;
  for (let i = 0; i < 5; i++) myceliumSpawnRoot();
}

function updateMycelium() {
  if (frameCount % MYCELIUM_FRAME_INTERVAL === 0) {
    const obstacles = MYCELIUM_AVOID_PAINTINGS ? myceliumObstacles() : [];
    myceliumBranches.forEach((b) => b.step(obstacles));
  }

  myceliumRootTimer++;
  if (
    myceliumRootTimer > MYCELIUM_ROOT_INTERVAL &&
    myceliumBranches.length < MYCELIUM_MAX_BRANCHES
  ) {
    myceliumRootTimer = 0;
    myceliumSpawnRoot();
  }
}

function myceliumRibbonSides(branch) {
  const pts = branch.points;
  const n = pts.length;
  const rootW = branch.thickness;
  const tipW = Math.max(1.5, branch.thickness * 0.45);

  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
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

function drawMyceliumBranch(pg, branch) {
  if (branch.points.length < 2) return;

  const { left, right } = myceliumRibbonSides(branch);

  pg.push();
  pg.stroke(255);
  pg.strokeWeight(1.5);
  pg.fill(255);
  pg.beginShape();
  left.forEach((p) => pg.vertex(p.x, p.y));
  for (let i = right.length - 1; i >= 0; i--) pg.vertex(right[i].x, right[i].y);
  pg.endShape(CLOSE);
  pg.pop();

  // Bulbous tip nodule where the hypha is actively growing.
  if (branch.alive) {
    const tip = branch.points[branch.points.length - 1];
    pg.noStroke();
    pg.fill(255);
    pg.circle(tip.x, tip.y, Math.max(2, branch.thickness * 0.5));
  }
}

function drawMycelium(pg) {
  myceliumBranches.forEach((b) => drawMyceliumBranch(pg, b));
}
