/**
 * Binary feature server (Phase 3 of the 1M plan).
 *
 * A dedicated, separate server from the JSON one (`server.js`) so the live 1000-unit SVG view
 * is untouched. Holds units in Structure-of-Arrays typed arrays, sends a binary SNAPSHOT on
 * connect, then a binary DELTA of moved units every tick. Runs on its own port/path.
 *
 * Run:  node binary-server.js         (COUNT env overrides default, e.g. COUNT=1000000)
 */

import { WebSocketServer } from "ws";
import { createServer } from "http";
import {
  FRAME_SNAPSHOT,
  FRAME_DELTA,
  packTypeStatus,
  encodeFrame,
} from "./wire-protocol.js";

const PORT = Number(process.env.PORT || 8081);
const PATH = "/binary-features";
const TICK_MS = Number(process.env.TICK_MS || 1000);
const MAX_COUNT = 2_000_000;
const DEFAULT_COUNT = Number(process.env.COUNT || 100_000);
// Dead-band: a unit is only sent once it has drifted this far (degrees) from its last-sent
// position. ~0.0002 deg ≈ 22 m, which is sub-pixel at zoom ~10, so motion still looks
// continuous while slow movers (tanks) drop out of most frames. Set 0 to send everyone.
const DELTA_EPS_DEG = Number(process.env.DELTA_EPS_DEG ?? 0.0002);

// San Antonio bounding box (matches the client demo bounds).
const BOUNDS = { north: 29.7, south: 29.1, east: -98.2, west: -98.8 };

// ---- Structure-of-Arrays state ------------------------------------------------------------
let count = 0;
/** @type {Uint32Array} */ let id;
/** @type {Float32Array} */ let lon;
/** @type {Float32Array} */ let lat;
/** @type {Float32Array} */ let heading; // degrees, 0 = north
/** @type {Float32Array} */ let speed; // km/h
/** @type {Uint8Array} */ let packed; // type + status
/** Last position we actually sent per unit, for the dead-band delta. */
/** @type {Float32Array} */ let sentLon;
/** @type {Float32Array} */ let sentLat;
/** All indices (snapshot) and a reusable scratch buffer for the per-tick dirty set. */
let allIndices;
let dirtyScratch;

function initState(n) {
  count = Math.max(1, Math.min(n, MAX_COUNT));
  id = new Uint32Array(count);
  lon = new Float32Array(count);
  lat = new Float32Array(count);
  heading = new Float32Array(count);
  speed = new Float32Array(count);
  packed = new Uint8Array(count);
  sentLon = new Float32Array(count);
  sentLat = new Float32Array(count);
  allIndices = new Uint32Array(count);
  dirtyScratch = new Uint32Array(count);

  const lonSpan = BOUNDS.east - BOUNDS.west;
  const latSpan = BOUNDS.north - BOUNDS.south;
  for (let i = 0; i < count; i++) {
    id[i] = i + 1;
    lon[i] = BOUNDS.west + Math.random() * lonSpan;
    lat[i] = BOUNDS.south + Math.random() * latSpan;
    sentLon[i] = lon[i]; // snapshot delivers these, so they are "already sent"
    sentLat[i] = lat[i];
    heading[i] = Math.random() * 360;
    // 60% tanks (slower), 40% aircraft (faster) — mirrors the JSON server mix.
    const isAircraft = Math.random() < 0.4;
    speed[i] = isAircraft ? 200 + Math.random() * 400 : 20 + Math.random() * 40;
    const status = Math.floor(Math.random() * 4);
    packed[i] = packTypeStatus(isAircraft ? 1 : 0, status);
    allIndices[i] = i;
  }
  console.log(`🎖️ Initialized ${count} binary units`);
}

