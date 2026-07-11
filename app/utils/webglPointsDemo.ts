import WebGLPointsLayer from "ol/layer/WebGLPoints";
import VectorLayer from "ol/layer/Vector";
import type Layer from "ol/layer/Layer";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import { Style, Text, Fill, Stroke, Circle as CircleStyle } from "ol/style";
import type { Extent } from "ol/extent";
import { buildSymbolAtlas, type SymbolAtlas } from "./symbolAtlas";
import { CustomPointsLayer } from "./customPointsLayer";
import { FeatureStore } from "../services/featureStore";

// Callsign labels only render at/above this zoom, so at most a screenful is ever drawn.
const LABEL_MIN_ZOOM = 13;
// Hard cap on labels per refresh — a viewport at high zoom holds far fewer than this.
const LABEL_MAX = 400;

interface LabelSource {
  count: () => number;
  /** Current Mercator coordinate of point i (split to avoid per-call allocation). */
  coordX: (i: number) => number;
  coordY: (i: number) => number;
  variantAt: (i: number) => number;
}

interface LabelController {
  layer: VectorLayer<VectorSource>;
  /** Re-scan the view and rebuild the visible label set (call on moveend). */
  update: (extent: Extent, zoom: number) => void;
  /** Cheaply move the existing labels to their points' current positions (call per tick). */
  reposition: () => void;
}

/**
 * Viewport-gated callsign labels (Phase 4). A separate Canvas text layer that, on demand,
 * is filled with labels only for the points currently in view above a zoom threshold — never
 * anywhere near 1M. Scans live positions (so it is correct even while points move), capped and
 * decluttered. Callsigns are derived from index + type so we never store 1M label strings.
 */
function createLabelController(src: LabelSource): LabelController {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    declutter: true,
    style: (f) =>
      new Style({
        text: new Text({
          text: String(f.get("label")),
          font: "11px system-ui, sans-serif",
          offsetY: -12,
          fill: new Fill({ color: "#e5e7eb" }),
          stroke: new Stroke({ color: "#000000", width: 3 }),
        }),
      }),
  });

  const update = (extent: Extent, zoom: number) => {
    if (zoom < LABEL_MIN_ZOOM) {
      source.clear();
      return;
    }
    const [minX, minY, maxX, maxY] = extent;
    const n = src.count();
    const feats: Feature[] = [];
    for (let i = 0; i < n && feats.length < LABEL_MAX; i++) {
      const cx = src.coordX(i);
      const cy = src.coordY(i);
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
        const f = new Feature({ geometry: new Point([cx, cy]) });
        f.set("idx", i, true);
        f.set("label", src.variantAt(i) < 4 ? `GND-${i}` : `AIR-${i}`);
        feats.push(f);
      }
    }
    source.clear();
    source.addFeatures(feats);
  };

  const reposition = () => {
    source.forEachFeature((f) => {
      const i = f.get("idx") as number;
      (f.getGeometry() as Point).setCoordinates([src.coordX(i), src.coordY(i)]);
    });
  };

  return { layer, update, reposition };
}

/** Details of the currently-selected unit, shown in the map's info panel. */
export interface Selection {
  index: number;
  callsign: string;
  kind: "Ground" | "Air";
  status: string;
}

// Status index (variant % 4) → affiliation name, matching the atlas variant layout.
const STATUS_NAMES = ["Friendly", "Hostile", "Neutral", "Unknown"];
// Click tolerance in screen pixels for picking the nearest point.
const PICK_TOLERANCE_PX = 12;

interface SelectionController {
  layer: VectorLayer<VectorSource>;
  /** Pick the nearest point within tolerance of a clicked coordinate. */
  pick: (coord: number[], resolution: number) => Selection | null;
  clear: () => void;
  /** Keep the highlight glued to the selected point as it moves (call per tick). */
  reposition: () => void;
}

/**
 * Click-to-select (Phase 4). Rather than enabling OpenLayers' always-on GPU hit detection —
 * which adds per-frame cost to every one of the 1M points — we scan our own position arrays
 * once per click (clicks are rare) to find the nearest point, and draw a highlight ring that
 * tracks it. Selection is by index, so it survives movement.
 */
