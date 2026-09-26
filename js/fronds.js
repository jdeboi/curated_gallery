/*
 * Fronds: a grid of fern-like fronds (a central tapering stem with
 * alternating curved leaflets, like the reference silhouette this scene
 * was modeled on) that sway in a wind field driven by Perlin noise.
 *
 * The wind is a single shared noise field sampled per-frond at that
 * frond's own (x, y) plus a slowly advancing time coordinate
 * (frondWindValue(), 3-argument noise(x, y, t)) rather than one
 * independent noise lane per frond (contrast js/stars.js's per-star
 * noiseOffset) - that spatial correlation is what makes neighboring
 * fronds bend together in a passing wave instead of jittering
 * independently, which is what wind actually looks like. A slower second
 * noise lane (frondGustEnvelope()) scales the whole field up and down
 * over time for occasional gusts. Each frond still gets a small per-frond
 * phase offset folded into its time coordinate so two fronds standing at
 * the same spot in the field don't bend in lockstep forever - just mostly
 * together, the way real neighboring plants do.
 *
 * A frond's stem is bent by sampling that wind value once per frame and
 * applying it as an angle that grows with the square of how far along the
 * stem a point is (t*t) - a stiff base, floppier tip, which is the same
 * "more deflection near a cantilever's free end" shape a real flexible
 * stem bends in under a lateral load, done as a cheap approximation
 * rather than an actual physics sim. Leaflets are attached at fixed
 * points along that bent stem and inherit its local direction, so they
 * automatically sway with the stem instead of needing their own wind
 * calculation - only a small cheap sinusoidal flutter is added on top for
 * a bit of per-leaflet life.
 *
 * The stem is still drawn as a live tapered ribbon each frame
 * (emitBladeStrip()) since its curve genuinely changes shape every frame
 * as it bends - but every leaflet is a stamped sprite instead
 * (frondLeafTemplate, built once by ensureFrondLeafTemplate() and reused
 * for every leaflet on every frond, the same img-stamping trick
 * js/stars.js uses for its flowers). An early version rebuilt each
 * leaflet's curved ribbon from scratch every frame like the stem does -
 * at ~10 leaflets x ~40 fronds that's hundreds of curved ribbons, each
 * several pg.vertex() calls, every single frame, which turned out to be
 * the actual frame-rate cost (p5 2.0's immediate-mode vertex() builds real
 * Vertex/Shape objects per call, not a cheap array push). A leaflet's
 * *shape* never changes though - only its position, rotation (from the
 * bending stem) and length do - so it can be rasterized once to a small
 * offscreen buffer and every actual leaflet just becomes a
 * translate+rotate+scale+image() blit, the same handful of cheap calls
 * regardless of how curvy the template is. The template is built at
 * TEMPLATE_LEN with width/curl as fixed fractions of that length
 * (FROND_LEAF_WIDTH_FRAC/FROND_LEAF_CURL_FRAC), so scaling the stamp
 * uniformly by (actualLen / TEMPLATE_LEN) reproduces any leaflet's actual
 * width and curl in the same proportion without distortion - a leaflet's
 * curl direction is therefore fixed in the template's own local frame
 * rather than always bowing toward absolute "up" the way a from-scratch
 * ribbon could; mirrored via `pg.scale(1, side)` for alternating left/
 * right leaflets so a pair still curls away from each other.
 */

const FROND_GRID_SPACING = 110; // px between grid cell centers, in WALL_BOUNDS space
const FROND_POSITION_JITTER = 22; // max random offset off the strict grid point, each axis

const FROND_HEIGHT_MIN = 90;
const FROND_HEIGHT_MAX = 150;
const FROND_STEM_SEGMENTS = 9; // points along the bent stem - smoothness of the curve
const FROND_STEM_BASE_WIDTH = 3.2;
const FROND_STEM_TIP_WIDTH = 0.6;
const FROND_STATIC_TILT = 0.1; // max fixed per-frond lean off vertical, radians - breaks up a too-mechanical grid

