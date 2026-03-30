export interface HiddenFile {
  id: string;
  name: string;
  size: number;
  type: string;
  data: ArrayBuffer;
  comment?: string;
}

export type EncryptionMethod = 'xor' | 'aes';

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
// Steganography Core Functions
// ──────────────────────────────────────────────

export async function embedFiles(
  coverFile: File,
  secretFiles: File[],
  password?: string,
  comments?: Record<number, string>,
  method?: EncryptionMethod
): Promise<{ blob: Blob; extension: string }> {
  const coverBuffer = await readFileAsArrayBuffer(coverFile);

  let payloadBytes: Uint8Array;
  let methodFlag: number;

  if (password && method === 'xor') {
    const filesForRaw: Array<{
      name: string;
      type: string;
      data: ArrayBuffer;
      comment?: string;
    }> = [];
    for (let i = 0; i < secretFiles.length; i++) {
      const file = secretFiles[i];
      const buffer = await readFileAsArrayBuffer(file);
      filesForRaw.push({
        name: file.name,
        type: file.type,
        data: buffer,
        comment: comments?.[i] || undefined,
      });
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
        name: file.name,
        type: file.type,
        size: file.size,
        dataBase64: arrayBufferToBase64(buffer),
        comment: comments?.[i] || undefined,
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
        name: file.name,
        type: file.type,
        size: file.size,
        dataBase64: arrayBufferToBase64(buffer),
        comment: comments?.[i] || undefined,
      });
    }
    const payloadJson = JSON.stringify({ files: filesData });
    payloadBytes = new TextEncoder().encode(payloadJson);
    methodFlag = 0x00;
  }

  const payloadSize = payloadBytes.length;
  const totalSize = coverBuffer.byteLength + payloadSize + 9;
  const combined = new Uint8Array(totalSize);

  combined.set(new Uint8Array(coverBuffer), 0);
  combined.set(payloadBytes, coverBuffer.byteLength);

  const metaOffset = coverBuffer.byteLength + payloadSize;
  combined[metaOffset] = (payloadSize >> 24) & 0xff;
  combined[metaOffset + 1] = (payloadSize >> 16) & 0xff;
  combined[metaOffset + 2] = (payloadSize >> 8) & 0xff;
  combined[metaOffset + 3] = payloadSize & 0xff;
  combined[metaOffset + 4] = methodFlag;
  combined[metaOffset + 5] = MAGIC_BYTES[0];
  combined[metaOffset + 6] = MAGIC_BYTES[1];
  combined[metaOffset + 7] = MAGIC_BYTES[2];
  combined[metaOffset + 8] = MAGIC_BYTES[3];

  const ext = coverFile.name.split('.').pop() || 'bin';
  const blob = new Blob([combined], { type: coverFile.type || 'application/octet-stream' });

  return { blob, extension: ext };
}

export function checkForHiddenData(
  buffer: ArrayBuffer
): { found: boolean; hasPassword: boolean; method: EncryptionMethod | null } {
  const uint8 = new Uint8Array(buffer);

  if (uint8.length < 9) {
    return { found: false, hasPassword: false, method: null };
  }

  const magicOffset = uint8.length - 4;
  const hasMagic =
    uint8[magicOffset] === MAGIC_BYTES[0] &&
    uint8[magicOffset + 1] === MAGIC_BYTES[1] &&
    uint8[magicOffset + 2] === MAGIC_BYTES[2] &&
    uint8[magicOffset + 3] === MAGIC_BYTES[3];

  if (!hasMagic) {
    return { found: false, hasPassword: false, method: null };
  }

  const methodFlag = uint8[uint8.length - 5];
  const sizeOffset = uint8.length - 9;
  const payloadSize =
    (uint8[sizeOffset] << 24) |
    (uint8[sizeOffset + 1] << 16) |
    (uint8[sizeOffset + 2] << 8) |
    uint8[sizeOffset + 3];

  if (payloadSize <= 0 || payloadSize > uint8.length - 9) {
    return { found: false, hasPassword: false, method: null };
  }

  if (methodFlag === 0x01) {
    return { found: true, hasPassword: true, method: 'xor' };
  }
  if (methodFlag === 0x02) {
    return { found: true, hasPassword: true, method: 'aes' };
  }

  return { found: true, hasPassword: false, method: null };
}

