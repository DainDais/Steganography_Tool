// Every embedded payload begins with a fixed-size header so the
// decoder knows what it is looking at and when to stop reading.

export const MAGIC = 0x53544732; // "STG2" as a 32-bit number

export interface PayloadHeader {
  magic: number;
  version: number;
  encrypted: boolean;
  length: number;
}