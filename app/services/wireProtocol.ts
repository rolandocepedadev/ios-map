/**
 * Binary wire protocol for streaming map objects (Phase 3 of the 1M plan).
 *
 * The JSON `features_update` path serialized every object as text every tick — at 1M that is
 * ~150 MB/tick. This protocol encodes each object as a fixed 16-byte record inside a compact
 * framed buffer, cutting the wire size ~10x and letting the client parse it with a DataView in
 * a Web Worker instead of `JSON.parse` on the main thread.
 *
 * Frames come in two kinds:
 *  - SNAPSHOT: the full population (sent on connect).
 *  - DELTA:    only the records that changed this tick (keyed by id).
 *
 * NOTE: the constants and record layout here MUST stay in sync with the server mirror at
 * `websocket-server/wire-protocol.js`.
 */

export const WIRE_VERSION = 1;

export const FRAME_SNAPSHOT = 0;
export const FRAME_DELTA = 1;

/** Frame header: [u8 frameType][u8 version][u16 reserved][u32 recordCount]. */
export const HEADER_SIZE = 8;

/** Record: [u32 id][f32 lon][f32 lat][u16 heading][u8 packed][u8 reserved]. */
export const RECORD_SIZE = 16;
export const OFF_ID = 0;
export const OFF_LON = 4;
export const OFF_LAT = 8;
export const OFF_HEADING = 12;
export const OFF_PACKED = 14;

/** Heading is quantized from 0..360 degrees into a u16. */
export const HEADING_SCALE = 65535 / 360;

// `packed` byte: bit0 = type (0 tank, 1 aircraft), bits1-2 = status (0..3).
export const STATUS_COUNT = 4;
export function unpackType(packed: number): number {
  return packed & 0x1;
}
export function unpackStatus(packed: number): number {
  return (packed >> 1) & 0x3;
}
/** Atlas cell index for a record: typeIndex * STATUS_COUNT + statusIndex. */
export function packedToVariant(packed: number): number {
  return unpackType(packed) * STATUS_COUNT + unpackStatus(packed);
}

export interface FrameHeader {
  frameType: number;
  version: number;
  count: number;
}

export function readFrameHeader(view: DataView): FrameHeader {
  return {
    frameType: view.getUint8(0),
    version: view.getUint8(1),
    count: view.getUint32(4, true),
  };
}

/** Web Mercator (EPSG:3857) forward projection — matches OpenLayers `fromLonLat`. */
const EARTH_RADIUS = 6378137;
const DEG2RAD = Math.PI / 180;
export function lonToMercatorX(lon: number): number {
  return EARTH_RADIUS * lon * DEG2RAD;
}
export function latToMercatorY(lat: number): number {
  return EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2));
}
