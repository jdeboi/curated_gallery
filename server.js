/*
 * Remote-control relay: lets a phone change the scene on every wall at once.
 *
 * Zero dependencies (plain Node http) so it runs the same locally
 * (`node server.js`) and on Railway (`npm start`, PORT from the env).
 *
 * - Walls (js/remote.js) subscribe to GET /api/events (Server-Sent Events)
 *   and POST /api/status to report which scene they're on (plus the scene
 *   list and durations, so this server can run the same schedule).
 * - The phone page (remote.html) subscribes to the same stream and POSTs
 *   /api/command: start / stop (black) / next / lock / unlock.
 *
 * Every event is the full snapshot (see snapshot()), not a diff, so a wall
 * or phone that reconnects is caught up by the first message alone. The
 * show state carries a `seq` that only goes up when someone actually sends
 * a command, so a wall reconnecting doesn't mistake it for a new one.
 *
 * Also serves the repo root as a static site, so running this locally is a
 * drop-in replacement for `npx http-server .` - open
 * http://localhost:8080/left.html on the wall and
 * http://<this-machine's-ip>:8080/remote.html on a phone on the same wifi.
 *
 * State is in memory only: a restart drops back to { mode: "auto" }.
 */

const http = require("http");
const showClock = require("./js/showClock.js");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
// Optional shared secret for sending commands (not for watching/reporting).
// Set it on Railway so a public URL can't be used by anyone to flip scenes;
// open the phone page once as /remote.html?token=<it> and it's remembered.
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || "";
const ROOT = __dirname;
const WALL_STALE_MS = 30000; // a wall not heard from in this long shows as offline
const HEARTBEAT_MS = 20000; // keeps proxies (Railway's included) from idling out SSE streams

// The shared show state every wall follows (js/remote.js). `seq` goes up on
// every command, so walls can tell a new command from a reconnect.
let show = { seq: 0, running: true, locked: null, offsetMs: 0 };
let scenes = []; // [{ name, duration }], as last reported by a wall - declared SCENES order
const walls = {}; // wall id -> { scene, playing, lastSeen }
const clients = new Set();

function snapshot() {
  const now = Date.now();
  const wallList = Object.entries(walls).map(([id, w]) => ({
    id,
    scene: w.scene,
    playing: w.playing,
    stopped: w.stopped,
    online: now - w.lastSeen < WALL_STALE_MS,
  }));
  const current = currentSceneName();
  return {
    show,
    current,
    scenes: scenes.map((s) => s.name),
    walls: wallList,
    tokenRequired: !!CONTROL_TOKEN,
  };
}

// What the schedule says is on right now (or the locked scene) - the same
// answer every wall computes, via the shared js/showClock.js.
function currentSceneName() {
  if (show.locked) return show.locked;
  if (!scenes.length) return null;
  const durations = scenes.map((s) => s.duration);
  return scenes[showClock.showPosition(durations, Date.now() + show.offsetMs).sceneIndex].name;
}

function applyCommand(body) {
  const now = Date.now();
  const durations = scenes.map((s) => s.duration);
  const next = { ...show, seq: show.seq + 1 };
  switch (body.action) {
    case "start":
      next.running = true;
      break;
    case "stop":
      next.running = false;
      break;
    case "next":
      if (!scenes.length) return "no wall has reported its scenes yet";
      if (show.locked) {
        // Locked: move the lock along, in the walls' declared scene order.
        const i = scenes.findIndex((s) => s.name === show.locked);
        next.locked = scenes[(i + 1) % scenes.length].name;
      } else {
        next.offsetMs = showClock.offsetForNext(durations, now, show.offsetMs);
      }
      next.running = true;
      break;
    case "lock": {
      if (!scenes.length) return "no wall has reported its scenes yet";
      const name = typeof body.scene === "string" ? body.scene : currentSceneName();
      if (!scenes.some((s) => s.name === name)) return `unknown scene "${name}"`;
      next.locked = name;
      next.running = true;
      break;
    }
    case "unlock":
      if (show.locked) {
        // Pick the clock back up from the start of the locked scene, rather
        // than jumping to whatever the schedule happens to say now.
        const i = scenes.findIndex((s) => s.name === show.locked);
        if (i >= 0) next.offsetMs = showClock.offsetToStartScene(durations, i, now);
      }
      next.locked = null;
      break;
    default:
      return "expected action: start | stop | next | lock | unlock";
  }
  show = next;
  return null;
}

function broadcast() {
  const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(msg);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    return sendJson(res, 200, snapshot());
  }

  if (url.pathname === "/api/status" && req.method === "POST") {
    const body = await readJson(req);
    const id = String(body.wall || "wall").slice(0, 40);
    walls[id] = {
      scene: typeof body.scene === "string" ? body.scene.slice(0, 80) : null,
      playing: !!body.playing,
      stopped: !!body.stopped,
      lastSeen: Date.now(),
    };
    if (Array.isArray(body.scenes)) {
      scenes = body.scenes
        .filter((s) => s && typeof s.name === "string" && s.duration > 0)
        .slice(0, 200)
        .map((s) => ({ name: s.name.slice(0, 80), duration: Number(s.duration) }));
    }
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/command" && req.method === "POST") {
    const body = await readJson(req);
    if (CONTROL_TOKEN && body.token !== CONTROL_TOKEN) {
      return sendJson(res, 401, { error: "bad token" });
    }
    const error = applyCommand(body);
    if (error) return sendJson(res, 400, { error });
    broadcast();
    return sendJson(res, 200, { ok: true, show });
  }

  sendJson(res, 404, { error: "not found" });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (rel === "/remote") rel = "/remote.html";
  const file = path.normalize(path.join(ROOT, rel));
  // No escaping the repo root, and nothing from dotfiles (.git, .claude, ...).
  if (!file.startsWith(ROOT + path.sep) || rel.split("/").some((p) => p.startsWith("."))) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    // Walls usually load from a local static server and talk to this one
    // cross-origin (e.g. localhost -> Railway), so the API is open to any origin.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    handleApi(req, res, url).catch((err) => sendJson(res, 400, { error: err.message }));
    return;
  }
  serveStatic(req, res, url);
});

setInterval(() => {
  for (const res of clients) res.write(": heartbeat\n\n");
}, HEARTBEAT_MS);

// Re-broadcast now and then so phones notice a wall going stale/offline
// even when nothing else is happening.
setInterval(broadcast, WALL_STALE_MS / 2);

server.listen(PORT, () => {
  console.log(`remote control listening on :${PORT}${CONTROL_TOKEN ? " (token required)" : ""}`);
});