const FROND_LEAF_START_T = 0.1; // fraction along the stem the first leaflet pair sits at
const FROND_LEAF_END_T = 0.96; // fraction along the stem the last (smallest) leaflet sits at
const FROND_LEAF_COUNT_MIN = 8;
const FROND_LEAF_COUNT_MAX = 12;
const FROND_LEAF_WIDTH_FRAC = 0.16; // leaflet max width as a fraction of its own length
const FROND_LEAF_CURL_FRAC = 0.35; // how strongly a leaflet's tip bows, as a fraction of its length
// Angles below are in radians, written as (degrees * DEG) for readability -
// plain Math.PI arithmetic rather than p5's radians(), since these are
// evaluated at script-load time, before p5 has necessarily attached its
// global helpers (p5 functions are only safe to call once setup() is
// under way).
const DEG = Math.PI / 180;
const FROND_LEAF_ANGLE_BASE = 78 * DEG; // angle off the stem tangent for the lowest leaflets - near-perpendicular
const FROND_LEAF_ANGLE_TIP = 28 * DEG; // angle off the stem tangent near the frond's apex - near-parallel
const FROND_LEAF_FLUTTER_SPEED = 0.02;
const FROND_LEAF_FLUTTER_AMOUNT = 6 * DEG;

const WIND_SPATIAL_SCALE = 0.006; // lower = broader, slower-varying gusts across the grid
const WIND_TIME_SCALE = 0.0035; // per-frame advance of the wind field's time coordinate
const WIND_MAX_ANGLE = 62 * DEG; // stem bend at the tip under full wind
const WIND_PHASE_JITTER = 2; // max per-frond offset folded into the time coordinate, breaks lockstep between fronds sharing a spot in the field

const WIND_GUST_TIME_SCALE = 0.0009; // slower lane -> gusts arrive/fade over several seconds
const WIND_GUST_MIN = 0.35;
const WIND_GUST_MAX = 1.5;

// Leaflet sprite template - see file header. Built once (ensureFrondLeafTemplate())
// and reused, scaled/rotated, for every leaflet on every frond.
const FROND_LEAF_TEMPLATE_SEGMENTS = 16; // one-time cost, so this can be generous
const FROND_LEAF_TEMPLATE_LEN = 100;
let frondLeafTemplate = null;
let frondLeafTemplateH = 0;

let fronds = [];
let frondWindTime = 0;

class Frond {
  constructor(x, y) {
    this.baseX = x;
    this.baseY = y;
    this.height = random(FROND_HEIGHT_MIN, FROND_HEIGHT_MAX);
    this.staticTilt = random(-FROND_STATIC_TILT, FROND_STATIC_TILT);
    this.phase = random(WIND_PHASE_JITTER); // folded into the wind field's time coordinate
    this.flutterSeed = random(1000);
    this.maxLeafLen = this.height * random(0.32, 0.4);

    const leafCount = Math.round(
      random(FROND_LEAF_COUNT_MIN, FROND_LEAF_COUNT_MAX),
    );
    this.leafAttachTs = [];
    for (let i = 0; i < leafCount; i++) {
      const t = map(i, 0, leafCount - 1, FROND_LEAF_START_T, FROND_LEAF_END_T);
      this.leafAttachTs.push(t);
    }
  }
}

// Appends one tapered ribbon around the given centerline to an already-open
// beginShape(TRIANGLES). widthFn(t) is the full width (not half) at that
// fraction along `points`. Used for the stem every frame, and once for the
// leaflet template.
function emitBladeStrip(pg, points, widthFn) {
  const n = points.length;
  let prevLeft, prevRight;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const hw = widthFn(t) / 2;
    const left = { x: p.x + nx * hw, y: p.y + ny * hw };
    const right = { x: p.x - nx * hw, y: p.y - ny * hw };

    if (i > 0) {
      pg.vertex(prevLeft.x, prevLeft.y);
      pg.vertex(prevRight.x, prevRight.y);
      pg.vertex(left.x, left.y);

      pg.vertex(left.x, left.y);
      pg.vertex(prevRight.x, prevRight.y);
      pg.vertex(right.x, right.y);
    }
    prevLeft = left;
    prevRight = right;
  }
}