// Advance every unit one tick; matches server.js movement math (0deg = north).
function step(dtSeconds) {
  for (let i = 0; i < count; i++) {
    const speedDegPerSec = (speed[i] / 3600) * (1 / 111);
    const distance = speedDegPerSec * dtSeconds;
    const rad = (heading[i] - 90) * (Math.PI / 180);
    let nLon = lon[i] + distance * Math.cos(rad);
    let nLat = lat[i] + distance * Math.sin(rad);

    if (nLon < BOUNDS.west || nLon > BOUNDS.east) {
      nLon = Math.max(BOUNDS.west, Math.min(BOUNDS.east, nLon));
      heading[i] = (540 - heading[i]) % 360; // reflect east/west
    }
    if (nLat < BOUNDS.south || nLat > BOUNDS.north) {
      nLat = Math.max(BOUNDS.south, Math.min(BOUNDS.north, nLat));
      heading[i] = (360 - heading[i]) % 360; // reflect north/south
    }
    lon[i] = nLon;
    lat[i] = nLat;
  }
}

// ---- Server plumbing ----------------------------------------------------------------------
const columns = () => ({ id, lon, lat, heading, packed });

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", features: count, clients: wss.clients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: PATH });

function snapshotBuffer() {
  return encodeFrame(FRAME_SNAPSHOT, columns(), allIndices);
}

// Send the current snapshot to every connected client. Used after a (re)initialization so
// nobody is left applying DELTA frames against a stale/differently-sized population.
function broadcastSnapshot() {
  const buf = snapshotBuffer();
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(buf);
  }
  console.log(
    `📦 Broadcast SNAPSHOT to ${wss.clients.size} client(s): ${count} units, ` +
      `${(buf.byteLength / 1e6).toFixed(2)} MB`,
  );
}

wss.on("connection", (ws) => {
  console.log(`🔌 Binary client connected (${wss.clients.size} total)`);
  let initialized = false;

  // The client's first text message requests a population size.
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(data.toString());
      if (msg.op === "hello" && !initialized) {
        initialized = true;
        const requested = Number(msg.count) || DEFAULT_COUNT;
        if (count !== Math.min(requested, MAX_COUNT)) {
          // Reinit resizes the shared simulation, so re-snapshot ALL clients, not just this
          // one — otherwise existing clients desync on the next DELTA.
          initState(requested);
          broadcastSnapshot();
        } else {
          const buf = snapshotBuffer();
          ws.send(buf);
          console.log(
            `📦 Sent SNAPSHOT: ${count} units, ${(buf.byteLength / 1e6).toFixed(2)} MB`,
          );
        }
      }
    } catch (err) {
      console.error("❌ Bad client message:", err);
    }
  });

  ws.on("close", () => {
    console.log(`🔌 Binary client disconnected (${wss.clients.size} total)`);
  });
  ws.on("error", (err) => console.error("❌ WS error:", err));
});

// Collect the indices that drifted past the dead-band since we last sent them.
function collectDirty() {
  if (DELTA_EPS_DEG <= 0) return allIndices;
  const eps2 = DELTA_EPS_DEG * DELTA_EPS_DEG;
  let d = 0;
  for (let i = 0; i < count; i++) {
    const dx = lon[i] - sentLon[i];
    const dy = lat[i] - sentLat[i];
    if (dx * dx + dy * dy >= eps2) {
      dirtyScratch[d++] = i;
      sentLon[i] = lon[i];
      sentLat[i] = lat[i];
    }
  }
  return dirtyScratch.subarray(0, d);
}

// Single simulation loop broadcasting a delta of only the moved units to all clients.
setInterval(() => {
  if (count === 0 || wss.clients.size === 0) return;
  const start = process.hrtime.bigint();
  step(TICK_MS / 1000);
  const dirty = collectDirty();
  if (dirty.length === 0) return; // nothing moved enough this tick

  const buf = encodeFrame(FRAME_DELTA, columns(), dirty);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(buf);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const pct = ((dirty.length / count) * 100).toFixed(0);
  console.log(
    `📡 DELTA ${dirty.length}/${count} units (${pct}%) → ${wss.clients.size} client(s), ` +
      `${(buf.byteLength / 1e6).toFixed(2)} MB, ${ms.toFixed(1)}ms`,
  );
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`🛰️  Binary feature server on ws://localhost:${PORT}${PATH}`);
  console.log(`     default COUNT=${DEFAULT_COUNT}, TICK_MS=${TICK_MS}, MAX=${MAX_COUNT}`);
});
