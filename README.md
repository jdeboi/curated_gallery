# curated walls

Projection mapping installations for walls of curated paintings, built on
[p5.mapper](https://github.com/jdeboi/p5.mapper). This one repo drives
multiple walls - **left wall** (one flat surface) and **right wall**
(three flat panels, because that wall physically curves) - sharing one
engine: a timed show that cycles through generative scenes (mycelium
growth, shapes emanating from wing sculptures/paintings, fireflies) while
pulsing bird/butterfly outlines and painting-shaped glow/spotlight effects
stay on constantly, corner-pinned to each wall's projector(s).

Two independently-running walls (no network between them) still land on
the same scene at the same time, because the show schedule is derived
from the system clock rather than from when either page happened to
load - see "The show" below.

## Running it

Static site - serve the repo root and open it:

```bash
npx http-server .
# or
python3 -m http.server 8000
```

`index.html` is just a landing page linking to `left.html` and
`right.html` - open whichever wall you're working on directly.

## How a wall is put together

Everything reusable lives in `js/` (and `lib/p5.mapper.min.js`) - it
knows nothing about how many paintings, sculptures, or panels a specific
wall has. Each wall supplies that as data in its own `js/<wall>/sketch.js`:

- **`wallPanels`** (`js/wall.js`) - one or more corner-pinned `QuadMap`s,
  each placed at an `{x, y}` offset inside one shared **logical drawing
  space**. Left wall has one panel at `(0,0)`; right wall has three,
  side by side, because its physical curve can't be corner-pinned as a
  single flat quad. Every visible pixel (scene content, painting glows,
  outline pulses) is authored once in that shared logical space and
  drawn into *every* panel (`displayWall()`); each panel's own buffer
  size clips it down to just its own slice, so content (mycelium,
  fireflies) can grow/drift right across the seam between panels.
- **`PAINTING_SPECS[]`** - one entry per painting: size, corner-pin
  resolution, and which panel it's physically mounted on (`panel`
  index). Each becomes a `QuadMap` (`paintingMaps[]`) that never draws
  anything itself - it exists purely so its calibrated corners can be
  read back (`js/paintings.js`), converted into the shared logical space
  via that painting's own panel, to draw the glow/spotlight effects.
- **`OUTLINE_SPECS[]`** - one entry per wing sculpture (name, SVG file,
  size, panel). Empty on a wall with none (right wall, for now). Each
  becomes a `QuadMap` (`butterflyMaps[]`), seeded from the traced SVG
  silhouette rather than a bounding box, so calibrating it means
  dragging the real wing/bird shape onto the physical piece. Read back
  by `js/outlines.js` to draw the pulsing rings.

This split exists so each painting/sculpture/panel can be calibrated
independently while all the actual rendering happens in a shared
coordinate space, not siloed per panel.

## The show

`js/scenes.js` holds the `SCENES` list - each entry is a self-contained
`{ name, duration, init, update, draw }`. Which scene is live, and how
far into it, is computed from `Date.now() % totalShowDuration` - not
"time since this page loaded" - so any wall running this code with a
roughly-synced clock (NTP) lands on the same scene at the same moment as
any other, with zero network link required. This syncs *timing* only:
each wall's mycelium/particles/emanate still run their own independent
randomness, so the specific shapes won't match pixel-for-pixel between
walls, just the scene and its phase.

Current scenes:

- **mycelium** (`js/mycelium.js`) - branching hyphae growth.
- **emanate** (`js/emanate.js`) - spore-like shapes drifting outward from
  the wing sculptures, or from paintings on a wall with no sculptures.
- **fireflies** (`js/particles.js`) - floating pulsing particles.

To add a scene: give it its own `js/whatever.js` with `initX()`,
`updateX()`, `drawX(pg)`, add a script tag in each wall's `.html` (before
`js/scenes.js`), and add `{ name, duration, init: initX, update: updateX,
draw: drawX }` to `SCENES` in `js/scenes.js` (shared by every wall).

| Key | Action |
| --- | --- |
| `→` / `←` | Next / previous scene - a local preview override, stops following the clock |
| `space` | Resume following the clock (snaps to wherever the schedule says "now" is) / pause |

## Calibration workflow

1. Press `c` to enter calibration mode.
2. Drag each wall panel's four corners to fit its flat section of the
   wall (right wall: one drag per panel).
3. Drag each `paintingMaps[i]` / `butterflyMaps[i]` onto its physical
   painting or sculpture.
4. Press `p` to **lock** every painting/outline reference surface as a
   child of *its own* panel (see below).
5. Press `s` - this downloads a JSON file (`left-map.json` /
   `right-map.json`) to your browser's Downloads folder. Move it to
   `maps/left/map.json` / `maps/right/map.json` to persist it.

