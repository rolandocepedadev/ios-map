import { MilitaryFeature } from "../services/militaryFeatures";

export interface SymbolConfig {
  size: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  rotation: number;
}

// MIL-STD-2525 color coding
export const MIL_STD_COLORS = {
  friendly: "#00FF00", // Green
  hostile: "#FF0000", // Red
  neutral: "#FFFF00", // Yellow
  unknown: "#00FFFF", // Cyan
} as const;

// Symbol configurations for different unit types and affiliation
export const getSymbolConfig = (feature: MilitaryFeature): SymbolConfig => {
  const baseSize = feature.type === "aircraft" ? 24 : 20;
  const color = MIL_STD_COLORS[feature.status];

  return {
    size: baseSize,
    color: color,
    strokeColor: "#000000",
    strokeWidth: 2,
    rotation: feature.heading,
  };
};

// SVG path data for military symbols
export const SYMBOL_PATHS = {
  // Tank symbol (simplified MIL-STD-2525 ground vehicle)
  tank: {
    body: "M-8,-6 L8,-6 L10,-4 L10,4 L8,6 L-8,6 L-10,4 L-10,-4 Z",
    turret: "M-3,-3 L3,-3 L3,3 L-3,3 Z",
    barrel: "M0,-3 L0,-12 M-1,-12 L1,-12",
  },

  // Aircraft symbol (simplified MIL-STD-2525 fixed wing)
  aircraft: {
    fuselage: "M0,-12 L0,12",
    wings: "M-12,0 L12,0",
    tail: "M0,8 L-4,12 M0,8 L4,12",
    nose: "M0,-12 L-2,-14 L2,-14 Z",
  },
} as const;

// Generate SVG string for military symbol
export const generateMilStdSymbol = (feature: MilitaryFeature): string => {
  const config = getSymbolConfig(feature);
  const paths = SYMBOL_PATHS[feature.type];

  let svgContent = "";

  if (feature.type === "tank") {
    const tankPaths = paths as typeof SYMBOL_PATHS.tank;
    // Tank body
    svgContent += `<path d="${tankPaths.body}" fill="${config.color}" stroke="${config.strokeColor}" stroke-width="${config.strokeWidth}"/>`;
    // Tank turret
    svgContent += `<path d="${tankPaths.turret}" fill="${config.color}" stroke="${config.strokeColor}" stroke-width="1"/>`;
    // Tank barrel
    svgContent += `<path d="${tankPaths.barrel}" stroke="${config.strokeColor}" stroke-width="2" stroke-linecap="round"/>`;
  } else if (feature.type === "aircraft") {
    const aircraftPaths = paths as typeof SYMBOL_PATHS.aircraft;
    // Aircraft fuselage
    svgContent += `<path d="${aircraftPaths.fuselage}" stroke="${config.color}" stroke-width="${config.strokeWidth + 1}" stroke-linecap="round"/>`;
    // Aircraft wings
    svgContent += `<path d="${aircraftPaths.wings}" stroke="${config.color}" stroke-width="${config.strokeWidth}" stroke-linecap="round"/>`;
    // Aircraft tail
    svgContent += `<path d="${aircraftPaths.tail}" stroke="${config.color}" stroke-width="${config.strokeWidth}" stroke-linecap="round"/>`;
    // Aircraft nose
    svgContent += `<path d="${aircraftPaths.nose}" fill="${config.color}" stroke="${config.strokeColor}" stroke-width="1"/>`;
  }

  // Add affiliation frame (MIL-STD-2525 standard)
  const frameColor = config.color;
  const frameSize = config.size + 4;

  let frameShape = "";
  switch (feature.status) {
    case "friendly":
      // Rectangle for friendly
      frameShape = `<rect x="${-frameSize / 2}" y="${-frameSize / 2}" width="${frameSize}" height="${frameSize}" fill="none" stroke="${frameColor}" stroke-width="2" rx="2"/>`;
      break;
    case "hostile":
      // Diamond for hostile
      frameShape = `<path d="M0,${-frameSize / 2} L${frameSize / 2},0 L0,${frameSize / 2} L${-frameSize / 2},0 Z" fill="none" stroke="${frameColor}" stroke-width="2"/>`;
      break;
    case "neutral":
      // Square for neutral
      frameShape = `<rect x="${-frameSize / 2}" y="${-frameSize / 2}" width="${frameSize}" height="${frameSize}" fill="none" stroke="${frameColor}" stroke-width="2"/>`;
      break;
    case "unknown":
      // Circle for unknown
      frameShape = `<circle cx="0" cy="0" r="${frameSize / 2}" fill="none" stroke="${frameColor}" stroke-width="2"/>`;
      break;
  }

  const fullSvg = `
    <svg width="${config.size * 2}" height="${config.size * 2}" viewBox="${-config.size} ${-config.size} ${config.size * 2} ${config.size * 2}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${config.rotation})">
        ${frameShape}
        ${svgContent}
      </g>
      <!-- Callsign label -->
      <text x="0" y="${config.size + 8}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" fill="${config.color}" font-weight="bold">
        ${feature.callSign}
      </text>
    </svg>
  `;

  return fullSvg;
};

// Convert SVG to data URL for use in OpenLayers
export const svgToDataUrl = (svgString: string): string => {
  const encodedSvg = encodeURIComponent(svgString);
  return `data:image/svg+xml;charset=utf-8,${encodedSvg}`;
};

// Create OpenLayers icon style for military feature
export const createMilStdIcon = (feature: MilitaryFeature) => {
  const svgString = generateMilStdSymbol(feature);
  const dataUrl = svgToDataUrl(svgString);
  const config = getSymbolConfig(feature);

  return {
    src: dataUrl,
    scale: 1,
    anchor: [0.5, 0.5],
    anchorXUnits: "fraction" as const,
    anchorYUnits: "fraction" as const,
    rotation: 0, // Rotation is handled in SVG
    size: [config.size * 2, config.size * 2],
  };
};

// Animation utilities for moving features
export const interpolatePosition = (
  start: [number, number],
  end: [number, number],
  progress: number,
): [number, number] => {
  const lng = start[0] + (end[0] - start[0]) * progress;
  const lat = start[1] + (end[1] - start[1]) * progress;
  return [lng, lat];
};

// Calculate bearing between two points
export const calculateBearing = (
  start: [number, number],
  end: [number, number],
): number => {
  const startLng = (start[0] * Math.PI) / 180;
  const startLat = (start[1] * Math.PI) / 180;
  const endLng = (end[0] * Math.PI) / 180;
  const endLat = (end[1] * Math.PI) / 180;

  const dLng = endLng - startLng;

  const y = Math.sin(dLng) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  bearing = (bearing + 360) % 360;

  return bearing;
};

// Generate speed indicator for features
export const generateSpeedIndicator = (
  speed: number,
  maxSpeed: number,
): string => {
  const percentage = Math.min(speed / maxSpeed, 1);
  const barWidth = 20;
  const barHeight = 4;
  const fillWidth = barWidth * percentage;

  return `
    <svg width="${barWidth + 4}" height="${barHeight + 4}" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="${barWidth}" height="${barHeight}" fill="none" stroke="#000" stroke-width="1"/>
      <rect x="2" y="2" width="${fillWidth}" height="${barHeight}" fill="#00FF00"/>
    </svg>
  `;
};
