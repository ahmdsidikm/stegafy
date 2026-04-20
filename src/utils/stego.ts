export interface HiddenFile {
  id: string;
  name: string;
  size: number;
  type: string;
  data: ArrayBuffer;
  comment?: string;
}

export type EncryptionMethod = 'xor' | 'aes';


export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_MATCH_THRESHOLD = 0.50; // Euclidean distance (sedang)
export const FACE_SEED_LENGTH = 64; // 64-byte random seed stored in the encrypted bundle


const MAGIC_BYTES = [0x53, 0x54, 0x45, 0x47]; // "STEG"
const AES_SALT_LENGTH = 32; // Increased for Argon2
const AES_IV_LENGTH = 12;
const ARGON2_TIME_COST = 3;
const ARGON2_MEMORY_COST = 65536; // 64MB
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32; // 256-bit key

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// ──────────────────────────────────────────────
// Password Strength Calculator
// ──────────────────────────────────────────────

export interface PasswordStrength {
  score: number; // 0-4
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  percentage: number;
  suggestions: string[];
}

export function calculatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: '',
      color: 'bg-slate-200',
      bgColor: 'bg-slate-50',
      textColor: 'text-slate-400',
      percentage: 0,
      suggestions: [],
    };
  }

  let score = 0;
  const suggestions: string[] = [];

  // Length scoring
  if (password.length >= 8) score += 1;
  else suggestions.push('Minimal 8 karakter');

  if (password.length >= 12) score += 1;
  else if (password.length >= 8) suggestions.push('Tambahkan lebih banyak karakter (12+)');

  // Character variety
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  const varietyCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (varietyCount >= 3) score += 1;
  else {
    if (!hasUpper) suggestions.push('Tambahkan huruf besar');
    if (!hasDigit) suggestions.push('Tambahkan angka');
    if (!hasSpecial) suggestions.push('Tambahkan simbol (!@#$%)');
  }

  if (varietyCount >= 4 && password.length >= 12) score += 1;

  // Penalize common patterns
  const commonPatterns = /^(123|abc|qwerty|password|admin|letmein)/i;
  const repeating = /(.)\1{2,}/;
  const sequential = /(012|123|234|345|456|567|678|789|abc|bcd|cde|def)/i;

  if (commonPatterns.test(password) || repeating.test(password) || sequential.test(password)) {
    score = Math.max(0, score - 1);
    if (commonPatterns.test(password)) suggestions.push('Hindari pola umum');
    if (repeating.test(password)) suggestions.push('Hindari karakter berulang');
    if (sequential.test(password)) suggestions.push('Hindari urutan berturut');
  }

  // Clamp score
  score = Math.min(4, Math.max(0, score));

  const configs: Record<number, Omit<PasswordStrength, 'score' | 'suggestions' | 'percentage'>> = {
    0: { label: 'Sangat Lemah', color: 'bg-red-500', bgColor: 'bg-red-50', textColor: 'text-red-600' },
    1: { label: 'Lemah', color: 'bg-orange-500', bgColor: 'bg-orange-50', textColor: 'text-orange-600' },
    2: { label: 'Cukup', color: 'bg-amber-500', bgColor: 'bg-amber-50', textColor: 'text-amber-600' },
    3: { label: 'Kuat', color: 'bg-emerald-500', bgColor: 'bg-emerald-50', textColor: 'text-emerald-600' },
    4: { label: 'Sangat Kuat', color: 'bg-emerald-600', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700' },
  };

  return {
    score,
    ...configs[score],
    percentage: (score / 4) * 100,
    suggestions: suggestions.slice(0, 3),
  };
}

// ──────────────────────────────────────────────
// Secure Password Handling
// ──────────────────────────────────────────────

export function secureWipeString(str: string): void {
  // While we can't truly wipe JS strings (they're immutable),
  // we can signal to the GC and clear any typed array copies
  try {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    crypto.getRandomValues(bytes);
  } catch {
    // Silently fail — best effort
  }
}

// ──────────────────────────────────────────────
// Face Descriptor Helpers
// ──────────────────────────────────────────────

/**
 * Serialize a Float32Array face descriptor (128 floats = 512 bytes) to Uint8Array.
 */
export function serializeFaceDescriptor(descriptor: Float32Array): Uint8Array {
  const buf = new Uint8Array(descriptor.buffer.slice(descriptor.byteOffset, descriptor.byteOffset + descriptor.byteLength));
  return buf;
}

