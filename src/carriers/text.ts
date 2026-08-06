// Hides data in zero-width Unicode characters inserted between the
// visible characters of a cover text. The result looks unchanged when
// rendered but carries the payload.

import { MAGIC, VERSION, HEADER_SIZE, serializeHeader, deserializeHeader } from "../core/header";
import { selectPositions } from "../core/position";
import { encryptPayload, decryptPayload } from "../core/security";
import type { EmbedOptions } from "../core/types";

type Bytes = Uint8Array<ArrayBuffer>;

const ZERO = "\u200C"; // zero width non-joiner  -> bit 0
const ONE = "\u200D";  // zero width joiner      -> bit 1

const ZERO_WIDTH = new Set([ZERO, ONE]);

function visibleChars(text: string): string[] {
  return Array.from(text).filter((c) => !ZERO_WIDTH.has(c));
}

export function capacity(cover: string): number {
  const gaps = visibleChars(cover).length + 1;
  return Math.max(0, Math.floor(gaps / 8) - HEADER_SIZE);
}

export function stripHidden(text: string): string {
  return visibleChars(text).join("");
}

export async function encodeText(
  cover: string,
  payload: Bytes,
  options: EmbedOptions = {}
): Promise<string> {
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

  const chars = visibleChars(cover);
  const gaps = chars.length + 1;
  const bitsNeeded = bytes.length * 8;

  if (bitsNeeded > gaps) {
    throw new Error(
      `Cover text too short: needs ${bitsNeeded} gaps, has ${gaps}`
    );
  }

  const order = selectPositions(gaps, options.password);

  // gapContents[i] holds whatever invisible character goes before chars[i]
  const gapContents: string[] = new Array(gaps).fill("");

  for (let i = 0; i < bitsNeeded; i++) {
    const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    gapContents[order[i]] = bit === 1 ? ONE : ZERO;
  }

  let result = "";
  for (let i = 0; i < chars.length; i++) {
    result += gapContents[i] + chars[i];
  }
  result += gapContents[chars.length];

  return result;
}

export async function decodeText(
  stego: string,
  options: EmbedOptions = {}
): Promise<Bytes> {
  const chars = Array.from(stego);
  const gaps: string[] = [];
  let pending = "";

  for (const char of chars) {
    if (ZERO_WIDTH.has(char)) {
      pending = char;
    } else {
      gaps.push(pending);
      pending = "";
    }
  }
  gaps.push(pending);

  const order = selectPositions(gaps.length, options.password);

  function readBytes(startByte: number, count: number): Bytes {
    const out = new Uint8Array(count);
    for (let i = 0; i < count * 8; i++) {
      const slot = order[startByte * 8 + i];
      const bit = gaps[slot] === ONE ? 1 : 0;
      out[i >> 3] = (out[i >> 3] << 1) | bit;
    }
    return out;
  }

  if (gaps.length < HEADER_SIZE * 8) {
    throw new Error("Text is too short to contain a payload");
  }

  const header = deserializeHeader(readBytes(0, HEADER_SIZE));

  if ((HEADER_SIZE + header.length) * 8 > gaps.length) {
    throw new Error("Header claims a payload larger than the text can hold");
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