// Quadratic bezier sample, base -> ctrl -> tip.
function quadraticBezierPoints(base, ctrl, tip, segments) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    points.push({
      x: u * u * base.x + 2 * u * t * ctrl.x + t * t * tip.x,
      y: u * u * base.y + 2 * u * t * ctrl.y + t * t * tip.y,
    });
  }
  return points;
}

// Builds the shared leaflet sprite once - a curved, tapered blade pointing
// along +x from local (0, H/2) to (TEMPLATE_LEN, H/2), bowed toward local
// -y by TEMPLATE_LEN * FROND_LEAF_CURL_FRAC. See file header for why this
// replaced rebuilding each leaflet's ribbon from scratch every frame.
function ensureFrondLeafTemplate() {
  if (frondLeafTemplate) return;

  const maxWidth = FROND_LEAF_TEMPLATE_LEN * FROND_LEAF_WIDTH_FRAC;
  const curl = FROND_LEAF_TEMPLATE_LEN * FROND_LEAF_CURL_FRAC;
  const margin = maxWidth / 2 + 2;
  const h = 2 * (curl + margin);
  const w = FROND_LEAF_TEMPLATE_LEN + 2;
  frondLeafTemplateH = h;

  const base = { x: 1, y: h / 2 };
  const tip = { x: 1 + FROND_LEAF_TEMPLATE_LEN, y: h / 2 };
  const ctrl = { x: (base.x + tip.x) / 2, y: h / 2 - curl };
  const points = quadraticBezierPoints(
    base,
    ctrl,
    tip,
    FROND_LEAF_TEMPLATE_SEGMENTS,
  );

  frondLeafTemplate = createGraphics(w, h);
  frondLeafTemplate.pixelDensity(1); // stamped scaled per-instance anyway - no benefit to a retina buffer
  frondLeafTemplate.noStroke();
  frondLeafTemplate.fill(255);
  frondLeafTemplate.beginShape(TRIANGLES);
  emitBladeStrip(
    frondLeafTemplate,
    points,
    (t) => maxWidth * Math.sin(Math.PI * t),
  );
  frondLeafTemplate.endShape();
}

function initFronds() {
  ensureFrondLeafTemplate();
  fronds = [];
  frondWindTime = 0;
  const cols = Math.floor(WALL_BOUNDS.w / FROND_GRID_SPACING);
  const rows = Math.floor(WALL_BOUNDS.h / FROND_GRID_SPACING);
  const offsetX = (WALL_BOUNDS.w - (cols - 1) * FROND_GRID_SPACING) / 2;
  const offsetY = (WALL_BOUNDS.h - (rows - 1) * FROND_GRID_SPACING) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x =
        offsetX +
        col * FROND_GRID_SPACING +
        random(-FROND_POSITION_JITTER, FROND_POSITION_JITTER);
      const y =
        offsetY +
        row * FROND_GRID_SPACING +
        random(-FROND_POSITION_JITTER, FROND_POSITION_JITTER);
      fronds.push(new Frond(x, y));
    }
  }
}

function updateFronds() {
  frondWindTime += WIND_TIME_SCALE;
}

// Slow-moving envelope shared by every frond, so gusts rise and fade
// across the whole wall together rather than each frond gusting on its
// own independent schedule.
function frondGustEnvelope() {
  const raw = noise(5000, frameCount * WIND_GUST_TIME_SCALE);
  return map(raw, 0, 1, WIND_GUST_MIN, WIND_GUST_MAX);
}

// -1..1 lateral wind value at this frond's position and moment - spatially
// correlated via shared (x, y) noise coordinates, individually offset via
// each frond's own phase so nearby fronds bend together without ever
// moving in perfect lockstep.
function frondWindValue(frond) {
  const raw = noise(
    frond.baseX * WIND_SPATIAL_SCALE,
    frond.baseY * WIND_SPATIAL_SCALE,
    frondWindTime + frond.phase,
  );
  // Raw noise() sits mostly in the 0.3-0.7 band (same observation as
  // js/stars.js's twinkle) - mapping that narrower band to the full -1..1
  // range, then clamping, means the bend actually swings out toward its
  // full WIND_MAX_ANGLE at either side instead of just wobbling weakly
  // around center the way mapping noise()'s full 0..1 range would.
  return constrain(map(raw, 0.3, 0.7, -1, 1), -1, 1);
}

