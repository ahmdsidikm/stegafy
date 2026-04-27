import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import {
  Unlock, Upload, X, Download, Lock, Eye,
  FileIcon, Image, Film, Music, FileText, Plus,
  Trash2, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle, Loader2, Package,
  Shield, Info, DownloadCloud, AlertTriangle,
  EyeOff, LockKeyhole, MessageSquare, MessageSquarePlus,
  Maximize2, Edit3, Check, KeyRound, Search,
  LayoutGrid, Zap, ShieldCheck, ScanFace, Camera, CameraOff,
  Menu, ChevronLeft, Layers, Cpu,
} from 'lucide-react';
import {
  embedFiles, embedFilesNoCover, extractFiles, checkForHiddenData, reEmbedFiles,
  readFileAsArrayBuffer, readFileAsDataURL, readFileAsText,
  blobToDataURL, blobToText, formatFileSize, getFileCategory,
  calculatePasswordStrength, secureWipeString,
  isFaceMatch, faceDescriptorDistance, FACE_MATCH_THRESHOLD,
  type HiddenFile, type EncryptionMethod, type PasswordStrength,
} from './utils/stego';
import { PixelEncryptorView } from './PixelEncryptor';

// App mode type for sidebar navigation
type AppMode = 'stego' | 'pixel-encryptor';

// Partition for Pro Mode multi-password encryption
interface Partition {
  id: string;
  label: string;         // e.g. "Partisi A"
  password: string;
  showPassword: boolean;
  fileIndexes: number[]; // indexes into secretFiles
}

type Tab = 'embed' | 'decrypt';
type FilterCategory = 'all' | 'image' | 'video' | 'audio' | 'text' | 'other';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface FilePreview {
  name: string;
  size: number;
  type: string;
  url?: string;
  text?: string;
}

interface ConfirmDialog {
  open: boolean;
  fileId: string;
  fileName: string;
}

interface ImageLightbox {
  open: boolean;
  src: string;
  alt: string;
}

// ──────────────────────────────────────────────
// Face Scanner Component (face-api.js)
// ──────────────────────────────────────────────

type FaceScanMode = 'enroll' | 'verify';
type FaceScanStatus = 'idle' | 'loading-models' | 'waiting' | 'detecting' | 'success' | 'error' | 'no-face';

interface FaceScannerProps {
  mode: FaceScanMode;
  /** For verify mode: the stored descriptor to match against */
  storedDescriptor?: Float32Array | null;
  onCapture?: (descriptor: Float32Array) => void;
  onVerified?: (descriptor: Float32Array) => void;
  onFailed?: (reason: string) => void;
  onClose: () => void;
}

declare global {
  // face-api.js loaded via CDN
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { faceapi: any; }
}

