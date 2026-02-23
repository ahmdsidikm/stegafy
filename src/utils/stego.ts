export interface HiddenFile {
  id: string;
  name: string;
  size: number;
  type: string;
  data: ArrayBuffer;
}

const MAGIC_BYTES = [0x53, 0x54, 0x45, 0x47]; // "STEG"

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function xorEncrypt(data: Uint8Array<ArrayBuffer>, password: string): Uint8Array<ArrayBuffer> {
  if (!password) return data;
  const result = new Uint8Array(data.length) as Uint8Array<ArrayBuffer>;
  const passBytes = new TextEncoder().encode(password);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ passBytes[i % passBytes.length];
  }
  return result;
}

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

export async function embedFiles(
  coverFile: File,
  secretFiles: File[],
  password?: string
): Promise<{ blob: Blob; extension: string }> {
  const coverBuffer = await readFileAsArrayBuffer(coverFile);

  const filesData: Array<{ name: string; type: string; size: number; dataBase64: string }> = [];

  for (const file of secretFiles) {
    const buffer = await readFileAsArrayBuffer(file);
    filesData.push({
      name: file.name,
      type: file.type,
      size: file.size,
      dataBase64: arrayBufferToBase64(buffer),
    });
  }

  const payloadObj = {
    files: filesData,
    hasPassword: !!password,
  };

  const payloadJson = JSON.stringify(payloadObj);
  const encoded = new TextEncoder().encode(payloadJson);
  let payloadBytes = new Uint8Array(encoded.buffer as ArrayBuffer, encoded.byteOffset, encoded.byteLength);

  if (password) {
    payloadBytes = xorEncrypt(payloadBytes, password);
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

  try {
    const text = new TextDecoder().decode(payloadBytes);
    const obj = JSON.parse(text);
    return { found: true, hasPassword: !!obj.hasPassword };
  } catch {
    return { found: true, hasPassword: true };
  }
}

export function extractFiles(buffer: ArrayBuffer, password?: string): HiddenFile[] {
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
  let payloadBytes = new Uint8Array(buffer.slice(payloadStart, payloadStart + payloadSize)) as Uint8Array<ArrayBuffer>;

  if (password) {
    payloadBytes = xorEncrypt(payloadBytes, password);
  }

  let payloadJson: string;
  try {
    payloadJson = new TextDecoder().decode(payloadBytes);
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
  }));

  const payloadObj = {
    files: filesData,
    hasPassword: !!password,
  };

  const payloadJson = JSON.stringify(payloadObj);
  const reEncoded = new TextEncoder().encode(payloadJson);
  let payloadBytes = new Uint8Array(reEncoded.buffer as ArrayBuffer, reEncoded.byteOffset, reEncoded.byteLength);

  if (password) {
    payloadBytes = xorEncrypt(payloadBytes, password);
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
