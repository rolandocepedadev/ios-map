import { SYMBOL_PATHS, MIL_STD_COLORS } from "./milStd2525";
import { MilitaryFeature } from "../services/militaryFeatures";

/**
 * Sprite atlas for GPU point rendering (Phase 1 of the 1M-object plan).
 *
 * The Canvas `VectorLayer` generated a unique SVG `Icon` per feature, which caps out
 * well before 100k features. `WebGLPointsLayer` instead renders every point from a single
 * shared texture, selecting a sub-sprite per feature via a data-driven `icon-offset`
 * expression. We therefore pre-bake the finite set of symbol variants (type x status)
 * into one horizontal sprite sheet exactly once, then drive color/shape purely by picking
 * the right cell on the GPU.
 *
 * Symbols are drawn pointing north (unrotated); per-point heading is applied on the GPU via
 * the `icon-rotation` style expression, so rotation never touches the atlas.
 */

// Order here defines the variant index layout in the atlas (must stay stable).
export const ATLAS_TYPES: MilitaryFeature["type"][] = ["tank", "aircraft"];
export const ATLAS_STATUSES: MilitaryFeature["status"][] = [
  "friendly",
  "hostile",
  "neutral",
  "unknown",
];

/** Pixel size of each square cell in the atlas. */
export const ATLAS_CELL = 64;

export interface SymbolAtlas {
  /** PNG data URL suitable for the WebGL `icon-src` style property. */
  dataUrl: string;
  /** Side length of a single sprite cell, in pixels. */
  cell: number;
  /** Full atlas texture dimensions. */
  width: number;
  height: number;
  /** Number of distinct variants (cells) in the atlas. */
  count: number;
}

/**
 * Stable index of a (type, status) pair within the atlas row.
 * This value is stored per feature as the `variant` attribute and read by the
 * `icon-offset` style expression to locate the correct cell.
 */
export const variantIndex = (
  type: MilitaryFeature["type"],
  status: MilitaryFeature["status"],
): number => ATLAS_TYPES.indexOf(type) * ATLAS_STATUSES.length + ATLAS_STATUSES.indexOf(status);

// Half-extent of the affiliation frame within a cell.
const FRAME_HALF = 16;

function drawFrame(
  ctx: CanvasRenderingContext2D,
  status: MilitaryFeature["status"],
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (status) {
    case "friendly": // rounded rectangle
      ctx.roundRect(-FRAME_HALF, -FRAME_HALF, FRAME_HALF * 2, FRAME_HALF * 2, 3);
      break;
    case "hostile": // diamond
      ctx.moveTo(0, -FRAME_HALF);
      ctx.lineTo(FRAME_HALF, 0);
      ctx.lineTo(0, FRAME_HALF);
      ctx.lineTo(-FRAME_HALF, 0);
      ctx.closePath();
      break;
    case "neutral": // square
      ctx.rect(-FRAME_HALF, -FRAME_HALF, FRAME_HALF * 2, FRAME_HALF * 2);
      break;
    case "unknown": // circle
      ctx.arc(0, 0, FRAME_HALF, 0, Math.PI * 2);
      break;
  }
  ctx.stroke();
}

function drawSymbol(
  ctx: CanvasRenderingContext2D,
  type: MilitaryFeature["type"],
  color: string,
) {
  // SYMBOL_PATHS use SVG path syntax; Path2D consumes it directly so the shapes stay in
  // sync with the (retired-at-scale) SVG symbology.
  if (type === "tank") {
    const p = SYMBOL_PATHS.tank;
    ctx.fillStyle = color;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    const body = new Path2D(p.body);
    ctx.fill(body);
    ctx.stroke(body);
    const turret = new Path2D(p.turret);
    ctx.lineWidth = 1;
    ctx.fill(turret);
    ctx.stroke(turret);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000000";
    ctx.stroke(new Path2D(p.barrel));
  } else {
    const p = SYMBOL_PATHS.aircraft;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.stroke(new Path2D(p.fuselage));
    ctx.lineWidth = 2;
    ctx.stroke(new Path2D(p.wings));
    ctx.stroke(new Path2D(p.tail));
    ctx.fillStyle = color;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    const nose = new Path2D(p.nose);
    ctx.fill(nose);
    ctx.stroke(nose);
  }
}

/**
 * Build the sprite atlas as a single-row texture. Cheap and synchronous — call once at
 * layer initialization. Requires a DOM (browser) context.
 */
export function buildSymbolAtlas(): SymbolAtlas {
  const cell = ATLAS_CELL;
  const count = ATLAS_TYPES.length * ATLAS_STATUSES.length; // 8

  const canvas = document.createElement("canvas");
  canvas.width = cell * count;
  canvas.height = cell;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable for symbol atlas");

  for (const type of ATLAS_TYPES) {
    for (const status of ATLAS_STATUSES) {
      const idx = variantIndex(type, status);
      const color = MIL_STD_COLORS[status];
      ctx.save();
      ctx.translate(idx * cell + cell / 2, cell / 2);
      drawFrame(ctx, status, color);
      drawSymbol(ctx, type, color);
      ctx.restore();
    }
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    cell,
    width: canvas.width,
    height: canvas.height,
    count,
  };
}
