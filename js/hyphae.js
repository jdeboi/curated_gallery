/*
 * Hyphae: a fine, grayscale fungal network - modeled on a fluorescence
 * micrograph of mycelium - that just grows and branches across the wall.
 *
 * Borrows js/mycelium.js's growth approach (branches stepping through
 * WALL_BOUNDS on an elapsed-time clock, wrapping around the wall edges
 * with a fresh segment per wrap) but none of its painting/wing-sculpture
 * behavior: nothing here steers around, reveals or even looks at the
 * paintings - they just keep whatever the scene's paintingState is while
 * the network grows behind them.
 *
 * Each branch's generation sets its whole look (see HYPHAE_GENERATIONS):
 * long, fairly straight, bright primary hyphae; progressively shorter,
 * thinner, dimmer and more wandering offshoots off those. Round spore-like
 * beads swell out of the lines themselves - bright ones at some fork points
 * along the main hyphae, plus a steady sprinkle landing anywhere on the
 * network, often in little clusters along the same line - with only a few
 * faint specks drifting free of it.
 *
 * Drawing is batched per generation (one stroked Path2D for every finished
 * branch, one rebuilt each frame for the still-growing ones) and per dot
 * brightness, so the per-panel cost stays a handful of draw calls however
 * dense the network gets. Every HYPHAE_CYCLE the whole network fades out
 * and restarts from empty.
 */

const HYPHAE_STEP = 2;
const HYPHAE_STEPS_PER_SECOND = 40;
const HYPHAE_MAX_STEPS_PER_FRAME = 4; // don't lurch forward after a hitch
const HYPHAE_MAX_BRANCHES = 1200; // total grown per cycle
const HYPHAE_INITIAL_ROOTS = 7;
const HYPHAE_ROOT_INTERVAL = 2500; // ms between additional roots
const HYPHAE_CYCLE = 40000; // ms of growth before the network restarts
const HYPHAE_FADE = 3000; // ms fade-out at the end of each cycle
const HYPHAE_DOTS_PER_SECOND = 20; // dots sprinkled over the network (and a few off it)
const HYPHAE_FREE_DOT_CHANCE = 0.12; // share of sprinkled dots that land off the hyphae as faint specks
const HYPHAE_SPORE_CHANCE = 0.3; // chance a primary/secondary fork drops a bright spore
const HYPHAE_DOT_GROW = 700; // ms for a dot to swell to full size
const HYPHAE_SATELLITE_MAX = 3; // each on-line dot buds 0 to this many smaller beads along the same line
const HYPHAE_DOT_GRAY_STEP = 20; // finished dots are batched by gray, quantized to this
const HYPHAE_WIDTH_SCALE = 2.4; // multiplies every generation's stroke width

// Per generation: stroke width/gray, length range (px), per-step heading
// jitter, pull back toward the branch's starting heading (keeps primaries
// long and straight-ish), and steps between forks (null = never forks).
const HYPHAE_GENERATIONS = [
  {
    width: 3,
    gray: 235,
    halo: 0.1,
    length: [700, 1500],
    wander: 0.07,
    straighten: 0.03,
    forkEvery: [20, 50],
  },
  {
    width: 1.7,
    gray: 170,
    halo: 0.07,
    length: [180, 480],
    wander: 0.13,
    straighten: 0.02,
    forkEvery: [12, 35],
  },
  {
    width: 1,
    gray: 115,
    halo: 0,
    length: [50, 180],
    wander: 0.2,
    straighten: 0.01,
    forkEvery: [8, 22],
  },
  {
    width: 0.6,
    gray: 75,
    halo: 0,
    length: [12, 55],
    wander: 0.28,
    straighten: 0,
    forkEvery: null,
  },
];

let hyphaeBranches = []; // growing branches only - finished ones live in hyphaeDonePaths
let hyphaeAllBranches = []; // every branch this cycle, growing or done - dots land on these
let hyphaeBranchCount = 0;
let hyphaeDonePaths = []; // per generation
let hyphaeLivePaths = []; // per generation, rebuilt every frame
let hyphaeDots = []; // still swelling - finished ones live in hyphaeDoneDots
let hyphaeDoneDots = new Map(); // gray -> Path2D
let hyphaeStartTime = 0;
let hyphaeLastRoot = 0;
let hyphaeStepProgress = 0;
let hyphaeDotDebt = 0;

class HyphaBranch {
  constructor(x, y, angle, generation) {
    const g = HYPHAE_GENERATIONS[generation];
    this.segments = [[{ x, y }]];
    this.angle = angle;
    this.baseAngle = angle;
    this.generation = generation;
    this.maxLength = random(g.length[0], g.length[1]);
    this.length = 0;
    this.alive = true;
    this.forkCooldown = g.forkEvery
      ? random(g.forkEvery[0], g.forkEvery[1])
      : Infinity;
    hyphaeBranchCount++;
    hyphaeAllBranches.push(this);
  }

  get points() {
    return this.segments[this.segments.length - 1];
  }

