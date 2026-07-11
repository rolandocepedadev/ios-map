/**
 * Headless smoke test for the binary feature server.
 * Connects, requests a small population, and validates the SNAPSHOT + one DELTA frame.
 *
 * Run:  node test-binary.js   (with binary-server.js already running)
 */
import { WebSocket } from "ws";
import {
  HEADER_SIZE,
  RECORD_SIZE,
  OFF_ID,
  OFF_LON,
  OFF_LAT,
  OFF_HEADING,
  OFF_PACKED,
  HEADING_SCALE,
  FRAME_SNAPSHOT,
  FRAME_DELTA,
  STATUS_COUNT,
} from "./wire-protocol.js";

const URL = "ws://localhost:8081/binary-features";
const REQUEST = 1000;

function decodeHeader(view) {
  return {
    frameType: view.getUint8(0),
    version: view.getUint8(1),
    count: view.getUint32(4, true),
  };
}

function firstRecord(view) {
  const o = HEADER_SIZE;
  const packed = view.getUint8(o + OFF_PACKED);
  return {
    id: view.getUint32(o + OFF_ID, true),
    lon: view.getFloat32(o + OFF_LON, true),
    lat: view.getFloat32(o + OFF_LAT, true),
    headingDeg: view.getUint16(o + OFF_HEADING, true) / HEADING_SCALE,
    type: packed & 0x1,
    status: (packed >> 1) & 0x3,
    variant: (packed & 0x1) * STATUS_COUNT + ((packed >> 1) & 0x3),
  };
}

let snapshot = null;
let pass = true;
const assert = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) pass = false;
};

const ws = new WebSocket(URL);
ws.binaryType = "arraybuffer";

ws.on("open", () => {
  console.log("🔌 connected; sending hello");
  ws.send(JSON.stringify({ op: "hello", count: REQUEST }));
});

ws.on("message", (data, isBinary) => {
  if (!isBinary) return;
  // With binaryType='arraybuffer', data is already an ArrayBuffer.
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  );
  const view = new DataView(buf);
  const header = decodeHeader(view);

  if (!snapshot) {
    snapshot = header;
    const rec = firstRecord(view);
    console.log("📦 SNAPSHOT", header, "first record:", rec);
    assert(header.frameType === FRAME_SNAPSHOT, "first frame is SNAPSHOT");
    assert(header.version === 1, "version is 1");
    assert(header.count === REQUEST, `count matches request (${header.count})`);
    assert(
      buf.byteLength === HEADER_SIZE + header.count * RECORD_SIZE,
      "buffer size matches header count",
    );
    assert(rec.lon > -98.8 && rec.lon < -98.2, "lon within San Antonio bounds");
    assert(rec.lat > 29.1 && rec.lat < 29.7, "lat within San Antonio bounds");
    assert(rec.variant >= 0 && rec.variant < 8, "variant in 0..7");
  } else {
    const rec = firstRecord(view);
    console.log("📡 DELTA", header, "first record:", rec);
    assert(header.frameType === FRAME_DELTA, "second frame is DELTA");
    assert(
      header.count > 0 && header.count <= snapshot.count,
      `delta is a subset of the population (${header.count}/${snapshot.count})`,
    );
    console.log(pass ? "\n🎉 ALL CHECKS PASSED" : "\n💥 SOME CHECKS FAILED");
    ws.close();
    process.exit(pass ? 0 : 1);
  }
});

ws.on("error", (err) => {
  console.error("❌ connection error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("❌ timed out waiting for frames");
  process.exit(1);
}, 8000);
