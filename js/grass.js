/*
 * "grass" scene - a field of grass blades covering the whole wall, swaying
 * in a traveling wind.
 *
 * Drawn as plain vector shapes straight into the wall panel's 2D buffer
 * (no offscreen shader canvas), so blade edges stay crisp at any panel
 * resolution. Each blade is one closed path - two quadratic curves from
 * either side of its root up to a shared pointed tip - issued through the
 * native canvas context (pg.drawingContext) rather than p5's
 * beginShape()/vertex(): p5 2.0's immediate-mode vertex() is the frame-rate
 * bottleneck at a few hundred curved shapes (see js/fronds.js's header),
 * while a native quadraticCurveTo() is a single cheap call. p5's own
 * translate() still applies, since it's set on that same context.
 *
 * The field is stacked rows (GRASS_ROW_SPACING apart, top to bottom of the
 * wall), each row a line of blades GRASS_CELL_WIDTH apart with jittered
 * root positions/heights/leans. Blades are taller than the row spacing, so
 * each row overlaps the rows above it - that overlap is what reads as a
 * continuous lawn rather than separate strips. Rows are drawn back to front
 * (top of the wall first), every blade in a row batched into one path with
 * one fill + one stroke: the fill is a vertical gradient from black at the
 * row's roots to white at its tallest tips, so each row fades into the
 * shadow of the row in front of it, and the thin black stroke separates
 * overlapping blades from each other.
 *
 * A blade bends toward its wind offset with a stiff base and floppy tip -
 * the quadratic's control point sits partway up above the root, so the
 * curve leaves the ground near-vertical and only curls at the top (same
 * cantilever feel as js/fronds.js). The wind is a traveling wave plus
 * shared noise sampled at each blade's own root x, so neighboring blades
 * bend together and gusts visibly roll across the wall.
 *
 * Blade geometry is computed once per frame in updateGrass(): drawGrass()
 * runs once per wall panel (js/wall.js's displayWall()), so doing the wind
 * math there would repeat it for every panel.
 *
 * Blades grow up from nothing over GRASS_GROW_MS at scene start, so the
 * scene opens with the lawn sprouting rather than popping in.
 */

const GRASS_ROW_SPACING = 32; // logical px between blade rows
const GRASS_CELL_WIDTH = 26; // logical px between blades within a row - smaller = denser
const GRASS_ROOT_JITTER = 0.8; // root offset within its cell, as a fraction of cell width/row spacing
const GRASS_HEIGHT_MIN = 45;
const GRASS_HEIGHT_MAX = 95;
const GRASS_BASE_WIDTH = 7; // half-width at the root, logical px
const GRASS_MAX_LEAN = 0.25; // static lean off vertical, as a fraction of blade height
const GRASS_BEND = 0.3; // max wind deflection at the tip, as a fraction of blade height
const GRASS_WIND_SPEED = 2.0;
const GRASS_GROW_MS = 5000;
const GRASS_EDGE_WEIGHT = 1.5; // black stroke separating overlapping blades
// Tip and root colors (CSS). White-on-black to match the other plant
// scenes; roots fade toward black so overlapping rows read with depth.
const GRASS_TIP_COLOR = "rgb(255, 255, 255)";
const GRASS_ROOT_COLOR = "rgb(0, 0, 0)";

let grassRows = []; // [{ rootY, blades: [{ x, y, height, lean, width, sway }] }]
let grassPaths = []; // per row, this frame: { rootY, path: Path2D }
let grassStartMs = 0;

function initGrass() {
  grassStartMs = millis();
  grassRows = [];
  const rows = Math.ceil(WALL_BOUNDS.h / GRASS_ROW_SPACING) + 1;
  const cols = Math.ceil(WALL_BOUNDS.w / GRASS_CELL_WIDTH) + 1;
  for (let r = 0; r < rows; r++) {
    const rowY = r * GRASS_ROW_SPACING;
    const blades = [];
    for (let c = -1; c < cols; c++) {
      blades.push({
        x: (c + random(GRASS_ROOT_JITTER)) * GRASS_CELL_WIDTH,
        y: rowY + random(GRASS_ROOT_JITTER) * GRASS_ROW_SPACING,
        height: random(GRASS_HEIGHT_MIN, GRASS_HEIGHT_MAX),
        lean: random(-1, 1) * GRASS_MAX_LEAN,
        width: GRASS_BASE_WIDTH * random(0.7, 1.3),
        sway: random(0.8, 1.2),
      });
    }
    grassRows.push({ rootY: rowY + GRASS_ROW_SPACING, blades });
  }
  grassPaths = [];
}

// Traveling wind wave, roughly -1..1 (biased slightly to one side so the
// lawn has a prevailing lean), sampled at a blade's root x.
function grassWind(x, t) {
  const gust = 0.55 + 0.45 * Math.sin(t * 0.21);
  const w =
    0.6 * Math.sin(x * 0.005 - t * 1.1) +
    0.5 * (noise(x * 0.012 - t * 0.7, 71) * 2 - 1);
  return w * gust + 0.25;
}

function updateGrass() {
  const grow = Math.min(1, (millis() - grassStartMs) / GRASS_GROW_MS);
  const growEase = 1 - Math.pow(1 - grow, 3); // ease-out so the sprout slows as it reaches full height
  const t = (millis() / 1000) * GRASS_WIND_SPEED;

  grassPaths = grassRows.map((row) => {
    const path = new Path2D();
    row.blades.forEach((b) => {
      const h = b.height * growEase;
      if (h < 1) return;
      const tipX = b.x + (b.lean + grassWind(b.x, t) * GRASS_BEND * b.sway) * h;
      const tipY = b.y - h;
      // Control point partway up, only slightly leaned - stiff base, and
      // most of the bend happens near the tip.
      const ctrlX = b.x + b.lean * h * 0.5;
      const ctrlY = b.y - h * 0.55;
      const w = b.width * Math.min(1, growEase * 2);
      path.moveTo(b.x - w, b.y);
      path.quadraticCurveTo(ctrlX - w * 0.8, ctrlY, tipX, tipY);
      path.quadraticCurveTo(ctrlX + w * 0.8, ctrlY, b.x + w, b.y);
      path.closePath();
    });
    return { rootY: row.rootY, path };
  });
}

function drawGrass(pg) {
  pg.background(0);
  const ctx = pg.drawingContext;
  ctx.save();
  ctx.strokeStyle = GRASS_ROOT_COLOR;
  ctx.lineWidth = 0; //GRASS_EDGE_WEIGHT;
  ctx.lineJoin = "round";
  grassPaths.forEach(({ rootY, path }) => {
    const grad = ctx.createLinearGradient(
      0,
      rootY,
      0,
      rootY - GRASS_HEIGHT_MAX,
    );
    grad.addColorStop(0, GRASS_ROOT_COLOR);
    grad.addColorStop(0.75, GRASS_TIP_COLOR);
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.stroke(path);
  });
  ctx.restore();
}
``;
