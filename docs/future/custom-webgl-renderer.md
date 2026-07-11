# Future Plan: Custom WebGL Point Renderer

**Status:** Deferred (captured while building Phase 3). Not scheduled.

## Why this exists

The 1M-object work (Phases 1–4) is built on OpenLayers' stock `WebGLPointsLayer`. That was
the right call to move fast and stay in-stack, but it carries two structural costs that no
amount of tuning removes:

1. **One `ol/Feature` + `ol/geom/Point` per object.** At 1M that is ~0.5–1 GB of JS objects,
   and it exists purely so the renderer has something to read. The columnar `FeatureStore`
   (`app/services/featureStore.ts`) already holds the real state in ~25 MB of typed arrays;
   the Feature objects are pure overhead.
2. **An O(N) render-instruction rebuild per update.** On every `source.changed()` the renderer
   walks all N cached features on the main thread to pack a `Float32Array` before handing it to
   its worker (`ol/renderer/webgl/PointsLayer.js` → `rebuildBuffers_`). This is the periodic
   main-thread hitch visible in the `?scale=1000000&move=1` demo.

Both costs vanish if we own the GPU buffers directly.

## What to build

A custom OpenLayers layer + renderer (extend `ol/layer/Layer` with a WebGL renderer built on
`ol/webgl/Helper`) that:

- Uploads the `FeatureStore` typed arrays straight into GPU vertex buffers (position, plus
  per-instance `variant` and `rotation`), using **instanced rendering** of a single quad —
  the same sprite atlas (`app/utils/symbolAtlas.ts`) and shader logic we already validated.
- On update, does a targeted `gl.bufferSubData` for changed points (or a single full re-upload
  of the ~8 MB position buffer, which is a fast GPU transfer), driven directly by the store's
  `x`/`y` arrays — **no `Feature` objects, no per-object main-thread packing loop**.
- Keeps the store as the sole source of truth. In the Phase 3 architecture the Web Worker
  already owns a store and posts position buffers via transferables; the custom renderer would
  consume those buffers with zero per-object main-thread work.

## Expected payoff

- **Memory:** drop from ~0.5–1 GB to tens of MB at 1M.
- **Main thread:** eliminate the per-tick rebuild hitch; updates become a buffer upload.
- **Headroom:** makes smooth 60fps animation of 1M+ realistic, and unblocks higher counts.

## Cost / risk

- Hand-written GLSL (vertex + fragment) and OL renderer plumbing (prepareFrame, hit detection,
  world wrapping, view transforms) — a meaningfully larger and riskier lift than the stock path.
- Reimplements things OL gives us for free: GPU hit-detection, dateline wrapping, DPR handling.
- Should only be undertaken if the stock-renderer hitch/memory at target scale proves
  unacceptable in practice. Measure first (the demo's `🛰️ moved N points in Xms` log is the
  signal), then decide.

## Related

- Phases 1–4 plan: `~/.claude/plans/one-feature-that-id-cached-stearns.md`
- Stock renderer path: `app/utils/webglPointsDemo.ts`, `app/components/MapContainer.tsx`
- Store (reused as-is): `app/services/featureStore.ts`
