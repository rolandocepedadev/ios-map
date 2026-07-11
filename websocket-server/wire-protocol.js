/**
 * Binary wire protocol — server mirror of app/services/wireProtocol.ts.
 *
 * Encodes map objects as fixed 16-byte records inside a framed ArrayBuffer. Keep the
 * constants and record layout identical to the TypeScript version on the client.
 */

export const WIRE_VERSION = 1;

export const FRAME_SNAPSHOT = 0;
export const FRAME_DELTA = 1;

export const HEADER_SIZE = 8; // [u8 type][u8 version][u16 reserved][u32 count]
export const RECORD_SIZE = 16; // [u32 id][f32 lon][f32 lat][u16 hdg][u8 packed][u8 rsvd]
export const OFF_ID = 0;
export const OFF_LON = 4;
export const OFF_LAT = 8;
export const OFF_HEADING = 12;
export const OFF_PACKED = 14;

export const HEADING_SCALE = 65535 / 360;
export const STATUS_COUNT = 4;

/** Pack type (0 tank / 1 aircraft) and status (0..3) into one byte. */
export function packTypeStatus(type, status) {
  return (type & 0x1) | ((status & 0x3) << 1);
}

/**
 * Encode a frame from Structure-of-Arrays columns, including only `indices`.
 * @returns {ArrayBuffer}
 */
export function encodeFrame(frameType, columns, indices) {
  const { id, lon, lat, heading, packed } = columns;
  const n = indices.length;
  const buffer = new ArrayBuffer(HEADER_SIZE + n * RECORD_SIZE);
  const view = new DataView(buffer);

  view.setUint8(0, frameType);
  view.setUint8(1, WIRE_VERSION);
  view.setUint32(4, n, true);

  let o = HEADER_SIZE;
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    view.setUint32(o + OFF_ID, id[i], true);
    view.setFloat32(o + OFF_LON, lon[i], true);
    view.setFloat32(o + OFF_LAT, lat[i], true);
    const h = ((heading[i] % 360) + 360) % 360;
    view.setUint16(o + OFF_HEADING, Math.round(h * HEADING_SCALE), true);
    view.setUint8(o + OFF_PACKED, packed[i]);
    o += RECORD_SIZE;
  }
  return buffer;
}
