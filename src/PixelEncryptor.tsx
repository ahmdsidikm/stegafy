import { useState, useRef, useCallback } from 'react';
import {
  Upload, X, Download, Lock, Unlock, Eye, EyeOff,
  AlertCircle, CheckCircle, Loader2, Info, RefreshCw,
  Image as ImageIcon, ShieldCheck, Zap,
} from 'lucide-react';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type PixelMode = 'encrypt' | 'decrypt';

interface ToastMsg {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ──────────────────────────────────────────────
// Pixel Encryption Core
// The algorithm works by XOR-mixing each pixel's
// R, G, B channels with a deterministic key stream
// derived from the password using a seeded PRNG.
// ──────────────────────────────────────────────

/** Simple Mulberry32 PRNG — fast, deterministic, good distribution */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a numeric seed from a password string */
function passwordToSeed(password: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < password.length; i++) {
    hash ^= password.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Encrypt or decrypt image pixels using XOR + key stream derived from password.
 * Since XOR is symmetric, the same function handles both encrypt and decrypt.
 */
async function processPixels(
  imageData: ImageData,
  password: string,
  _mode: PixelMode
): Promise<ImageData> {
  const seed = passwordToSeed(password);
  const rand = mulberry32(seed);

  const data = new Uint8ClampedArray(imageData.data);
  const pixelCount = data.length / 4;

  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    // Generate 3 pseudo-random bytes for R, G, B (skip alpha)
    const kr = Math.floor(rand() * 256);
    const kg = Math.floor(rand() * 256);
    const kb = Math.floor(rand() * 256);

    data[base]     = data[base]     ^ kr;
    data[base + 1] = data[base + 1] ^ kg;
    data[base + 2] = data[base + 2] ^ kb;
    // Alpha channel stays unchanged
  }

  return new ImageData(data, imageData.width, imageData.height);
}

// ──────────────────────────────────────────────
// File reading helper
// ──────────────────────────────────────────────

function readImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar'));
    img.src = URL.createObjectURL(file);
  });
}

// ──────────────────────────────────────────────
// Main exported component
// ──────────────────────────────────────────────

