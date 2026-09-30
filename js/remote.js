/*
 * Phone remote control - wall side. Listens to the relay in server.js and
 * follows its shared show state (running/stopped, locked scene, clock
 * offset for "next"), and reports back which scene this wall is on so the
 * phone page (remote.html) can show it.
 *
 * Which relay to use, first match wins:
 *   1. ?remote=<url> on this page's URL (?remote=off disables it)
 *   2. REMOTE_CONTROL_URL below - set this to the Railway URL once deployed
 *   3. this page's own origin, if it was served by server.js itself
 *      (`npm start` locally) - checked once via /api/state, silently skipped
 *      when served by a plain static server
 *
 * Purely additive: if the relay is unreachable the wall just keeps running
 * the clock-driven show (and the keyboard still works). EventSource
 * reconnects on its own and the state is re-applied idempotently.
 */

const REMOTE_CONTROL_URL = "https://curatedgallery-production.up.railway.app";
const REMOTE_STATUS_INTERVAL_MS = 10000; // heartbeat, so the phone can tell the wall is online

// "left" / "right", from left.html / right.html.
const REMOTE_WALL_ID = location.pathname.split("/").pop().replace(/\.html$/, "") || "wall";

let remoteBase = null;
let remoteConnected = false;
let remoteLastSeq = null;

function remoteStatusLine() {
  if (!remoteBase) return "remote: off";
  return `remote: ${remoteConnected ? "connected" : "connecting..."}`;
}

async function resolveRemoteBase() {
  const param = new URLSearchParams(location.search).get("remote");
  if (param === "off") return null;
  if (param) return param.replace(/\/$/, "");
  if (REMOTE_CONTROL_URL) return REMOTE_CONTROL_URL.replace(/\/$/, "");
  if (!location.protocol.startsWith("http")) return null;
  try {
    const res = await fetch("/api/state");
    if (res.ok) return location.origin;
  } catch (err) {
    // plain static server - no relay here
  }
  return null;
}

// Idempotent: the relay sends its whole show state (see server.js), and
// this makes the wall match it - safe to run again on every reconnect.
function applyRemoteShow(show) {
  const isNewCommand = remoteLastSeq !== null && show.seq !== remoteLastSeq;
  remoteLastSeq = show.seq;

  showOffsetMs = show.offsetMs; // js/scenes.js - picked up by updateShow() next frame
  setShowStopped(!show.running); // js/scenes.js
  if (show.locked) {
    holdSceneByName(show.locked); // js/scenes.js
  } else if (!showPlaying && (!showHeldLocally || isNewCommand)) {
    // Unlocked: any hold that didn't come from this wall's own keyboard goes
    // back to the clock on every message (the relay re-broadcasts every
    // ~15s), so a missed unlock can't leave walls apart for good. A
    // keyboard hold survives until the phone's next command.
    resumeShow(); // js/scenes.js
  }
  reportRemoteStatus();
}

function reportRemoteStatus() {
  if (!remoteBase || typeof currentScene !== "function") return;
  fetch(`${remoteBase}/api/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wall: REMOTE_WALL_ID,
      scene: currentScene().name,
      playing: showPlaying,
      stopped: showStopped,
      scenes: SCENES.map((s) => ({ name: s.name, duration: sceneDuration(s) })),
    }),
  }).catch(() => {});
}

// Measure this machine's clock against the relay's: a few round trips,
// keeping the one with the shortest RTT (least network noise), assuming the
// server read its clock halfway through it.
async function syncRemoteClock() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    try {
      const sent = Date.now();
      const res = await fetch(`${remoteBase}/api/time`, { cache: "no-store" });
      const { now } = await res.json();
      const received = Date.now();
      const rtt = received - sent;
      if (!best || rtt < best.rtt) best = { rtt, skew: now + rtt / 2 - received };
    } catch (err) {
      return;
    }
  }
  if (best) showClockSkewMs = best.skew; // js/scenes.js
}

async function initRemote() {
  remoteBase = await resolveRemoteBase();
  if (!remoteBase) return;

  await syncRemoteClock();
  setInterval(syncRemoteClock, 5 * 60 * 1000); // clocks drift

  const events = new EventSource(`${remoteBase}/api/events`);
  events.onopen = () => {
    remoteConnected = true;
    reportRemoteStatus();
  };
  events.onerror = () => {
    remoteConnected = false;
  };
  events.onmessage = (e) => {
    try {
      applyRemoteShow(JSON.parse(e.data).show);
    } catch (err) {
      console.warn("[remote] bad message", err);
    }
  };

  // Report scene changes promptly (auto-advance, arrow keys) plus a slow
  // heartbeat - polling this rather than hooking enterScene() keeps
  // js/scenes.js unaware of the remote entirely.
  let lastReported = "";
  let lastReportAt = 0;
  setInterval(() => {
    if (typeof currentScene !== "function" || typeof SCENES === "undefined") return;
    const key = `${currentScene().name}|${showPlaying}|${showStopped}`;
    if (key !== lastReported || Date.now() - lastReportAt > REMOTE_STATUS_INTERVAL_MS) {
      lastReported = key;
      lastReportAt = Date.now();
      reportRemoteStatus();
    }
  }, 1000);
}

// Wait for p5's setup() (and so initShow()) to have run before connecting -
// applying a command any earlier would init a scene with no canvas yet.
const remoteStartTimer = setInterval(() => {
  if (typeof frameCount !== "undefined" && frameCount > 0) {
    clearInterval(remoteStartTimer);
    initRemote();
  }
}, 250);
