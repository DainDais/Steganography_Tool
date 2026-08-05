// Every embedded payload begins with a fixed-size header so the
// decoder knows what it is looking at and when to stop reading.

export const MAGIC = 0x53544732; // "STG2" as a 32-bit number

export interface PayloadHeader {
  magic: number;
  version: number;
  encrypted: boolean;
  length: number;
}
export const HEADER_SIZE = 10;
export const VERSION = 1;

export function serializeHeader(header: PayloadHeader): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, header.magic, false);
  view.setUint8(4, header.version);
  view.setUint8(5, header.encrypted ? 1 : 0);
  view.setUint32(6, header.length, false);

  return bytes;
}

export function deserializeHeader(bytes: Uint8Array): PayloadHeader {
  if (bytes.length < HEADER_SIZE) {
    throw new Error("Not enough bytes to contain a header");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);

  const header: PayloadHeader = {
    magic: view.getUint32(0, false),
    version: view.getUint8(4),
    encrypted: view.getUint8(5) === 1,
    length: view.getUint32(6, false),
  };

  if (header.magic !== MAGIC) {
    throw new Error("No steganographic payload found (bad magic number)");
  }

  return header;
}