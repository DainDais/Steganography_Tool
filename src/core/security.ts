// Encrypts payloads before they are embedded. Uses AES-GCM for
// authenticated encryption and PBKDF2 to turn a password into a key.

// Web Crypto requires a non-shared ArrayBuffer, so we name that
// specific shape rather than the looser default Uint8Array.
type Bytes = Uint8Array<ArrayBuffer>;

const SALT_SIZE = 16;
const IV_SIZE = 12;
const ITERATIONS = 600_000;

async function deriveKey(
  password: string,
  salt: Bytes
): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPayload(
  plaintext: Bytes,
  password: string
): Promise<Bytes> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));

  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  const result = new Uint8Array(
    SALT_SIZE + IV_SIZE + ciphertext.byteLength
  );
  result.set(salt, 0);
  result.set(iv, SALT_SIZE);
  result.set(new Uint8Array(ciphertext), SALT_SIZE + IV_SIZE);

  return result;
}

export async function decryptPayload(
  data: Bytes,
  password: string
): Promise<Bytes> {
  if (data.length <= SALT_SIZE + IV_SIZE) {
    throw new Error("Encrypted data is too short to be valid");
  }

  const salt = data.slice(0, SALT_SIZE);
  const iv = data.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
  const ciphertext = data.slice(SALT_SIZE + IV_SIZE);

  const key = await deriveKey(password, salt);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error("Decryption failed: wrong password or corrupted data");
  }
}