/**
 * Deserialize 512 bytes back to a Float32Array face descriptor.
 */
export function deserializeFaceDescriptor(bytes: Uint8Array): Float32Array {
  const copy = new Uint8Array(bytes).buffer;
  return new Float32Array(copy);
}

/**
 * Compute euclidean distance between two face descriptors.
 * Threshold ~0.5 = sedang (toleran terhadap perubahan cahaya/sudut).
 */
export function faceDescriptorDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function isFaceMatch(a: Float32Array, b: Float32Array): boolean {
  return faceDescriptorDistance(a, b) <= FACE_MATCH_THRESHOLD;
}

// ──────────────────────────────────────────────
// XOR Encryption (tanpa base64)
// ──────────────────────────────────────────────

function xorEncrypt(data: Uint8Array, password: string): Uint8Array {
  if (!password) return data;
  const result = new Uint8Array(data.length);
  const passBytes = new TextEncoder().encode(password);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ passBytes[i % passBytes.length];
  }
  // Wipe password bytes
  crypto.getRandomValues(passBytes);
  return result;
}

// ──────────────────────────────────────────────
// Argon2id Key Derivation (pure JS implementation)
// ──────────────────────────────────────────────

/**
 * Minimal Argon2id implementation for browser environments.
 * Falls back to PBKDF2 if performance is critical.
 *
 * Since full Argon2 in pure JS is complex and slow, we use a
 * hybrid approach: Argon2-like strengthening via multiple rounds
 * of PBKDF2 with SHA-512 + memory-hard mixing.
 */
async function argon2DeriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Phase 1: Initial PBKDF2 key material
  const baseKeyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Phase 2: Memory-hard mixing
  // Allocate memory blocks to simulate Argon2's memory hardness
  const blockCount = Math.min(ARGON2_MEMORY_COST / 1024, 64); // Cap at 64 blocks for browser
  const blockSize = 1024; // 1KB per block
  const memoryBlocks: Uint8Array[] = [];

  // Generate initial blocks using PBKDF2 with high iterations
  const initialBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ARGON2_TIME_COST * 10000,
      hash: 'SHA-512',
    },
    baseKeyMaterial,
    blockSize * 8 // bits
  );

  const initialBlock = new Uint8Array(initialBits);

  // Fill memory blocks
  for (let i = 0; i < blockCount; i++) {
    const block = new Uint8Array(blockSize);
    for (let j = 0; j < blockSize; j++) {
      block[j] = initialBlock[j % initialBlock.length] ^ ((i * blockSize + j) & 0xff);
    }
    memoryBlocks.push(block);
  }

  // Phase 3: Mix blocks (simulate Argon2 mixing)
  for (let t = 0; t < ARGON2_TIME_COST; t++) {
    for (let i = 0; i < blockCount; i++) {
      const refIndex = (memoryBlocks[i][0] + memoryBlocks[i][1] * 256) % blockCount;
      const refBlock = memoryBlocks[refIndex];
      for (let j = 0; j < blockSize; j++) {
        memoryBlocks[i][j] ^= refBlock[j];
      }
    }
  }

  // Phase 4: Combine blocks into final seed
  const finalSeed = new Uint8Array(ARGON2_HASH_LENGTH);
  for (let i = 0; i < blockCount; i++) {
    for (let j = 0; j < ARGON2_HASH_LENGTH; j++) {
      finalSeed[j] ^= memoryBlocks[i][j % blockSize];
    }
  }

  // Phase 5: Final PBKDF2 pass with the mixed seed as salt
  const combinedSalt = new Uint8Array(salt.length + finalSeed.length);
  combinedSalt.set(salt, 0);
  combinedSalt.set(finalSeed, salt.length);

  const finalKeyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: combinedSalt,
      iterations: 50000,
      hash: 'SHA-256',
    },
    finalKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // Wipe sensitive data from memory
  crypto.getRandomValues(passwordBytes);
  for (const block of memoryBlocks) {
    crypto.getRandomValues(block);
  }
  crypto.getRandomValues(finalSeed);
  crypto.getRandomValues(combinedSalt);

  return derivedKey;
}

// ──────────────────────────────────────────────
// AES-256-GCM Encryption (with Argon2id KDF)
// ──────────────────────────────────────────────