export function PixelEncryptorView() {
  const [mode, setMode] = useState<PixelMode>('encrypt');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: ToastMsg['type']) => {
    const id = Math.random().toString(36).substring(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('File harus berupa gambar (PNG, JPG, BMP, dll)', 'error');
      return;
    }
    setImageFile(file);
    setResultSrc(null);
    setResultName('');
    const url = URL.createObjectURL(file);
    setPreviewSrc(url);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // Simulate change event
    const dt = new DataTransfer();
    dt.items.add(file);
    const fakeEvent = { target: { files: dt.files } } as unknown as React.ChangeEvent<HTMLInputElement>;
    handleFileSelect(fakeEvent);
  };

  const handleProcess = async () => {
    if (!imageFile) return showToast('Pilih gambar terlebih dahulu!', 'error');
    if (!password.trim()) return showToast('Masukkan password enkripsi!', 'error');

    setProcessing(true);
    try {
      const img = await readImageFile(imageFile);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const processed = await processPixels(imageData, password, mode);

      ctx.putImageData(processed, 0, 0);
      const outputUrl = canvas.toDataURL('image/png');
      setResultSrc(outputUrl);

      const baseName = imageFile.name.replace(/\.[^.]+$/, '');
      setResultName(
        mode === 'encrypt'
          ? `${baseName}_encrypted.png`
          : `${baseName}_decrypted.png`
      );

      showToast(
        mode === 'encrypt'
          ? 'Gambar berhasil dienkripsi!'
          : 'Gambar berhasil didekripsi!',
        'success'
      );
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultSrc) return;
    const a = document.createElement('a');
    a.href = resultSrc;
    a.download = resultName || 'pixel_result.png';
    a.click();
  };

  const handleReset = () => {
    setImageFile(null);
    setPreviewSrc(null);
    setResultSrc(null);
    setResultName('');
    setPassword('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="relative">
      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 w-[min(92vw,380px)] pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border animate-slideDown ${
              toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
              toast.type === 'error'   ? 'bg-red-50 border-red-200 text-red-800' :
                                         'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {toast.type === 'success' && <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />}
            {toast.type === 'error'   && <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />}
            {toast.type === 'info'    && <Info        className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />}
            <span className="text-sm leading-snug font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Mode Selector */}
      <div className="mb-6 flex gap-3 items-center">
        <div className="flex bg-slate-100 rounded-xl p-1">
          <button
            onClick={() => { setMode('encrypt'); setResultSrc(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === 'encrypt' ? 'bg-white text-cyan-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Enkripsi
          </button>
          <button
            onClick={() => { setMode('decrypt'); setResultSrc(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === 'decrypt' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Unlock className="w-3.5 h-3.5" />
            Dekripsi
          </button>
        </div>

        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold ${
          mode === 'encrypt' ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' : 'bg-teal-50 text-teal-700 border border-teal-100'
        }`}>
          {mode === 'encrypt' ? <ShieldCheck className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          {mode === 'encrypt' ? 'Mode Enkripsi Piksel' : 'Mode Dekripsi Piksel'}
        </div>

        {(imageFile || resultSrc) && (
          <button
            onClick={handleReset}
            className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Input */}
        <div className="space-y-5">
          {/* Image picker */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                mode === 'encrypt' ? 'bg-cyan-50 text-cyan-600' : 'bg-teal-50 text-teal-600'
              }`}>1</div>
              <h3 className="text-sm font-bold text-slate-700">
                Pilih Gambar {mode === 'encrypt' ? 'untuk Dienkripsi' : 'Terenkripsi'}
              </h3>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />

            {!imageFile ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full border-2 border-dashed rounded-xl py-10 flex flex-col items-center gap-3 transition-all group cursor-pointer ${
                  mode === 'encrypt'
                    ? 'border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/30'
                    : 'border-slate-200 hover:border-teal-300 hover:bg-teal-50/30'
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center transition-colors ${
                  mode === 'encrypt' ? 'group-hover:bg-cyan-100' : 'group-hover:bg-teal-100'
                }`}>
                  <ImageIcon className={`w-6 h-6 text-slate-400 transition-colors ${
                    mode === 'encrypt' ? 'group-hover:text-cyan-500' : 'group-hover:text-teal-500'
                  }`} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-700">
                    Klik atau drag & drop gambar
                  </p>
                  <p className="text-xs text-slate-400 mt-1">PNG, JPG, BMP, WebP didukung</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    mode === 'encrypt' ? 'bg-cyan-50 text-cyan-500' : 'bg-teal-50 text-teal-500'
                  }`}>
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-700 truncate">{imageFile.name}</p>
                    <p className="text-xs text-slate-400">{(imageFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={handleReset}
                    className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {previewSrc && (
                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                    <img src={previewSrc} alt="Original" className="w-full max-h-64 object-contain" />
                    <p className="text-[10px] text-slate-400 text-center py-1.5">Gambar Original</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Password */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                mode === 'encrypt' ? 'bg-cyan-50 text-cyan-600' : 'bg-teal-50 text-teal-600'
              }`}>2</div>
              <h3 className="text-sm font-bold text-slate-700">Password Enkripsi</h3>
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password..."
                onKeyDown={(e) => { if (e.key === 'Enter') handleProcess(); }}
                className={`w-full border rounded-xl px-4 py-3 pr-10 text-sm text-slate-700 placeholder-slate-400 outline-none transition-all ${
                  mode === 'encrypt'
                    ? 'border-slate-200 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100'
                    : 'border-slate-200 focus:border-teal-300 focus:ring-2 focus:ring-teal-100'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-100 text-slate-400 transition-all cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              {mode === 'encrypt'
                ? 'Simpan password ini untuk mendekripsi gambar nanti.'
                : 'Gunakan password yang sama dengan saat enkripsi.'}
            </p>
          </section>

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={processing || !imageFile || !password.trim()}
            className={`w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
              mode === 'encrypt'
                ? 'bg-gradient-to-r from-cyan-500 to-sky-500 shadow-cyan-200 hover:brightness-105'
                : 'bg-gradient-to-r from-teal-500 to-emerald-500 shadow-teal-200 hover:brightness-105'
            }`}
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {mode === 'encrypt' ? 'Mengenkripsi piksel...' : 'Mendekripsi piksel...'}
              </>
            ) : (
              <>
                {mode === 'encrypt' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                {mode === 'encrypt' ? 'Enkripsi Gambar' : 'Dekripsi Gambar'}
              </>
            )}
          </button>
        </div>

        {/* Right: Result */}
        <div>
          {resultSrc ? (
            <section className={`bg-white rounded-2xl border-2 p-5 animate-fadeUp ${
              mode === 'encrypt' ? 'border-cyan-200' : 'border-teal-200'
            }`}>
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  mode === 'encrypt' ? 'bg-cyan-50' : 'bg-teal-50'
                }`}>
                  <CheckCircle className={`w-4 h-4 ${mode === 'encrypt' ? 'text-cyan-500' : 'text-teal-500'}`} />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${mode === 'encrypt' ? 'text-cyan-700' : 'text-teal-700'}`}>
                    {mode === 'encrypt' ? 'Enkripsi Berhasil!' : 'Dekripsi Berhasil!'}
                  </h3>
                  <p className={`text-xs ${mode === 'encrypt' ? 'text-cyan-500' : 'text-teal-500'}`}>
                    {resultName}
                  </p>
                </div>
              </div>

              <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 mb-4">
                <img src={resultSrc} alt="Result" className="w-full max-h-64 object-contain" />
                <p className="text-[10px] text-slate-400 text-center py-1.5">
                  {mode === 'encrypt' ? 'Gambar Terenkripsi (tampak acak/noise)' : 'Gambar Terdekripsi'}
                </p>
              </div>

              {/* Side-by-side comparison label */}
              {previewSrc && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    <img src={previewSrc} alt="Before" className="w-full h-24 object-contain" />
                    <p className="text-[10px] text-slate-400 text-center py-1">Sebelum</p>
                  </div>
                  <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    <img src={resultSrc} alt="After" className="w-full h-24 object-contain" />
                    <p className="text-[10px] text-slate-400 text-center py-1">Sesudah</p>
                  </div>
                </div>
              )}

              <button
                onClick={handleDownload}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-colors active:scale-[0.98] cursor-pointer ${
                  mode === 'encrypt'
                    ? 'bg-cyan-500 hover:bg-cyan-600'
                    : 'bg-teal-500 hover:bg-teal-600'
                }`}
              >
                <Download className="w-4 h-4" />
                Unduh Gambar
              </button>

              {mode === 'encrypt' && (
                <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                  <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 leading-relaxed">
                    <strong>Penting:</strong> Gambar yang terenkripsi akan tampak seperti noise acak. Gunakan password yang sama untuk mendekripsinya kembali.
                  </p>
                </div>
              )}
            </section>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center justify-center text-center min-h-[400px] sticky top-20">
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-5 ${
                mode === 'encrypt' ? 'bg-cyan-50' : 'bg-teal-50'
              }`}>
                {mode === 'encrypt'
                  ? <Lock className="w-9 h-9 text-cyan-300" />
                  : <Unlock className="w-9 h-9 text-teal-300" />
                }
              </div>
              <p className="text-sm font-semibold text-slate-400">
                {mode === 'encrypt' ? 'Hasil enkripsi akan muncul di sini' : 'Hasil dekripsi akan muncul di sini'}
              </p>
              <p className="text-xs text-slate-300 mt-1">
                {mode === 'encrypt'
                  ? 'Pilih gambar, masukkan password, lalu klik Enkripsi'
                  : 'Pilih gambar terenkripsi, masukkan password yang sama, lalu klik Dekripsi'
                }
              </p>

              {/* Info cards */}
              <div className="mt-8 w-full space-y-2 text-left">
                <div className={`rounded-xl p-3 flex items-start gap-3 ${
                  mode === 'encrypt' ? 'bg-cyan-50' : 'bg-teal-50'
                }`}>
                  <Zap className={`w-4 h-4 mt-0.5 shrink-0 ${mode === 'encrypt' ? 'text-cyan-500' : 'text-teal-500'}`} />
                  <div>
                    <p className={`text-xs font-bold ${mode === 'encrypt' ? 'text-cyan-700' : 'text-teal-700'}`}>
                      Enkripsi Berbasis Piksel
                    </p>
                    <p className={`text-[11px] mt-0.5 ${mode === 'encrypt' ? 'text-cyan-600/80' : 'text-teal-600/80'}`}>
                      Setiap piksel R/G/B di-XOR dengan key stream dari password Anda.
                    </p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-xs font-bold text-slate-600">Simetris</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Proses enkripsi dan dekripsi menggunakan password yang sama persis.
                    </p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 flex items-start gap-3">
                  <Upload className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-xs font-bold text-slate-600">Output PNG</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Hasil selalu disimpan sebagai PNG untuk menjaga integritas data piksel.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
