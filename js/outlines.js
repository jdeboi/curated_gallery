/*
 * Pulsing/expanding outlines for the wing sculptures (bird + 2 butterflies).
 *
 * Each sculpture gets a QuadMap reference surface (see sketch.js), sized
 * to that SVG's own viewBox so the traced silhouette points - sampled
 * once from the path and never touched again - sit in the quad's local,
 * un-warped (0,0)-(width,height) rectangle. Calibrating a shape then just
 * means corner-pinning that quad (the same 4-handle drag already used for
 * paintingMaps/quadMap itself) to scale/keystone/position the whole wing
 * or bird onto the physical piece - no per-point dragging needed, because
 * the shape is fixed and only the quad's 4 corners move.
 *
 * refMap.resolveToScreen(localX, localY) is p5.mapper's own forward
 * perspective-warp primitive (the same one it uses to keystone a texture
 * onto a QuadMap) - it maps a point from that local rectangle through the
 * quad's current corner positions to get its true canvas position. That
 * absolute point is then run through quadMap's own inverse transform to
 * land in quadMap's local drawing space, where the pulsing rings are
 * drawn straight into quadMap's single visible surface - never clipped
 * to a small reference buffer.
 */

const OUTLINE_SPECS = [
  { name: "bird", file: "assets/bird.svg", width: 322.5, height: 294.49 },
  { name: "butterfly0", file: "assets/butterfly0.svg", width: 328.97, height: 242.07 },
  { name: "butterfly1", file: "assets/butterfly1.svg", width: 276.61, height: 272.9 },
];

const OUTLINE_LANDMARK_COUNT = 24;

let outlinePaths = [];

// Traces each shape's silhouette into outlinePaths[i], in that SVG's own
// local coordinate space (matching the QuadMap it's warped through - see
// butterflyMaps in sketch.js). Nothing here touches the reference surface
// itself - drawPulsingOutline reads outlinePaths + the surface's current
// corners together at draw time, so a saved calibration (the quad's 4
// corners) and the traced shape never fight over the same data the way a
// PolyMap's own point array would.
function loadOutlineSVGs() {
  return Promise.all(
    OUTLINE_SPECS.map((spec, i) =>
      fetch(spec.file)
        .then((res) => res.text())
        .then((svgText) => tracePathPoints(svgText, OUTLINE_LANDMARK_COUNT))
        .then((points) => {
          outlinePaths[i] = points;
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

  const localPoints = outlinePaths[index].map((p) => {
    const screenPoint = refMap.resolveToScreen(p.x, p.y);
    return quadMap.getTransformedCursor(screenPoint.x, screenPoint.y);
  });
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