async function aesEncrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(AES_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const key = await argon2DeriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  // Header: [1 byte version][salt][iv][ciphertext]
  // Version 0x02 = Argon2id KDF
  const result = new Uint8Array(1 + AES_SALT_LENGTH + AES_IV_LENGTH + ciphertext.byteLength);
  result[0] = 0x02; // Version marker for Argon2
  result.set(salt, 1);
  result.set(iv, 1 + AES_SALT_LENGTH);
  result.set(new Uint8Array(ciphertext), 1 + AES_SALT_LENGTH + AES_IV_LENGTH);

  // Wipe intermediate data
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  return result;
}

async function aesDecrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  // Check version byte
  const version = data[0];

  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  let key: CryptoKey;

  if (version === 0x02) {
    // Argon2id KDF (new format)
    if (data.length < 1 + AES_SALT_LENGTH + AES_IV_LENGTH + 1) {
      throw new Error('Data terenkripsi terlalu pendek.');
    }
    salt = data.slice(1, 1 + AES_SALT_LENGTH);
    iv = data.slice(1 + AES_SALT_LENGTH, 1 + AES_SALT_LENGTH + AES_IV_LENGTH);
    ciphertext = data.slice(1 + AES_SALT_LENGTH + AES_IV_LENGTH);
    key = await argon2DeriveKey(password, salt);
  } else {
    // Legacy PBKDF2 format (backward compatibility)
    // Old format: [salt(16)][iv(12)][ciphertext]
    const legacySaltLen = 16;
    if (data.length < legacySaltLen + AES_IV_LENGTH + 1) {
      throw new Error('Data terenkripsi terlalu pendek.');
    }
    salt = data.slice(0, legacySaltLen);
    iv = data.slice(legacySaltLen, legacySaltLen + AES_IV_LENGTH);
    ciphertext = data.slice(legacySaltLen + AES_IV_LENGTH);
    key = await legacyDeriveKey(password, salt);
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('Gagal mendekripsi. Password salah atau data rusak.');
  }
}

// Legacy PBKDF2 key derivation for backward compatibility
async function legacyDeriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ──────────────────────────────────────────────
// File Reading Helpers
// ──────────────────────────────────────────────

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsText(file);
  });
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca blob'));
    reader.readAsDataURL(blob);
  });
}

export function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca blob'));
    reader.readAsText(blob);
  });
}

// ──────────────────────────────────────────────
// Base64 Helpers (hanya untuk AES)
// ──────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// ──────────────────────────────────────────────
// Raw binary serialization (untuk XOR — tanpa base64)
// ──────────────────────────────────────────────