Keybindings (see `keyPressed()` in each wall's `sketch.js`):

| Key | Action |
| --- | --- |
| `c` | Toggle calibration mode |
| `p` | Toggle parent-lock (paintings/outlines <-> their panel) |
| `s` | Save calibration (downloads a JSON file - see step 5 above) |
| `l` | Reload calibration from `maps/<wall>/map.json` |
| `f` | Toggle fullscreen |
| `i` | Cycle painting light mode (on / glow / outline) |

## Parenting: keeping paintings aligned when a panel moves

`paintingMaps` and `butterflyMaps` are calibrated in absolute screen
space, same as each wall panel. If a projector gets bumped and a panel
needs re-keystoning, every painting/outline mounted on it would
otherwise need to be re-dragged too.

Pressing `p` parents each one to *its own* panel (`PAINTING_SPECS[i].panel`
/ `OUTLINE_SPECS[i].panel`) using p5.mapper's built-in `Surface.setParent()`.
Once locked:

- Each painting/outline's calibration is stored **relative to its
  panel's own local (pre-warp) space** instead of absolute screen
  coordinates.
- Moving/re-keystoning that panel alone re-derives every parented
  surface's position automatically (`recalcFromParent()`) - on a
  multi-panel wall, only the pieces mounted on that specific panel move.
- Whole-surface dragging is disabled on locked surfaces (p5.mapper
  restriction - a raw screen-space drag isn't exact once the parent has
  any keystone). **Dragging individual corners/points still works while
  locked** and is correctly expressed relative to the parent, so minor
  touch-ups don't require unlocking.
- The lock state is visible on-screen (top-left, below the frame rate)
  and is saved/restored with the rest of the calibration in
  `maps/<wall>/map.json` (p5.mapper persists it as `parentId` on each
  surface).

Press `p` again to **unlock**: every surface's current resolved position
is frozen back into absolute coordinates (no jump) and whole-shape
dragging is restored, e.g. for a bigger repositioning. Press `p` once
more to relock.

## Fixed: WebGL context exhaustion while dragging a locked wall

`js/debug.js` is a temporary diagnostic harness (not part of the mapping
logic) added to track down a "lock parenting, start dragging the wall ->
screen goes white and unresponsive" report. Root cause, found via its
`createGraphics()` call logging: `PolyMap.recalcFromParent()` (in
p5.mapper) re-derived each parented outline's bounding box every frame
while its parent panel was being dragged, and called
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

## Adding another wall

1. Copy `js/right/sketch.js` (or `js/left/sketch.js`, if it's a single
   flat wall) into a new `js/<wall>/sketch.js`, and adjust `wallPanels`,
   `PAINTING_SPECS`, and `OUTLINE_SPECS` for that wall's real layout.
2. Copy `right.html` to `<wall>.html`, pointing its last script tag at
   `js/<wall>/sketch.js`.
3. Add `maps/<wall>/map.json` (an empty `{"surfaces": [], "lines": []}`
   is fine to start) and point that wall's `pMapper.load(...)` /
   `pMapper.save(...)` calls at it.
4. Add any wall-specific assets under `assets/<wall>/`.

No engine file (`js/*.js` outside the per-wall folders) needs touching.

## Files

- `index.html` - landing page linking to `left.html` / `right.html`.
- `left.html`, `right.html` - each wall's entry point: same script
  includes, different final `sketch.js`.
- `js/left/sketch.js`, `js/right/sketch.js` - per-wall config: panels,
  `PAINTING_SPECS`, `OUTLINE_SPECS`, keybindings, setup/draw. The only
  wall-specific code.
- `js/wall.js` - the multi-panel/logical-space abstraction (`wallPanels`,
  `WALL_BOUNDS`, `panelToLogical()`, `displayWall()`).
- `js/paintings.js` - reads painting quad corners back into polygons
  (in the shared logical space), draws the glow/spotlight effects.
- `js/outlines.js` - loads/traces wing-sculpture SVGs into `PolyMap`
  points, draws the pulsing outlines.
- `js/particles.js` - the "fireflies" scene's floating particle system.
- `js/mycelium.js` - the "mycelium" scene's branching growth.
- `js/emanate.js` - the "emanate" scene's shapes drifting off wing
  sculptures (or paintings, if a wall has none).
- `js/scenes.js` - the show: scene list, clock-driven scheduling,
  play/pause.
- `js/parenting.js` - lock/unlock helpers wiring each painting/outline to
  its own panel via p5.mapper's parenting API.
- `js/debug.js` - temporary WebGL-context diagnostic harness (see above).
- `maps/left/map.json`, `maps/right/map.json` - each wall's saved
  calibration (surface positions, corner pins, parent relationships).
- `assets/left/`, `assets/right/` - each wall's own images/SVGs.
  `assets/Roboto.ttf` is shared.
