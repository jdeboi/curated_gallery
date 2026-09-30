/*
 * On-screen status HUD: one small translucent panel instead of several
 * independently-positioned text() calls scattered down the corner. Each
 * status line is sourced from the file that owns that state
 * (sceneStatusLine() - js/scenes.js, paintingModeStatusLine() -
 * js/paintings.js, parentingStatusLine() - js/parenting.js,
 * mirrorMaskEffectsStatusLine() - js/mirrorMasks.js,
 * faceEyesStatusLine() - js/faceEyes.js) so this file only owns
 * the layout/styling, not the data.
 */

const HUD_X = 15;
const HUD_Y = 15;
const HUD_PADDING = 12;
const HUD_LINE_HEIGHT = 24;
const HUD_TEXT_SIZE = 16;
const HUD_HINT_TEXT_SIZE = 12;
const HUD_HINT = "arrows/space: scene (local)    w: painting mode    q: butterfly mode    p: parenting    m: mirror fx    e: eyes    c: calibrate    h: hud";

// Off by default - the walls open in presentation mode. "h" toggles it
// (see keyPressed() in each wall's sketch.js).
let hudVisible = false;

function toggleHUD() {
  hudVisible = !hudVisible;
}

function displayHUD() {
  if (!hudVisible || !myFont) return;

  const lines = [
    `${round(frameRate())} fps`,
    sceneStatusLine(), // js/scenes.js
    paintingModeStatusLine(), // js/paintings.js
    parentingStatusLine(), // js/parenting.js
    mirrorMaskEffectsStatusLine(), // js/mirrorMasks.js
    faceEyesStatusLine(), // js/faceEyes.js
    remoteStatusLine(), // js/remote.js
  ];

  const panelWidth = 460;
  const panelHeight = HUD_PADDING * 2 + lines.length * HUD_LINE_HEIGHT;
  const x = -width / 2 + HUD_X;
  const y = -height / 2 + HUD_Y;

  push();
  noStroke();
  fill(0, 160);
  // No corner-radius argument here - rect()'s rounded-corner form corrupts
  // this renderer's WebGL immediate-mode draw state (same family of issue
  // js/debug.js was built to chase down), silently breaking every text()
  // call for the rest of the frame - reproduced by isolating it in a
  // headless run: the exact same rect() call renders fine 4-arg, and blanks
  // out everything drawn after it once a 5th (radius) arg is added.
  rect(x, y, panelWidth, panelHeight);

  textFont(myFont);
  textAlign(LEFT, TOP);
  textSize(HUD_TEXT_SIZE);
  fill(255);
  lines.forEach((line, i) => {
    text(line, x + HUD_PADDING, y + HUD_PADDING + i * HUD_LINE_HEIGHT);
  });

  textSize(HUD_HINT_TEXT_SIZE);
  fill(255, 130);
  text(HUD_HINT, x, y + panelHeight + 16);
  pop();
}