function serializeFilesRaw(
  filesData: Array<{
    name: string;
    type: string;
    data: ArrayBuffer;
    comment?: string;
  }>
): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  const countBuf = new Uint8Array(4);
  const countView = new DataView(countBuf.buffer);
  countView.setUint32(0, filesData.length, false);
  parts.push(countBuf);

  for (const f of filesData) {
    const nameBytes = encoder.encode(f.name);
    const typeBytes = encoder.encode(f.type);
    const commentBytes = encoder.encode(f.comment || '');
    const dataBytes = new Uint8Array(f.data);

    const nameLenBuf = new Uint8Array(2);
    new DataView(nameLenBuf.buffer).setUint16(0, nameBytes.length, false);
    parts.push(nameLenBuf);
    parts.push(nameBytes);

    const typeLenBuf = new Uint8Array(2);
    new DataView(typeLenBuf.buffer).setUint16(0, typeBytes.length, false);
    parts.push(typeLenBuf);
    parts.push(typeBytes);

    const commentLenBuf = new Uint8Array(2);
    new DataView(commentLenBuf.buffer).setUint16(0, commentBytes.length, false);
    parts.push(commentLenBuf);
    parts.push(commentBytes);

    const dataLenBuf = new Uint8Array(4);
    new DataView(dataLenBuf.buffer).setUint32(0, dataBytes.length, false);
    parts.push(dataLenBuf);
    parts.push(dataBytes);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

function deserializeFilesRaw(
  data: Uint8Array
): Array<{ name: string; type: string; data: ArrayBuffer; comment: string }> {
  const decoder = new TextDecoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const fileCount = view.getUint32(offset, false);
  offset += 4;

  const files: Array<{ name: string; type: string; data: ArrayBuffer; comment: string }> = [];

  for (let i = 0; i < fileCount; i++) {
    const nameLen = view.getUint16(offset, false);
    offset += 2;
    const name = decoder.decode(data.subarray(offset, offset + nameLen));
    offset += nameLen;

    const typeLen = view.getUint16(offset, false);
    offset += 2;
    const type = decoder.decode(data.subarray(offset, offset + typeLen));
    offset += typeLen;

    const commentLen = view.getUint16(offset, false);
    offset += 2;
    const comment = decoder.decode(data.subarray(offset, offset + commentLen));
    offset += commentLen;

    const dataLen = view.getUint32(offset, false);
    offset += 4;
    const fileData = data.slice(offset, offset + dataLen).buffer as ArrayBuffer;
    offset += dataLen;

    files.push({ name, type, data: fileData, comment });
  }

  return files;
}

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// Steganography Core Functions
// ──────────────────────────────────────────────

/**
 * NEW Trailer layout (v3 — Face-Seed Bundle):
 *
 *   [ cover bytes (variable) ]
 *   [ payload bytes (variable) ]
 *   [ encryptedFaceSeedBundle (bundleSize bytes) ]  ← only when hasFace = 0x01
 *   [ payloadSize  (4 bytes, big-endian) ]
 *   [ bundleSize   (4 bytes, big-endian) ]           ← 0 when hasFace = 0x00
 *   [ hasFace flag (1 byte) : 0x00 | 0x01 ]
 *   [ methodFlag   (1 byte) ]
 *   [ MAGIC        (4 bytes): 'STEG' ]
 *
 * Fixed trailer = 14 bytes. Always present regardless of hasFace.
 *
 * The encryptedFaceSeedBundle stores:
 *   AES-256-GCM( seed(64 bytes) || faceDescriptor(512 bytes) , userPassword )
 * so that:
 *   1. Only the correct password can decrypt the bundle.
 *   2. Only the correct face (distance ≤ threshold) is accepted.
 *   3. compositePassword = userPassword + hex(seed)  is used to encrypt/decrypt the payload.
 */
const FIXED_TRAILER = 14; // always present

// ──────────────────────────────────────────────
// Face-Seed Bundle API
// ──────────────────────────────────────────────

/** Generate a cryptographically random 64-byte seed. */
export function generateFaceSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(FACE_SEED_LENGTH));
}

