// End-to-end encryption for sync. The sync code never leaves the device: both the vault id
// (what the server stores data under) and the AES key are derived from it with HKDF, so the
// server only ever sees an opaque id and ciphertext.

/** Crockford base32: no I, L, O, U, so codes survive being read aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20; // 100 bits

export function newSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]);
  return formatCode(chars.join(""));
}

/** Uppercases, drops separators, and maps look-alikes (O→0, I/L→1). Returns null if invalid. */
export function normalizeCode(input: string): string | null {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (raw.length !== CODE_LENGTH || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return raw;
}

export function formatCode(raw: string): string {
  return raw.match(/.{1,5}/g)!.join("-");
}

export interface VaultKeys {
  vaultId: string;
  key: CryptoKey;
}

const enc = new TextEncoder();

export async function deriveKeys(code: string): Promise<VaultKeys> {
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error("That sync code isn't valid.");
  const base = await crypto.subtle.importKey("raw", enc.encode(normalized), "HKDF", false, ["deriveBits", "deriveKey"]);
  const hkdf = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode("mnemo-sync"), info: enc.encode(info) });
  const idBits = await crypto.subtle.deriveBits(hkdf("vault-id/v1"), base, 256);
  const key = await crypto.subtle.deriveKey(hkdf("aes-key/v1"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const vaultId = Array.from(new Uint8Array(idBits), (b) => b.toString(16).padStart(2, "0")).join("");
  return { vaultId, key };
}

const MAGIC = enc.encode("MNM1");

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** JSON → gzip → AES-256-GCM. Layout: "MNM1" | 12-byte IV | ciphertext. */
export async function seal(value: unknown, key: CryptoKey): Promise<Uint8Array> {
  const plain = await pipe(enc.encode(JSON.stringify(value)), new CompressionStream("gzip"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(MAGIC.length + iv.length + cipher.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(cipher, MAGIC.length + iv.length);
  return out;
}

export async function open<T>(data: Uint8Array, key: CryptoKey): Promise<T> {
  if (data.length < 16 || !MAGIC.every((b, i) => data[i] === b)) throw new Error("Sync data is corrupt or from another app.");
  const iv = data.slice(4, 16);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data.slice(16));
  } catch {
    throw new Error("Couldn't decrypt the synced data. Is the sync code right?");
  }
  const json = await pipe(new Uint8Array(plain), new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(json)) as T;
}
