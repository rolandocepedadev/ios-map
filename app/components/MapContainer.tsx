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
import { buildDemoLayer, type DemoLayer } from "../utils/webglPointsDemo";

interface MapContainerProps {
  features: MilitaryFeature[];
  /**
   * GPU stress test: when set (via `?scale=N`), render N points through a WebGLPointsLayer
   * instead of the Canvas SVG path. Proves the renderer scales to ~1M.
   */
  demoScale?: number;
  /**
   * When true (via `?move=1`), animate the demo points from the columnar FeatureStore
   * (Phase 2). Otherwise the demo points are static.
   */
  demoMove?: boolean;
}

const MapContainer = memo(function MapContainer({
  features,
  demoScale = 0,
  demoMove = false,
}: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const militaryLayerRef = useRef<
    VectorLayer<VectorSource> | WebGLPointsLayer<VectorSource> | null
  >(null);
  const demoRef = useRef<DemoLayer | null>(null);
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
    // stress-test rendering N points (moving when demoMove is set); otherwise the standard
    // Canvas SVG layer for the live 1000-unit feed.
    let militaryLayer:
      | VectorLayer<VectorSource>
      | WebGLPointsLayer<VectorSource>;

    if (demoScale > 0) {
      const demo = buildDemoLayer(demoScale, demoMove);
      demoRef.current = demo;
      militaryLayer = demo.layer;
      demo.start();
    } else {
      militaryLayer = new VectorLayer({
        source: new VectorSource(),
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
    }

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
      if (demoRef.current) {
        demoRef.current.stop();
        demoRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
        isInitialized.current = false;
      }
      if (militaryLayerRef.current) {
        militaryLayerRef.current = null;
      }
    };
  }, [updateMilitaryFeatures, demoScale, demoMove]); // demo flags are set once from the URL

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
