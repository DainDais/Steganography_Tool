// A carrier is any medium that can hide data: an image, a text
// document, an audio file. Every carrier implements this contract.

export type CarrierKind = "image" | "text";

export interface EmbedOptions {
  password?: string;
}

export interface Carrier<T> {
  kind: CarrierKind;

  // How many bytes of payload this carrier can hold.
  capacity(source: T): number;

  // Hide payload inside source, returning a modified carrier.
  encode(source: T, payload: Uint8Array, options?: EmbedOptions): Promise<T>;

  // Recover the hidden payload from a modified carrier.
  decode(source: T, options?: EmbedOptions): Promise<Uint8Array>;
}