// Bent stem for one frond this frame: an array of {x, y} points from base
// to tip, plus the local heading angle used to reach each point (needed so
// leaflets attached along the stem inherit the stem's own bend instead of
// pointing at a fixed rest angle). Deflection grows with t^2 (stiff base,
// floppier tip) - see file header.
function frondStemPoints(frond, bendAngle) {
  const points = [{ x: frond.baseX, y: frond.baseY }];
  const angles = [-HALF_PI + frond.staticTilt];
  const stepLen = frond.height / FROND_STEM_SEGMENTS;

  for (let i = 1; i <= FROND_STEM_SEGMENTS; i++) {
    const t = i / FROND_STEM_SEGMENTS;
    const angle = -HALF_PI + frond.staticTilt + bendAngle * t * t;
    const prev = points[i - 1];
    points.push({
      x: prev.x + Math.cos(angle) * stepLen,
      y: prev.y + Math.sin(angle) * stepLen,
    });
    angles.push(angle);
  }
  return { points, angles };
}

// How long a leaflet at fraction t along the stem is, as a fraction of
// frond.maxLeafLen - short near the very base, peaking a bit further up,
// then tapering steadily toward the apex (matches the reference image's
// silhouette, where the longest leaflets sit low but not at the base).
function frondLeafLengthFrac(t) {
  if (t < 0.3) return map(t, 0, 0.3, 0.3, 1);
  return map(t, 0.3, 1, 1, 0.14);
}

// Stamps one leaflet: translate to its attach point on the bent stem,
// rotate to its angle off the stem tangent (alternating sides, narrowing
// toward the apex), scale the shared template uniformly by
// actualLen/TEMPLATE_LEN (see file header for why a uniform scale
// reproduces the leaflet's width/curl in the right proportion), and blit
// it - no per-frame vertex work at all.
function emitFrondLeaf(pg, frond, base, stemAngle, t, index) {
  const side = index % 2 === 0 ? 1 : -1;
  const angleFromStem = lerp(FROND_LEAF_ANGLE_BASE, FROND_LEAF_ANGLE_TIP, t);
  const flutter =
    Math.sin(
      frameCount * FROND_LEAF_FLUTTER_SPEED + frond.flutterSeed + index,
    ) * FROND_LEAF_FLUTTER_AMOUNT;
  const leafAngle = stemAngle + side * angleFromStem + flutter;

  const len = frondLeafLengthFrac(t) * frond.maxLeafLen;
  const scale = len / FROND_LEAF_TEMPLATE_LEN;

  pg.push();
  pg.translate(base.x, base.y);
  pg.rotate(leafAngle);
  pg.scale(1, side); // mirrors the template so alternating leaflets curl apart, not in parallel
  pg.image(
    frondLeafTemplate,
    0,
    (-frondLeafTemplateH / 2) * scale,
    frondLeafTemplate.width * scale,
    frondLeafTemplateH * scale,
  );
  pg.pop();
}

// Every frond's stem batches into one shared beginShape(TRIANGLES)/endShape()
// pair (one fill() call total, same reasoning as js/vines.js - see that
// file's header) rather than one shape per frond; leaf images are stamped
// in a separate pass afterward since image() can't live inside a shape.
function drawFronds(pg) {
  const gust = frondGustEnvelope();
  const frondStems = fronds.map((frond) => {
    const bendAngle = frondWindValue(frond) * WIND_MAX_ANGLE * gust;
    return { frond, ...frondStemPoints(frond, bendAngle) };
  });

  pg.push();
  pg.noStroke();
  pg.fill(255);

  pg.beginShape(TRIANGLES);
  frondStems.forEach(({ points }) =>
    emitBladeStrip(pg, points, (t) =>
      lerp(FROND_STEM_BASE_WIDTH, FROND_STEM_TIP_WIDTH, t),
    ),
  );
  pg.endShape();

  frondStems.forEach(({ frond, points, angles }) => {
    frond.leafAttachTs.forEach((t, index) => {
      const segIndex = Math.round(t * FROND_STEM_SEGMENTS);
      emitFrondLeaf(pg, frond, points[segIndex], angles[segIndex], t, index);
    });
  });

  pg.pop();
}
