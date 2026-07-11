/**
 * Columnar Structure-of-Arrays (SoA) store for map objects (Phase 2 of the 1M plan).
 *
 * The live path holds objects as an array of plain JS objects in React state and replaces
 * the whole array every tick — which melts under GC + reconciliation well before 1M. This
 * store instead keeps each field in a flat typed array, mutated in place. It is the single
 * source of truth for the simulation and is deliberately framework-agnostic (no OpenLayers,
 * no React) so Phase 3's Web Worker can own an identical instance and apply binary deltas.
 *
 * Positions are stored in the map's projected units (Web Mercator meters), so no per-tick
 * reprojection is needed — the caller seeds already-projected coordinates and bounds.
 */

export interface StoreBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SeedOptions {
  /** Number of distinct sprite variants (atlas cells) to assign randomly. */
  variantCount: number;
  /**
   * Multiplier applied to physically-realistic speeds so motion is visible at demo scale
   * and zoom. Real km/h movement is ~1px/s at zoom 10; the default exaggerates it.
   */
  speedScale?: number;
}

// Realistic speed ranges (km/h) by type, matching the mock server's tanks/aircraft.
const TANK_SPEED_KMH = [20, 60] as const;
const AIRCRAFT_SPEED_KMH = [200, 600] as const;
const KMH_TO_MPS = 1000 / 3600;

export class FeatureStore {
  readonly capacity: number;
  count = 0;

  // Position in projected units (Web Mercator meters). Float64 to preserve mercator
  // precision (values reach ~2e7, beyond Float32's ~7 significant digits).
  readonly x: Float64Array;
  readonly y: Float64Array;
  // Heading in radians, 0 = north (+y), increasing clockwise.
  readonly heading: Float32Array;
  // Speed in projected units per second (already speed-scaled).
  readonly speed: Float32Array;
  // Atlas cell index (0..variantCount-1); high half = aircraft in the demo layout.
  readonly variant: Uint8Array;

  readonly bounds: StoreBounds;

  constructor(capacity: number, bounds: StoreBounds) {
    this.capacity = capacity;
    this.bounds = bounds;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.heading = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.variant = new Uint8Array(capacity);
  }

  /** Populate the store with `count` randomly-placed, randomly-directed objects. */
  seedRandom(count: number, opts: SeedOptions): void {
    const n = Math.min(count, this.capacity);
    const { minX, minY, maxX, maxY } = this.bounds;
    const w = maxX - minX;
    const h = maxY - minY;
    const variantCount = Math.max(1, opts.variantCount);
    const speedScale = opts.speedScale ?? 1;

    for (let i = 0; i < n; i++) {
      this.x[i] = minX + Math.random() * w;
      this.y[i] = minY + Math.random() * h;
      this.heading[i] = Math.random() * Math.PI * 2;
      const variant = Math.floor(Math.random() * variantCount);
      this.variant[i] = variant;
      // In the atlas layout, variants >= variantCount/2 are aircraft (faster).
      const isAircraft = variant >= variantCount / 2;
      const [lo, hi] = isAircraft ? AIRCRAFT_SPEED_KMH : TANK_SPEED_KMH;
      this.speed[i] = (lo + Math.random() * (hi - lo)) * KMH_TO_MPS * speedScale;
    }
    this.count = n;
  }

  /**
   * Advance every object by `dt` seconds along its heading, bouncing off the bounds.
   * Pure arithmetic over typed arrays — no allocation, no per-object object access.
   */
  step(dt: number): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const { x, y, heading, speed, count } = this;
    for (let i = 0; i < count; i++) {
      const h = heading[i];
      const d = speed[i] * dt;
      let nx = x[i] + Math.sin(h) * d;
      let ny = y[i] + Math.cos(h) * d;

      // Reflect heading off the walls so objects stay in view.
      if (nx < minX || nx > maxX) {
        nx = Math.max(minX, Math.min(maxX, nx));
        heading[i] = -h; // mirror across the y-axis (east/west flip)
      }
      if (ny < minY || ny > maxY) {
        ny = Math.max(minY, Math.min(maxY, ny));
        heading[i] = Math.PI - heading[i]; // mirror across the x-axis (north/south flip)
      }
      x[i] = nx;
      y[i] = ny;
    }
  }
}
