# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Next.js web app (despite the `ios-map` directory name, it is **not** a native iOS app) that
renders moving "military" units on an OpenLayers map. Beyond the original ~1,000-unit live view,
it carries a full pipeline for rendering and animating **up to 1,000,000 objects with no
clustering** — that scaling work is the bulk of the interesting code.

## Commands

Run from the repo root unless noted. Package manager is **pnpm**.

```bash
pnpm dev            # Next.js dev server on http://localhost:3000
pnpm build          # production build (Turbopack); also runs tsc — use to verify a change
pnpm lint           # eslint (flat config in eslint.config.mjs)
npx tsc --noEmit -p tsconfig.json   # typecheck only
```

The `websocket-server/` directory is a **separate package** with its own `node_modules`
(`ws`, ESM). Install once (`cd websocket-server && pnpm install`), then:

```bash
node server.js                                   # JSON live feed, ws://localhost:8080, 1000 units
COUNT=1000000 TICK_MS=1000 node binary-server.js # binary feed, ws://localhost:8081, scalable
node test-binary.js                              # headless smoke test of the binary protocol
```

There is **no unit-test framework**. The only automated checks are the two headless WS scripts
in `websocket-server/` (`test-binary.js`, `test-connection.js`) and `pnpm build` / `pnpm lint`.
WebGL rendering can only be verified in a real browser (no headless GL).

## Two runtime processes

1. **Next.js app** (`app/`) — the client. Client-only; `page.tsx` and `MapContainer.tsx` are
   `"use client"`.
2. **websocket-server/** — two independent mock servers. `server.js` (port 8080) streams the
   live 1000-unit feed as JSON. `binary-server.js` (port 8081) streams a scalable population as
   the binary protocol. They are unrelated; the JSON one powers the default view, the binary one
   powers the `?source=server` demo.

## The two rendering worlds

The single most important thing to understand: there is a **live path** and a **demo path**,
selected by URL query flags resolved in `page.tsx` and passed to `MapContainer.tsx`.

- **Live path** (no `?scale`): the original experience. `MilitaryFeatureService`
  (`app/services/militaryFeatures.ts`) connects to the JSON server (or falls back to local
  polling), holds units as an array in React state, and `MapContainer` renders them as a Canvas
  `VectorLayer` with per-feature MIL-STD-2525 SVG icons (`app/utils/milStd2525.ts`). This tops
  out well before 100k and is left untouched by the scaling work.

- **Demo path** (`?scale=N`): the 1M pipeline. `MapContainer` bypasses the live service and
  builds one of several GPU point layers via `app/utils/webglPointsDemo.ts`. All demo paths
  render from a shared **sprite atlas** (`app/utils/symbolAtlas.ts`, 8 variants = 2 types × 4
  statuses) and, where animated, a columnar **`FeatureStore`** (`app/services/featureStore.ts`,
  Structure-of-Arrays typed arrays — the source of truth, deliberately OpenLayers/React-free).

### Demo URL flags (combine on the `?scale=N` demo path)

- `?scale=N` — render N points (e.g. `1000000`).
- `?move=1` — animate them client-side from the `FeatureStore` (Phase 2).
- `?source=server` — drive them from `binary-server.js` (port 8081) via the Web Worker (Phase 3).
- `?renderer=custom` — use the custom WebGL renderer with GPU interpolation instead of the stock
  OpenLayers `WebGLPointsLayer`.

Example: `http://localhost:3000/?scale=1000000&renderer=custom` (custom renderer, no server needed).

## Why the architecture is shaped this way

Each layer of the naive pipeline caps out before 1M, so each was replaced:

- **Rendering** — Canvas SVG icons → GPU points. The **stock path** uses OpenLayers
  `WebGLPointsLayer`: it reads position from per-feature geometries, so updates mutate each
  geometry's flat-coordinate array **in place** and bump the source revision **once**
  (`source.changed()`), avoiding per-feature change events. Its limit is a full O(N) buffer
  rebuild per update, which makes smooth per-frame interpolation impossible.

- **Custom renderer** (`app/utils/customPointsLayer.ts`) — a WebGL2 layer via
  `ol/layer/Layer`'s `render(frameState)` option. It owns its GPU buffers and instance-renders
  the atlas **directly from the `FeatureStore` typed arrays** (no `ol/Feature` objects, dropping
  ~0.5–1 GB at 1M), and interpolates `mix(prev, target, u_t)` in the vertex shader for free
  smooth motion. Positions are uploaded **origin-relative** to preserve float32 precision, and
  the interpolation clock is read from `frameState.time`. Design rationale:
  `docs/future/custom-webgl-renderer.md`.

- **Transport** — full-array JSON per tick → a **binary protocol** (16-byte fixed records,
  SNAPSHOT + dead-band DELTA frames). Decoded off the main thread in a **Web Worker**
  (`app/workers/featureWorker.ts`) that owns the socket, keeps a worker-side SoA, projects to
  Web Mercator, and posts position buffers back via transferables.

## Sharp edges

- **Wire protocol is duplicated.** `app/services/wireProtocol.ts` (client, decode) and
  `websocket-server/wire-protocol.js` (server, encode) define the same record layout and MUST be
  kept in sync — there is no shared module across the two packages.

- **Client-only URL flags.** The page is statically prerendered, so reading `window.location`
  during render breaks hydration. Flags are resolved in a client `useEffect` into a `demo` state
  with a `ready` gate, and `MapContainer` is only mounted once flags are known. Keep new demo
  flags on this same pattern.

- **`MapContainer` initializes once.** Its map/layer setup runs a single time (guarded by
  `isInitialized`); the demo flags are read at that moment, which is why the map is mounted only
  after flags resolve rather than re-initialized on change.

- **Labels/selection read live positions, not OL features.** Because moving geometries in place
  (or the custom renderer) leaves OL's spatial index stale, viewport-gated labels and
  click-to-select scan the position source directly (`coordX`/`coordY` accessors in
  `webglPointsDemo.ts`) instead of using OL feature queries.

- **MapTiler key** is currently hardcoded in the `apply(...)` style URL in `MapContainer.tsx`.
