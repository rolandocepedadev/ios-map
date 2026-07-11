"use client";

import { memo, useRef, useEffect, useCallback } from "react";
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import { fromLonLat } from "ol/proj";
import { defaults as defaultControls } from "ol/control";
import { apply } from "ol-mapbox-style";
import VectorLayer from "ol/layer/Vector";
import WebGLPointsLayer from "ol/layer/WebGLPoints";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { Style, Icon } from "ol/style";
import { MilitaryFeature } from "../services/militaryFeatures";
import { createMilStdIcon } from "../utils/milStd2525";
import { buildSymbolAtlas } from "../utils/symbolAtlas";

// Spread bounds for the WebGL stress demo (matches the mock data's San Antonio box).
const DEMO_BOUNDS = { north: 29.7, south: 29.1, east: -98.2, west: -98.8 };

/**
 * Build a WebGLPointsLayer populated with `count` random static points for the GPU
 * stress test. All points render from one shared sprite atlas: the per-feature `variant`
 * attribute picks the atlas cell (icon-offset) and `rot` drives GPU rotation (icon-rotation),
 * so there is no per-feature style/SVG allocation. This is the Phase-1 proof that the
 * renderer scales to ~1M; Phase 2 replaces the per-feature Feature objects with a columnar
 * typed-array store.
 */
function createWebGLDemoLayer(
  source: VectorSource,
  count: number,
): WebGLPointsLayer<VectorSource> {
  const atlas = buildSymbolAtlas();
  const { west, east, south, north } = DEMO_BOUNDS;

  console.time(`🧪 generate ${count} demo features`);
  const feats: Feature[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const lon = west + Math.random() * (east - west);
    const lat = south + Math.random() * (north - south);
    const f = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
    f.set("variant", Math.floor(Math.random() * atlas.count), true);
    f.set("rot", Math.random() * Math.PI * 2, true);
    feats[i] = f;
  }
  source.addFeatures(feats);
  console.timeEnd(`🧪 generate ${count} demo features`);

  return new WebGLPointsLayer({
    source,
    style: {
      "icon-src": atlas.dataUrl,
      // Select the atlas cell for this feature; texture size is supplied automatically.
      "icon-offset": ["array", ["*", ["get", "variant"], atlas.cell], 0],
      "icon-size": [atlas.cell, atlas.cell],
      "icon-rotation": ["get", "rot"],
      "icon-rotate-with-view": false,
    },
  });
}

interface MapContainerProps {
  features: MilitaryFeature[];
  /**
   * Phase 1 GPU stress test: when set (via `?scale=N`), render N static points through a
   * WebGLPointsLayer instead of the Canvas SVG path. Proves the renderer scales to ~1M.
   */
  demoScale?: number;
}

const MapContainer = memo(function MapContainer({
  features,
  demoScale = 0,
}: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const militaryLayerRef = useRef<
    VectorLayer<VectorSource> | WebGLPointsLayer<VectorSource> | null
  >(null);
  const isInitialized = useRef(false);

  // Function to update military features on the map
  const updateMilitaryFeatures = useCallback((features: MilitaryFeature[]) => {
    console.log(`🗺️ Updating map with ${features.length} military features`);

    if (!militaryLayerRef.current) {
      console.warn("❌ Military layer not initialized");
      return;
    }

    const militarySource = militaryLayerRef.current.getSource();
    if (!militarySource) {
      console.warn("❌ Military source not available");
      return;
    }

    militarySource.clear();

    features.forEach((feature, index) => {
      const olFeature = new Feature({
        geometry: new Point(fromLonLat(feature.position)),
        militaryData: feature,
      });

      olFeature.setId(feature.id);
      militarySource.addFeature(olFeature);

      // Log sample feature positions
      if (index < 3) {
        console.log(
          `📍 ${feature.callSign}: [${feature.position[0].toFixed(4)}, ${feature.position[1].toFixed(4)}]`,
        );
      }
    });

    console.log(`✅ Map updated with ${features.length} features`);
  }, []);

  useEffect(() => {
    if (!mapRef.current || isInitialized.current) return;

    const map = new Map({
      target: mapRef.current,
      controls: defaultControls({
        attribution: true,
        zoom: true,
        rotate: false,
      }),
      view: new View({
        center: fromLonLat([-98.4936, 29.4241]), // San Antonio
        zoom: 10,
        minZoom: 2,
        maxZoom: 18,
      }),
    });

    mapInstanceRef.current = map;
    isInitialized.current = true;

    // Create the military features layer. In demo mode we use a GPU WebGLPointsLayer to
    // stress-test rendering N static points; otherwise the standard Canvas SVG layer.
    const militarySource = new VectorSource();
    const militaryLayer:
      | VectorLayer<VectorSource>
      | WebGLPointsLayer<VectorSource> = demoScale > 0
      ? createWebGLDemoLayer(militarySource, demoScale)
      : new VectorLayer({
          source: militarySource,
          style: (feature) => {
            const militaryFeature = feature.get(
              "militaryData",
            ) as MilitaryFeature;
            if (!militaryFeature) return new Style();

            const iconConfig = createMilStdIcon(militaryFeature);
            return new Style({
              image: new Icon(iconConfig),
            });
          },
        });

    militaryLayerRef.current = militaryLayer;
    map.addLayer(militaryLayer);

    // Apply MapTiler vector style
    apply(
      map,
      "https://api.maptiler.com/maps/019aa851-7005-7219-9be8-65f5e65ce6b4/style.json?key=RxKwgw2F5GydcRbFAqMS",
    )
      .then(() => {
        // Ensure military layer is on top after base map loads
        map.removeLayer(militaryLayer);
        map.addLayer(militaryLayer);
      })
      .catch((error) => {
        console.error("Error applying MapTiler style:", error);
      });

    // Cleanup only on component unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
        isInitialized.current = false;
      }
      if (militaryLayerRef.current) {
        militaryLayerRef.current = null;
      }
    };
  }, [updateMilitaryFeatures, demoScale]); // demoScale is set once from the URL

  // Update military features when props change (skipped in the WebGL demo path)
  useEffect(() => {
    if (demoScale > 0) return;
    console.log(`🔄 MapContainer received ${features?.length || 0} features`);
    if (features && features.length > 0) {
      updateMilitaryFeatures(features);
    }
  }, [features, updateMilitaryFeatures, demoScale]);

  return (
    <div className="absolute inset-0">
      <div
        ref={mapRef}
        className="w-full h-full bg-zinc-950"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
        }}
      />
    </div>
  );
});

export default MapContainer;
