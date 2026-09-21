/*
 * Shapes drifting outward from the wing sculptures (bird + 2 butterflies)
 * - or, on a wall with no sculptures at all (e.g. the right wall), from
 * its paintings instead, so every wall gets this scene's content.
 *
 * Reuses the exact same outline resolution as drawPulsingOutline in
 * js/outlines.js - outlinePaths[i] traced from the SVG, resolved through
 * that shape's calibrated butterflyMaps[i] QuadMap and then through the
 * wall's panel-aware inverse transform (js/wall.js) - so spawn points
 * always sit right on whatever the outline is currently corner-pinned
 * to, in sync with the pulsing rings. Particles launch from a random
 * point on the silhouette (or painting edge), heading roughly away from
 * its centroid, then drift and fade.
 */

const EMANATE_SPAWN_PER_OUTLINE = 0.35; // expected new particles per outline per frame
const EMANATE_MAX_PARTICLES = 220;

let emanateParticles = [];

class EmanateShape {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    const speed = random(0.3, 0.9);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.wander = random(-0.015, 0.015);
    this.size = random(4, 10);
    this.maxLife = random(180, 340);
    this.life = 0;
    this.rotation = random(TWO_PI);
    this.rotationSpeed = random(-0.03, 0.03);
    this.kind = floor(random(3)); // 0 circle, 1 triangle, 2 diamond
  }

  update() {
    this.life++;
    const speed = Math.hypot(this.vx, this.vy);
    const angle = Math.atan2(this.vy, this.vx) + this.wander;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotationSpeed;
  }

  get alive() {
    return this.life < this.maxLife;
  }

  display(pg) {
    const t = this.life / this.maxLife;
    let alpha;
    if (t < 0.15) alpha = 255 * (t / 0.15);
    else if (t > 0.7) alpha = 255 * (1 - (t - 0.7) / 0.3);
    else alpha = 255;

    pg.push();
    pg.translate(this.x, this.y);
    pg.rotate(this.rotation);
    pg.noStroke();
    pg.fill(255, alpha * 0.85);
    const s = this.size;
    if (this.kind === 0) {
      pg.circle(0, 0, s);
    } else if (this.kind === 1) {
      pg.triangle(0, -s * 0.6, s * 0.55, s * 0.4, -s * 0.55, s * 0.4);
    } else {
      pg.quad(0, -s * 0.6, s * 0.5, 0, 0, s * 0.6, -s * 0.5, 0);
    }
    pg.pop();
  }
}

// Same transform chain as drawPulsingOutline (js/outlines.js) - kept
// separate rather than shared so each effect can read outline geometry
// independently without coupling their draw order.
function emanateOutlineGeometry(index, refMap) {
  if (!outlinePaths[index]) return null;
  const panel = resolvePanelIndex(refMap);
  const localPoints = outlinePaths[index].map((p) => {
    const screenPoint = refMap.resolveToScreen(p.x, p.y);
    return panelToLogical(panel, screenPoint.x, screenPoint.y);
  });
  return { points: localPoints, centroid: polygonCentroid(localPoints) };
}

// Falls back to painting outlines when a wall has no wing sculptures at
// all (OUTLINE_SPECS is empty), so the scene isn't just blank there.
function emanateSpawnSources() {
  const outlineSources = butterflyMaps
    .map((refMap, i) => emanateOutlineGeometry(i, refMap))
    .filter(Boolean);
  if (outlineSources.length > 0) return outlineSources;

  return getPaintingPolygons().map((poly) => ({
    points: poly,
    centroid: polygonCentroid(poly),
  }));
}

function initEmanate() {
  emanateParticles = [];
}

function updateEmanate() {
  if (emanateParticles.length < EMANATE_MAX_PARTICLES) {
    emanateSpawnSources().forEach((geo) => {
      if (random() >= EMANATE_SPAWN_PER_OUTLINE) return;
      const p = random(geo.points);
      const angle =
        Math.atan2(p.y - geo.centroid.y, p.x - geo.centroid.x) +
        random(-0.3, 0.3);
      emanateParticles.push(new EmanateShape(p.x, p.y, angle));
    });
  }

  emanateParticles.forEach((p) => p.update());
  emanateParticles = emanateParticles.filter((p) => p.alive);
}

function drawEmanate(pg) {
  emanateParticles.forEach((p) => p.display(pg));
}
