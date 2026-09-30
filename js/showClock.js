/*
 * The show schedule as pure math: given every scene's duration and a moment
 * in time, which scene is live and how far into it. Shared, word for word,
 * by the walls (js/scenes.js, as browser globals) and the remote-control
 * relay (server.js, via require) - so when the phone says "next" or "lock",
 * the server works out the answer the same way every wall would.
 *
 * Each full pass through the scenes is shuffled, seeded from the loop number
 * (time / total duration) rather than Math.random(), so the "random" order
 * is still the same function of wall-clock time on every machine.
 *
 * `offsetMs` everywhere below is the remote's shared clock shift: the show
 * plays at Date.now() + offsetMs. "Next" works by bumping it past the rest
 * of the current scene, so every wall skips together and keeps following
 * the clock afterward.
 */

(function (exports) {
  // Small deterministic PRNG (mulberry32).
  function mulberry32(seed) {
    let state = seed | 0;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher-Yates shuffle of scene indices, seeded by the loop number.
  function shuffledSceneOrder(count, seed) {
    const rand = mulberry32(seed);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  // Cached per loop so the per-frame call isn't re-shuffling every frame.
  let cachedKey = null;
  let cachedOrder = null;
  function orderForLoop(count, loopIndex) {
    const key = `${count}:${loopIndex}`;
    if (key !== cachedKey) {
      cachedKey = key;
      cachedOrder = shuffledSceneOrder(count, loopIndex);
    }
    return cachedOrder;
  }

  function totalDuration(durations) {
    return durations.reduce((sum, d) => sum + d, 0);
  }

  // -> { sceneIndex, elapsedInScene } at time t (ms).
  function showPosition(durations, t) {
    const total = totalDuration(durations);
    const loopIndex = Math.floor(t / total);
    const order = orderForLoop(durations.length, loopIndex);
    let rem = t - loopIndex * total;
    for (let i = 0; i < order.length; i++) {
      const dur = durations[order[i]];
      if (rem < dur) return { sceneIndex: order[i], elapsedInScene: rem };
      rem -= dur;
    }
    // Floating-point edge case at the exact wraparound instant.
    const last = order[order.length - 1];
    return { sceneIndex: last, elapsedInScene: durations[last] - 1 };
  }

  // Offset that skips from whatever's live at nowMs + offsetMs to the start
  // of the scene after it in the schedule.
  function offsetForNext(durations, nowMs, offsetMs) {
    const pos = showPosition(durations, nowMs + offsetMs);
    return offsetMs + (durations[pos.sceneIndex] - pos.elapsedInScene);
  }

  // Offset that makes sceneIndex start right at nowMs - used when unlocking,
  // so the show picks up from the scene it was locked on instead of jumping
  // somewhere unrelated.
  function offsetToStartScene(durations, sceneIndex, nowMs) {
    const total = totalDuration(durations);
    const loopIndex = Math.floor(nowMs / total);
    const order = orderForLoop(durations.length, loopIndex);
    let start = loopIndex * total;
    for (const i of order) {
      if (i === sceneIndex) break;
      start += durations[i];
    }
    return start - nowMs;
  }

  exports.showPosition = showPosition;
  exports.offsetForNext = offsetForNext;
  exports.offsetToStartScene = offsetToStartScene;
})(typeof module !== "undefined" ? module.exports : (window.showClock = {}));