function FaceScanner({ mode, storedDescriptor, onCapture, onVerified, onClose }: FaceScannerProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const rafRef      = useRef<number | null>(null);
  const lockedRef   = useRef(false); // prevent re-entry during capture

  const [status, setStatus]         = useState<FaceScanStatus>('loading-models');
  const [statusMsg, setStatusMsg]   = useState('Memuat model AI wajah...');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false); // live indicator

  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Real-time detection loop (RAF, no setInterval) ──────────────────
  const startDetectionLoop = useCallback((faceapi: Window['faceapi']) => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });

    const loop = async () => {
      if (lockedRef.current || !video || !canvas) return;
      if (video.readyState >= 2) {
        try {
          const detection = await faceapi
            .detectSingleFace(video, options)
            .withFaceLandmarks(true);

          const ctx = canvas.getContext('2d');
          if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

          // Match canvas size to video display size
          const { videoWidth: vw, videoHeight: vh } = video;
          const dw = canvas.offsetWidth;
          const dh = canvas.offsetHeight;
          canvas.width  = dw;
          canvas.height = dh;
          ctx.clearRect(0, 0, dw, dh);

          if (detection) {
            setFaceDetected(true);
            // Scale box from video coords → canvas coords, mirrored horizontally
            const scaleX = dw / vw;
            const scaleY = dh / vh;
            const box = detection.detection.box;
            const rx = dw - (box.x + box.width)  * scaleX;  // mirror
            const ry = box.y * scaleY;
            const rw = box.width  * scaleX;
            const rh = box.height * scaleY;

            // Outer glow
            ctx.shadowColor   = mode === 'enroll' ? '#10b981' : '#7c3aed';
            ctx.shadowBlur    = 12;
            ctx.strokeStyle   = mode === 'enroll' ? '#10b981' : '#8b5cf6';
            ctx.lineWidth     = 2.5;
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.shadowBlur = 0;

            // Corner brackets
            const C = 16;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth   = 3;
            const corners: [number, number, number, number][] = [
              [rx,      ry,       C,  0], [rx,      ry,       0,  C],
              [rx+rw,   ry,      -C,  0], [rx+rw,   ry,       0,  C],
              [rx,      ry+rh,    C,  0], [rx,      ry+rh,    0, -C],
              [rx+rw,   ry+rh,   -C,  0], [rx+rw,   ry+rh,    0, -C],
            ];
            for (const [sx, sy, dx, dy] of corners) {
              ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + dx, sy + dy); ctx.stroke();
            }

            // Confidence dot
            const conf = detection.detection.score;
            ctx.fillStyle = conf > 0.7 ? '#10b981' : '#f59e0b';
            ctx.beginPath();
            ctx.arc(rx + rw - 6, ry + 6, 5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            setFaceDetected(false);
          }
        } catch { /* ignore detection errors in loop */ }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    const loadAndStart = async () => {
      try {
        if (!window.faceapi) {
          await new Promise<void>((res, rej) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
            script.onload = () => res();
            script.onerror = () => rej(new Error('Gagal memuat library face-api.js'));
            document.head.appendChild(script);
          });
        }
        const faceapi = window.faceapi;
        setStatusMsg('Memuat model pendeteksi wajah...');
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        if (cancelled) return;
        setModelsLoaded(true);
        setStatusMsg('Membuka kamera...');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setStatus('waiting');
        setStatusMsg(mode === 'enroll'
          ? 'Arahkan wajah ke kamera — kotak hijau akan muncul saat terdeteksi'
          : 'Arahkan wajah ke kamera — kotak ungu akan muncul saat terdeteksi');
        startDetectionLoop(faceapi);
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setStatusMsg((err as Error).message || 'Gagal membuka kamera');
        }
      }
    };

    loadAndStart();
    return () => { cancelled = true; stopCamera(); };
  }, [mode, stopCamera, startDetectionLoop]);

  const scanFace = async () => {
    if (!videoRef.current || !window.faceapi || lockedRef.current) return;
    lockedRef.current = true;
    setStatus('detecting');
    setStatusMsg('Mengambil fitur wajah...');

    try {
      const faceapi = window.faceapi;
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

      const detection = await faceapi
        .detectSingleFace(videoRef.current, options)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection) {
        lockedRef.current = false;
        setStatus('no-face');
        setStatusMsg('Wajah tidak terdeteksi. Pastikan pencahayaan cukup dan wajah terlihat jelas.');
        setTimeout(() => {
          setStatus('waiting');
          setStatusMsg(mode === 'enroll'
            ? 'Arahkan wajah ke kamera — kotak hijau akan muncul saat terdeteksi'
            : 'Arahkan wajah ke kamera — kotak ungu akan muncul saat terdeteksi');
        }, 2500);
        return;
      }

      const descriptor = new Float32Array(detection.descriptor);

      if (mode === 'enroll') {
        setStatus('success');
        setStatusMsg('Wajah berhasil dipindai! ✓');
        stopCamera();
        setTimeout(() => { onCapture?.(descriptor); onClose(); }, 900);
      } else {
        if (!storedDescriptor) {
          lockedRef.current = false;
          setStatus('error');
          setStatusMsg('Tidak ada data wajah tersimpan di file ini.');
          return;
        }
        const dist = faceDescriptorDistance(descriptor, storedDescriptor);
        if (isFaceMatch(descriptor, storedDescriptor)) {
          setStatus('success');
          setStatusMsg(`Wajah cocok! (jarak: ${dist.toFixed(3)}) ✓`);
          stopCamera();
          setTimeout(() => { onVerified?.(descriptor); onClose(); }, 900);
        } else {
          lockedRef.current = false;
          setStatus('error');
          setStatusMsg(`Wajah tidak cocok (jarak: ${dist.toFixed(3)}, batas: ${FACE_MATCH_THRESHOLD}). Coba lagi.`);
          setTimeout(() => {
            setStatus('waiting');
            setStatusMsg('Arahkan wajah ke kamera — kotak ungu akan muncul saat terdeteksi');
          }, 3000);
        }
      }
    } catch (err) {
      lockedRef.current = false;
      setStatus('error');
      setStatusMsg(`Error: ${(err as Error).message}`);
    }
  };

  const accentGreen  = mode === 'enroll';
  const statusColor  =
    status === 'success'                   ? 'text-emerald-600' :
    status === 'error' || status === 'no-face' ? 'text-red-500'     :
    status === 'detecting'                 ? (accentGreen ? 'text-emerald-600' : 'text-violet-600') :
    'text-slate-500';

  const borderColor =
    status === 'success'                   ? 'border-emerald-400' :
    status === 'error' || status === 'no-face' ? 'border-red-400'     :
    faceDetected && status === 'waiting'   ? (accentGreen ? 'border-emerald-400' : 'border-violet-400') :
    'border-slate-300';

  return (
    /* backdrop — pointer-events pada div luar, bukan backdrop, supaya tidak ada re-render cascade */
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}>
      {/* invisible clickable backdrop area behind modal */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" style={{ animation: 'scaleIn 0.18s ease-out both' }}>
        {/* Header */}
        <div className={`px-5 py-4 flex items-center justify-between border-b border-slate-100 ${accentGreen ? 'bg-emerald-50' : 'bg-violet-50'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accentGreen ? 'bg-emerald-100' : 'bg-violet-100'}`}>
              <ScanFace className={`w-5 h-5 ${accentGreen ? 'text-emerald-600' : 'text-violet-600'}`} />
            </div>
            <div>
              <p className={`text-sm font-bold ${accentGreen ? 'text-emerald-800' : 'text-violet-800'}`}>
                {accentGreen ? 'Daftarkan Wajah' : 'Verifikasi Wajah'}
              </p>
              <p className="text-[11px] text-slate-500">
                {accentGreen ? 'Wajah akan dienkripsi & disimpan di stego file' : 'Cocokkan wajah dengan yang tersimpan di file'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 hover:text-slate-600 transition-all cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video + Canvas overlay */}
        <div className="p-4">
          <div
            className={`relative rounded-xl overflow-hidden border-2 transition-colors duration-300 bg-black ${borderColor}`}
            style={{ aspectRatio: '4/3' }}
          >
            {/* Mirrored video */}
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
              playsInline
              muted
            />

            {/* Canvas for face box overlay — also mirrored via CSS so coords match */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />

            {/* Loading overlay */}
            {(status === 'loading-models' || !modelsLoaded) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/85">
                <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
                <p className="text-xs text-slate-300 font-medium">Memuat model AI wajah...</p>
              </div>
            )}

            {/* Success overlay */}
            {status === 'success' && (
              <div className="absolute inset-0 flex items-center justify-center bg-emerald-900/40">
                <CheckCircle className="w-16 h-16 text-emerald-300 drop-shadow-lg" />
              </div>
            )}

            {/* Face detected live badge */}
            {faceDetected && status === 'waiting' && (
              <div className={`absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold backdrop-blur-sm
                ${accentGreen ? 'bg-emerald-500/90 text-white' : 'bg-violet-500/90 text-white'}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Wajah Terdeteksi
              </div>
            )}

            {/* No-face warning badge */}
            {status === 'no-face' && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold bg-red-500/90 text-white backdrop-blur-sm">
                <AlertCircle className="w-3 h-3" />
                Wajah Tidak Terdeteksi
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
            {status === 'detecting'   && <Loader2     className={`w-3.5 h-3.5 mt-0.5 animate-spin shrink-0 ${accentGreen ? 'text-emerald-500' : 'text-violet-500'}`} />}
            {status === 'success'     && <CheckCircle  className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />}
            {(status === 'error' || status === 'no-face') && <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-red-500 shrink-0" />}
            {(status === 'waiting' || status === 'loading-models') && <Camera className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />}
            <p className={`text-xs leading-snug font-medium ${statusColor}`}>{statusMsg}</p>
          </div>

          {/* Privacy tip */}
          {accentGreen && (
            <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100">
              <Info className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
              <p className="text-[11px] text-amber-700 leading-snug">
                Hanya 128 nilai fitur wajah yang disimpan — bukan foto. Data ini dienkripsi di dalam stego file.
              </p>
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="px-4 pb-4">
          <button
            onClick={scanFace}
            disabled={status !== 'waiting' && status !== 'error' && status !== 'no-face'}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2
              active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md
              ${accentGreen
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-200'
                : 'bg-violet-500  hover:bg-violet-600  text-white shadow-violet-200'}`}
          >
            <ScanFace className="w-4 h-4" />
            {accentGreen ? 'Scan & Simpan Wajah' : 'Verifikasi Wajah'}
          </button>
        </div>
      </div>
    </div>
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Compression helpers using built-in CompressionStream API ──────────────
async function compressData(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result.buffer;
}

async function decompressData(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result.buffer;
}

// Marker to detect compressed payload: 4-byte magic "ZSTG"
const COMPRESS_MAGIC = new Uint8Array([0x5A, 0x53, 0x54, 0x47]);

function addCompressHeader(compressed: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(4 + compressed.byteLength);
  out.set(COMPRESS_MAGIC, 0);
  out.set(new Uint8Array(compressed), 4);
  return out.buffer;
}

function stripCompressHeader(data: ArrayBuffer): { isCompressed: boolean; payload: ArrayBuffer } {
  const bytes = new Uint8Array(data);
  if (bytes.length > 4 &&
      bytes[0] === COMPRESS_MAGIC[0] && bytes[1] === COMPRESS_MAGIC[1] &&
      bytes[2] === COMPRESS_MAGIC[2] && bytes[3] === COMPRESS_MAGIC[3]) {
    return { isCompressed: true, payload: bytes.slice(4).buffer };
  }
  return { isCompressed: false, payload: data };
}

function getFileIconEl(type: string, name: string) {
  const cat = getFileCategory(type, name);
  switch (cat) {
    case 'image': return <Image className="w-4 h-4" />;
    case 'video': return <Film className="w-4 h-4" />;
    case 'audio': return <Music className="w-4 h-4" />;
    case 'text': return <FileText className="w-4 h-4" />;
    default: return <FileIcon className="w-4 h-4" />;
  }
}

function getFileIconColor(type: string, name: string) {
  const cat = getFileCategory(type, name);
  switch (cat) {
    case 'image': return 'text-blue-500 bg-blue-50';
    case 'video': return 'text-purple-500 bg-purple-50';
    case 'audio': return 'text-pink-500 bg-pink-50';
    case 'text': return 'text-emerald-500 bg-emerald-50';
    default: return 'text-slate-500 bg-slate-100';
  }
}

const FILTER_CATEGORIES: { key: FilterCategory; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'Semua', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { key: 'image', label: 'Gambar', icon: <Image className="w-3.5 h-3.5" /> },
  { key: 'video', label: 'Video', icon: <Film className="w-3.5 h-3.5" /> },
  { key: 'audio', label: 'Audio', icon: <Music className="w-3.5 h-3.5" /> },
  { key: 'text', label: 'Teks', icon: <FileText className="w-3.5 h-3.5" /> },
  { key: 'other', label: 'File', icon: <FileIcon className="w-3.5 h-3.5" /> },
];

// ──────────────────────────────────────────────
// Password Strength Indicator Component
// ──────────────────────────────────────────────

function PasswordStrengthIndicator({ password }: { password: string }) {
  const strength = useMemo(() => calculatePasswordStrength(password), [password]);

  if (!password) return null;

  return (
    <div className="mt-2.5 animate-slideDown">
      {/* Strength bar */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${strength.color}`}
            style={{ width: `${strength.percentage}%` }}
          />
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${strength.textColor} whitespace-nowrap`}>
          {strength.label}
        </span>
      </div>

      {/* Strength dots */}
      <div className="flex items-center gap-1 mb-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i < strength.score
                ? strength.color
                : 'bg-slate-100'
            }`}
          />
        ))}
      </div>

      {/* Suggestions */}
      {strength.suggestions.length > 0 && strength.score < 3 && (
        <div className={`${strength.bgColor} rounded-lg px-3 py-2 space-y-1`}>
          {strength.suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <Info className={`w-3 h-3 mt-0.5 shrink-0 ${strength.textColor}`} />
              <span className={`text-[11px] leading-snug ${strength.textColor}`}>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Success message for strong passwords */}
      {strength.score >= 3 && (
        <div className="flex items-center gap-1.5 bg-emerald-50 rounded-lg px-3 py-2">
          <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
          <span className="text-[11px] text-emerald-600 font-medium">
            {strength.score === 4 ? 'Password sangat aman!' : 'Password cukup aman'}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Partition color palette (defined outside component to avoid recreation) ──
const PARTITION_COLORS = [
  { bg: 'bg-emerald-50', border: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-700', label: 'text-emerald-700', dot: 'bg-emerald-500', ring: 'ring-emerald-400' },
  { bg: 'bg-blue-50',    border: 'border-blue-300',    badge: 'bg-blue-100 text-blue-700',       label: 'text-blue-700',   dot: 'bg-blue-500',     ring: 'ring-blue-400' },
  { bg: 'bg-violet-50',  border: 'border-violet-300',  badge: 'bg-violet-100 text-violet-700',   label: 'text-violet-700', dot: 'bg-violet-500',   ring: 'ring-violet-400' },
  { bg: 'bg-rose-50',    border: 'border-rose-300',    badge: 'bg-rose-100 text-rose-700',       label: 'text-rose-700',   dot: 'bg-rose-500',     ring: 'ring-rose-400' },
  { bg: 'bg-amber-50',   border: 'border-amber-300',   badge: 'bg-amber-100 text-amber-700',     label: 'text-amber-700',  dot: 'bg-amber-500',    ring: 'ring-amber-400' },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('embed');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({ open: false, fileId: '', fileName: '' });
  const [lightbox, setLightbox] = useState<ImageLightbox>({ open: false, src: '', alt: '' });

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('stego');

  // Pixel Encryptor mode
  const [pixelMode, setPixelMode] = useState<'encrypt' | 'decrypt'>('encrypt');

  // No-cover mode toggle (for embed tab)
  const [noCoverMode, setNoCoverMode] = useState(false);

  // Embed state
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<FilePreview | null>(null);
  const [secretFiles, setSecretFiles] = useState<File[]>([]);
  const [secretPreviews, setSecretPreviews] = useState<FilePreview[]>([]);
  const [embedPassword, setEmbedPassword] = useState('');
  const [showEmbedPassword, setShowEmbedPassword] = useState(false);
  const [embedMethod, setEmbedMethod] = useState<EncryptionMethod>('xor');
  const [embedding, setEmbedding] = useState(false);
  const [stegoResult, setStegoResult] = useState<{ url: string; extension: string } | null>(null);
  const [stegoPreview, setStegoPreview] = useState<FilePreview | null>(null);
  const [openedEmbedPreviews, setOpenedEmbedPreviews] = useState<Set<number>>(new Set());
  const [embedComments, setEmbedComments] = useState<Record<number, string>>({});
  const [openedEmbedComments, setOpenedEmbedComments] = useState<Set<number>>(new Set());
  const [stegoOutputName, setStegoOutputName] = useState('');
  const [editingStegoName, setEditingStegoName] = useState(false);
  const [editingEmbedFileNames, setEditingEmbedFileNames] = useState<Set<number>>(new Set());
  const [embedFileNames, setEmbedFileNames] = useState<Record<number, string>>({});

  // Decrypt state
  const [stegoFile, setStegoFile] = useState<File | null>(null);
  const [stegoFilePreview, setStegoFilePreview] = useState<FilePreview | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [showDecryptPassword, setShowDecryptPassword] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [detectedMethod, setDetectedMethod] = useState<EncryptionMethod | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptedFiles, setDecryptedFiles] = useState<HiddenFile[]>([]);
  const [stegoBuffer, setStegoBuffer] = useState<ArrayBuffer | null>(null);
  const [modified, setModified] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [openedDecryptPreviews, setOpenedDecryptPreviews] = useState<Set<string>>(new Set());
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [stegoDetected, setStegoDetected] = useState(false);
  const [editingComments, setEditingComments] = useState<Set<string>>(new Set());
  const [decryptionDone, setDecryptionDone] = useState(false);
  const [editingFileNames, setEditingFileNames] = useState<Set<string>>(new Set());
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [originalDecryptPassword, setOriginalDecryptPassword] = useState('');
  const [allDecryptPreviewsOpen, setAllDecryptPreviewsOpen] = useState(false);
  const [decryptMethod, setDecryptMethod] = useState<EncryptionMethod>('xor');

  // Password toggle slider
  const [useEmbedPassword, setUseEmbedPassword] = useState(false);

  // Key type state (embed)
  const [embedKeyType, setEmbedKeyType] = useState<'password' | 'generate'>('password');
  const [generatedKey, setGeneratedKey] = useState<string>('');
  const [generatedKeyUrl, setGeneratedKeyUrl] = useState<string>('');

  // Key type state (decrypt)
  const [decryptKeyType, setDecryptKeyType] = useState<'password' | 'keyfile'>('password');

  // Filter & Search state
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Face auth state
  const [embedFaceDescriptor, setEmbedFaceDescriptor] = useState<Float32Array | null>(null);
  const [showFaceScanner, setShowFaceScanner] = useState(false);
  const [faceScanMode, setFaceScanMode] = useState<'enroll' | 'verify'>('enroll');
  const [storedFaceDescriptor, setStoredFaceDescriptor] = useState<Float32Array | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);
  const [stegoHasFace, setStegoHasFace] = useState(false);

  // Partition state (Mode Pro / AES)
  const [usePartitions, setUsePartitions] = useState(false);
  const [partitions, setPartitions] = useState<Partition[]>([]);
  // For decrypt: which partition label the user typed password for
  const [decryptPartitionLabel, setDecryptPartitionLabel] = useState('');
  const [isPartitionBundle, setIsPartitionBundle] = useState(false);
  const [partitionBundleLabels, setPartitionBundleLabels] = useState<string[]>([]);
  const [partitionDecryptPassword, setPartitionDecryptPassword] = useState('');
  const [showPartitionDecryptPassword, setShowPartitionDecryptPassword] = useState(false);
  const [selectedPartitionLabel, setSelectedPartitionLabel] = useState('');

  // Activity log state (Mode Pro)
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [showLogPopup, setShowLogPopup] = useState(false);

  // Compression stats state
  const [embedCompressionStats, setEmbedCompressionStats] = useState<{
    originalSize: number;
    compressedSize: number;
    savedPercent: number;
  } | null>(null);
  const [decryptCompressionStats, setDecryptCompressionStats] = useState<{
    compressedSize: number;
    decompressedSize: number;
    savedPercent: number;
  } | null>(null);

  const makeTs = () => new Date().toLocaleString('id-ID', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const addLog = useCallback((entry: string) => {
    setActivityLog((prev) => [...prev, `[${makeTs()}] ${entry}`]);
  }, []);

  // Track previous comment values for detecting add vs edit
  const prevEmbedCommentsRef = useRef<Record<number, string>>({});
  const prevDecryptCommentsRef = useRef<Record<string, string>>({});
  // Debounce timers for comment logging
  const embedCommentLogTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const decryptCommentLogTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const logEmbedCommentChange = useCallback((index: number, fileName: string, newValue: string) => {
    if (embedCommentLogTimerRef.current[index]) {
      clearTimeout(embedCommentLogTimerRef.current[index]);
    }
    embedCommentLogTimerRef.current[index] = setTimeout(() => {
      const prev = prevEmbedCommentsRef.current[index] ?? '';
      if (newValue === prev) return;
      if (!prev && newValue) {
        addLog(`Komentar ditambahkan pada file embed "${fileName}"`);
      } else if (prev && !newValue) {
        addLog(`Komentar dihapus pada file embed "${fileName}"`);
      } else {
        addLog(`Komentar diedit pada file embed "${fileName}"`);
      }
      prevEmbedCommentsRef.current[index] = newValue;
    }, 800);
  }, [addLog]);

  const logDecryptCommentChange = useCallback((fileId: string, fileName: string, newValue: string) => {
    if (decryptCommentLogTimerRef.current[fileId]) {
      clearTimeout(decryptCommentLogTimerRef.current[fileId]);
    }
    decryptCommentLogTimerRef.current[fileId] = setTimeout(() => {
      const prev = prevDecryptCommentsRef.current[fileId] ?? '';
      if (newValue === prev) return;
      if (!prev && newValue) {
        addLog(`Komentar ditambahkan pada file dekripsi "${fileName}"`);
      } else if (prev && !newValue) {
        addLog(`Komentar dihapus pada file dekripsi "${fileName}"`);
      } else {
        addLog(`Komentar diedit pada file dekripsi "${fileName}"`);
      }
      prevDecryptCommentsRef.current[fileId] = newValue;
    }, 800);
  }, [addLog]);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const stegoInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: Toast['type']) => {
    const id = Math.random().toString(36).substring(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const hasAnyChanges = modified || passwordChanged;

  const categoryCounts = useMemo(() => {
    const counts: Record<FilterCategory, number> = {
      all: decryptedFiles.length,
      image: 0, video: 0, audio: 0, text: 0, other: 0,
    };
    for (const f of decryptedFiles) {
      const cat = getFileCategory(f.type, f.name) as FilterCategory;
      if (cat in counts) counts[cat]++;
    }
    return counts;
  }, [decryptedFiles]);

  const filteredDecryptedFiles = useMemo(() => {
    let files = decryptedFiles;
    if (filterCategory !== 'all') {
      files = files.filter((f) => getFileCategory(f.type, f.name) === filterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      files = files.filter((f) => f.name.toLowerCase().includes(q));
    }
    return files;
  }, [decryptedFiles, filterCategory, searchQuery]);

  async function buildFilePreview(file: File): Promise<FilePreview> {
    const preview: FilePreview = { name: file.name, size: file.size, type: file.type };
    const cat = getFileCategory(file.type, file.name);
    if (cat === 'image') {
      preview.url = await readFileAsDataURL(file);
    } else if (cat === 'text') {
      preview.text = await readFileAsText(file);
    } else if (cat === 'audio' || cat === 'video') {
      preview.url = URL.createObjectURL(file);
    }
    return preview;
  }

  const getEmbedFileName = (index: number): string => {
    return embedFileNames[index] ?? secretFiles[index]?.name ?? '';
  };

  const resetStegoResult = () => {
    setStegoResult(null);
    setStegoPreview(null);
    setStegoOutputName('');
    setEditingStegoName(false);
    setEmbedCompressionStats(null);
  };

  const resetEmbedKeyState = () => {
    setEmbedKeyType('password');
    setGeneratedKey('');
    setGeneratedKeyUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return ''; });
    setEmbedPassword('');
  };

  // Reset face descriptor juga saat tab embed di-clear
  const resetEmbedFace = () => setEmbedFaceDescriptor(null);

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    resetStegoResult();
    const preview = await buildFilePreview(file);
    setCoverPreview(preview);
  };

  const handleSecretFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSecretFiles((prev) => [...prev, ...files]);
    resetStegoResult();
    const previews = await Promise.all(files.map(buildFilePreview));
    setSecretPreviews((prev) => [...prev, ...previews]);
    if (secretInputRef.current) secretInputRef.current.value = '';
  };

  const removeSecretFile = (index: number) => {
    setSecretFiles((prev) => prev.filter((_, i) => i !== index));
    setSecretPreviews((prev) => prev.filter((_, i) => i !== index));
    resetStegoResult();
    setOpenedEmbedPreviews((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
    setEmbedComments((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([key, val]) => { const k = Number(key); if (k < index) next[k] = val; else if (k > index) next[k - 1] = val; });
      return next;
    });
    setOpenedEmbedComments((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
    setEmbedFileNames((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([key, val]) => { const k = Number(key); if (k < index) next[k] = val; else if (k > index) next[k - 1] = val; });
      return next;
    });
    setEditingEmbedFileNames((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  const openEmbedPreview = (index: number) => {
    setOpenedEmbedPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const toggleEmbedComment = (index: number) => {
    setOpenedEmbedComments((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const toggleEditEmbedFileName = (index: number) => {
    setEditingEmbedFileNames((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!(index in embedFileNames)) {
          setEmbedFileNames((p) => ({ ...p, [index]: secretFiles[index]?.name ?? '' }));
        }
        next.add(index);
      }
      return next;
    });
  };

  const openDecryptPreview = (fileId: string) => {
    setOpenedDecryptPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  const toggleAllDecryptPreviews = () => {
    if (allDecryptPreviewsOpen) {
      setOpenedDecryptPreviews(new Set());
      setAllDecryptPreviewsOpen(false);
    } else {
      const allIds = new Set(filteredDecryptedFiles.map((f) => f.id));
      setOpenedDecryptPreviews(allIds);
      setAllDecryptPreviewsOpen(true);
    }
  };

  const toggleEditComment = (fileId: string) => {
    setEditingComments((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        // Closing edit mode — log "Selesai" if comment changed
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const toggleEditFileName = (fileId: string) => {
    setEditingFileNames((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  const updateDecryptedFileName = (fileId: string, name: string) => {
    setDecryptedFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, name } : f)));
    setModified(true);
  };

  const updateDecryptedFileComment = (fileId: string, comment: string) => {
    setDecryptedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      if (file) logDecryptCommentChange(fileId, file.name, comment);
      return prev.map((f) => (f.id === fileId ? { ...f, comment } : f));
    });
    setModified(true);
  };

  // Secure password clearing function
  const clearEmbedPassword = useCallback(() => {
    secureWipeString(embedPassword);
    setEmbedPassword('');
    setShowEmbedPassword(false);
  }, [embedPassword]);

  const clearDecryptPassword = useCallback(() => {
    secureWipeString(decryptPassword);
    setDecryptPassword('');
    setShowDecryptPassword(false);
  }, [decryptPassword]);

  const clearNewPassword = useCallback(() => {
    secureWipeString(newPassword);
    setNewPassword('');
    setShowNewPassword(false);
  }, [newPassword]);

  const generateRandomKey = useCallback(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const array = new Uint8Array(50);
    crypto.getRandomValues(array);
    let key = '';
    for (let i = 0; i < 50; i++) {
      key += chars[array[i] % chars.length];
    }
    setGeneratedKey(key);
    setEmbedPassword(key);
    // Buat blob txt (internal), diunduh sebagai key.sty
    const blob = new Blob([key], { type: 'text/plain' });
    setGeneratedKeyUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
  }, []);

  // ── Partition helpers (Mode Pro) ───────────────────────────────────────

  const addPartition = () => {
    if (partitions.length >= 5) return;
    const idx = partitions.length;
    const labels = ['A', 'B', 'C', 'D', 'E'];
    setPartitions((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), label: `Partisi ${labels[idx]}`, password: '', showPassword: false, fileIndexes: [] },
    ]);
  };

  const removePartition = (id: string) => {
    setPartitions((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePartitionPassword = (id: string, password: string) => {
    setPartitions((prev) => prev.map((p) => (p.id === id ? { ...p, password } : p)));
  };

  const togglePartitionShowPassword = (id: string) => {
    setPartitions((prev) => prev.map((p) => (p.id === id ? { ...p, showPassword: !p.showPassword } : p)));
  };

  const toggleFileInPartition = (partitionId: string, fileIndex: number) => {
    setPartitions((prev) => prev.map((p) => {
      if (p.id !== partitionId) {
        return { ...p, fileIndexes: p.fileIndexes.filter((i) => i !== fileIndex) };
      }
      const has = p.fileIndexes.includes(fileIndex);
      return { ...p, fileIndexes: has ? p.fileIndexes.filter((i) => i !== fileIndex) : [...p.fileIndexes, fileIndex] };
    }));
  };

  const getFilePartition = (fileIndex: number): Partition | undefined => {
    return partitions.find((p) => p.fileIndexes.includes(fileIndex));
  };

  const resetPartitions = () => {
    setUsePartitions(false);
    setPartitions([]);
  };

  const handleKeyFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const key = text.trim();
      setDecryptPassword(key);
      showToast('Key berhasil dimuat dari file!', 'success');
    } catch {
      showToast('Gagal membaca file key.', 'error');
    }
    if (e.target) e.target.value = '';
  }, [showToast]);

  const handleEmbed = async () => {
    if (!noCoverMode && !coverFile) return showToast('Pilih file cover terlebih dahulu!', 'error');
    if (secretFiles.length === 0) return showToast('Tambahkan minimal satu file rahasia!', 'error');

    // Partition validation
    if (usePartitions && embedMethod === 'aes') {
      if (partitions.length < 2) return showToast('Tambahkan minimal 2 partisi!', 'error');
      const hasEmptyPass = partitions.some((p) => !p.password.trim());
      if (hasEmptyPass) return showToast('Semua partisi harus memiliki password!', 'error');
      const totalAssigned = partitions.reduce((a, p) => a + p.fileIndexes.length, 0);
      if (totalAssigned === 0) return showToast('Assign minimal satu file ke partisi!', 'error');
      const unassigned = secretFiles.map((_, i) => i).filter((i) => !getFilePartition(i));
      if (unassigned.length > 0) return showToast(`${unassigned.length} file belum diassign ke partisi!`, 'error');
    }

    setEmbedding(true);
    setEmbedCompressionStats(null);
    const passwordCopy = embedPassword; // Copy before clearing
    try {
      // ── Step 1: Rename files ────────────────────────────────────────────
      const renamedFiles = secretFiles.map((file, index) => {
        const customName = embedFileNames[index];
        if (customName && customName !== file.name) {
          return new File([file], customName, { type: file.type });
        }
        return file;
      });

      // ── Step 2: Compress each file before embedding ─────────────────────
      let totalOriginalSize = 0;
      let totalCompressedSize = 0;
      const compressedFiles = await Promise.all(renamedFiles.map(async (file) => {
        const buf = await readFileAsArrayBuffer(file);
        totalOriginalSize += buf.byteLength;
        const compressed = await compressData(buf);
        const withHeader = addCompressHeader(compressed);
        totalCompressedSize += withHeader.byteLength;
        // Keep original extension so stego utils can still read type
        return new File([withHeader], file.name, { type: file.type });
      }));

      const savedPercent = totalOriginalSize > 0
        ? Math.max(0, Math.round((1 - totalCompressedSize / totalOriginalSize) * 100))
        : 0;
      setEmbedCompressionStats({ originalSize: totalOriginalSize, compressedSize: totalCompressedSize, savedPercent });

      // ── Partition Mode (AES only) ───────────────────────────────────────
      if (usePartitions && embedMethod === 'aes') {
        // Build a ZIP-like multi-partition bundle:
        // For each partition we create a separate encrypted .enc blob, then bundle them
        // as a JSON manifest embedded inside the main file using a special marker.
        // Format: we embed a single "partition bundle" file that contains JSON metadata
        // and each partition's encrypted data as base64.
        const partitionBlobs: { label: string; data: string }[] = [];
        for (const partition of partitions) {
          const partFiles = partition.fileIndexes.map((i) => compressedFiles[i]);
          const partComments: Record<number, string> = {};
          partition.fileIndexes.forEach((origIdx, newIdx) => {
            if (embedComments[origIdx]) partComments[newIdx] = embedComments[origIdx];
          });
          const partLog = [
            `[${makeTs()}] Partisi "${partition.label}" dibuat`,
            `[${makeTs()}] ${partFiles.length} file dalam partisi ini`,
          ];
          const { blob: partBlob } = await embedFilesNoCover(
            partFiles, partition.password.trim(),
            partComments, 'aes',
            undefined,
            partLog
          );
          const arrBuf = await partBlob.arrayBuffer();
          // Convert to base64 safely without spread (avoids stack overflow on large files)
          const bytes = new Uint8Array(arrBuf);
          let binary = '';
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          const base64 = btoa(binary);
          partitionBlobs.push({ label: partition.label, data: base64 });
        }

        // Encode bundle
        const bundleJson = JSON.stringify({ type: 'partition-bundle', version: 1, partitions: partitionBlobs });
        const bundleBytes = new TextEncoder().encode(bundleJson);
        const bundleFile = new File([bundleBytes], '__partition_bundle__.json', { type: 'application/json' });

        const creationLog: string[] = [
          `[${makeTs()}] File stego partisi dibuat`,
          `[${makeTs()}] ${partitions.length} partisi terenkripsi AES-256-GCM + Argon2`,
          ...partitions.map((p) => `[${makeTs()}]   ${p.label}: ${p.fileIndexes.length} file`),
          ...(embedFaceDescriptor ? [`[${makeTs()}] Face Lock diaktifkan`] : []),
        ];

        let blob: Blob;
        let extension: string;
        const bundlePw = '__PARTITION_BUNDLE__';
        if (noCoverMode) {
          ({ blob, extension } = await embedFilesNoCover([bundleFile], bundlePw, {}, 'aes', embedFaceDescriptor ?? undefined, creationLog));
        } else {
          ({ blob, extension } = await embedFiles(coverFile!, [bundleFile], bundlePw, {}, 'aes', embedFaceDescriptor ?? undefined, creationLog));
        }

        const url = URL.createObjectURL(blob);
        setStegoResult({ url, extension });
        const defaultName = noCoverMode ? `partitioned_encrypted.enc` : `stego_partitioned.${extension}`;
        setStegoOutputName(defaultName);
        setEditingStegoName(false);
        const sp: FilePreview = { name: defaultName, size: blob.size, type: noCoverMode ? 'application/octet-stream' : coverFile!.type };
        if (!noCoverMode) {
          const cat = getFileCategory(coverFile!.type, coverFile!.name);
          if (cat === 'image') sp.url = await blobToDataURL(blob);
          else if (cat === 'text') sp.text = await blobToText(blob);
          else if (cat === 'audio' || cat === 'video') sp.url = url;
        }
        setStegoPreview(sp);
        clearEmbedPassword();
        showToast(`File berhasil dienkripsi dalam ${partitions.length} partisi!`, 'success');
        return;
      }

      const methodToUse = passwordCopy ? embedMethod : undefined;

      // Build creation log to embed in payload — each entry gets its own fresh timestamp
      const creationLog: string[] = [
        `[${makeTs()}] File stego dibuat`,
        noCoverMode
          ? `[${makeTs()}] Mode: Tanpa file cover (.enc)`
          : `[${makeTs()}] Cover: ${coverFile!.name}`,
        `[${makeTs()}] ${compressedFiles.length} file rahasia disematkan (dikompresi: ${savedPercent}% hemat)`,
        ...renamedFiles.map((f) => `[${makeTs()}]   - ${f.name} (${formatFileSize(f.size)})`),
        ...(passwordCopy
          ? [`[${makeTs()}] Enkripsi: ${methodToUse === 'aes' ? 'AES-256-GCM + Argon2 (Mode Pro)' : 'XOR (Mode Standar)'}`]
          : [`[${makeTs()}] Tanpa enkripsi password`]),
        ...(embedFaceDescriptor ? [`[${makeTs()}] Face Lock diaktifkan`] : []),
      ];

      let blob: Blob;
      let extension: string;

      if (noCoverMode) {
        ({ blob, extension } = await embedFilesNoCover(
          compressedFiles, passwordCopy || undefined,
          embedComments, methodToUse,
          embedFaceDescriptor ?? undefined,
          creationLog
        ));
      } else {
        ({ blob, extension } = await embedFiles(
          coverFile!, compressedFiles, passwordCopy || undefined,
          embedComments, methodToUse,
          embedFaceDescriptor ?? undefined,
          creationLog
        ));
      }

      const url = URL.createObjectURL(blob);
      setStegoResult({ url, extension });
      const defaultName = noCoverMode ? `encrypted_files.enc` : `stego_file.${extension}`;
      setStegoOutputName(defaultName);
      setEditingStegoName(false);

      const sp: FilePreview = { name: defaultName, size: blob.size, type: noCoverMode ? 'application/octet-stream' : coverFile!.type };
      if (!noCoverMode) {
        const cat = getFileCategory(coverFile!.type, coverFile!.name);
        if (cat === 'image') sp.url = await blobToDataURL(blob);
        else if (cat === 'text') sp.text = await blobToText(blob);
        else if (cat === 'audio' || cat === 'video') sp.url = url;
      }
      setStegoPreview(sp);

      // Clear password from memory after successful embed
      clearEmbedPassword();
      showToast(noCoverMode ? 'File berhasil dienkripsi ke .enc!' : 'File berhasil disembunyikan! Password telah dihapus dari memori.', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      // Always wipe the password copy
      secureWipeString(passwordCopy);
      setEmbedding(false);
    }
  };

  const handleStegoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStegoFile(file);
    setDecryptedFiles([]);
    setModified(false);
    setNeedsPassword(false);
    setDetectedMethod(null);
    setDecryptPassword('');
    setShowDecryptPassword(false);
    setFilePreviews({});
    setOpenedDecryptPreviews(new Set());
    setEditingComments(new Set());
    setStegoDetected(false);
    setDecryptionDone(false);
    setEditingFileNames(new Set());
    setNewPassword('');
    setShowNewPassword(false);
    setPasswordChanged(false);
    setOriginalDecryptPassword('');
    setAllDecryptPreviewsOpen(false);
    setFilterCategory('all');
    setSearchQuery('');
    setDecryptMethod('xor');
    setDecryptKeyType('password');
    setActivityLog([]);  // reset log on new file
    setIsPartitionBundle(false);
    setPartitionBundleLabels([]);
    setSelectedPartitionLabel('');
    setPartitionDecryptPassword('');
    setShowPartitionDecryptPassword(false);

    const preview = await buildFilePreview(file);
    setStegoFilePreview(preview);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      setStegoBuffer(buffer);
      const check = checkForHiddenData(buffer);
      if (!check.found) {
        showToast('Tidak ditemukan data tersembunyi dalam file ini.', 'error');
        setStegoDetected(false);
        return;
      }
      setStegoDetected(true);
      setNeedsPassword(check.hasPassword);
      setDetectedMethod(check.method);
      setStegoHasFace(check.hasFace);
      setFaceVerified(false);
      addLog(`File stego dimuat: ${file.name} (${formatFileSize(file.size)})`);
      if (check.method) addLog(`Metode enkripsi terdeteksi: ${check.method === 'aes' ? 'AES-256-GCM + Argon2 (Mode Pro)' : 'XOR (Mode Standar)'}`);
      if (check.hasFace) addLog('Face Lock terdeteksi pada file ini');
      if (!check.hasPassword) addLog('File tidak terenkripsi password');

      // Pre-extract face descriptor from stego file (tersimpan di trailer, bukan payload)
      // Ini aman dilakukan tanpa password karena face descriptor ada di luar payload terenkripsi
      if (check.hasFace) {
        try {
          // Extract dengan password kosong — akan gagal di payload tapi face descriptor sudah terbaca
          const { faceDescriptor } = await extractFiles(buffer, undefined, null).catch(() => ({ faceDescriptor: null, files: [] }));
          // Jika no password stego atau bisa dibaca, ambil face descriptor-nya
          // Untuk AES/XOR stego: face descriptor dibaca SEBELUM decrypt payload
          // Kita extract langsung dari buffer trailer
          if (faceDescriptor) {
            setStoredFaceDescriptor(faceDescriptor);
          } else {
            // Extract face bytes langsung dari trailer buffer
            const u8 = new Uint8Array(buffer);
            const FACE_BYTES_LEN = 128 * 4;
            const faceStart = u8.length - 10 - FACE_BYTES_LEN;
            if (faceStart >= 0) {
              const faceBytes = u8.slice(faceStart, faceStart + FACE_BYTES_LEN);
              const copy = new Uint8Array(faceBytes).buffer;
              setStoredFaceDescriptor(new Float32Array(copy));
            }
          }
        } catch {
          // fallback: extract face bytes langsung dari trailer
          const u8 = new Uint8Array(buffer);
          const FACE_BYTES_LEN = 128 * 4;
          const faceStart = u8.length - 10 - FACE_BYTES_LEN;
          if (faceStart >= 0) {
            const faceBytes = u8.slice(faceStart, faceStart + FACE_BYTES_LEN);
            const copy = new Uint8Array(faceBytes).buffer;
            setStoredFaceDescriptor(new Float32Array(copy));
          }
        }
      }
      if (check.method) {
        setDecryptMethod(check.method);
      }
      if (check.hasPassword) {
        const methodLabel = check.method === 'aes' ? 'AES-256 + Argon2' : 'XOR';
        showToast(`File memerlukan password (${methodLabel}) untuk dekripsi.`, 'info');

        // Try to detect partition bundle (using internal marker password)
        if (check.method === 'aes') {
          try {
            const { files: innerFiles } = await extractFiles(buffer, '__PARTITION_BUNDLE__', 'aes');
            if (innerFiles.length === 1 && innerFiles[0].name === '__partition_bundle__.json') {
              const jsonText = new TextDecoder().decode(innerFiles[0].data);
              const bundle = JSON.parse(jsonText);
              if (bundle.type === 'partition-bundle' && Array.isArray(bundle.partitions)) {
                const labels: string[] = bundle.partitions.map((p: { label: string }) => p.label);
                setIsPartitionBundle(true);
                setPartitionBundleLabels(labels);
                setSelectedPartitionLabel(labels[0] || '');
                addLog(`File partisi terdeteksi: ${labels.length} partisi (${labels.join(', ')})`);
                showToast(`File berisi ${labels.length} partisi! Pilih partisi dan masukkan passwordnya.`, 'info');
              }
            }
          } catch {
            // Not a partition bundle, ignore
          }
        }
      } else {
        showToast('Data tersembunyi terdeteksi! Klik Dekripsi.', 'info');
      }
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const handleDecrypt = async () => {
    if (!stegoBuffer) return showToast('Pilih file stego terlebih dahulu!', 'error');

    // Jika file punya face lock, wajib verifikasi wajah dulu
    if (stegoHasFace && !faceVerified) {
      showToast('File ini dilindungi wajah. Verifikasi wajah terlebih dahulu!', 'error');
      return;
    }

    setDecrypting(true);
    setDecryptCompressionStats(null);
    const passwordCopy = decryptPassword;
    try {
      const { files, faceDescriptor, log: payloadLog } = await extractFiles(stegoBuffer, passwordCopy || undefined, detectedMethod);

      // ── Decompress each file if it has the ZSTG header ──────────────────
      let totalCompressedSize = 0;
      let totalDecompressedSize = 0;
      const decompressedFiles = await Promise.all(files.map(async (file) => {
        const { isCompressed, payload } = stripCompressHeader(file.data);
        if (isCompressed) {
          totalCompressedSize += file.data.byteLength;
          const decompressed = await decompressData(payload);
          totalDecompressedSize += decompressed.byteLength;
          return { ...file, data: decompressed, size: decompressed.byteLength };
        }
        // Not compressed (older file) — pass through
        totalCompressedSize += file.data.byteLength;
        totalDecompressedSize += file.data.byteLength;
        return file;
      }));

      const savedPercent = totalDecompressedSize > 0
        ? Math.max(0, Math.round((1 - totalCompressedSize / totalDecompressedSize) * 100))
        : 0;
      setDecryptCompressionStats({ compressedSize: totalCompressedSize, decompressedSize: totalDecompressedSize, savedPercent });

      // Simpan stored face descriptor untuk referensi (sudah diverifikasi sebelumnya)
      if (faceDescriptor) setStoredFaceDescriptor(faceDescriptor);

      setDecryptedFiles(decompressedFiles);
      // Initialize previous comment tracking so we can detect add vs edit
      prevDecryptCommentsRef.current = Object.fromEntries(decompressedFiles.map((f) => [f.id, f.comment ?? '']));
      setModified(false);
      setOpenedDecryptPreviews(new Set());
      setEditingComments(new Set());
      setEditingFileNames(new Set());
      setDecryptionDone(true);
      setOriginalDecryptPassword(passwordCopy);
      setNewPassword(passwordCopy);
      setPasswordChanged(false);
      setAllDecryptPreviewsOpen(false);
      setFilterCategory('all');
      setSearchQuery('');
      if (detectedMethod) setDecryptMethod(detectedMethod);

      clearDecryptPassword();

      // Restore log from payload, then append new session entries — each with a fresh timestamp
      const sessionEntries: string[] = [];
      sessionEntries.push(`[${makeTs()}] Dekripsi berhasil: ${stegoFile?.name ?? 'file stego'}`);
      sessionEntries.push(`[${makeTs()}] ${decompressedFiles.length} file berhasil diekstrak`);
      for (const f of decompressedFiles) sessionEntries.push(`[${makeTs()}]   - ${f.name} (${formatFileSize(f.size)})`);
      if (detectedMethod) sessionEntries.push(`[${makeTs()}] Metode enkripsi: ${detectedMethod === 'aes' ? 'AES-256-GCM + Argon2 (Mode Pro)' : 'XOR (Mode Standar)'}`);
      if (faceDescriptor) sessionEntries.push(`[${makeTs()}] Face Lock: terverifikasi`);
      if (savedPercent > 0) sessionEntries.push(`[${makeTs()}] Dekompresi: ${savedPercent}% ruang dihemat saat penyimpanan`);
      setActivityLog([...(payloadLog || []), ...sessionEntries]);

      showToast(`Berhasil mendekripsi ${decompressedFiles.length} file! Password telah dihapus dari memori.`, 'success');

      const previews: Record<string, string> = {};
      for (const f of decompressedFiles) {
        const cat = getFileCategory(f.type, f.name);
        const blob = new Blob([f.data], { type: f.type });
        if (cat === 'image') previews[f.id] = await blobToDataURL(blob);
        else if (cat === 'text') previews[f.id] = await blobToText(blob);
        else if (cat === 'audio' || cat === 'video') previews[f.id] = URL.createObjectURL(blob);
      }
      setFilePreviews(previews);
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      secureWipeString(passwordCopy);
      setDecrypting(false);
    }
  };

  const handlePartitionDecrypt = async () => {
    if (!stegoBuffer) return;
    if (!partitionDecryptPassword.trim()) return showToast('Masukkan password!', 'error');

    setDecrypting(true);
    try {
      // Step 1: Extract the partition bundle using internal marker
      const { files: innerFiles } = await extractFiles(stegoBuffer, '__PARTITION_BUNDLE__', 'aes');
      if (!innerFiles.length || innerFiles[0].name !== '__partition_bundle__.json') {
        throw new Error('File bundle partisi tidak valid');
      }
      const jsonText = new TextDecoder().decode(innerFiles[0].data);
      const bundle = JSON.parse(jsonText);

      // Step 2: Try password against ALL partitions, take the first match
      let matchedLabel = '';
      let matchedFiles: typeof innerFiles = [];

      for (const partitionEntry of bundle.partitions) {
        try {
          const binaryStr = atob(partitionEntry.data);
          const partBytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) partBytes[i] = binaryStr.charCodeAt(i);
          const partBuffer = partBytes.buffer;

          const { files: partFiles } = await extractFiles(partBuffer, partitionDecryptPassword.trim(), 'aes');
          // If no error thrown, password matched this partition
          matchedLabel = partitionEntry.label;
          matchedFiles = partFiles;
          break;
        } catch {
          // Wrong password for this partition, try next
          continue;
        }
      }

      if (!matchedLabel) {
        showToast('Password salah — tidak cocok dengan partisi manapun.', 'error');
        setDecrypting(false);
        return;
      }

      // Step 3: Decompress matched files
      const decompressedFiles = await Promise.all(matchedFiles.map(async (file) => {
        const { isCompressed, payload } = stripCompressHeader(file.data);
        if (isCompressed) {
          const decompressed = await decompressData(payload);
          return { ...file, data: decompressed, size: decompressed.byteLength };
        }
        return file;
      }));

      // Step 4: Merge into existing decrypted files (avoid exact duplicates)
      setDecryptedFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name + f.size));
        const newOnes = decompressedFiles.filter((f) => !existing.has(f.name + f.size));
        return [...prev, ...newOnes];
      });

      // Build previews
      const previews: Record<string, string> = {};
      for (const f of decompressedFiles) {
        const cat = getFileCategory(f.type, f.name);
        const blob = new Blob([f.data], { type: f.type });
        if (cat === 'image') previews[f.id] = await blobToDataURL(blob);
        else if (cat === 'text') previews[f.id] = await blobToText(blob);
        else if (cat === 'audio' || cat === 'video') previews[f.id] = URL.createObjectURL(blob);
      }
      setFilePreviews((prev) => ({ ...prev, ...previews }));
      setDecryptionDone(true);
      setPartitionDecryptPassword('');
      addLog(`Partisi "${matchedLabel}" berhasil didekripsi: ${decompressedFiles.length} file`);
      showToast(`✓ ${matchedLabel} terbuka — ${decompressedFiles.length} file diekstrak.`, 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setDecrypting(false);
    }
  };

  const requestRemoveDecryptedFile = (id: string, name: string) => {
    setConfirmDialog({ open: true, fileId: id, fileName: name });
  };

  const confirmRemoveDecryptedFile = () => {
    setDecryptedFiles((prev) => prev.filter((f) => f.id !== confirmDialog.fileId));
    setOpenedDecryptPreviews((prev) => { const next = new Set(prev); next.delete(confirmDialog.fileId); return next; });
    setEditingComments((prev) => { const next = new Set(prev); next.delete(confirmDialog.fileId); return next; });
    setEditingFileNames((prev) => { const next = new Set(prev); next.delete(confirmDialog.fileId); return next; });
    setModified(true);
    addLog(`File dihapus dari payload: ${confirmDialog.fileName}`);
    setConfirmDialog({ open: false, fileId: '', fileName: '' });
    showToast('File berhasil dihapus.', 'info');
  };

  const cancelRemoveDecryptedFile = () => {
    setConfirmDialog({ open: false, fileId: '', fileName: '' });
  };

  const handleAddFileToDecrypted = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const newFiles: HiddenFile[] = [];
      const newPreviews: Record<string, string> = {};
      for (const file of files) {
        const buffer = await readFileAsArrayBuffer(file);
        const id = Math.random().toString(36).substring(2, 15);
        newFiles.push({ id, name: file.name, size: file.size, type: file.type, data: buffer, comment: '' });
        const cat = getFileCategory(file.type, file.name);
        if (cat === 'image') newPreviews[id] = await readFileAsDataURL(file);
        else if (cat === 'text') newPreviews[id] = await readFileAsText(file);
        else if (cat === 'audio' || cat === 'video') newPreviews[id] = URL.createObjectURL(file);
      }
      setDecryptedFiles((prev) => [...prev, ...newFiles]);
      setFilePreviews((prev) => ({ ...prev, ...newPreviews }));
      setModified(true);
      addLog(`${files.length} file ditambahkan ke payload`);
      files.forEach((f) => addLog(`Ditambahkan ${f.name} (${formatFileSize(f.size)})`));
      showToast(`${files.length} file ditambahkan.`, 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    }
    if (addFileInputRef.current) addFileInputRef.current.value = '';
  };

  const handleUpdateAndDownload = async () => {
    if (!stegoBuffer || decryptedFiles.length === 0) return;
    setUpdating(true);
    const passwordToUse = passwordChanged ? newPassword : originalDecryptPassword;
    const passwordCopy = passwordToUse; // Copy

    // Append update entry to log before saving — each entry gets its own fresh timestamp
    const updatedLog = [
      ...activityLog,
      `[${makeTs()}] File diperbarui & disimpan ulang (${decryptedFiles.length} file dalam payload)`,
      ...(passwordChanged ? [`[${makeTs()}] Password diubah`] : []),
    ];

    try {
      const newBlob = await reEmbedFiles(
        stegoBuffer, decryptedFiles,
        passwordCopy || undefined,
        passwordCopy ? decryptMethod : undefined,
        storedFaceDescriptor ?? undefined,
        updatedLog
      );

      const newBuffer = await newBlob.arrayBuffer();
      setStegoBuffer(newBuffer);
      setActivityLog(updatedLog);
      const url = URL.createObjectURL(newBlob);
      const ext = stegoFile?.name.split('.').pop() || 'bin';
      const a = document.createElement('a');
      a.href = url;
      a.download = `updated_stego.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setOriginalDecryptPassword(passwordCopy);
      setModified(false);
      setPasswordChanged(false);

      // Clear new password from memory after successful update
      clearNewPassword();
      showToast('File cover diperbarui dan diunduh! Password telah dihapus dari memori.', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      secureWipeString(passwordCopy);
      setUpdating(false);
    }
  };

  const downloadFile = (file: HiddenFile) => {
    const blob = new Blob([file.data], { type: file.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllFiles = async () => {
    if (decryptedFiles.length === 0) return;
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      for (const file of decryptedFiles) {
        zip.file(file.name, file.data);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'decrypted_files.zip';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Semua file berhasil diunduh sebagai ZIP!', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setDownloadingAll(false);
    }
  };

  const openLightbox = (src: string, alt: string) => setLightbox({ open: true, src, alt });
  const closeLightbox = () => setLightbox({ open: false, src: '', alt: '' });

  const renderPreview = (preview: FilePreview, clickableImage = false) => {
    const cat = getFileCategory(preview.type, preview.name);
    if (cat === 'image' && preview.url) {
      return (
        <div className="rounded-xl overflow-hidden bg-slate-50 border border-slate-200 relative group">
          <img src={preview.url} alt={preview.name} className="w-full max-h-64 object-contain" />
          {clickableImage && (
            <button onClick={() => openLightbox(preview.url!, preview.name)} className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
              <div className="bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg">
                <Maximize2 className="w-4 h-4 text-slate-700" />
                <span className="text-xs font-semibold text-slate-700">Lihat Penuh</span>
              </div>
            </button>
          )}
        </div>
      );
    }
    if (cat === 'video' && preview.url) return <video src={preview.url} controls loop className="w-full max-h-64 rounded-xl bg-black border border-slate-200" />;
    if (cat === 'audio' && preview.url) return <div className="p-4 rounded-xl bg-slate-50 border border-slate-200"><audio src={preview.url} controls loop className="w-full" /></div>;
    if (cat === 'text' && preview.text) return (
      <div className="max-h-44 overflow-auto rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs font-mono text-slate-600 leading-relaxed whitespace-pre-wrap">
        {preview.text.substring(0, 2000)}{preview.text.length > 2000 && <span className="text-slate-400">... (terpotong)</span>}
      </div>
    );
    return null;
  };

  const renderDecryptPreview = (fileId: string, type: string, name: string) => {
    const previewData = filePreviews[fileId];
    if (!previewData) return null;
    const cat = getFileCategory(type, name);
    if (cat === 'image') {
      return (
        <div className="rounded-xl overflow-hidden bg-slate-50 border border-slate-200 relative group">
          <img src={previewData} alt={name} className="w-full max-h-56 object-contain" />
          <button onClick={() => openLightbox(previewData, name)} className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
            <div className="bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg">
              <Maximize2 className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-semibold text-slate-700">Lihat Penuh</span>
            </div>
          </button>
        </div>
      );
    }
    if (cat === 'video') return <video src={previewData} controls loop className="w-full max-h-56 rounded-xl bg-black border border-slate-200" />;
    if (cat === 'audio') return <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><audio src={previewData} controls loop className="w-full" /></div>;
    if (cat === 'text') return (
      <div className="max-h-40 overflow-auto rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs font-mono text-slate-600 leading-relaxed whitespace-pre-wrap">
        {previewData.substring(0, 2000)}{previewData.length > 2000 && <span className="text-slate-400">... (terpotong)</span>}
      </div>
    );
    return null;
  };

  const clearStegoState = () => {
    // Clear passwords from memory
    secureWipeString(decryptPassword);
    secureWipeString(newPassword);
    secureWipeString(originalDecryptPassword);

    setStegoFile(null);
    setStegoFilePreview(null);
    setStegoBuffer(null);
    setDecryptedFiles([]);
    setModified(false);
    setNeedsPassword(false);
    setDetectedMethod(null);
    setDecryptPassword('');
    setShowDecryptPassword(false);
    setFilePreviews({});
    setOpenedDecryptPreviews(new Set());
    setEditingComments(new Set());
    setStegoDetected(false);
    setDecryptionDone(false);
    setEditingFileNames(new Set());
    setNewPassword('');
    setShowNewPassword(false);
    setPasswordChanged(false);
    setOriginalDecryptPassword('');
    setAllDecryptPreviewsOpen(false);
    setFilterCategory('all');
    setSearchQuery('');
    setDecryptMethod('xor');
    setFaceVerified(false);
    setStoredFaceDescriptor(null);
    setStegoHasFace(false);
    setDecryptKeyType('password');
    setDecryptCompressionStats(null);
    setIsPartitionBundle(false);
    setPartitionBundleLabels([]);
    setSelectedPartitionLabel('');
    setPartitionDecryptPassword('');
    setShowPartitionDecryptPassword(false);
    if (stegoInputRef.current) stegoInputRef.current.value = '';
  };

  const renderEncryptionMethodSelector = (
    value: EncryptionMethod,
    onChange: (m: EncryptionMethod) => void,
    disabled = false
  ) => (
    <div className="grid grid-cols-2 gap-2.5">
      <button
        type="button"
        onClick={() => !disabled && onChange('xor')}
        disabled={disabled}
        className={`relative rounded-xl border-2 p-3.5 text-left transition-all
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
          ${value === 'xor'
            ? 'border-amber-400 bg-amber-50/50 shadow-sm'
            : disabled
              ? 'border-slate-200 bg-slate-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
          }
        `}
      >
        {value === 'xor' && !disabled && (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${
          value === 'xor' && !disabled ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'
        }`}>
          <Zap className="w-4 h-4" />
        </div>
        <p className={`text-sm font-bold mb-0.5 ${value === 'xor' && !disabled ? 'text-amber-700' : 'text-slate-600'}`}>Mode Standar</p>
        <p className={`text-[10px] leading-snug ${value === 'xor' && !disabled ? 'text-amber-600/80' : 'text-slate-400'}`}>
          Cepat & ringan. Ukuran file lebih kecil.
        </p>
      </button>

      <button
        type="button"
        onClick={() => !disabled && onChange('aes')}
        disabled={disabled}
        className={`relative rounded-xl border-2 p-3.5 text-left transition-all
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
          ${value === 'aes'
            ? 'border-emerald-400 bg-emerald-50/50 shadow-sm'
            : disabled
              ? 'border-slate-200 bg-slate-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
          }
        `}
      >
        {value === 'aes' && !disabled && (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${
          value === 'aes' && !disabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
        }`}>
          <ShieldCheck className="w-4 h-4" />
        </div>
        <p className={`text-sm font-bold mb-0.5 ${value === 'aes' && !disabled ? 'text-emerald-700' : 'text-slate-600'}`}>Mode Pro</p>
        <p className={`text-[10px] leading-snug ${value === 'aes' && !disabled ? 'text-emerald-600/80' : 'text-slate-400'}`}>
          Ukuran file lebih besar tapi paling aman.
        </p>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* ====== SIDEBAR ====== */}
      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-800">SecureTools</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Sidebar menu */}
        <nav className="flex-1 p-3 space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 py-2">Menu</p>

          <button
            onClick={() => { setAppMode('stego'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all cursor-pointer ${
              appMode === 'stego'
                ? 'bg-violet-50 text-violet-700 border border-violet-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              appMode === 'stego' ? 'bg-violet-100' : 'bg-slate-100'
            }`}>
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">Stenografi</p>
              <p className="text-[10px] text-slate-400 truncate">Sembunyikan file di media</p>
            </div>
            {appMode === 'stego' && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
            )}
          </button>

          <button
            onClick={() => { setAppMode('pixel-encryptor'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all cursor-pointer ${
              appMode === 'pixel-encryptor'
                ? 'bg-cyan-50 text-cyan-700 border border-cyan-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              appMode === 'pixel-encryptor' ? 'bg-cyan-100' : 'bg-slate-100'
            }`}>
              <Cpu className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">Pixel Encryptor</p>
              <p className="text-[10px] text-slate-400 truncate">Enkripsi visual gambar</p>
            </div>
            {appMode === 'pixel-encryptor' && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
            )}
          </button>
        </nav>

        {/* Sidebar footer */}
        <div className="p-4 border-t border-slate-100">
          <p className="text-[11px] text-slate-400 text-center">&copy; 2026 Steganografi Multi-Media</p>
          <p className="text-[10px] text-slate-300 text-center">By Ahmad Sidik</p>
        </div>
      </aside>

      {/* ====== MAIN CONTENT AREA ====== */}
      <div className="flex-1 flex flex-col min-h-screen">
      {/* ====== FACE SCANNER MODAL ====== */}
      {showFaceScanner && (
        <FaceScanner
          mode={faceScanMode}
          storedDescriptor={storedFaceDescriptor}
          onCapture={(descriptor) => {
            setEmbedFaceDescriptor(descriptor);
            showToast('Wajah berhasil didaftarkan! Akan dienkripsi bersama file.', 'success');
          }}
          onVerified={() => {
            setFaceVerified(true);
            showToast('Verifikasi wajah berhasil!', 'success');
          }}
          onClose={() => setShowFaceScanner(false)}
        />
      )}

      {/* ====== IMAGE LIGHTBOX ====== */}
      {lightbox.open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-overlayIn">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeLightbox} />
          <div className="relative max-w-[95vw] max-h-[95vh] animate-scaleIn">
            <button onClick={closeLightbox} className="absolute -top-3 -right-3 z-10 w-10 h-10 rounded-full bg-white shadow-xl flex items-center justify-center hover:bg-red-50 text-slate-500 hover:text-red-500 transition-all cursor-pointer">
              <X className="w-5 h-5" />
            </button>
            <img src={lightbox.src} alt={lightbox.alt} className="max-w-[95vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl" />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-2xl p-4">
              <p className="text-white text-sm font-semibold truncate">{lightbox.alt}</p>
            </div>
          </div>
        </div>
      )}

      {/* ====== LOG POPUP MODAL ====== */}
      {showLogPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-overlayIn">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowLogPopup(false)} />
          <div className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Log Aktivitas</h3>
                  <p className="text-[11px] text-slate-400">{activityLog.length} entri tercatat</p>
                </div>
              </div>
              <button onClick={() => setShowLogPopup(false)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-all cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-[420px] overflow-y-auto space-y-1">
              {activityLog.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-6">Belum ada aktivitas tercatat.</p>
              ) : (
                activityLog.slice().reverse().map((entry, i) => (
                  <p
                    key={i}
                    className={`text-[11px] leading-relaxed font-mono break-all whitespace-pre-wrap ${
                      entry.includes('  -') ? 'text-slate-400 pl-3' :
                      entry.includes('  +') ? 'text-emerald-400 pl-3' :
                      entry.includes('Enkripsi') || entry.includes('enkripsi') ? 'text-violet-300' :
                      entry.includes('Dekripsi') || entry.includes('dekripsi') ? 'text-emerald-300' :
                      entry.includes('Face Lock') ? 'text-blue-300' :
                      'text-slate-300'
                    }`}
                  >
                    {entry}
                  </p>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====== CONFIRMATION DIALOG ====== */}
      {confirmDialog.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-overlayIn">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={cancelRemoveDecryptedFile} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-scaleIn">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Hapus File?</h3>
                <p className="text-sm text-slate-500 mt-0.5">Tindakan ini tidak dapat dibatalkan.</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 mb-5">
              <p className="text-sm text-slate-700 font-medium truncate">{confirmDialog.fileName}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={cancelRemoveDecryptedFile} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors active:scale-[0.98] cursor-pointer">Batal</button>
              <button onClick={confirmRemoveDecryptedFile} className="flex-1 py-2.5 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 transition-colors active:scale-[0.98] cursor-pointer">Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* ====== TOASTS — MOVED TO BOTTOM RIGHT ====== */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 w-[min(92vw,380px)]">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-enter flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : ''} ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : ''} ${toast.type === 'info' ? 'bg-blue-50 border-blue-200 text-blue-800' : ''}`}>
            {toast.type === 'success' && <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />}
            {toast.type === 'info' && <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />}
            <span className="text-sm leading-snug font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* ====== HEADER ====== */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger menu */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-all cursor-pointer"
              title="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-200">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800 leading-tight">
                {appMode === 'stego' ? 'Stegafy' : 'Pixel Encryptor'}
              </h1>
              <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
                {appMode === 'stego' ? 'Steganography File' : 'Enkripsi Visual Gambar'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {appMode === 'stego' && (
              <div className="flex bg-slate-100 rounded-xl p-1">
                <button onClick={() => setActiveTab('embed')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'embed' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <LockKeyhole className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sembunyikan</span>
                  <span className="sm:hidden">Embed</span>
                </button>
                <button onClick={() => setActiveTab('decrypt')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'decrypt' ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Unlock className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Dekripsi</span>
                  <span className="sm:hidden">Decrypt</span>
                </button>
              </div>
            )}
            {appMode === 'pixel-encryptor' && (
              <div className="flex bg-slate-100 rounded-xl p-1">
                <button onClick={() => setPixelMode('encrypt')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${pixelMode === 'encrypt' ? 'bg-white text-cyan-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Lock className="w-3.5 h-3.5" />
                  Enkripsi
                </button>
                <button onClick={() => setPixelMode('decrypt')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${pixelMode === 'decrypt' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Unlock className="w-3.5 h-3.5" />
                  Dekripsi
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ====== MAIN ====== */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ============ PIXEL ENCRYPTOR MODE ============ */}
        {appMode === 'pixel-encryptor' && (
          <div className="animate-fadeUp">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">Image Pixel Encryptor</h2>
              <p className="text-sm text-slate-500 mt-1">Enkripsi dan dekripsi gambar pada level piksel menggunakan password.</p>
            </div>
            {/* Lazy import placeholder — rendered by PixelEncryptor.tsx */}
            <PixelEncryptorView mode={pixelMode} setMode={setPixelMode} />
          </div>
        )}

        {/* ============ STEGO MODE ============ */}
        {appMode === 'stego' && (
        <>
        {/* ============ EMBED TAB ============ */}
        {activeTab === 'embed' && (
          <div className="animate-fadeUp">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">Steganography File</h2>
              <p className="text-sm text-slate-500 mt-1">Sisipkan file ke dalam file cover media Anda.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 space-y-5">

                {/* Step 1: Cover */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">1</div>
                      <h3 className="text-sm font-bold text-slate-700">File Cover</h3>
                    </div>
                    {/* Mode .enc toggle */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">Mode .enc</span>
                      <button
                        type="button"
                        onClick={() => { setNoCoverMode((v) => !v); setCoverFile(null); setCoverPreview(null); resetStegoResult(); }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${noCoverMode ? 'bg-violet-500' : 'bg-slate-200'}`}
                        title={noCoverMode ? 'Mode .enc aktif — tanpa file cover' : 'Aktifkan mode tanpa file cover (output .enc)'}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${noCoverMode ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>
                  <input ref={coverInputRef} type="file" className="hidden" onChange={handleCoverSelect} />
                  {noCoverMode ? (
                    <div className="flex items-start gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                      <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Lock className="w-3.5 h-3.5 text-violet-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-violet-800">Mode Enkripsi Langsung (.enc)</p>
                        <p className="text-xs text-violet-600 mt-0.5">File cover tidak diperlukan. Hasil enkripsi akan disimpan sebagai file <code className="bg-violet-100 px-1 rounded font-mono">.enc</code> yang hanya bisa dibuka dengan aplikasi ini.</p>
                      </div>
                    </div>
                  ) : !coverFile ? (
                    <button onClick={() => coverInputRef.current?.click()} className="w-full border-2 border-dashed border-slate-200 rounded-xl py-10 flex flex-col items-center gap-3 hover:border-orange-300 hover:bg-orange-50/30 transition-all group cursor-pointer">
                      <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                        <Upload className="w-6 h-6 text-slate-400 group-hover:text-orange-500 transition-colors" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-700">Klik untuk memilih file cover</p>
                        <p className="text-xs text-slate-400 mt-1">Gambar, Video, Audio, atau Teks</p>
                      </div>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getFileIconColor(coverFile.type, coverFile.name)}`}>
                          {getFileIconEl(coverFile.type, coverFile.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-700 truncate">{coverFile.name}</p>
                          <p className="text-xs text-slate-400">{formatFileSize(coverFile.size)}</p>
                        </div>
                        <button onClick={() => { setCoverFile(null); setCoverPreview(null); resetStegoResult(); if (coverInputRef.current) coverInputRef.current.value = ''; }} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {coverPreview && renderPreview(coverPreview)}
                    </div>
                  )}
                </section>
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">{noCoverMode ? '1' : '2'}</div>
                      <h3 className="text-sm font-bold text-slate-700">
                        File Rahasia
                        {secretFiles.length > 0 && <span className="text-slate-400 font-normal ml-1">({secretFiles.length})</span>}
                      </h3>
                    </div>
                    <input ref={secretInputRef} type="file" multiple className="hidden" onChange={handleSecretFilesSelect} />
                    {secretFiles.length > 0 && (
                      <button onClick={() => secretInputRef.current?.click()} className="flex items-center gap-1 text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-all cursor-pointer">
                        <Plus className="w-3.5 h-3.5" />Tambah
                      </button>
                    )}
                  </div>
                  {secretFiles.length === 0 ? (
                    <button onClick={() => secretInputRef.current?.click()} className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center gap-3 hover:border-orange-300 hover:bg-orange-50/30 transition-all group cursor-pointer">
                      <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                        <Plus className="w-5 h-5 text-slate-400 group-hover:text-orange-500 transition-colors" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-700">Tambahkan file rahasia</p>
                        <p className="text-xs text-slate-400 mt-0.5">Bisa lebih dari satu file</p>
                      </div>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      {secretFiles.map((file, index) => {
                        const hasPreviewable = getFileCategory(file.type, file.name) !== 'other' && secretPreviews[index];
                        const isOpen = openedEmbedPreviews.has(index);
                        const isCommentOpen = openedEmbedComments.has(index);
                        const comment = embedComments[index] || '';
                        const isEditingName = editingEmbedFileNames.has(index);
                        const displayName = getEmbedFileName(index);
                        return (
                          <div key={index} className="rounded-xl overflow-hidden border border-slate-100 file-item">
                            <div className="flex items-center gap-3 p-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getFileIconColor(file.type, file.name)}`}>
                                {getFileIconEl(file.type, file.name)}
                              </div>
                              <div className="min-w-0 flex-1">
                                {isEditingName ? (
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={embedFileNames[index] ?? file.name} onChange={(e) => { setEmbedFileNames((prev) => ({ ...prev, [index]: e.target.value })); resetStegoResult(); }} className="flex-1 min-w-0 bg-white border border-orange-300 rounded-lg px-2.5 py-1 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-orange-100 outline-none transition-all" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') toggleEditEmbedFileName(index); }} />
                                    <button onClick={() => toggleEditEmbedFileName(index)} className="p-1.5 rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition-all cursor-pointer shrink-0"><Check className="w-3.5 h-3.5" /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 group/name">
                                    <p className="text-sm font-medium text-slate-700 truncate">{displayName}</p>
                                    <button onClick={() => toggleEditEmbedFileName(index)} className="p-1 rounded-md opacity-0 group-hover/name:opacity-100 hover:bg-orange-50 text-slate-400 hover:text-orange-500 transition-all cursor-pointer shrink-0" title="Ubah nama file"><Edit3 className="w-3 h-3" /></button>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                                  {comment && <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md"><MessageSquare className="w-2.5 h-2.5" />Komentar</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => toggleEmbedComment(index)} className={`p-1.5 rounded-lg transition-all cursor-pointer ${isCommentOpen ? 'bg-amber-50 text-amber-500' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'}`} title={isCommentOpen ? 'Tutup komentar' : 'Tambah komentar'}><MessageSquarePlus className="w-4 h-4" /></button>
                                {hasPreviewable && <button onClick={() => openEmbedPreview(index)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer" title={isOpen ? 'Tutup preview' : 'Lihat preview'}>{isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>}
                                <button onClick={() => removeSecretFile(index)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer"><X className="w-4 h-4" /></button>
                              </div>
                            </div>
                            {isCommentOpen && (
                              <div className="px-3 pb-3 animate-slideDown">
                                <div className="relative">
                                  <MessageSquare className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-400" />
                                  <textarea value={comment} onChange={(e) => { const newVal = e.target.value; setEmbedComments((prev) => ({ ...prev, [index]: newVal })); logEmbedCommentChange(index, getEmbedFileName(index), newVal); resetStegoResult(); }} placeholder="Tambahkan komentar untuk file ini..." rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-700 placeholder-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition-all resize-none outline-none" />
                                </div>
                              </div>
                            )}
                            {isOpen && secretPreviews[index] && <div className="px-3 pb-3 animate-slideDown">{renderPreview(secretPreviews[index])}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Step 3: Metode Enkripsi */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">{noCoverMode ? '2' : '3'}</div>
                      <h3 className="text-sm font-bold text-slate-700">Metode Enkripsi</h3>
                    </div>
                    {embedMethod && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide ${
                        embedMethod === 'aes' ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'
                      }`}>
                        {embedMethod === 'aes' ? 'AES-256 + Argon2' : 'XOR'}
                      </span>
                    )}
                  </div>
                  {renderEncryptionMethodSelector(
                    embedMethod,
                    (m) => { setEmbedMethod(m); resetStegoResult(); if (m !== 'aes') { setEmbedKeyType('password'); setGeneratedKey(''); setGeneratedKeyUrl(''); } },
                    false
                  )}
                </section>

                {/* Step 4: Password & Keamanan */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover overflow-visible">
                  {/* Header with slider toggle */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">{noCoverMode ? '3' : '4'}</div>
                      <h3 className="text-sm font-bold text-slate-700">Password & Keamanan</h3>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wide">Opsional</span>
                    </div>
                    {/* Slider toggle */}
                    <button
                      type="button"
                      onClick={() => {
                        const next = !useEmbedPassword;
                        setUseEmbedPassword(next);
                        if (!next) {
                          setEmbedPassword('');
                          setEmbedKeyType('password');
                          setGeneratedKey('');
                          setGeneratedKeyUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return ''; });
                          setEmbedFaceDescriptor(null);
                          resetStegoResult();
                        }
                      }}
                      className="relative cursor-pointer shrink-0"
                      title={useEmbedPassword ? 'Matikan enkripsi' : 'Aktifkan enkripsi'}
                    >
                      <div className={`w-11 h-6 rounded-full transition-colors duration-200 ${useEmbedPassword ? 'bg-orange-500' : 'bg-slate-200'}`} />
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${useEmbedPassword ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Konten — hanya tampil saat toggle ON */}
                  {useEmbedPassword && (
                    <div className="space-y-3 overflow-visible pb-1">

                      {/* Key type toggle - hanya untuk Mode Pro / AES */}
                      {embedMethod === 'aes' && (
                        <div className={usePartitions ? 'opacity-40 pointer-events-none select-none' : ''}>
                          <label className="text-xs font-semibold text-slate-500 mb-2 block">
                            Jenis Kunci Enkripsi
                            {usePartitions && <span className="ml-2 text-[10px] text-slate-400 normal-case">(diatur per partisi)</span>}
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <div className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left
                              ${embedKeyType === 'password' ? 'border-orange-400 bg-orange-50/60' : 'border-slate-200 bg-white'}`}>
                              {embedKeyType === 'password' && <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-orange-400 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>}
                              <Lock className={`w-4 h-4 shrink-0 ${embedKeyType === 'password' ? 'text-orange-500' : 'text-slate-400'}`} />
                              <div>
                                <p className={`text-xs font-bold ${embedKeyType === 'password' ? 'text-orange-700' : 'text-slate-600'}`}>Password</p>
                                <p className={`text-[10px] ${embedKeyType === 'password' ? 'text-orange-500/80' : 'text-slate-400'}`}>Ketik manual</p>
                              </div>
                            </div>
                            <div className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left
                              ${embedKeyType === 'generate' ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 bg-white'}`}>
                              {embedKeyType === 'generate' && <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-400 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>}
                              <KeyRound className={`w-4 h-4 shrink-0 ${embedKeyType === 'generate' ? 'text-violet-500' : 'text-slate-400'}`} />
                              <div>
                                <p className={`text-xs font-bold ${embedKeyType === 'generate' ? 'text-violet-700' : 'text-slate-600'}`}>Buat Key</p>
                                <p className={`text-[10px] ${embedKeyType === 'generate' ? 'text-violet-500/80' : 'text-slate-400'}`}>Auto-generate</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Manual password input */}
                      {(embedKeyType === 'password' || embedMethod !== 'aes') && (
                        <div className={`relative ${usePartitions ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            type={showEmbedPassword ? 'text' : 'password'}
                            value={usePartitions ? '' : embedPassword}
                            onChange={(e) => !usePartitions && setEmbedPassword(e.target.value)}
                            placeholder={usePartitions ? 'Password diatur per partisi...' : 'Masukkan password...'}
                            readOnly={usePartitions}
                            className="focus-ring w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-orange-300 transition-all"
                          />
                          {!usePartitions && (
                            <button onClick={() => setShowEmbedPassword(!showEmbedPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer">
                              {showEmbedPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Password strength */}
                      {(embedKeyType === 'password' || embedMethod !== 'aes') && !usePartitions && <PasswordStrengthIndicator password={embedPassword} />}

                      {/* Generate Key UI */}
                      {embedMethod === 'aes' && embedKeyType === 'generate' && (
                        <div>
                          {!generatedKey ? (
                            <button
                              type="button"
                              onClick={generateRandomKey}
                              className="w-full flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer shadow-md shadow-violet-200"
                            >
                              <RefreshCw className="w-4 h-4" />
                              Generate Key
                            </button>
                          ) : (
                            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-violet-700 flex items-center gap-1.5">
                                  <CheckCircle className="w-3.5 h-3.5" />Key siap digunakan!
                                </span>
                                <button type="button" onClick={generateRandomKey} className="text-[11px] text-violet-500 hover:text-violet-700 font-semibold flex items-center gap-1 cursor-pointer">
                                  <RefreshCw className="w-3 h-3" />Generate ulang
                                </button>
                              </div>
                              <div className="flex items-start gap-2 px-2.5 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-[10px] text-amber-700 leading-snug font-medium">
                                  File <strong>key.sty</strong> bisa diunduh di kolom hasil setelah enkripsi selesai.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}



                      {/* ── Face Lock (hanya Mode Pro / AES) ── */}
                      {embedMethod === 'aes' && (embedPassword || (embedKeyType === 'generate' && generatedKey)) && (
                        <div className="overflow-visible">
                          <div className="flex items-center gap-1.5 mb-2">
                            <ScanFace className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-xs font-semibold text-slate-600">Keamanan Ganda</span>
                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md">OPSIONAL</span>
                          </div>

                          {!embedFaceDescriptor ? (
                            <div className="rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-4 flex flex-col items-center gap-3">
                              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                                <ScanFace className="w-6 h-6 text-emerald-500" />
                              </div>
                              <p className="text-xs font-semibold text-slate-600">Aktifkan Face Lock</p>
                              <button
                                type="button"
                                onClick={() => { setFaceScanMode('enroll'); setShowFaceScanner(true); }}
                                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98] cursor-pointer shadow-sm shadow-emerald-200"
                              >
                                <Camera className="w-3.5 h-3.5" />
                                Scan Wajah Sekarang
                              </button>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                                <CheckCircle className="w-5 h-5 text-emerald-500" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-emerald-700">Face Lock Aktif ✓</p>
                                <p className="text-[11px] text-emerald-600/80 mt-0.5">128 vektor fitur wajah siap dienkripsi</p>
                              </div>
                              <button type="button" onClick={() => setEmbedFaceDescriptor(null)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer shrink-0" title="Hapus face lock">
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => { setFaceScanMode('enroll'); setShowFaceScanner(true); }} className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-500 transition-all cursor-pointer shrink-0" title="Scan ulang">
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hint saat toggle OFF */}
                  {!useEmbedPassword && (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Aktifkan untuk mengenkripsi file dengan password atau key
                    </p>
                  )}
                </section>

                {/* ── Partisi Password (Mode Pro / AES only) ── */}
                {embedMethod === 'aes' && useEmbedPassword && secretFiles.length > 0 && (
                  <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 card-hover animate-fadeUp">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-700">Partisi Password</h3>
                          <p className="text-[10px] text-slate-400">Enkripsi file ke partisi berbeda dengan password berbeda</p>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">MODE PRO</span>
                      </div>
                      {/* Toggle partisi */}
                      <button
                        type="button"
                        onClick={() => {
                          const next = !usePartitions;
                          setUsePartitions(next);
                          if (!next) resetPartitions();
                        }}
                        className="relative cursor-pointer shrink-0"
                      >
                        <div className={`w-11 h-6 rounded-full transition-colors duration-200 ${usePartitions ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${usePartitions ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    {!usePartitions ? (
                      <div className="flex items-start gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Layers className="w-4 h-4 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-500">Partisi nonaktif</p>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">Aktifkan untuk memisahkan file ke beberapa partisi dengan password berbeda. Password A buka Partisi A, Password B buka Partisi B, dst.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Warning: password di step 4 diabaikan */}
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-amber-700 leading-snug font-medium">
                            Mode Partisi aktif — password di atas diabaikan. Setiap partisi punya passwordnya sendiri di bawah.
                          </p>
                        </div>

                        {/* Daftar partisi */}
                        <div className="space-y-3">
                          {partitions.map((partition, pIdx) => {
                            const pc = PARTITION_COLORS[pIdx % PARTITION_COLORS.length];
                            return (
                              <div key={partition.id} className={`rounded-xl border-2 ${pc.border} ${pc.bg} p-3 space-y-2.5`}>
                                {/* Header partisi */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full ${pc.dot} flex items-center justify-center`}>
                                      <span className="text-[9px] font-bold text-white">{pIdx + 1}</span>
                                    </div>
                                    <span className={`text-sm font-bold ${pc.label}`}>{partition.label}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${pc.badge}`}>
                                      {partition.fileIndexes.length} file
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removePartition(partition.id)}
                                    className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Password partisi */}
                                <div className="relative">
                                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                  <input
                                    type={partition.showPassword ? 'text' : 'password'}
                                    value={partition.password}
                                    onChange={(e) => updatePartitionPassword(partition.id, e.target.value)}
                                    placeholder={`Password ${partition.label}...`}
                                    className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-9 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent transition-all"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => togglePartitionShowPassword(partition.id)}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 text-slate-400 cursor-pointer"
                                  >
                                    {partition.showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </div>

                                {/* File assignment */}
                                <div>
                                  <p className="text-[10px] font-semibold text-slate-500 mb-1.5">Assign file ke partisi ini:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {secretFiles.map((file, fileIdx) => {
                                      const inThis = partition.fileIndexes.includes(fileIdx);
                                      const inOther = !inThis && !!getFilePartition(fileIdx);
                                      const displayName = embedFileNames[fileIdx] ?? file.name;
                                      return (
                                        <button
                                          key={fileIdx}
                                          type="button"
                                          onClick={() => !inOther && toggleFileInPartition(partition.id, fileIdx)}
                                          disabled={inOther}
                                          title={inOther ? `Sudah di partisi lain` : displayName}
                                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all cursor-pointer max-w-[120px]
                                            ${inThis ? `${pc.badge} border-current` : inOther ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'}`}
                                        >
                                          {inThis && <Check className="w-2.5 h-2.5 shrink-0" />}
                                          <span className="truncate">{displayName.length > 12 ? displayName.slice(0, 12) + '…' : displayName}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Tambah partisi */}
                        {partitions.length < 5 && (
                          <button
                            type="button"
                            onClick={addPartition}
                            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-emerald-200 rounded-xl py-2.5 text-xs font-bold text-emerald-600 hover:border-emerald-400 hover:bg-emerald-50/50 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Tambah Partisi {['B','C','D','E'][partitions.length - 1] ?? 'A'}
                          </button>
                        )}
                        {partitions.length === 0 && (
                          <button
                            type="button"
                            onClick={addPartition}
                            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-emerald-200 rounded-xl py-3 text-xs font-bold text-emerald-600 hover:border-emerald-400 hover:bg-emerald-50/50 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Buat Partisi Pertama
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {/* Embed Button */}
                <button
                  onClick={handleEmbed}
                  disabled={embedding || (!noCoverMode && !coverFile) || secretFiles.length === 0}
                  className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3.5 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                >
                  {embedding ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {(embedPassword || generatedKey) && embedMethod === 'aes'
                        ? 'Mengenkripsi dengan AES-256 + Argon2...'
                        : noCoverMode ? 'Mengenkripsi...' : 'Menyembunyikan...'}
                    </>
                  ) : (
                    <><LockKeyhole className="w-4 h-4" />{noCoverMode ? 'Enkripsi ke .enc' : 'Sembunyikan File'}</>
                  )}
                </button>
              </div>

              {/* Right column: result */}
              <div className="lg:col-span-1">
                {stegoResult ? (
                  <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 animate-fadeUp sticky top-20">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-emerald-700">Berhasil!</h3>
                        <p className="text-xs text-emerald-500">File siap diunduh</p>
                      </div>
                    </div>
                    {stegoPreview && renderPreview(stegoPreview, true)}
                    <div className="bg-slate-50 rounded-xl p-3 mt-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500 shrink-0">
                          <Package className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {editingStegoName ? (
                            <div className="flex items-center gap-1.5">
                              <input type="text" value={stegoOutputName} onChange={(e) => setStegoOutputName(e.target.value)} className="flex-1 min-w-0 bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-emerald-100 outline-none transition-all" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') setEditingStegoName(false); }} />
                              <button onClick={() => setEditingStegoName(false)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-all cursor-pointer shrink-0"><Check className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <p className="text-sm font-semibold text-slate-700 truncate">{stegoOutputName}</p>
                              <button onClick={() => setEditingStegoName(true)} className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-emerald-100 text-slate-400 hover:text-emerald-600 transition-all cursor-pointer shrink-0" title="Ubah nama file"><Edit3 className="w-3 h-3" /></button>
                            </div>
                          )}
                          {stegoPreview && <p className="text-xs text-slate-400 mt-0.5">{formatFileSize(stegoPreview.size)}</p>}
                        </div>
                      </div>
                    </div>
                    {/* Compression stats */}
                    {embedCompressionStats && (
                      <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                          <span className="text-[11px] font-bold text-teal-700 uppercase tracking-wide">Kompresi File</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="flex justify-between text-[10px] text-teal-600 mb-1">
                              <span>{formatFileSize(embedCompressionStats.compressedSize)}</span>
                              <span>{formatFileSize(embedCompressionStats.originalSize)}</span>
                            </div>
                            <div className="h-1.5 bg-teal-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-teal-400 rounded-full transition-all duration-700"
                                style={{ width: `${100 - embedCompressionStats.savedPercent}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] text-teal-500 mt-1">
                              <span>Terkompresi</span>
                              <span>Asli</span>
                            </div>
                          </div>
                          <div className="text-center shrink-0">
                            <p className="text-lg font-black text-teal-600">{embedCompressionStats.savedPercent}%</p>
                            <p className="text-[10px] text-teal-500 font-semibold leading-tight">lebih<br/>kecil</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Password cleared notice */}
                    <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                      <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="text-[11px] font-semibold text-blue-700">Password telah dihapus dari memori</span>
                    </div>
                    {/* Download key.sty — muncul jika enkripsi pakai generate key */}
                    {embedKeyType === 'generate' && generatedKeyUrl && (
                      <div className="mt-3 animate-fadeIn">
                        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl mb-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-[10px] text-amber-700 font-medium leading-snug">
                            Unduh <strong>key.sty</strong> sekarang! Tanpa file ini kamu tidak bisa membuka file nantinya.
                          </p>
                        </div>
                        <a
                          href={generatedKeyUrl}
                          download="key.sty"
                          className="w-full flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white py-2.5 rounded-xl text-sm font-bold transition-colors active:scale-[0.98]"
                        >
                          <KeyRound className="w-4 h-4" />Unduh key.sty
                        </a>
                      </div>
                    )}
                    <a href={stegoResult.url} download={stegoOutputName || `stego_file.${stegoResult.extension}`} className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold transition-colors active:scale-[0.98]">
                      <Download className="w-4 h-4" />Unduh File
                    </a>
                  </section>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center justify-center text-center min-h-[280px] sticky top-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                      <Package className="w-7 h-7 text-slate-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-400">Hasil akan muncul di sini</p>
                    <p className="text-xs text-slate-300 mt-1">Pilih file dan klik Sembunyikan</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ DECRYPT TAB ============ */}
        {activeTab === 'decrypt' && (
          <div className="animate-fadeUp">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">Dekripsi File</h2>
              <p className="text-sm text-slate-500 mt-1">Ekstrak file tersembunyi dari file stego Anda.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-1 space-y-5">

                {/* Step 1: File Stego */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center text-xs font-bold">1</div>
                    <h3 className="text-sm font-bold text-slate-700">File Stego</h3>
                  </div>
                  <input ref={stegoInputRef} type="file" className="hidden" onChange={handleStegoSelect} />
                  {!stegoFile ? (
                    <button onClick={() => stegoInputRef.current?.click()} className="w-full border-2 border-dashed border-slate-200 rounded-xl py-10 flex flex-col items-center gap-3 hover:border-violet-300 hover:bg-violet-50/30 transition-all group cursor-pointer">
                      <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors">
                        <Upload className="w-6 h-6 text-slate-400 group-hover:text-violet-500 transition-colors" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-700">Pilih file stego</p>
                        <p className="text-xs text-slate-400 mt-1">File yang berisi data tersembunyi</p>
                      </div>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getFileIconColor(stegoFile.type, stegoFile.name)}`}>
                          {getFileIconEl(stegoFile.type, stegoFile.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-700 truncate">{stegoFile.name}</p>
                          <p className="text-xs text-slate-400">{formatFileSize(stegoFile.size)}</p>
                        </div>
                        <button onClick={clearStegoState} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {stegoFilePreview && renderPreview(stegoFilePreview, true)}
                      {stegoDetected && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl animate-fadeIn">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="text-xs font-semibold text-emerald-700">Data tersembunyi terdeteksi</span>
                          </div>
                          {detectedMethod && (
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border animate-fadeIn ${
                              detectedMethod === 'aes' ? 'bg-emerald-50/50 border-emerald-200' : 'bg-amber-50/50 border-amber-200'
                            }`}>
                              {detectedMethod === 'aes' ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                              <span className={`text-xs font-semibold ${detectedMethod === 'aes' ? 'text-emerald-700' : 'text-amber-700'}`}>
                                Enkripsi: {detectedMethod === 'aes' ? 'AES-256 + Argon2' : 'XOR'}
                              </span>
                            </div>
                          )}
                          {stegoHasFace && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/50 border-violet-200 animate-fadeIn">
                              <ScanFace className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                              <span className="text-xs font-semibold text-violet-700">
                                Face Lock Aktif
                              </span>
                              {faceVerified && <CheckCircle className="w-3 h-3 text-emerald-500 ml-auto shrink-0" />}
                            </div>
                          )}
                          {!detectedMethod && !needsPassword && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl animate-fadeIn">
                              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="text-xs font-semibold text-slate-500">Tanpa enkripsi</span>
                            </div>
                          )}
                          {isPartitionBundle && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-emerald-50/60 border-emerald-200 animate-fadeIn">
                              <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="text-xs font-semibold text-emerald-700">
                                {partitionBundleLabels.length} Partisi Terenkripsi
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* Step 2: Password + Encryption Method */}
                {stegoFile && needsPassword && !decryptionDone && !isPartitionBundle && (
                  <section className="bg-white rounded-2xl border border-slate-200 p-5 animate-fadeUp card-hover">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center text-xs font-bold">2</div>
                        <h3 className="text-sm font-bold text-slate-700">
                          {decryptKeyType === 'keyfile' ? 'File Key' : 'Password & Keamanan'}
                        </h3>
                      </div>
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wide">Diperlukan</span>
                    </div>

                    {/* Key type toggle — tampil untuk semua file berpassword, bukan hanya AES */}
                    {needsPassword && (
                      <div className="mb-3 animate-fadeIn">
                        <label className="text-xs font-semibold text-slate-500 mb-2 block">Metode Input Kunci</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => { setDecryptKeyType('password'); setDecryptPassword(''); }}
                            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all cursor-pointer
                              ${decryptKeyType === 'password' ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                          >
                            {decryptKeyType === 'password' && <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-400 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>}
                            <Lock className={`w-4 h-4 shrink-0 ${decryptKeyType === 'password' ? 'text-violet-500' : 'text-slate-400'}`} />
                            <div>
                              <p className={`text-xs font-bold ${decryptKeyType === 'password' ? 'text-violet-700' : 'text-slate-600'}`}>Password</p>
                              <p className={`text-[10px] ${decryptKeyType === 'password' ? 'text-violet-500/80' : 'text-slate-400'}`}>Ketik manual</p>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDecryptKeyType('keyfile'); setDecryptPassword(''); }}
                            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all cursor-pointer
                              ${decryptKeyType === 'keyfile' ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                          >
                            {decryptKeyType === 'keyfile' && <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>}
                            <KeyRound className={`w-4 h-4 shrink-0 ${decryptKeyType === 'keyfile' ? 'text-emerald-500' : 'text-slate-400'}`} />
                            <div>
                              <p className={`text-xs font-bold ${decryptKeyType === 'keyfile' ? 'text-emerald-700' : 'text-slate-600'}`}>File Key</p>
                              <p className={`text-[10px] ${decryptKeyType === 'keyfile' ? 'text-emerald-500/80' : 'text-slate-400'}`}>Upload key.sty</p>
                            </div>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Password input — hidden saat keyfile mode */}
                    {decryptKeyType === 'password' && (
                      <div className="relative animate-slideDown">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type={showDecryptPassword ? 'text' : 'password'}
                          value={decryptPassword}
                          onChange={(e) => setDecryptPassword(e.target.value)}
                          placeholder="Masukkan password..."
                          className="focus-ring-accent w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-violet-300 transition-all"
                        />
                        <button onClick={() => setShowDecryptPassword(!showDecryptPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer">
                          {showDecryptPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    )}

                    {/* Key file upload — untuk semua tipe enkripsi */}
                    {decryptKeyType === 'keyfile' && (
                      <div className="animate-slideDown">
                        <input ref={keyFileInputRef} type="file" accept=".sty,.txt" className="hidden" onChange={handleKeyFileUpload} />
                        {!decryptPassword ? (
                          <button
                            type="button"
                            onClick={() => keyFileInputRef.current?.click()}
                            className="w-full border-2 border-dashed border-emerald-200 rounded-xl py-5 flex flex-col items-center gap-2 hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                              <KeyRound className="w-5 h-5 text-emerald-400 group-hover:text-emerald-600" />
                            </div>
                            <div className="text-center">
                              <p className="text-xs font-semibold text-slate-500 group-hover:text-slate-700">Klik untuk upload file key.sty</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">File key yang di-download saat enkripsi</p>
                            </div>
                          </button>
                        ) : (
                          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                              <CheckCircle className="w-4.5 h-4.5 text-emerald-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-emerald-700">Key berhasil dimuat ✓</p>
                              <p className="text-[10px] text-emerald-600/80 mt-0.5">Siap digunakan untuk dekripsi</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setDecryptPassword(''); if (keyFileInputRef.current) keyFileInputRef.current.value = ''; }}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer shrink-0"
                              title="Hapus key"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Face verification (if stego has face lock) */}
                    {stegoHasFace && (
                      <div className="mt-4 animate-slideDown">
                        <div className="flex items-center gap-1.5 mb-2">
                          <ScanFace className="w-3.5 h-3.5 text-violet-500" />
                          <span className="text-xs font-semibold text-slate-600">Verifikasi Keamanan Ganda</span>
                          <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-md">Diperlukan</span>
                        </div>
                        {!faceVerified ? (
                          <div className="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 p-4 flex flex-col items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center">
                              <ScanFace className="w-6 h-6 text-violet-500" />
                            </div>
                            <div className="text-center">
                              <p className="text-xs font-semibold text-slate-600">Face Lock Aktif</p>
                              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug"></p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFaceScanMode('verify');
                                setShowFaceScanner(true);
                              }}
                              className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98] cursor-pointer shadow-sm shadow-violet-200"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              Verifikasi Wajah
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                              <CheckCircle className="w-4.5 h-4.5 text-emerald-500" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-bold text-emerald-700">Wajah Terverifikasi ✓</p>
                              <p className="text-[11px] text-emerald-600/80">Identitas cocok</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setFaceVerified(false); setStoredFaceDescriptor(null); }}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer shrink-0"
                              title="Verifikasi ulang"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Detected encryption method (read-only display) */}
                    {detectedMethod && (
                      <div className="mt-4">
                        <label className="text-xs font-semibold text-slate-500 mb-2.5 block">Jenis Keamanan Terdeteksi</label>
                        {renderEncryptionMethodSelector(detectedMethod, () => {}, true)}
                      </div>
                    )}
                  </section>
                )}

                {/* Decrypt button */}
                {stegoFile && stegoDetected && !decryptionDone && !isPartitionBundle && (
                  <button
                    onClick={handleDecrypt}
                    disabled={decrypting || (needsPassword && !decryptPassword) || (stegoHasFace && !faceVerified)}
                    className="w-full bg-gradient-to-r from-violet-500 to-purple-500 text-white py-3.5 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                  >
                    {decrypting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {detectedMethod === 'aes' ? 'Mendekripsi AES-256 + Argon2...' : 'Mendekripsi...'}
                      </>
                    ) : stegoHasFace && !faceVerified ? (
                      <><ScanFace className="w-4 h-4" />Verifikasi Wajah Dulu</>
                    ) : (
                      <><Unlock className="w-4 h-4" />Dekripsi</>
                    )}
                  </button>
                )}

                {/* ── Partition Decrypt UI ── */}
                {stegoFile && isPartitionBundle && (
                  <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 animate-fadeUp card-hover">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <Layers className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-700">Dekripsi Partisi</h3>
                        <p className="text-[10px] text-slate-400">File ini memiliki {partitionBundleLabels.length} partisi — masukkan password untuk membuka partisi yang sesuai</p>
                      </div>
                      <span className="ml-auto text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 shrink-0">MODE PRO</span>
                    </div>

                    {/* Partisi labels info */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {partitionBundleLabels.map((label, idx) => {
                        const pc = PARTITION_COLORS[idx % PARTITION_COLORS.length];
                        return (
                          <span key={label} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${pc.badge}`}>
                            <div className={`w-2 h-2 rounded-full ${pc.dot}`} />
                            {label}
                          </span>
                        );
                      })}
                    </div>

                    {/* Single password input */}
                    <div className="space-y-3">
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type={showPartitionDecryptPassword ? 'text' : 'password'}
                          value={partitionDecryptPassword}
                          onChange={(e) => setPartitionDecryptPassword(e.target.value)}
                          placeholder="Masukkan password partisi..."
                          onKeyDown={(e) => { if (e.key === 'Enter') handlePartitionDecrypt(); }}
                          className="focus-ring-accent w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-emerald-300 transition-all"
                        />
                        <button onClick={() => setShowPartitionDecryptPassword(!showPartitionDecryptPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer">
                          {showPartitionDecryptPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <button
                        onClick={handlePartitionDecrypt}
                        disabled={decrypting || !partitionDecryptPassword.trim()}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-3 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                      >
                        {decrypting ? (
                          <><Loader2 className="w-4 h-4 animate-spin" />Mencari partisi yang cocok...</>
                        ) : (
                          <><Unlock className="w-4 h-4" />Buka Partisi</>
                        )}
                      </button>

                      {/* Hint */}
                      <p className="text-[11px] text-slate-400 text-center">
                        Password akan otomatis dicocokkan ke partisi yang sesuai
                      </p>
                    </div>

                    {/* Already opened partitions */}
                    {decryptionDone && decryptedFiles.length > 0 && (
                      <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl animate-fadeIn">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-emerald-700">{decryptedFiles.length} file berhasil dibuka. Masukkan password lain untuk buka partisi berikutnya.</span>
                      </div>
                    )}
                  </section>
                )}

                {/* Password/Key cleared notice after decryption */}
                {decryptionDone && decryptKeyType === 'password' && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl animate-fadeIn">
                    <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span className="text-[11px] font-semibold text-blue-700">Password dekripsi telah dihapus dari memori</span>
                  </div>
                )}

                {/* Update password section - shown after decryption */}
                {decryptionDone && (
                  <section className="bg-white rounded-2xl border border-slate-200 p-5 animate-fadeUp card-hover">
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center">
                        <KeyRound className="w-3.5 h-3.5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-700">Ubah Password & Keamanan</h3>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wide">Opsional</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">Ubah password, metode enkripsi, lalu unduh file cover yang diperbarui.</p>

                    {/* New password */}
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          setPasswordChanged(e.target.value !== originalDecryptPassword || decryptMethod !== (detectedMethod || 'xor'));
                        }}
                        placeholder="Password baru..."
                        className="focus-ring w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-amber-300 transition-all"
                      />
                      <button onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer">
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Password strength indicator for new password */}
                    <PasswordStrengthIndicator password={newPassword} />

                    {/* Method selector for re-embed */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2.5">
                        <label className="text-xs font-semibold text-slate-500">Jenis Keamanan</label>
                        {!newPassword && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            Isi password untuk memilih
                          </span>
                        )}
                      </div>
                      {renderEncryptionMethodSelector(
                        decryptMethod,
                        (m) => {
                          setDecryptMethod(m);
                          setPasswordChanged(newPassword !== originalDecryptPassword || m !== (detectedMethod || 'xor'));
                        },
                        !newPassword
                      )}
                    </div>



                    {hasAnyChanges && (
                      <button
                        onClick={handleUpdateAndDownload}
                        disabled={updating}
                        className="mt-4 w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer animate-fadeIn"
                      >
                        {updating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {newPassword && decryptMethod === 'aes'
                              ? 'Mengenkripsi ulang dengan AES-256 + Argon2...'
                              : 'Memperbarui...'}
                          </>
                        ) : (
                          <><RefreshCw className="w-4 h-4" />Perbarui & Unduh Cover</>
                        )}
                      </button>
                    )}
                  </section>
                )}
              </div>

              {/* Right column: results */}
              <div className="lg:col-span-2">
                {decryptedFiles.length > 0 ? (
                  <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 animate-fadeUp">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-emerald-700">Hasil Dekripsi</h3>
                          <p className="text-xs text-emerald-500">{decryptedFiles.length} file ditemukan</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input ref={addFileInputRef} type="file" multiple className="hidden" onChange={handleAddFileToDecrypted} />
                        {decryptionDone && (
                          <button
                            onClick={() => setShowLogPopup(true)}
                            className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-500 hover:text-amber-600 transition-all cursor-pointer shrink-0"
                            title="Lihat log aktivitas"
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={toggleAllDecryptPreviews} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all cursor-pointer ${allDecryptPreviewsOpen ? 'text-violet-600 bg-violet-100 hover:bg-violet-200' : 'text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100'}`} title={allDecryptPreviewsOpen ? 'Tutup semua preview' : 'Buka semua preview'}>
                          {allDecryptPreviewsOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">{allDecryptPreviewsOpen ? '' : ''}</span>
                        </button>
                        <button onClick={() => addFileInputRef.current?.click()} className="flex items-center gap-1.5 text-xs font-semibold text-violet-500 hover:text-violet-600 bg-violet-50 hover:bg-violet-100 px-3 py-2 rounded-lg transition-all cursor-pointer">
                          <Plus className="w-3.5 h-3.5" />Tambah File
                        </button>
                      </div>
                    </div>

                    {/* Category filter */}
                    <div className="mb-3">
                      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                        {FILTER_CATEGORIES.map(({ key, label, icon }) => {
                          const count = categoryCounts[key];
                          const isActive = filterCategory === key;
                          if (key !== 'all' && count === 0) return null;
                          return (
                            <button key={key} onClick={() => setFilterCategory(key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 ${isActive ? 'bg-violet-100 text-violet-700 shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                              {icon}<span>{label}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${isActive ? 'bg-violet-200 text-violet-800' : 'bg-slate-200 text-slate-500'}`}>{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Decompression stats */}
                    {decryptCompressionStats && decryptCompressionStats.savedPercent > 0 && (
                      <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Zap className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-teal-700">Kompresi menghemat ruang penyimpanan</p>
                              <p className="text-[10px] text-teal-500 mt-0.5">
                                {formatFileSize(decryptCompressionStats.compressedSize)} disimpan → {formatFileSize(decryptCompressionStats.decompressedSize)} setelah dekompresi
                              </p>
                            </div>
                          </div>
                          <div className="text-center shrink-0 bg-white rounded-lg px-3 py-1.5 border border-teal-200">
                            <p className="text-lg font-black text-teal-600">{decryptCompressionStats.savedPercent}%</p>
                            <p className="text-[10px] text-teal-500 font-semibold">dihemat</p>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 bg-teal-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-400 rounded-full"
                            style={{ width: `${100 - decryptCompressionStats.savedPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Search */}
                    <div className="mb-4">
                      <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama file..." className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition-all outline-none" />
                        {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                      {(filterCategory !== 'all' || searchQuery) && (
                        <div className="flex items-center justify-between mt-2">
                          <p className="text-xs text-slate-400">Menampilkan <span className="font-semibold text-slate-600">{filteredDecryptedFiles.length}</span> dari {decryptedFiles.length} file</p>
                          <button onClick={() => { setFilterCategory('all'); setSearchQuery(''); }} className="text-[11px] font-semibold text-violet-500 hover:text-violet-600 cursor-pointer">Reset Filter</button>
                        </div>
                      )}
                    </div>

                    {/* File list */}
                    <div className="space-y-3">
                      {filteredDecryptedFiles.length === 0 ? (
                        <div className="py-8 flex flex-col items-center justify-center text-center">
                          <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mb-3"><Search className="w-5 h-5 text-slate-300" /></div>
                          <p className="text-sm font-semibold text-slate-400">Tidak ada file ditemukan</p>
                          <p className="text-xs text-slate-300 mt-1">Coba ubah filter atau kata kunci pencarian</p>
                        </div>
                      ) : (
                        filteredDecryptedFiles.map((file) => {
                          const cat = getFileCategory(file.type, file.name);
                          const hasMediaPreview = cat !== 'other' && filePreviews[file.id];
                          const hasComment = !!(file.comment);
                          const isOpen = openedDecryptPreviews.has(file.id);
                          const isEditing = editingComments.has(file.id);
                          const isEditingName = editingFileNames.has(file.id);
                          return (
                            <div key={file.id} className="rounded-xl overflow-hidden border border-slate-100 file-item">
                              <div className="flex items-center gap-3 p-3">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getFileIconColor(file.type, file.name)}`}>
                                  {getFileIconEl(file.type, file.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  {isEditingName ? (
                                    <div className="flex items-center gap-1.5">
                                      <input type="text" value={file.name} onChange={(e) => updateDecryptedFileName(file.id, e.target.value)} className="flex-1 min-w-0 bg-white border border-violet-300 rounded-lg px-2.5 py-1 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-violet-100 outline-none transition-all" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') toggleEditFileName(file.id); }} />
                                      <button onClick={() => toggleEditFileName(file.id)} className="p-1.5 rounded-lg bg-violet-100 text-violet-600 hover:bg-violet-200 transition-all cursor-pointer shrink-0"><Check className="w-3.5 h-3.5" /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 group/name">
                                      <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                                      <button onClick={() => toggleEditFileName(file.id)} className="p-1 rounded-md opacity-0 group-hover/name:opacity-100 hover:bg-violet-50 text-slate-400 hover:text-violet-500 transition-all cursor-pointer shrink-0" title="Ubah nama file"><Edit3 className="w-3 h-3" /></button>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                                    {!isOpen && hasComment && <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md"><MessageSquare className="w-2.5 h-2.5" />Komentar</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button onClick={() => openDecryptPreview(file.id)} className={`p-2 rounded-lg transition-all cursor-pointer ${isOpen ? 'bg-violet-50 text-violet-500' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'}`} title={isOpen ? 'Tutup detail' : 'Lihat detail'}>
                                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                  <button onClick={() => downloadFile(file)} className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 transition-all cursor-pointer" title="Unduh"><Download className="w-4 h-4" /></button>
                                  <button onClick={() => requestRemoveDecryptedFile(file.id, file.name)} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer" title="Hapus"><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </div>
                              {isOpen && (
                                <div className="px-3 pb-3 space-y-3 animate-slideDown">
                                  {hasMediaPreview && renderDecryptPreview(file.id, file.type, file.name)}
                                  <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <MessageSquare className="w-3 h-3 text-amber-500" />
                                        <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">Komentar</span>
                                      </div>
                                      <button onClick={() => toggleEditComment(file.id)} className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-all cursor-pointer ${isEditing ? 'text-amber-700 bg-amber-200 hover:bg-amber-300' : 'text-amber-500 hover:text-amber-600 hover:bg-amber-100'}`}>
                                        {isEditing ? 'Selesai' : 'Edit'}
                                      </button>
                                    </div>
                                    {isEditing ? (
                                      <textarea value={file.comment || ''} onChange={(e) => updateDecryptedFileComment(file.id, e.target.value)} placeholder="Tulis komentar..." rows={2} className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none outline-none" autoFocus />
                                    ) : (
                                      <p className={`text-xs leading-relaxed whitespace-pre-wrap ${file.comment ? 'text-slate-600' : 'text-slate-400 italic'}`}>
                                        {file.comment || 'Tidak ada komentar.'}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Download all */}
                    <div className="mt-5 pt-5 border-t border-slate-100">
                      <button onClick={downloadAllFiles} disabled={downloadingAll} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-md shadow-emerald-200">
                        {downloadingAll ? <><Loader2 className="w-4 h-4 animate-spin" />Mengemas file...</> : <><DownloadCloud className="w-4 h-4" />Unduh Semua ({decryptedFiles.length} file)</>}
                      </button>
                    </div>
                  </section>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center justify-center text-center min-h-[320px]">
                    <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                      <Unlock className="w-7 h-7 text-slate-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-400">Hasil dekripsi akan muncul di sini</p>
                    <p className="text-xs text-slate-300 mt-1">Pilih file stego dan klik Dekripsi</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </main>

      {/* ====== FOOTER ====== */}
      <footer className="border-t border-slate-100 mt-auto bg-white">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col items-center gap-2">
          <a
            href="about.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer"
            title="Dokumentasi & Panduan"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Tentang</span>
          </a>
          <p className="text-xs text-slate-400">&copy; 2026 Steganografi Multi-Media, By Ahmad Sidik.</p>
        </div>
      </footer>
    </div>
    </div>
  );
}
