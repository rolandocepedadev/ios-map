import WebGLPointsLayer from "ol/layer/WebGLPoints";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import { buildSymbolAtlas, type SymbolAtlas } from "./symbolAtlas";
import { FeatureStore } from "../services/featureStore";

/**
 * WebGL point demo layers for the 1M stress test.
 *
 * Phase 1 rendered N static points. Phase 2 adds a moving variant driven by the columnar
 * {@link FeatureStore}: each tick we step the store, write the new coordinates straight into
 * each geometry's flat-coordinate array in place, then bump the source revision ONCE. That
 * makes OL's WebGLPointsLayer renderer rebuild its buffers a single time per tick (the heavy
 * work happens in its Web Worker), with no per-feature change events — the only way to animate
 * this many points through the stock renderer without drowning the main thread in events.
 */

// Spread bounds for the demo (matches the mock data's San Antonio box).
const DEMO_BOUNDS_LONLAT = { west: -98.8, east: -98.2, south: 29.1, north: 29.7 };

// Exaggerate speeds so motion is actually visible at zoom ~10 (real km/h is ~1px/s there).
const DEMO_SPEED_SCALE = 40;

// How often the simulation advances. Motion is stepped, not interpolated (smoothing is a
// Phase 4 concern); a moderate cadence keeps the per-tick rebuild hitch infrequent at 1M.
const DEMO_TICK_MS = 500;

function pointsStyle(atlas: SymbolAtlas) {
  return {
    "icon-src": atlas.dataUrl,
    // Pick this feature's atlas cell; texture size is provided to the shader automatically.
    "icon-offset": ["array", ["*", ["get", "variant"], atlas.cell], 0],
    "icon-size": [atlas.cell, atlas.cell],
    "icon-rotation": ["get", "rot"],
    "icon-rotate-with-view": false,
  };
}

export interface DemoLayer {
  layer: WebGLPointsLayer<VectorSource>;
  /** Begins the animation loop (moving demo only). Returns a no-op when static. */
  start: () => void;
  /** Stops the animation loop and releases the interval. */
  stop: () => void;
}

/**
 * Build a WebGLPointsLayer of `count` points sharing one sprite atlas.
 * When `moving` is true, the returned `start()` animates them via the FeatureStore.
 */
export function buildDemoLayer(count: number, moving: boolean): DemoLayer {
  const atlas = buildSymbolAtlas();
  const source = new VectorSource();
  const layer = new WebGLPointsLayer<VectorSource>({
    source,
    style: pointsStyle(atlas),
  });

  // Project the demo bounds to Web Mercator once; the store simulates in these units.
  const [minX, minY] = fromLonLat([
    DEMO_BOUNDS_LONLAT.west,
    DEMO_BOUNDS_LONLAT.south,
  ]);
  const [maxX, maxY] = fromLonLat([
    DEMO_BOUNDS_LONLAT.east,
    DEMO_BOUNDS_LONLAT.north,
  ]);

  const store = new FeatureStore(count, { minX, minY, maxX, maxY });
  store.seedRandom(count, {
    variantCount: atlas.count,
    speedScale: moving ? DEMO_SPEED_SCALE : 0,
  });

  // Create the features once. Hold a direct reference to each geometry's flat-coordinate
  // array so movement is a plain array write (no getter, no event) per object per tick.
  console.time(`🧪 build ${count} demo features`);
  const feats: Feature[] = new Array(count);
  const coordRefs: number[][] = new Array(count);
  for (let i = 0; i < count; i++) {
    const geom = new Point([store.x[i], store.y[i]]);
    const f = new Feature({ geometry: geom });
    f.set("variant", store.variant[i], true);
    f.set("rot", store.heading[i], true);
    feats[i] = f;
    coordRefs[i] = geom.getFlatCoordinates();
  }
  source.addFeatures(feats);
  console.timeEnd(`🧪 build ${count} demo features`);

  if (!moving) {
    return { layer, start: () => {}, stop: () => {} };
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastMs = 0;

  const tick = () => {
    const now = performance.now();
    const dt = lastMs ? (now - lastMs) / 1000 : DEMO_TICK_MS / 1000;
    lastMs = now;

    // Advance the simulation, then mirror positions into the geometries in place.
    store.step(dt);
    const { x, y } = store;
    for (let i = 0; i < count; i++) {
      const c = coordRefs[i];
      c[0] = x[i];
      c[1] = y[i];
    }
    // Single revision bump → exactly one buffer rebuild for the whole batch.
    source.changed();

    const cost = performance.now() - now;
    if (cost > 8) {
      console.log(`🛰️ moved ${count} points in ${cost.toFixed(1)}ms (main thread)`);
    }
  };

  return {
    layer,
    start: () => {
      if (timer) return;
      lastMs = 0;
      timer = setInterval(tick, DEMO_TICK_MS);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/** Default endpoint for the binary feature server (Phase 3). */
export const BINARY_SERVER_URL = "ws://localhost:8081/binary-features";

/**
 * Build a WebGLPointsLayer fed by the binary server via a Web Worker. The worker owns the
 * socket, decodes frames, and posts Mercator position buffers; this main-thread code only
 * builds the features once (on snapshot) and writes positions in place each tick.
 */
export function buildServerDrivenLayer(
  requestedCount: number,
  url: string = BINARY_SERVER_URL,
): DemoLayer {
  const atlas = buildSymbolAtlas();
  const source = new VectorSource();
  const layer = new WebGLPointsLayer<VectorSource>({
    source,
    style: pointsStyle(atlas),
  });

  let worker: Worker | null = null;
  let coordRefs: number[][] = [];

  const onSnapshot = (data: {
    count: number;
    x: Float32Array;
    y: Float32Array;
    variant: Uint8Array;
    rot: Float32Array;
  }) => {
    const { count, x, y, variant, rot } = data;
    console.time(`🧪 build ${count} server features`);
    source.clear();
    const feats: Feature[] = new Array(count);
    coordRefs = new Array(count);
    for (let i = 0; i < count; i++) {
      const geom = new Point([x[i], y[i]]);
      const f = new Feature({ geometry: geom });
      f.set("variant", variant[i], true);
      f.set("rot", rot[i], true);
      feats[i] = f;
      coordRefs[i] = geom.getFlatCoordinates();
    }
    source.addFeatures(feats);
    console.timeEnd(`🧪 build ${count} server features`);
  };

  const onPositions = (data: { count: number; x: Float32Array; y: Float32Array }) => {
    const { count, x, y } = data;
    if (count !== coordRefs.length) return; // ignore until features are built
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const c = coordRefs[i];
      c[0] = x[i];
      c[1] = y[i];
    }
    source.changed();
    const cost = performance.now() - now;
    if (cost > 8) {
      console.log(`🛰️ applied ${count} positions in ${cost.toFixed(1)}ms (main thread)`);
    }
  };

  return {
    layer,
    start: () => {
      if (worker) return;
      worker = new Worker(
        new URL("../workers/featureWorker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "snapshot") onSnapshot(msg);
        else if (msg.type === "positions") onPositions(msg);
      };
      worker.postMessage({ op: "connect", url, count: requestedCount });
    },
    stop: () => {
      if (worker) {
        worker.postMessage({ op: "disconnect" });
        worker.terminate();
        worker = null;
      }
    },
  };
}
