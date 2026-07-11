/// <reference lib="webworker" />
/**
 * Feature worker (Phase 3 of the 1M plan).
 *
 * Owns the WebSocket to the binary server and keeps a worker-side Structure-of-Arrays copy of
 * the population. It decodes binary SNAPSHOT/DELTA frames with a DataView, projects lon/lat to
 * Web Mercator here (off the main thread), and posts compact position buffers back to the main
 * thread via transferables (zero-copy). The main thread does nothing but write those numbers
 * into the OpenLayers geometries — all parse/diff/project work stays off the render thread.
 */
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
  readFrameHeader,
  packedToVariant,
  lonToMercatorX,
  latToMercatorY,
} from "../services/wireProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const DEG2RAD = Math.PI / 180;

let ws: WebSocket | null = null;

// Worker-side SoA copy (Mercator, ready for the renderer).
let count = 0;
let mercX = new Float64Array(0);
let mercY = new Float64Array(0);
let variant = new Uint8Array(0);
let rot = new Float32Array(0);
const idToIndex = new Map<number, number>();

function handleSnapshot(view: DataView, n: number) {
  count = n;
  mercX = new Float64Array(n);
  mercY = new Float64Array(n);
  variant = new Uint8Array(n);
  rot = new Float32Array(n);
  idToIndex.clear();

  let o = HEADER_SIZE;
  for (let i = 0; i < n; i++) {
    const id = view.getUint32(o + OFF_ID, true);
    const lon = view.getFloat32(o + OFF_LON, true);
    const lat = view.getFloat32(o + OFF_LAT, true);
    const hRaw = view.getUint16(o + OFF_HEADING, true);
    const packed = view.getUint8(o + OFF_PACKED);

    idToIndex.set(id, i);
    mercX[i] = lonToMercatorX(lon);
    mercY[i] = latToMercatorY(lat);
    variant[i] = packedToVariant(packed);
    rot[i] = (hRaw / HEADING_SCALE) * DEG2RAD;
    o += RECORD_SIZE;
  }

  // Ship the full initial state so the main thread can build the features once.
  const x = Float32Array.from(mercX);
  const y = Float32Array.from(mercY);
  const v = variant.slice();
  const r = rot.slice();
  ctx.postMessage({ type: "snapshot", count: n, x, y, variant: v, rot: r }, [
    x.buffer,
    y.buffer,
    v.buffer,
    r.buffer,
  ]);
}

function handleDelta(view: DataView, n: number) {
  let o = HEADER_SIZE;
  for (let k = 0; k < n; k++) {
    const id = view.getUint32(o + OFF_ID, true);
    const idx = idToIndex.get(id);
    if (idx !== undefined) {
      mercX[idx] = lonToMercatorX(view.getFloat32(o + OFF_LON, true));
      mercY[idx] = latToMercatorY(view.getFloat32(o + OFF_LAT, true));
    }
    o += RECORD_SIZE;
  }
  // Post index-aligned positions for the whole population (main applies by index).
  const x = Float32Array.from(mercX);
  const y = Float32Array.from(mercY);
  ctx.postMessage({ type: "positions", count, x, y }, [x.buffer, y.buffer]);
}

function handleFrame(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const { frameType, count: n } = readFrameHeader(view);
  if (frameType === FRAME_SNAPSHOT) handleSnapshot(view, n);
  else handleDelta(view, n);
}

function connect(url: string, requestedCount: number) {
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    ws?.send(JSON.stringify({ op: "hello", count: requestedCount }));
    ctx.postMessage({ type: "status", connected: true });
  };
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) handleFrame(event.data);
  };
  ws.onclose = () => ctx.postMessage({ type: "status", connected: false });
  ws.onerror = () => ctx.postMessage({ type: "status", connected: false });
}

ctx.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (msg?.op === "connect") {
    connect(msg.url, msg.count);
  } else if (msg?.op === "disconnect") {
    ws?.close();
    ws = null;
  }
};
