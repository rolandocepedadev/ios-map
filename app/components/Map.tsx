"use client";

import { useEffect, useRef, memo } from "react";
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import { fromLonLat } from "ol/proj";
import { defaults as defaultControls } from "ol/control";
import { apply } from "ol-mapbox-style";

interface MapProps {
  className?: string;
  center?: [number, number];
  zoom?: number;
}

const OpenLayersMap = memo(function OpenLayersMap({
  className = "w-full h-96",
  center = [-98.5795, 39.8283], // Center of USA
  zoom = 14,
}: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const initializedRef = useRef<boolean>(false);

  // Handle container resize (when sidebar opens/closes)

  useEffect(() => {
    if (!mapRef.current || initializedRef.current) return;

    // Create the map instance only once
    const map = new Map({
      target: mapRef.current,
      controls: defaultControls({
        attribution: true,
        zoom: true,
        rotate: false,
      }),
      view: new View({
        center: fromLonLat(center),
        zoom: zoom,
        minZoom: 2,
        maxZoom: 18,
      }),
    });

    mapInstanceRef.current = map;
    initializedRef.current = true;

    // Apply the MapTiler vector style
    apply(
      map,
      "https://api.maptiler.com/maps/019aa851-7005-7219-9be8-65f5e65ce6b4/style.json?key=RxKwgw2F5GydcRbFAqMS",
    ).catch((error) => {
      console.error("Error applying MapTiler style:", error);
    });

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
        initializedRef.current = false;
      }
    };
  }, [center, zoom]);

  // Handle updates to center/zoom without recreating the map
  useEffect(() => {
    if (mapInstanceRef.current && initializedRef.current) {
      const view = mapInstanceRef.current.getView();
      if (view) {
        view.animate({
          center: fromLonLat(center),
          zoom: zoom,
          duration: 500,
        });
      }
    }
  }, [center, zoom]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapRef}
        className={`${className} bg-zinc-950`}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
        }}
      />
    </div>
  );
});

export default OpenLayersMap;
