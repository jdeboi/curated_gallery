/*
 * Pulsing/expanding outlines for the wing sculptures (bird + 2 butterflies).
 *
 * Each sculpture gets a PolyMap reference surface (see sketch.js), seeded
 * with points sampled directly from its SVG's traced silhouette - not a
 * bounding rectangle - so calibrating it means dragging the actual wing/
 * bird shape onto the physical piece, not fighting a box that doesn't
 * resemble it. p5.mapper's default interaction mode already supports both
 * dragging the whole polygon at once (coarse placement) and dragging
 * individual points (fine-tuning wingtips etc.) without any extra setup.
 *
 * PolyMap points are plain, unwarped positions (no perspective pinning
 * like QuadMap), so getting a point's real canvas position is just
 * refMap.x + point.x / refMap.y + point.y - same pattern paintings.js
 * uses for its corners. That absolute point is then run through
 * quadMap's own inverse transform to land in quadMap's local drawing
 * space, where the pulsing rings are drawn straight into quadMap's
 * single visible surface - never clipped to a small reference buffer.
 */

const OUTLINE_SPECS = [
  { name: "bird", file: "assets/bird.svg" },
  { name: "butterfly0", file: "assets/butterfly0.svg" },
  { name: "butterfly1", file: "assets/butterfly1.svg" },
];

const OUTLINE_LANDMARK_COUNT = 24;

let outlinePaths = [];

// Seeds each butterflyMaps[i] PolyMap from its traced silhouette and
// resolves once all 3 are ready. Call this - and let it resolve - before
// pMapper.load(), so a saved calibration can override these seed
// positions instead of being clobbered by them once the fetch lands.
function loadOutlineSVGs() {
  return Promise.all(
    OUTLINE_SPECS.map((spec, i) =>
      fetch(spec.file)
        .then((res) => res.text())
        .then((svgText) => tracePathPoints(svgText, OUTLINE_LANDMARK_COUNT))
        .then((points) => {
          outlinePaths[i] = points;
          butterflyMaps[i].setPoints(points);
        })
        .catch((err) => console.error("Failed to load outline SVG:", spec.file, err)),
    ),
  );
}

function tracePathPoints(svgText, numPoints) {
  const d = svgText.match(/<path[^>]*\sd="([^"]+)"/)[1];

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  svg.style.position = "absolute";
  svg.style.left = "-9999px";
  document.body.appendChild(svg);

  const totalLength = path.getTotalLength();
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const pt = path.getPointAtLength((i / numPoints) * totalLength);
    points.push({ x: pt.x, y: pt.y });
  }

  document.body.removeChild(svg);
  return points;
}

function drawPulsingOutline(pg, index, refMap) {
  if (!outlinePaths[index]) return;

  const localPoints = refMap.points.map((p) =>
    quadMap.getTransformedCursor(refMap.x + p.x, refMap.y + p.y),
  );
  const centroid = polygonCentroid(localPoints);
  const osc = pMapper.getOscillator(3);

  const numRings = 3;
  for (let r = 0; r < numRings; r++) {
    const ringPhase = (osc + r / numRings) % 1;
    const scale = 1 + ringPhase * 0.6;
    const alpha = 255 * (1 - ringPhase);

    pg.push();
    pg.noFill();
    pg.stroke(255, alpha);
    pg.strokeWeight(2);
    pg.beginShape();
    localPoints.forEach((p) => {
      pg.vertex(
        centroid.x + (p.x - centroid.x) * scale,
        centroid.y + (p.y - centroid.y) * scale,
      );
    });
    pg.endShape(CLOSE);
    pg.pop();
  }
}