function createSelectionController(src: LabelSource): SelectionController {
  const source = new VectorSource();
  const highlight = new Feature({ geometry: new Point([0, 0]) });
  const layer = new VectorLayer({
    source,
    style: new Style({
      image: new CircleStyle({
        radius: 14,
        stroke: new Stroke({ color: "#38bdf8", width: 3 }),
      }),
    }),
  });

  let selected = -1;

  const clear = () => {
    selected = -1;
    source.clear();
  };

  const pick = (coord: number[], resolution: number): Selection | null => {
    const tol = PICK_TOLERANCE_PX * resolution;
    let best = -1;
    let bestD = tol * tol;
    const n = src.count();
    for (let i = 0; i < n; i++) {
      const dx = src.coordX(i) - coord[0];
      const dy = src.coordY(i) - coord[1];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) {
      clear();
      return null;
    }
    selected = best;
    (highlight.getGeometry() as Point).setCoordinates([
      src.coordX(best),
      src.coordY(best),
    ]);
    source.clear();
    source.addFeature(highlight);
    const variant = src.variantAt(best);
    return {
      index: best,
      callsign: variant < 4 ? `GND-${best}` : `AIR-${best}`,
      kind: variant < 4 ? "Ground" : "Air",
      status: STATUS_NAMES[variant % 4],
    };
  };

  const reposition = () => {
    if (selected < 0) return;
    (highlight.getGeometry() as Point).setCoordinates([
      src.coordX(selected),
      src.coordY(selected),
    ]);
  };

  return { layer, pick, clear, reposition };
}

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
  /** The points layer — stock WebGLPointsLayer, or the custom WebGL Layer. */
  layer: WebGLPointsLayer<VectorSource> | Layer;
  /** Canvas layer holding viewport-gated callsign labels; add above the points layer. */
  labelLayer: VectorLayer<VectorSource>;
  /** Canvas layer holding the selection highlight ring; add above the label layer. */
  highlightLayer: VectorLayer<VectorSource>;
  /** Refresh labels for the current view (call on moveend). */
  updateLabels: (extent: Extent, zoom: number) => void;
  /** Pick the nearest unit to a clicked map coordinate, or null if none is close. */
  pickAt: (coord: number[], resolution: number) => Selection | null;
  /** Clear the current selection. */
  clearSelection: () => void;
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

  const dataSrc: LabelSource = {
    count: () => count,
    coordX: (i) => coordRefs[i][0],
    coordY: (i) => coordRefs[i][1],
    variantAt: (i) => store.variant[i],
  };
  const labels = createLabelController(dataSrc);
  const selection = createSelectionController(dataSrc);

  if (!moving) {
    return {
      layer,
      labelLayer: labels.layer,
      highlightLayer: selection.layer,
      updateLabels: labels.update,
      pickAt: selection.pick,
      clearSelection: selection.clear,
      start: () => {},
      stop: () => {},
    };
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
    labels.reposition();
    selection.reposition();

    const cost = performance.now() - now;
    if (cost > 8) {
      console.log(`🛰️ moved ${count} points in ${cost.toFixed(1)}ms (main thread)`);
    }
  };

  return {
    layer,
    labelLayer: labels.layer,
    highlightLayer: selection.layer,
    updateLabels: labels.update,
    pickAt: selection.pick,
    clearSelection: selection.clear,
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
  let variants: Uint8Array = new Uint8Array(0);

  const dataSrc: LabelSource = {
    count: () => coordRefs.length,
    coordX: (i) => coordRefs[i][0],
    coordY: (i) => coordRefs[i][1],
    variantAt: (i) => variants[i] ?? 0,
  };
  const labels = createLabelController(dataSrc);
  const selection = createSelectionController(dataSrc);

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
    variants = variant;
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
    labels.reposition();
    selection.reposition();
    const cost = performance.now() - now;
    if (cost > 8) {
      console.log(`🛰️ applied ${count} positions in ${cost.toFixed(1)}ms (main thread)`);
    }
  };

  return {
    layer,
    labelLayer: labels.layer,
    highlightLayer: selection.layer,
    updateLabels: labels.update,
    pickAt: selection.pick,
    clearSelection: selection.clear,
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

/**
 * Build the custom WebGL layer (the deferred renderer) driven by the FeatureStore, with
 * GPU-side interpolation between ticks. There are NO ol/Feature objects — labels and selection
 * read straight from the store's typed arrays. Always animated.
 */
export function buildCustomDemoLayer(count: number): DemoLayer {
  const atlas = buildSymbolAtlas();

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
    speedScale: DEMO_SPEED_SCALE,
  });

  const custom = new CustomPointsLayer(atlas);
  custom.setVariants(store.variant, count);
  // Upload positions relative to the bounds origin so the shader keeps float32 precision.
  custom.setOrigin(minX, minY);

  // Interleaved [x,y] position buffers (origin-relative) + per-point rotation, refilled per tick.
  const prev = new Float32Array(count * 2);
  const target = new Float32Array(count * 2);
  const rot = new Float32Array(count);
  const fillTarget = () => {
    const { x, y, heading } = store;
    for (let i = 0; i < count; i++) {
      target[2 * i] = x[i] - minX;
      target[2 * i + 1] = y[i] - minY;
      rot[i] = heading[i];
    }
  };
  fillTarget();
  prev.set(target);
  custom.uploadTick(prev, target, rot, DEMO_TICK_MS);

  const dataSrc: LabelSource = {
    count: () => count,
    coordX: (i) => store.x[i],
    coordY: (i) => store.y[i],
    variantAt: (i) => store.variant[i],
  };
  const labels = createLabelController(dataSrc);
  const selection = createSelectionController(dataSrc);

  let timer: ReturnType<typeof setInterval> | null = null;
  let raf = 0;
  let lastMs = 0;

  const tick = () => {
    const now = performance.now();
    const dt = lastMs ? (now - lastMs) / 1000 : DEMO_TICK_MS / 1000;
    lastMs = now;
    prev.set(target); // last target becomes the new prev
    store.step(dt);
    fillTarget();
    custom.uploadTick(prev, target, rot, DEMO_TICK_MS);
    labels.reposition();
    selection.reposition();
  };

  // Drive a render every frame so the GPU interpolation factor advances smoothly.
  const animate = () => {
    custom.layer.changed();
    raf = requestAnimationFrame(animate);
  };

  return {
    layer: custom.layer,
    labelLayer: labels.layer,
    highlightLayer: selection.layer,
    updateLabels: labels.update,
    pickAt: selection.pick,
    clearSelection: selection.clear,
    start: () => {
      if (timer) return;
      lastMs = 0;
      timer = setInterval(tick, DEMO_TICK_MS);
      raf = requestAnimationFrame(animate);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}
