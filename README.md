# left_wall

Projection mapping sketch for a wall of curated paintings, built on
[p5.mapper](https://github.com/jdeboi/p5.mapper). It projects animated grass
particles, pulsing bird/butterfly outlines, and painting-shaped glow/spotlight
effects onto a physical wall, corner-pinned to the projector.

## Running it

Static site - serve the folder and open it:

```bash
npx http-server .
# or
python3 -m http.server 8000
```

## How the surfaces fit together

There's one **visible** surface and several **reference-only** ones:

- `quadMap` - the single corner-pinned `QuadMap` covering the whole wall.
  Every visible pixel (particles, painting glows, outline pulses) is drawn
  into this one surface (`quadMap.displaySketch(...)` in `sketch.js`).
- `paintingMaps[]` - one small `QuadMap` per painting, corner-pinned onto
  that painting's four corners. These never draw anything themselves
  (`pm.displaySketch(() => {})`) - they exist purely so their calibrated
  corners can be read back (`js/paintings.js`) to know exactly where each
  painting sits on the wall, so the glow/spotlight effects drawn into
  `quadMap` can be positioned and sized correctly.
- `butterflyMaps[]` - one `PolyMap` per wing sculpture (bird + 2
  butterflies), seeded from the actual traced SVG silhouette rather than a
  bounding box, so calibrating it means dragging the real wing/bird shape
  onto the physical piece. Same deal: reference-only, read back by
  `js/outlines.js` to draw the pulsing rings into `quadMap`.

This split exists so each painting/sculpture can be aligned independently
(their own draggable corners/points) while all the actual rendering happens
in one texture, avoiding N separate offscreen buffers with visible content.

## Calibration workflow

1. Press `c` to enter calibration mode.
2. Drag `quadMap`'s four corners to fit the wall.
3. Drag each `paintingMaps[i]` / `butterflyMaps[i]` onto its physical
   painting or sculpture.
4. Press `p` to **lock** every painting/outline reference surface as a
   child of `quadMap` (see below).
5. Press `s` to save calibration to `maps/map.json`.

Keybindings (see `keyPressed()` in `sketch.js`):

| Key | Action |
| --- | --- |
| `c` | Toggle calibration mode |
| `p` | Toggle parent-lock (paintings/outlines <-> wall) |
| `s` | Save calibration to `map.json` |
| `l` | Reload calibration from `map.json` |
| `f` | Toggle fullscreen |
| `i` | Cycle painting light mode (on / glow / outline) |

## Parenting: keeping paintings aligned when the wall moves

`paintingMaps` and `butterflyMaps` are calibrated in absolute screen space,
same as `quadMap`. If the projector gets bumped and `quadMap` needs
re-keystoning, every painting/outline reference would otherwise need to be
re-dragged too.

Pressing `p` parents all of them to `quadMap` using p5.mapper's built-in
`Surface.setParent()`. Once locked:

- Each painting/outline's calibration is stored **relative to `quadMap`'s
  own local (pre-warp) space** instead of absolute screen coordinates.
- Moving/re-keystoning `quadMap` alone re-derives every parented surface's
  position automatically (`recalcFromParent()`), so the paintings track the
  wall.
- Whole-surface dragging is disabled on locked surfaces (p5.mapper
  restriction - a raw screen-space drag isn't exact once the parent has any
  keystone). **Dragging individual corners/points still works while
  locked** and is correctly expressed relative to the parent, so minor
  touch-ups don't require unlocking.
- The lock state is visible on-screen (top-left, below the frame rate) and
  is saved/restored with the rest of the calibration in `map.json`
  (p5.mapper persists it as `parentId` on each surface).

Press `p` again to **unlock**: every surface's current resolved position is
frozen back into absolute coordinates (no jump) and whole-shape dragging is
restored, e.g. for a bigger repositioning. Press `p` once more to relock.

## Fixed: WebGL context exhaustion while dragging a locked wall

`js/debug.js` is a temporary diagnostic harness (not part of the mapping
logic) added to track down a "lock parenting, start dragging the wall ->
screen goes white and unresponsive" report. Root cause, found via its
`createGraphics()` call logging: `PolyMap.recalcFromParent()` (in
p5.mapper) re-derived each parented outline's bounding box every frame
while its parent (`quadMap`) was being dragged, and called
`setDimensions()` -> `setSize()`, which **recreates that surface's
offscreen buffer** (a fresh `createGraphics()`, i.e. 1-2 new `<canvas>`
elements) whenever the floored width/height differs from last frame.
Continuously-perturbed floating-point homography output flips that floor
by +-1px on most frames, so every parented `butterflyMaps[i]` was
reallocating its buffer nearly every frame of a drag - fast enough to blow
through the browser's WebGL context budget (observed: ~30 canvases growing
past 140 within about a second of dragging) and crash the canvas to white.

Fixed at the source in p5.mapper itself
(`~/Projects/p5/p5.mapper/src/surfaces/PolyMap.ts`,
`recalcFromParent()` no longer calls `setDimensions()`/`setSize()` -
`displaySurface()` and `isMouseOver()` already recompute bounds straight
from `this.points`, so a parent-driven reposition has no correctness need
to resize the buffer; `setPoints()`/`load()`, the actual structural
changes, still do). Rebuilt and re-vendored into
`lib/p5.mapper.min.js`. `js/debug.js` can be removed once you're confident
no other white-screen reports remain.

## Files

- `sketch.js` - setup/draw/keybindings, surface creation.
- `js/paintings.js` - reads painting quad corners back into polygons, draws
  the glow/spotlight effects.
- `js/outlines.js` - loads/traces the bird + butterfly SVGs into PolyMap
  points, draws the pulsing outlines.
- `js/particles.js` - the floating grass particle system.
- `js/parenting.js` - lock/unlock helpers wiring paintings/outlines to
  `quadMap` via p5.mapper's parenting API.
- `js/debug.js` - temporary WebGL-context diagnostic harness (see above).
- `maps/map.json` - saved calibration (surface positions, corner pins,
  parent relationships).
