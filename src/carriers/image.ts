// Hides data in the least significant bits of an image's colour
// channels. Alpha is skipped: changing transparency is more visible
// and some pipelines premultiply it, which would destroy the payload.

import { MAGIC, VERSION, HEADER_SIZE, serializeHeader, deserializeHeader } from "../core/header";
import { selectPositions } from "../core/position";
import { encryptPayload, decryptPayload } from "../core/security";
import type { EmbedOptions } from "../core/types";

type Bytes = Uint8Array<ArrayBuffer>;

// ImageData from a browser canvas satisfies this shape automatically,
// so tests can use a plain object instead of a real canvas.
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

const CHANNELS_PER_PIXEL = 4;
const USABLE_CHANNELS = 3;

function slotToDataIndex(slot: number): number {
  const pixel = Math.floor(slot / USABLE_CHANNELS);
  const component = slot % USABLE_CHANNELS;
  return pixel * CHANNELS_PER_PIXEL + component;
}

export function usableSlots(image: RasterImage): number {
  return image.width * image.height * USABLE_CHANNELS;
}

export function capacity(image: RasterImage): number {
  return Math.max(0, Math.floor(usableSlots(image) / 8) - HEADER_SIZE);
}

export async function encodeImage(
  image: RasterImage,
  payload: Bytes,
  options: EmbedOptions = {}
): Promise<RasterImage> {
  const body = options.password
    ? await encryptPayload(payload, options.password)
    : payload;

  const header = serializeHeader({
    magic: MAGIC,
    version: VERSION,
    encrypted: Boolean(options.password),
    length: body.length,
  });

  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header, 0);
  bytes.set(body, header.length);

  const slots = usableSlots(image);
  if (bytes.length * 8 > slots) {
    throw new Error(
      `Payload too large: needs ${bytes.length} bytes, image holds ${capacity(image)}`
    );
  }

  const order = selectPositions(slots, options.password);

  const output: RasterImage = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };

  for (let i = 0; i < bytes.length * 8; i++) {
    const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    const index = slotToDataIndex(order[i]);
    output.data[index] = (output.data[index] & 0xfe) | bit;
  }

  return output;
}

export async function decodeImage(
  image: RasterImage,
  options: EmbedOptions = {}
): Promise<Bytes> {
  const slots = usableSlots(image);
  const order = selectPositions(slots, options.password);

  function readBytes(startByte: number, count: number): Bytes {
    const out = new Uint8Array(count);
    for (let i = 0; i < count * 8; i++) {
      const slot = order[startByte * 8 + i];
      const bit = image.data[slotToDataIndex(slot)] & 1;
      out[i >> 3] = (out[i >> 3] << 1) | bit;
    }
    return out;
  }

  const header = deserializeHeader(readBytes(0, HEADER_SIZE));

  if ((HEADER_SIZE + header.length) * 8 > slots) {
    throw new Error("Header claims a payload larger than the image can hold");
  }

  const body = readBytes(HEADER_SIZE, header.length);

  if (!header.encrypted) {
    return body;
  }

  if (!options.password) {
    throw new Error("This payload is encrypted but no password was given");
  }

  return decryptPayload(body, options.password);
}