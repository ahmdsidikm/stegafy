// utils/stego.ts

export interface HiddenFile {
  id: string;
  name: string;
  size: number;
  type: string;
  data: ArrayBuffer;
  comment?: string;
}

const MAGIC_BYTES = [0x53, 0x54, 0x45, 0x47]; // "STEG"
const AES_SALT_LENGTH = 16;
const AES_IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// ──────────────────────────────────────────────
// AES-256-GCM Encryption / Decryption
// ──────────────────────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using AES-256-GCM.
 * Output layout: [salt (16 bytes)][iv (12 bytes)][ciphertext + auth tag]
 */
async function aesEncrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(AES_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Combine: salt + iv + ciphertext
  const result = new Uint8Array(AES_SALT_LENGTH + AES_IV_LENGTH + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, AES_SALT_LENGTH);
  result.set(new Uint8Array(ciphertext), AES_SALT_LENGTH + AES_IV_LENGTH);

  return result;
}

/**
 * Decrypts data that was encrypted with aesEncrypt.
 * Expects layout: [salt (16 bytes)][iv (12 bytes)][ciphertext + auth tag]
 */
async function aesDecrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  if (data.length < AES_SALT_LENGTH + AES_IV_LENGTH + 1) {
    throw new Error('Data terenkripsi terlalu pendek.');
  }

  const salt = data.slice(0, AES_SALT_LENGTH);
  const iv = data.slice(AES_SALT_LENGTH, AES_SALT_LENGTH + AES_IV_LENGTH);
  const ciphertext = data.slice(AES_SALT_LENGTH + AES_IV_LENGTH);

  const key = await deriveKey(password, salt);

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
// Base64 Helpers
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
// Steganography Core Functions
// ──────────────────────────────────────────────

/**
 * Flow: file → JSON payload → AES-256-GCM encrypt → append to cover
 *
 * Final layout: [cover bytes][encrypted payload][4-byte payload size][4-byte STEG magic]
 * Without password: [cover bytes][plain payload][4-byte payload size][4-byte STEG magic]
 */
export async function embedFiles(
  coverFile: File,
  secretFiles: File[],
  password?: string,
  comments?: Record<number, string>
): Promise<{ blob: Blob; extension: string }> {
  const coverBuffer = await readFileAsArrayBuffer(coverFile);

  const filesData: Array<{
    name: string;
    type: string;
    size: number;
    dataBase64: string;
    comment?: string;
  }> = [];

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

  const payloadObj = {
    files: filesData,
    hasPassword: !!password,
  };

  const payloadJson = JSON.stringify(payloadObj);
  const plainBytes = new TextEncoder().encode(payloadJson);

  // Encrypt with AES if password provided, otherwise use plain bytes
  let payloadBytes: Uint8Array;
  if (password) {
    payloadBytes = await aesEncrypt(plainBytes, password);
  } else {
    payloadBytes = new Uint8Array(plainBytes.buffer, plainBytes.byteOffset, plainBytes.byteLength);
  }

  const payloadSize = payloadBytes.length;
  // Layout: [cover][payload][4 bytes size][4 bytes magic]
  const totalSize = coverBuffer.byteLength + payloadSize + 8;
  const combined = new Uint8Array(totalSize);

  combined.set(new Uint8Array(coverBuffer), 0);
  combined.set(payloadBytes, coverBuffer.byteLength);

  const sizeOffset = coverBuffer.byteLength + payloadSize;
  combined[sizeOffset] = (payloadSize >> 24) & 0xff;
  combined[sizeOffset + 1] = (payloadSize >> 16) & 0xff;
  combined[sizeOffset + 2] = (payloadSize >> 8) & 0xff;
  combined[sizeOffset + 3] = payloadSize & 0xff;

  combined[sizeOffset + 4] = MAGIC_BYTES[0];
  combined[sizeOffset + 5] = MAGIC_BYTES[1];
  combined[sizeOffset + 6] = MAGIC_BYTES[2];
  combined[sizeOffset + 7] = MAGIC_BYTES[3];

  const ext = coverFile.name.split('.').pop() || 'bin';
  const blob = new Blob([combined], { type: coverFile.type || 'application/octet-stream' });

  return { blob, extension: ext };
}