  step() {
    const g = HYPHAE_GENERATIONS[this.generation];
    this.angle +=
      random(-g.wander, g.wander) +
      (this.baseAngle - this.angle) * g.straighten;
    const tip = this.points[this.points.length - 1];
    const next = {
      x: tip.x + Math.cos(this.angle) * HYPHAE_STEP,
      y: tip.y + Math.sin(this.angle) * HYPHAE_STEP,
    };

    // Wrap around the wall edges, same as js/mycelium.js.
    let wrapped = false;
    if (next.x < 0 || next.x > WALL_BOUNDS.w) {
      next.x = ((next.x % WALL_BOUNDS.w) + WALL_BOUNDS.w) % WALL_BOUNDS.w;
      wrapped = true;
    }
    if (next.y < 0 || next.y > WALL_BOUNDS.h) {
      next.y = ((next.y % WALL_BOUNDS.h) + WALL_BOUNDS.h) % WALL_BOUNDS.h;
      wrapped = true;
    }
    if (wrapped) this.segments.push([next]);
    else this.points.push(next);

    this.length += HYPHAE_STEP;
    if (this.length >= this.maxLength) {
      this.alive = false;
      hyphaeAddBranchPath(hyphaeDonePaths[this.generation], this, false);
      return;
    }

    if (--this.forkCooldown <= 0 && hyphaeBranchCount < HYPHAE_MAX_BRANCHES) {
      const side = random() < 0.5 ? -1 : 1;
      hyphaeBranches.push(
        new HyphaBranch(
          next.x,
          next.y,
          this.angle + side * random(0.35, 1.3),
          this.generation + 1,
        ),
      );
      this.forkCooldown = random(g.forkEvery[0], g.forkEvery[1]);
      if (this.generation <= 1 && random() < HYPHAE_SPORE_CHANCE) {
        const segment = this.segments.length - 1;
        hyphaeAddLineDot(this, segment, this.points.length - 1, 1.3, 255);
      }
    }
  }
}

function hyphaeSpawnRoot() {
  hyphaeBranches.push(
    new HyphaBranch(
      random(WALL_BOUNDS.w),
      random(WALL_BOUNDS.h),
      random(TWO_PI),
      0,
    ),
  );
}

function hyphaeAddDot(x, y, r, gray, delay = 0) {
  hyphaeDots.push({ x, y, r, gray, born: millis() + delay });
}

// A bead sitting right on `branch` at points[pointIndex] of one of its
// segments, sized off that branch's stroke width (`scale` times its
// radius-ish) so it always reads as a swelling on the line rather than
// hidden under it, and brighter than the line itself. Buds 0 to
// HYPHAE_SATELLITE_MAX smaller beads a few steps up/down the same segment,
// popping in just after it.
function hyphaeAddLineDot(branch, segmentIndex, pointIndex, scale, grayBoost) {
  const g = HYPHAE_GENERATIONS[branch.generation];
  const points = branch.segments[segmentIndex];
  const lineWidth = g.width * HYPHAE_WIDTH_SCALE;
  const r = Math.max(1.2, lineWidth * scale * random(0.6, 1.1));
  const gray = Math.min(255, g.gray + grayBoost * random(0.2, 0.5));
  const p = points[pointIndex];
  hyphaeAddDot(p.x, p.y, r, gray);

  const count = Math.floor(random(HYPHAE_SATELLITE_MAX + 1));
  for (let i = 0; i < count; i++) {
    const offset = (random() < 0.5 ? -1 : 1) * Math.floor(random(3, 10));
    const q = points[pointIndex + offset];
    if (!q) continue;
    hyphaeAddDot(
      q.x,
      q.y,
      Math.max(1, r * random(0.45, 0.8)),
      gray * random(0.75, 0.95),
      random(100, 500),
    );
  }
}

// Mostly beads on the existing network (biased toward longer, brighter
// branches - best of three random picks - so the main hyphae get most of
// them), plus the occasional faint free-floating speck.
function hyphaeSprinkleDot() {
  if (hyphaeAllBranches.length === 0 || random() < HYPHAE_FREE_DOT_CHANCE) {
    hyphaeAddDot(
      random(WALL_BOUNDS.w),
      random(WALL_BOUNDS.h),
      random(0.6, 1.6),
      random(45, 110),
    );
    return;
  }
  let branch = null;
  for (let i = 0; i < 3; i++) {
    const pick = random(hyphaeAllBranches);
    if (!branch || pick.length > branch.length) branch = pick;
  }
  const segmentIndex = Math.floor(random(branch.segments.length));
  const points = branch.segments[segmentIndex];
  hyphaeAddLineDot(branch, segmentIndex, Math.floor(random(points.length)), 1, 120);
}

function initHyphae() {
  hyphaeBranches = [];
  hyphaeAllBranches = [];
  hyphaeBranchCount = 0;
  hyphaeDonePaths = HYPHAE_GENERATIONS.map(() => new Path2D());
  hyphaeLivePaths = HYPHAE_GENERATIONS.map(() => new Path2D());
  hyphaeDots = [];
  hyphaeDoneDots = new Map();
  hyphaeStartTime = millis();
  hyphaeLastRoot = millis();
  hyphaeStepProgress = 0;
  hyphaeDotDebt = 0;
  for (let i = 0; i < HYPHAE_INITIAL_ROOTS; i++) hyphaeSpawnRoot();
}