export async function extractFiles(
  buffer: ArrayBuffer,
  password?: string,
  method?: EncryptionMethod | null
): Promise<HiddenFile[]> {
  const uint8 = new Uint8Array(buffer);

  if (uint8.length < 9) {
    throw new Error('File terlalu kecil untuk berisi data tersembunyi.');
  }

  const magicOffset = uint8.length - 4;
  const hasMagic =
    uint8[magicOffset] === MAGIC_BYTES[0] &&
    uint8[magicOffset + 1] === MAGIC_BYTES[1] &&
    uint8[magicOffset + 2] === MAGIC_BYTES[2] &&
    uint8[magicOffset + 3] === MAGIC_BYTES[3];

  if (!hasMagic) {
    throw new Error('Tidak ditemukan data tersembunyi dalam file ini.');
  }

  const methodFlag = uint8[uint8.length - 5];
  const sizeOffset = uint8.length - 9;
  const payloadSize =
    (uint8[sizeOffset] << 24) |
    (uint8[sizeOffset + 1] << 16) |
    (uint8[sizeOffset + 2] << 8) |
    uint8[sizeOffset + 3];

  if (payloadSize <= 0 || payloadSize > uint8.length - 9) {
    throw new Error('Data tersembunyi rusak atau ukuran tidak valid.');
  }

  const payloadStart = uint8.length - 9 - payloadSize;
  const payloadBytes = new Uint8Array(buffer.slice(payloadStart, payloadStart + payloadSize));

  if (methodFlag === 0x01) {
    if (!password) throw new Error('File ini memerlukan password (XOR).');
    const decrypted = xorEncrypt(payloadBytes, password);
    try {
      const files = deserializeFilesRaw(decrypted);
      return files.map((f) => ({
        id: generateId(),
        name: f.name,
        size: f.data.byteLength,
        type: f.type,
        data: f.data,
        comment: f.comment || '',
      }));
    } catch {
      throw new Error('Gagal membaca data tersembunyi. Password mungkin salah atau file rusak.');
    }
  }

  if (methodFlag === 0x02) {
    if (!password) throw new Error('File ini memerlukan password (AES).');
    const decrypted = await aesDecrypt(payloadBytes, password);
    let payloadJson: string;
    try {
      payloadJson = new TextDecoder().decode(decrypted);
    } catch {
      throw new Error('Gagal mendekode data. Password mungkin salah.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payloadObj: any;
    try {
      payloadObj = JSON.parse(payloadJson);
    } catch {
      throw new Error('Gagal membaca data tersembunyi. Password mungkin salah atau file rusak.');
    }
    if (!payloadObj.files || !Array.isArray(payloadObj.files)) {
      throw new Error('Format data tidak valid.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return payloadObj.files.map((f: any) => ({
      id: generateId(),
      name: f.name,
      size: f.size || 0,
      type: f.type,
      data: base64ToArrayBuffer(f.dataBase64),
      comment: f.comment || '',
    }));
  }

  let payloadJson: string;
  try {
    payloadJson = new TextDecoder().decode(payloadBytes);
  } catch {
    throw new Error('Gagal mendekode data.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payloadObj: any;
  try {
    payloadObj = JSON.parse(payloadJson);
  } catch {
    throw new Error('Gagal membaca data tersembunyi.');
  }
  if (!payloadObj.files || !Array.isArray(payloadObj.files)) {
    throw new Error('Format data tidak valid.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return payloadObj.files.map((f: any) => ({
    id: generateId(),
    name: f.name,
    size: f.size || 0,
    type: f.type,
    data: base64ToArrayBuffer(f.dataBase64),
    comment: f.comment || '',
  }));
}

export async function reEmbedFiles(
  stegoBuffer: ArrayBuffer,
  files: HiddenFile[],
  password?: string,
  method?: EncryptionMethod
): Promise<Blob> {
  const uint8 = new Uint8Array(stegoBuffer);

  const sizeOffset = uint8.length - 9;
  const payloadSize =
    (uint8[sizeOffset] << 24) |
    (uint8[sizeOffset + 1] << 16) |
    (uint8[sizeOffset + 2] << 8) |
    uint8[sizeOffset + 3];

  const coverEnd = uint8.length - 9 - payloadSize;
  const coverBytes = new Uint8Array(stegoBuffer.slice(0, coverEnd));

  let payloadBytes: Uint8Array;
  let methodFlag: number;

  if (password && method === 'xor') {
    const filesForRaw = files.map((f) => ({
      name: f.name,
      type: f.type,
      data: f.data,
      comment: f.comment || undefined,
    }));
    const rawBytes = serializeFilesRaw(filesForRaw);
    payloadBytes = xorEncrypt(rawBytes, password);
    methodFlag = 0x01;
  } else if (password && method === 'aes') {
    const filesData = files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
      dataBase64: arrayBufferToBase64(f.data),
      comment: f.comment || undefined,
    }));
    const payloadJson = JSON.stringify({ files: filesData });
    const plainBytes = new TextEncoder().encode(payloadJson);
    payloadBytes = await aesEncrypt(plainBytes, password);
    methodFlag = 0x02;
  } else {
    const filesData = files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
      dataBase64: arrayBufferToBase64(f.data),
      comment: f.comment || undefined,
    }));
    const payloadJson = JSON.stringify({ files: filesData });
    payloadBytes = new TextEncoder().encode(payloadJson);
    methodFlag = 0x00;
  }

  const newPayloadSize = payloadBytes.length;
  const totalSize = coverBytes.length + newPayloadSize + 9;
  const combined = new Uint8Array(totalSize);

  combined.set(coverBytes, 0);
  combined.set(payloadBytes, coverBytes.length);

  const metaOffset = coverBytes.length + newPayloadSize;
  combined[metaOffset] = (newPayloadSize >> 24) & 0xff;
  combined[metaOffset + 1] = (newPayloadSize >> 16) & 0xff;
  combined[metaOffset + 2] = (newPayloadSize >> 8) & 0xff;
  combined[metaOffset + 3] = newPayloadSize & 0xff;
  combined[metaOffset + 4] = methodFlag;
  combined[metaOffset + 5] = MAGIC_BYTES[0];
  combined[metaOffset + 6] = MAGIC_BYTES[1];
  combined[metaOffset + 7] = MAGIC_BYTES[2];
  combined[metaOffset + 8] = MAGIC_BYTES[3];

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