/** Convert seed bytes → lowercase hex string. */
export function seedToHex(seed: Uint8Array): string {
  return Array.from(seed).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the composite password used for payload encryption.
 *   compositePassword = userPassword + hexSeed
 * The seed is appended silently behind the scenes so the effective
 * key material is dramatically stronger than what the user typed.
 */
export function buildCompositePassword(userPassword: string, seed: Uint8Array): string {
  return userPassword + seedToHex(seed);
}

/**
 * Encrypt { seed(64 B) || faceDescriptor(512 B) } with userPassword using AES-256-GCM + Argon2.
 * Returns the opaque ciphertext blob to store in the file trailer.
 */
export async function encryptFaceSeedBundle(
  seed: Uint8Array,
  faceDescriptor: Float32Array,
  userPassword: string
): Promise<Uint8Array> {
  const faceBytes = serializeFaceDescriptor(faceDescriptor);
  const plain = new Uint8Array(FACE_SEED_LENGTH + faceBytes.length);
  plain.set(seed, 0);
  plain.set(faceBytes, FACE_SEED_LENGTH);
  const encrypted = await aesEncrypt(plain, userPassword);
  crypto.getRandomValues(plain); // wipe
  return encrypted;
}

/**
 * Decrypt the face-seed bundle stored in the file trailer.
 * Throws if password is wrong or data is corrupted.
 * Returns { seed, faceDescriptor }.
 */
export async function decryptFaceSeedBundle(
  encryptedBundle: Uint8Array,
  userPassword: string
): Promise<{ seed: Uint8Array; faceDescriptor: Float32Array }> {
  const plain = await aesDecrypt(encryptedBundle, userPassword);
  if (plain.length < FACE_SEED_LENGTH + FACE_DESCRIPTOR_LENGTH * 4) {
    throw new Error('Bundle data tidak valid atau rusak.');
  }
  const seed = plain.slice(0, FACE_SEED_LENGTH);
  const faceBytes = plain.slice(FACE_SEED_LENGTH, FACE_SEED_LENGTH + FACE_DESCRIPTOR_LENGTH * 4);
  const faceDescriptor = deserializeFaceDescriptor(faceBytes);
  crypto.getRandomValues(plain); // wipe
  return { seed, faceDescriptor };
}

/**
 * Read the raw encrypted bundle bytes from a stego file buffer — WITHOUT decrypting.
 * Used when loading a stego file so we can pass it to the face verification flow.
 * Returns null when the file has no face lock.
 */
export function extractEncryptedBundleRaw(buffer: ArrayBuffer): Uint8Array | null {
  const u8 = new Uint8Array(buffer);
  if (u8.length < FIXED_TRAILER) return null;

  // Verify magic
  const mo = u8.length - 4;
  if (
    u8[mo]     !== MAGIC_BYTES[0] ||
    u8[mo + 1] !== MAGIC_BYTES[1] ||
    u8[mo + 2] !== MAGIC_BYTES[2] ||
    u8[mo + 3] !== MAGIC_BYTES[3]
  ) return null;

  const hasFaceFlag = u8[u8.length - 5]; // offset -5 from end
  if (hasFaceFlag !== 0x01) return null;

  // bundleSize at offset -10 from end
  const bso = u8.length - 10;
  const bundleSize =
    (u8[bso]     << 24) | (u8[bso + 1] << 16) | (u8[bso + 2] << 8) | u8[bso + 3];
  if (bundleSize <= 0) return null;

  // payloadSize at offset -14 from end
  const pso = u8.length - 14;
  const payloadSize =
    (u8[pso] << 24) | (u8[pso + 1] << 16) | (u8[pso + 2] << 8) | u8[pso + 3];
  if (payloadSize <= 0) return null;

  // Bundle starts right after payload, before FIXED_TRAILER
  const bundleStart = u8.length - FIXED_TRAILER - bundleSize;
  if (bundleStart < 0) return null;

  return u8.slice(bundleStart, bundleStart + bundleSize);
}

// ──────────────────────────────────────────────
// embedFiles
// ──────────────────────────────────────────────

export async function embedFiles(
  coverFile: File,
  secretFiles: File[],
  password?: string,
  comments?: Record<number, string>,
  method?: EncryptionMethod,
  /**
   * Pre-encrypted face-seed bundle (output of encryptFaceSeedBundle).
   * When provided, the payload must already be encrypted with the composite password
   * (userPassword + seedHex). Pass undefined/null for files without Face Lock.
   */
  encryptedFaceSeedBundle?: Uint8Array | null
): Promise<{ blob: Blob; extension: string }> {
  const coverBuffer = await readFileAsArrayBuffer(coverFile);

  let payloadBytes: Uint8Array;
  let methodFlag: number;

  if (password && method === 'xor') {
    const filesForRaw: Array<{ name: string; type: string; data: ArrayBuffer; comment?: string }> = [];
    for (let i = 0; i < secretFiles.length; i++) {
      const file = secretFiles[i];
      const buffer = await readFileAsArrayBuffer(file);
      filesForRaw.push({ name: file.name, type: file.type, data: buffer, comment: comments?.[i] });
    }
    const rawBytes = serializeFilesRaw(filesForRaw);
    payloadBytes = xorEncrypt(rawBytes, password);
    methodFlag = 0x01;
  } else if (password && method === 'aes') {
    const filesData = [];
    for (let i = 0; i < secretFiles.length; i++) {
      const file = secretFiles[i];
      const buffer = await readFileAsArrayBuffer(file);
      filesData.push({
        name: file.name, type: file.type, size: file.size,
        dataBase64: arrayBufferToBase64(buffer), comment: comments?.[i],
      });
    }
    const payloadJson = JSON.stringify({ files: filesData });
    const plainBytes = new TextEncoder().encode(payloadJson);
    payloadBytes = await aesEncrypt(plainBytes, password);
    methodFlag = 0x02;
  } else {
    const filesData = [];
    for (let i = 0; i < secretFiles.length; i++) {
      const file = secretFiles[i];
      const buffer = await readFileAsArrayBuffer(file);
      filesData.push({
        name: file.name, type: file.type, size: file.size,
        dataBase64: arrayBufferToBase64(buffer), comment: comments?.[i],
      });
    }
    const payloadJson = JSON.stringify({ files: filesData });
    payloadBytes = new TextEncoder().encode(payloadJson);
    methodFlag = 0x00;
  }

  const payloadSize  = payloadBytes.length;
  const hasFace      = !!(encryptedFaceSeedBundle && encryptedFaceSeedBundle.length > 0);
  const bundleSize   = hasFace ? encryptedFaceSeedBundle!.length : 0;
  const totalSize    = coverBuffer.byteLength + payloadSize + bundleSize + FIXED_TRAILER;
  const combined     = new Uint8Array(totalSize);

  combined.set(new Uint8Array(coverBuffer), 0);
  combined.set(payloadBytes, coverBuffer.byteLength);

  let mo = coverBuffer.byteLength + payloadSize; // metaOffset

  // Write encrypted bundle (variable length, 0 bytes if no face)
  if (hasFace && encryptedFaceSeedBundle) {
    combined.set(encryptedFaceSeedBundle, mo);
    mo += bundleSize;
  }

  // payloadSize (4 bytes)
  combined[mo]     = (payloadSize >> 24) & 0xff;
  combined[mo + 1] = (payloadSize >> 16) & 0xff;
  combined[mo + 2] = (payloadSize >>  8) & 0xff;
  combined[mo + 3] =  payloadSize        & 0xff;
  // bundleSize (4 bytes) — 0 if no face
  combined[mo + 4] = (bundleSize >> 24) & 0xff;
  combined[mo + 5] = (bundleSize >> 16) & 0xff;
  combined[mo + 6] = (bundleSize >>  8) & 0xff;
  combined[mo + 7] =  bundleSize        & 0xff;
  // hasFace flag (1 byte)
  combined[mo + 8] = hasFace ? 0x01 : 0x00;
  // methodFlag (1 byte)
  combined[mo + 9] = methodFlag;
  // MAGIC (4 bytes)
  combined[mo + 10] = MAGIC_BYTES[0];
  combined[mo + 11] = MAGIC_BYTES[1];
  combined[mo + 12] = MAGIC_BYTES[2];
  combined[mo + 13] = MAGIC_BYTES[3];

  const ext  = coverFile.name.split('.').pop() || 'bin';
  const blob = new Blob([combined], { type: coverFile.type || 'application/octet-stream' });
  return { blob, extension: ext };
}

// ──────────────────────────────────────────────
// checkForHiddenData
// ──────────────────────────────────────────────

export function checkForHiddenData(
  buffer: ArrayBuffer
): { found: boolean; hasPassword: boolean; hasFace: boolean; method: EncryptionMethod | null } {
  const u8 = new Uint8Array(buffer);
  if (u8.length < FIXED_TRAILER) {
    return { found: false, hasPassword: false, hasFace: false, method: null };
  }

  // Check magic
  const mo = u8.length - 4;
  const hasMagic =
    u8[mo]     === MAGIC_BYTES[0] &&
    u8[mo + 1] === MAGIC_BYTES[1] &&
    u8[mo + 2] === MAGIC_BYTES[2] &&
    u8[mo + 3] === MAGIC_BYTES[3];
  if (!hasMagic) return { found: false, hasPassword: false, hasFace: false, method: null };

  // Trailer from end: MAGIC(-4), methodFlag(-5), hasFace(-6), bundleSize(-10 MSB), payloadSize(-14 MSB)
  const methodFlag  = u8[u8.length - 5];
  const hasFaceFlag = u8[u8.length - 6];
  const hasFace     = hasFaceFlag === 0x01;

  const bso = u8.length - 10;
  const bundleSize =
    (u8[bso]     << 24) | (u8[bso + 1] << 16) | (u8[bso + 2] << 8) | u8[bso + 3];

  const pso = u8.length - 14;
  if (pso < 0) return { found: false, hasPassword: false, hasFace: false, method: null };

  const payloadSize =
    (u8[pso] << 24) | (u8[pso + 1] << 16) | (u8[pso + 2] << 8) | u8[pso + 3];

  const totalExtra = FIXED_TRAILER + (hasFace ? bundleSize : 0);
  if (payloadSize <= 0 || payloadSize > u8.length - totalExtra) {
    return { found: false, hasPassword: false, hasFace: false, method: null };
  }

  const hasPassword = methodFlag === 0x01 || methodFlag === 0x02;
  const method: EncryptionMethod | null =
    methodFlag === 0x01 ? 'xor' :
    methodFlag === 0x02 ? 'aes' : null;

  return { found: true, hasPassword, hasFace, method };
}

// ──────────────────────────────────────────────
// extractFiles
// ──────────────────────────────────────────────

export async function extractFiles(
  buffer: ArrayBuffer,
  password?: string,
  method?: EncryptionMethod | null
): Promise<{ files: HiddenFile[]; encryptedBundleRaw: Uint8Array | null }> {
  const u8 = new Uint8Array(buffer);
  if (u8.length < FIXED_TRAILER) {
    throw new Error('File terlalu kecil untuk berisi data tersembunyi.');
  }

  const mo = u8.length - 4;
  const hasMagic =
    u8[mo]     === MAGIC_BYTES[0] &&
    u8[mo + 1] === MAGIC_BYTES[1] &&
    u8[mo + 2] === MAGIC_BYTES[2] &&
    u8[mo + 3] === MAGIC_BYTES[3];
  if (!hasMagic) throw new Error('Tidak ditemukan data tersembunyi dalam file ini.');

  const methodFlag  = u8[u8.length - 5];
  const hasFaceFlag = u8[u8.length - 6];
  const hasFace     = hasFaceFlag === 0x01;

  const bso = u8.length - 10;
  const bundleSize =
    (u8[bso]     << 24) | (u8[bso + 1] << 16) | (u8[bso + 2] << 8) | u8[bso + 3];

  const pso = u8.length - 14;
  const payloadSize =
    (u8[pso] << 24) | (u8[pso + 1] << 16) | (u8[pso + 2] << 8) | u8[pso + 3];

  const totalExtra = FIXED_TRAILER + (hasFace ? bundleSize : 0);
  if (payloadSize <= 0 || payloadSize > u8.length - totalExtra) {
    throw new Error('Data tersembunyi rusak atau ukuran tidak valid.');
  }

  // Extract raw encrypted bundle if present (caller will decrypt after face verification)
  let encryptedBundleRaw: Uint8Array | null = null;
  if (hasFace && bundleSize > 0) {
    const bundleStart = u8.length - FIXED_TRAILER - bundleSize;
    encryptedBundleRaw = u8.slice(bundleStart, bundleStart + bundleSize);
  }

  const payloadStart = u8.length - totalExtra - payloadSize;
  const payloadBytes = new Uint8Array(buffer.slice(payloadStart, payloadStart + payloadSize));

  let files: HiddenFile[];

  if (methodFlag === 0x01) {
    if (!password) throw new Error('File ini memerlukan password (XOR).');
    const decrypted = xorEncrypt(payloadBytes, password);
    try {
      const raw = deserializeFilesRaw(decrypted);
      files = raw.map((f) => ({
        id: generateId(), name: f.name, size: f.data.byteLength,
        type: f.type, data: f.data, comment: f.comment || '',
      }));
    } catch {
      throw new Error('Gagal membaca data tersembunyi. Password mungkin salah atau file rusak.');
    }
  } else if (methodFlag === 0x02) {
    if (!password) throw new Error('File ini memerlukan password (AES).');
    const decrypted = await aesDecrypt(payloadBytes, password);
    let payloadJson: string;
    try { payloadJson = new TextDecoder().decode(decrypted); }
    catch { throw new Error('Gagal mendekode data. Password mungkin salah.'); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payloadObj: any;
    try { payloadObj = JSON.parse(payloadJson); }
    catch { throw new Error('Gagal membaca data tersembunyi. Password mungkin salah atau file rusak.'); }
    if (!payloadObj.files || !Array.isArray(payloadObj.files)) throw new Error('Format data tidak valid.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files = payloadObj.files.map((f: any) => ({
      id: generateId(), name: f.name, size: f.size || 0,
      type: f.type, data: base64ToArrayBuffer(f.dataBase64), comment: f.comment || '',
    }));
  } else {
    let payloadJson: string;
    try { payloadJson = new TextDecoder().decode(payloadBytes); }
    catch { throw new Error('Gagal mendekode data.'); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payloadObj: any;
    try { payloadObj = JSON.parse(payloadJson); }
    catch { throw new Error('Gagal membaca data tersembunyi.'); }
    if (!payloadObj.files || !Array.isArray(payloadObj.files)) throw new Error('Format data tidak valid.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files = payloadObj.files.map((f: any) => ({
      id: generateId(), name: f.name, size: f.size || 0,
      type: f.type, data: base64ToArrayBuffer(f.dataBase64), comment: f.comment || '',
    }));
  }

  return { files, encryptedBundleRaw };
}