function updateHyphae() {
  const now = millis();
  if (now - hyphaeStartTime > HYPHAE_CYCLE) {
    initHyphae();
    return;
  }

  hyphaeStepProgress = Math.min(
    hyphaeStepProgress + (deltaTime / 1000) * HYPHAE_STEPS_PER_SECOND,
    HYPHAE_MAX_STEPS_PER_FRAME,
  );
  while (hyphaeStepProgress >= 1) {
    hyphaeStepProgress--;
    // Branches forked during this pass are pushed onto the end and only
    // start stepping next pass (forEach's range is fixed up front).
    hyphaeBranches.forEach((b) => b.step());
    hyphaeBranches = hyphaeBranches.filter((b) => b.alive);
  }

  if (
    now - hyphaeLastRoot > HYPHAE_ROOT_INTERVAL &&
    hyphaeBranchCount < HYPHAE_MAX_BRANCHES
  ) {
    hyphaeLastRoot = now;
    hyphaeSpawnRoot();
  }

  hyphaeDotDebt += (deltaTime / 1000) * HYPHAE_DOTS_PER_SECOND;
  while (hyphaeDotDebt >= 1) {
    hyphaeDotDebt--;
    hyphaeSprinkleDot();
  }

  // Fully swollen dots move into their gray bucket's shared path.
  hyphaeDots = hyphaeDots.filter((dot) => {
    if (now - dot.born < HYPHAE_DOT_GROW) return true;
    const gray =
      Math.round(dot.gray / HYPHAE_DOT_GRAY_STEP) * HYPHAE_DOT_GRAY_STEP;
    if (!hyphaeDoneDots.has(gray)) hyphaeDoneDots.set(gray, new Path2D());
    const path = hyphaeDoneDots.get(gray);
    path.moveTo(dot.x + dot.r, dot.y);
    path.arc(dot.x, dot.y, dot.r, 0, TWO_PI);
    return false;
  });

  // Built here, once per frame, rather than in drawHyphae, which runs once
  // per wall panel.
  hyphaeLivePaths = HYPHAE_GENERATIONS.map(() => new Path2D());
  hyphaeBranches.forEach((b) =>
    hyphaeAddBranchPath(hyphaeLivePaths[b.generation], b, true),
  );
}

// Appends a branch's polyline (one subpath per wrap segment) to `path`. A
// growing branch's tip is extended partway toward its next step by the
// fraction of a step that's elapsed, so it glides rather than hops.
function hyphaeAddBranchPath(path, branch, extendTip) {
  const last = branch.segments.length - 1;
  branch.segments.forEach((points, i) => {
    if (points.length < 2 && !(extendTip && i === last)) return;
    path.moveTo(points[0].x, points[0].y);
    for (let j = 1; j < points.length; j++)
      path.lineTo(points[j].x, points[j].y);
    if (extendTip && i === last) {
      const tip = points[points.length - 1];
      path.lineTo(
        tip.x + Math.cos(branch.angle) * HYPHAE_STEP * hyphaeStepProgress,
        tip.y + Math.sin(branch.angle) * HYPHAE_STEP * hyphaeStepProgress,
      );
    }
  });
}

function hyphaeGray(gray, alpha = 1) {
  const v = Math.round(gray);
  return `rgba(${v}, ${v}, ${v}, ${alpha})`;
}

function drawHyphae(pg) {
  const ctx = pg.drawingContext;
  const now = millis();
  ctx.save();
  ctx.globalAlpha = Math.min(
    1,
    Math.max(0, (HYPHAE_CYCLE - (now - hyphaeStartTime)) / HYPHAE_FADE),
  );

  // Finest generation first so the bright primaries sit on top.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let gen = HYPHAE_GENERATIONS.length - 1; gen >= 0; gen--) {
    const g = HYPHAE_GENERATIONS[gen];
    const paths = [hyphaeDonePaths[gen], hyphaeLivePaths[gen]];
    if (g.halo > 0) {
      // Soft glow: a wide, faint pass under the core stroke.
      ctx.strokeStyle = hyphaeGray(g.gray, g.halo);
      ctx.lineWidth = g.width * HYPHAE_WIDTH_SCALE * 4;
      paths.forEach((p) => ctx.stroke(p));
    }
    ctx.strokeStyle = hyphaeGray(g.gray);
    ctx.lineWidth = g.width * HYPHAE_WIDTH_SCALE;
    paths.forEach((p) => ctx.stroke(p));
  }

  // Dots last, so beads sit on top of the lines they swell out of.
  hyphaeDoneDots.forEach((path, gray) => {
    ctx.fillStyle = hyphaeGray(gray);
    ctx.fill(path);
  });
  hyphaeDots.forEach((dot) => {
    const t = Math.min(1, Math.max(0, (now - dot.born) / HYPHAE_DOT_GROW));
    ctx.fillStyle = hyphaeGray(dot.gray);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r * t, 0, TWO_PI);
    ctx.fill();
  });
  ctx.restore();
}
