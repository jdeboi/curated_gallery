/*
 * Temporary diagnostic harness for the "drag a corner fast/far -> screen
 * goes white and unresponsive" report. Remove once that's tracked down.
 *
 * Logs, all to the browser console:
 *  - every createGraphics() call (dimensions + a stack trace), so we can
 *    see exactly what's allocating offscreen buffers and how often
 *  - webglcontextlost / webglcontextrestored on every <canvas> on the
 *    page, which is the direct signal for "too many active WebGL
 *    contexts" actually evicting one
 *  - a periodic canvas/context count, so growth over time (e.g. across
 *    repeated drags or reloads) is visible even without a loss event
 */

(function () {
  const log = (...args) => console.warn("[debug]", ...args);

  // --- createGraphics call tracing ---
  window.addEventListener("load", () => {
    if (typeof createGraphics !== "function") return;
    const orig = createGraphics;
    window.createGraphics = function (...args) {
      log(`createGraphics(${args.slice(0, 3).join(", ")})`, new Error().stack);
      return orig.apply(this, args);
    };
  });

  // --- WebGL context loss/restore on every canvas, including ones
  //     created after page load (offscreen buffers) ---
  function watchCanvas(canvas) {
    if (canvas.__debugWatched) return;
    canvas.__debugWatched = true;
    canvas.addEventListener("webglcontextlost", (e) => {
      log("CONTEXT LOST on canvas:", canvas.width, "x", canvas.height, e);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      log("context restored on canvas:", canvas.width, "x", canvas.height);
    });
  }

  function scanCanvases() {
    document.querySelectorAll("canvas").forEach(watchCanvas);
  }

  // Canvases created dynamically (createGraphics) won't exist at load time -
  // rescan periodically to pick them up, and report the running count.
  let lastCount = -1;
  setInterval(() => {
    scanCanvases();
    const canvases = document.querySelectorAll("canvas");
    if (canvases.length !== lastCount) {
      lastCount = canvases.length;
      log(`canvas count changed: ${canvases.length} total on page`);
    }
  }, 1000);

  // --- catch anything that would otherwise only show as a generic error ---
  window.addEventListener("error", (e) => {
    log("window error:", e.message, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    log("unhandled rejection:", e.reason);
  });

  log("diagnostic harness active");
})();