export function checkForHiddenData(buffer: ArrayBuffer): { found: boolean; hasPassword: boolean } {
  const uint8 = new Uint8Array(buffer);

  if (uint8.length < 8) {
    return { found: false, hasPassword: false };
  }

  const magicOffset = uint8.length - 4;
  const hasMagic =
    uint8[magicOffset] === MAGIC_BYTES[0] &&
    uint8[magicOffset + 1] === MAGIC_BYTES[1] &&
    uint8[magicOffset + 2] === MAGIC_BYTES[2] &&
    uint8[magicOffset + 3] === MAGIC_BYTES[3];

  if (!hasMagic) {
    return { found: false, hasPassword: false };
  }

  const sizeOffset = uint8.length - 8;
  const payloadSize =
    (uint8[sizeOffset] << 24) |
    (uint8[sizeOffset + 1] << 16) |
    (uint8[sizeOffset + 2] << 8) |
    uint8[sizeOffset + 3];

  if (payloadSize <= 0 || payloadSize > uint8.length - 8) {
    return { found: false, hasPassword: false };
  }

  const payloadStart = uint8.length - 8 - payloadSize;
  const payloadBytes = new Uint8Array(buffer.slice(payloadStart, payloadStart + payloadSize));

  // Try parsing as plain JSON first (no password case)
  try {
    const text = new TextDecoder().decode(payloadBytes);
    const obj = JSON.parse(text);
    return { found: true, hasPassword: !!obj.hasPassword };
  } catch {
    // If JSON parse fails, it's likely AES-encrypted → needs password
    return { found: true, hasPassword: true };
  }
}

/**
 * Flow: read payload from stego → AES-256-GCM decrypt → parse JSON → return files
 */
export async function extractFiles(buffer: ArrayBuffer, password?: string): Promise<HiddenFile[]> {
  const uint8 = new Uint8Array(buffer);

  if (uint8.length < 8) {
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

  const sizeOffset = uint8.length - 8;
  const payloadSize =
    (uint8[sizeOffset] << 24) |
    (uint8[sizeOffset + 1] << 16) |
    (uint8[sizeOffset + 2] << 8) |
    uint8[sizeOffset + 3];

  if (payloadSize <= 0 || payloadSize > uint8.length - 8) {
    throw new Error('Data tersembunyi rusak atau ukuran tidak valid.');
  }

  const payloadStart = uint8.length - 8 - payloadSize;
  const payloadBytes = new Uint8Array(buffer.slice(payloadStart, payloadStart + payloadSize));

  // Decrypt with AES if password provided, otherwise use raw bytes
  let plainBytes: Uint8Array;
  if (password) {
    plainBytes = await aesDecrypt(payloadBytes, password);
  } else {
    plainBytes = payloadBytes;
  }

  let payloadJson: string;
  try {
    payloadJson = new TextDecoder().decode(plainBytes);
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
    throw new Error('Format data tidak valid. Password mungkin salah.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return payloadObj.files.map((f: any) => ({
    id: generateId(),
    name: f.name,
    size: f.size,
    type: f.type,
    data: base64ToArrayBuffer(f.dataBase64),
    comment: f.comment || '',
  }));
}

export async function reEmbedFiles(
  stegoBuffer: ArrayBuffer,
  files: HiddenFile[],
  password?: string
): Promise<Blob> {
  const uint8 = new Uint8Array(stegoBuffer);

  const sizeOffset = uint8.length - 8;
  const payloadSize =
    (uint8[sizeOffset] << 24) |
    (uint8[sizeOffset + 1] << 16) |
    (uint8[sizeOffset + 2] << 8) |
    uint8[sizeOffset + 3];

  const coverEnd = uint8.length - 8 - payloadSize;
  const coverBytes = new Uint8Array(stegoBuffer.slice(0, coverEnd));

  const filesData = files.map((f) => ({
    name: f.name,
    type: f.type,
    size: f.size,
    dataBase64: arrayBufferToBase64(f.data),
    comment: f.comment || undefined,
  }));

  const payloadObj = {
    files: filesData,
    hasPassword: !!password,
  };

  const payloadJson = JSON.stringify(payloadObj);
  const plainBytes = new TextEncoder().encode(payloadJson);

  // Encrypt with AES if password provided
  let payloadBytes: Uint8Array;
  if (password) {
    payloadBytes = await aesEncrypt(plainBytes, password);
  } else {
    payloadBytes = new Uint8Array(plainBytes.buffer, plainBytes.byteOffset, plainBytes.byteLength);
  }

  const newPayloadSize = payloadBytes.length;
  const totalSize = coverBytes.length + newPayloadSize + 8;
  const combined = new Uint8Array(totalSize);

  combined.set(coverBytes, 0);
  combined.set(payloadBytes, coverBytes.length);

  const newSizeOffset = coverBytes.length + newPayloadSize;
  combined[newSizeOffset] = (newPayloadSize >> 24) & 0xff;
  combined[newSizeOffset + 1] = (newPayloadSize >> 16) & 0xff;
  combined[newSizeOffset + 2] = (newPayloadSize >> 8) & 0xff;
  combined[newSizeOffset + 3] = newPayloadSize & 0xff;

  combined[newSizeOffset + 4] = MAGIC_BYTES[0];
  combined[newSizeOffset + 5] = MAGIC_BYTES[1];
  combined[newSizeOffset + 6] = MAGIC_BYTES[2];
  combined[newSizeOffset + 7] = MAGIC_BYTES[3];

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

export function getFileCategory(type: string, name: string): 'image' | 'video' | 'audio' | 'text' | 'other' {
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