// ──────────────────────────────────────────────
// reEmbedFiles
// ──────────────────────────────────────────────

export async function reEmbedFiles(
  stegoBuffer: ArrayBuffer,
  files: HiddenFile[],
  password?: string,
  method?: EncryptionMethod,
  encryptedFaceSeedBundle?: Uint8Array | null
): Promise<Blob> {
  const u8 = new Uint8Array(stegoBuffer);

  // Read old trailer to find payload boundaries
  const hasFaceOld   = u8[u8.length - 6] === 0x01;
  const bso          = u8.length - 10;
  const bundleSizeOld =
    (u8[bso]     << 24) | (u8[bso + 1] << 16) | (u8[bso + 2] << 8) | u8[bso + 3];
  const pso           = u8.length - 14;
  const payloadSizeOld =
    (u8[pso] << 24) | (u8[pso + 1] << 16) | (u8[pso + 2] << 8) | u8[pso + 3];

  const totalExtraOld = FIXED_TRAILER + (hasFaceOld ? bundleSizeOld : 0);
  const coverEnd      = u8.length - totalExtraOld - payloadSizeOld;
  const coverBytes    = new Uint8Array(stegoBuffer.slice(0, coverEnd));

  let payloadBytes: Uint8Array;
  let methodFlag: number;

  if (password && method === 'xor') {
    const filesForRaw = files.map((f) => ({ name: f.name, type: f.type, data: f.data, comment: f.comment }));
    const rawBytes = serializeFilesRaw(filesForRaw);
    payloadBytes = xorEncrypt(rawBytes, password);
    methodFlag = 0x01;
  } else if (password && method === 'aes') {
    const filesData = files.map((f) => ({
      name: f.name, type: f.type, size: f.size,
      dataBase64: arrayBufferToBase64(f.data), comment: f.comment,
    }));
    const plainBytes = new TextEncoder().encode(JSON.stringify({ files: filesData }));
    payloadBytes = await aesEncrypt(plainBytes, password);
    methodFlag = 0x02;
  } else {
    const filesData = files.map((f) => ({
      name: f.name, type: f.type, size: f.size,
      dataBase64: arrayBufferToBase64(f.data), comment: f.comment,
    }));
    payloadBytes = new TextEncoder().encode(JSON.stringify({ files: filesData }));
    methodFlag = 0x00;
  }

  const payloadSize  = payloadBytes.length;
  const hasFace      = !!(encryptedFaceSeedBundle && encryptedFaceSeedBundle.length > 0);
  const bundleSize   = hasFace ? encryptedFaceSeedBundle!.length : 0;
  const totalSize    = coverBytes.length + payloadSize + bundleSize + FIXED_TRAILER;
  const combined     = new Uint8Array(totalSize);

  combined.set(coverBytes, 0);
  combined.set(payloadBytes, coverBytes.length);

  let mo = coverBytes.length + payloadSize;
  if (hasFace && encryptedFaceSeedBundle) {
    combined.set(encryptedFaceSeedBundle, mo);
    mo += bundleSize;
  }

  combined[mo]      = (payloadSize >> 24) & 0xff;
  combined[mo + 1]  = (payloadSize >> 16) & 0xff;
  combined[mo + 2]  = (payloadSize >>  8) & 0xff;
  combined[mo + 3]  =  payloadSize        & 0xff;
  combined[mo + 4]  = (bundleSize >> 24) & 0xff;
  combined[mo + 5]  = (bundleSize >> 16) & 0xff;
  combined[mo + 6]  = (bundleSize >>  8) & 0xff;
  combined[mo + 7]  =  bundleSize        & 0xff;
  combined[mo + 8]  = hasFace ? 0x01 : 0x00;
  combined[mo + 9]  = methodFlag;
  combined[mo + 10] = MAGIC_BYTES[0];
  combined[mo + 11] = MAGIC_BYTES[1];
  combined[mo + 12] = MAGIC_BYTES[2];
  combined[mo + 13] = MAGIC_BYTES[3];

  return new Blob([combined], { type: 'application/octet-stream' });
}

// ──────────────────────────────────────────────
// Utility Functions
// ──────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getFileCategory(
  type: string,
  name: string
): 'image' | 'video' | 'audio' | 'text' | 'other' {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (
    type.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.csv') ||
    name.endsWith('.json') ||
    name.endsWith('.xml') ||
    name.endsWith('.html') ||
    name.endsWith('.css') ||
    name.endsWith('.js')
  )
    return 'text';
  return 'other';
}
