import { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import {
  Upload, X, Download, CheckCircle, AlertCircle, Info,
  RefreshCw, Loader2, Scissors, Combine, FileText, Package, FileArchive,
} from 'lucide-react';

export type FragMode = 'split' | 'merge';

interface ToastMsg {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface FragPart {
  name: string;
  blob: Blob;
  size: number;
}

interface FragFile {
  file: File;
  index: number;
  total: number;
  base: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function getPreviewType(name: string): 'image' | 'video' | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
  return null;
}

function parseFragName(name: string): { base: string; index: number; total: number } | null {
  const m = name.match(/^(.+)\.part(\d+)of(\d+)\.bin$/i);
  if (!m) return null;
  return { base: m[1], index: Number(m[2]), total: Number(m[3]) };
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  return (
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
  );
}

function SplitPanel({ showToast }: { showToast: (m: string, t: ToastMsg['type']) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [partsCount, setPartsCount] = useState(4);
  const [splitting, setSplitting] = useState(false);
  const [parts, setParts] = useState<FragPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File) => {
    setFile(f);
    setParts([]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) pickFile(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  };

  const handleSplit = async () => {
    if (!file) return showToast('Pilih file terlebih dahulu!', 'error');
    if (partsCount < 2) return showToast('Jumlah bagian minimal 2!', 'error');
    setSplitting(true);
    try {
      const buffer = await file.arrayBuffer();
      const total = buffer.byteLength;
      const chunkSize = Math.ceil(total / partsCount);
      const result: FragPart[] = [];
      for (let i = 0; i < partsCount; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, total);
        if (start >= end) break;
        const blob = new Blob([buffer.slice(start, end)]);
        result.push({ name: `${file.name}.part${i + 1}of${partsCount}.bin`, blob, size: end - start });
      }
      setParts(result);
      showToast(`File berhasil dipecah menjadi ${result.length} bagian!`, 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setSplitting(false);
    }
  };

  const downloadPart = (part: FragPart) => {
    const url = URL.createObjectURL(part.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = part.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const [zipping, setZipping] = useState(false);

  const downloadAll = async () => {
    if (!parts.length) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const part of parts) zip.file(part.name, part.blob);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file?.name ?? 'file'}_parts.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Semua bagian berhasil diunduh dalam satu ZIP!', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setZipping(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParts([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      {(file || parts.length > 0) && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs font-bold">1</div>
              <h3 className="text-sm font-bold text-slate-700">Pilih File</h3>
            </div>

            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

            {!file ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-xl py-10 flex flex-col items-center gap-3 transition-all group cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                  <Upload className="w-6 h-6 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-700">Klik atau drag & drop file</p>
                  <p className="text-xs text-slate-400 mt-1">Semua jenis file didukung</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-700 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
                </div>
                <button
                  onClick={handleReset}
                  className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs font-bold">2</div>
              <h3 className="text-sm font-bold text-slate-700">Jumlah Bagian</h3>
            </div>
            <input
              type="number"
              min={2}
              max={100}
              value={partsCount}
              onChange={(e) => setPartsCount(Math.max(2, Math.min(100, Number(e.target.value) || 2)))}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 transition-all"
            />
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              File akan dipecah menjadi {partsCount} bagian berformat .bin
            </p>

            <button
              onClick={handleSplit}
              disabled={splitting || !file}
              className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white transition-all shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-200 hover:brightness-105"
            >
              {splitting
                ? <><Loader2 className="w-4 h-4 animate-spin" />Memecah File...</>
                : <><Scissors className="w-4 h-4" />Pecah File</>}
            </button>
          </section>
        </div>

        <div>
          {parts.length > 0 ? (
            <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 animate-fadeUp">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-emerald-700">{parts.length} Bagian Siap</h3>
                    <p className="text-xs text-emerald-500">Simpan semua bagian untuk penggabungan nanti</p>
                  </div>
                </div>
                <button
                  onClick={downloadAll}
                  disabled={zipping}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {zipping
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Membuat ZIP...</>
                    : <><FileArchive className="w-3.5 h-3.5" />Unduh Semua (ZIP)</>}
                </button>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {parts.map((part) => (
                  <div key={part.name} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-700 truncate">{part.name}</p>
                      <p className="text-[11px] text-slate-400">{formatBytes(part.size)}</p>
                    </div>
                    <button
                      onClick={() => downloadPart(part)}
                      className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-all shrink-0 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  <strong>Penting:</strong> Simpan seluruh {parts.length} bagian. File hanya bisa digabung kembali jika semua bagian tersedia.
                </p>
              </div>
            </section>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center justify-center text-center min-h-[400px] sticky top-20">
              <div className="w-20 h-20 rounded-2xl bg-emerald-50 flex items-center justify-center mb-5">
                <Scissors className="w-9 h-9 text-emerald-300" />
              </div>
              <p className="text-sm font-semibold text-slate-400">Bagian file akan muncul di sini</p>
              <p className="text-xs text-slate-300 mt-1">Pilih file, atur jumlah bagian, lalu klik Pecah File</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MergePanel({ showToast }: { showToast: (m: string, t: ToastMsg['type']) => void }) {
  const [files, setFiles] = useState<FragFile[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergedUrl, setMergedUrl] = useState<string | null>(null);
  const [mergedName, setMergedName] = useState('');
  const [mergedSize, setMergedSize] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: FileList) => {
    const parsed: FragFile[] = [];
    for (const f of Array.from(fileList)) {
      const info = parseFragName(f.name);
      if (!info) {
        showToast(`${f.name} bukan bagian fragmen yang valid`, 'error');
        continue;
      }
      parsed.push({ file: f, ...info });
    }
    if (!parsed.length) return;

    setFiles((prev) => {
      const merged = [...prev];
      for (const p of parsed) {
        if (merged.some((m) => m.base === p.base && m.index === p.index)) continue;
        merged.push(p);
      }
      const bases = new Set(merged.map((m) => m.base));
      if (bases.size > 1) {
        showToast('Semua bagian harus berasal dari file yang sama', 'error');
        return prev;
      }
      return merged.sort((a, b) => a.index - b.index);
    });
    setMergedUrl(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((f) => f.index !== index));
    setMergedUrl(null);
  };

  const total = files[0]?.total ?? 0;
  const complete = total > 0 && files.length === total;

  const handleMerge = async () => {
    if (!complete) return showToast('Semua bagian belum lengkap!', 'error');
    setMerging(true);
    try {
      const sorted = [...files].sort((a, b) => a.index - b.index);
      const buffers = await Promise.all(sorted.map((f) => f.file.arrayBuffer()));
      const totalSize = buffers.reduce((sum, b) => sum + b.byteLength, 0);
      const merged = new Uint8Array(totalSize);
      let offset = 0;
      for (const buf of buffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      const blob = new Blob([merged]);
      setMergedUrl(URL.createObjectURL(blob));
      setMergedName(sorted[0].base);
      setMergedSize(totalSize);
      showToast('Semua bagian berhasil digabungkan!', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setMerging(false);
    }
  };

  const handleDownload = () => {
    if (!mergedUrl) return;
    const a = document.createElement('a');
    a.href = mergedUrl;
    a.download = mergedName || 'merged_file';
    a.click();
  };

  const handleReset = () => {
    setFiles([]);
    setMergedUrl(null);
    setMergedName('');
    setMergedSize(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      {(files.length > 0 || mergedUrl) && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center text-xs font-bold">1</div>
              <h3 className="text-sm font-bold text-slate-700">Unggah Bagian File (.bin)</h3>
            </div>

            <input ref={fileInputRef} type="file" accept=".bin" multiple className="hidden" onChange={handleFileSelect} />

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center gap-3 transition-all group cursor-pointer hover:border-teal-300 hover:bg-teal-50/30"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-teal-100 transition-colors">
                <Upload className="w-6 h-6 text-slate-400 group-hover:text-teal-500 transition-colors" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-700">Klik atau drag & drop bagian file</p>
                <p className="text-xs text-slate-400 mt-1">Bisa pilih banyak file .bin sekaligus</p>
              </div>
            </div>
          </section>

          {files.length > 0 && (
            <section className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-700">Bagian Terkumpul</h3>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${complete ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {files.length} / {total}
                </span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {files.map((f) => (
                  <div key={f.index} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 text-xs font-bold text-teal-500">
                      {f.index}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-700 truncate">{f.file.name}</p>
                      <p className="text-[11px] text-slate-400">{formatBytes(f.file.size)}</p>
                    </div>
                    <button
                      onClick={() => removeFile(f.index)}
                      className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={handleMerge}
                disabled={merging || !complete}
                className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white transition-all shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer bg-gradient-to-r from-teal-500 to-emerald-500 shadow-teal-200 hover:brightness-105"
              >
                {merging
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Menggabungkan...</>
                  : <><Combine className="w-4 h-4" />Gabungkan File</>}
              </button>
              {!complete && (
                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Tombol gabung aktif setelah semua {total || '?'} bagian terkumpul
                </p>
              )}
            </section>
          )}
        </div>

        <div>
          {mergedUrl ? (
            <section className="bg-white rounded-2xl border-2 border-teal-200 p-5 animate-fadeUp">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-teal-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-teal-700">Penggabungan Berhasil!</h3>
                  <p className="text-xs text-teal-500">{mergedName} · {formatBytes(mergedSize)}</p>
                </div>
              </div>
              {(() => {
                const previewType = getPreviewType(mergedName);
                if (previewType === 'image') {
                  return (
                    <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 mb-4">
                      <img src={mergedUrl} alt={mergedName} className="w-full max-h-64 object-contain" />
                    </div>
                  );
                }
                if (previewType === 'video') {
                  return (
                    <div className="rounded-xl overflow-hidden border border-slate-200 bg-black mb-4">
                      <video src={mergedUrl} controls className="w-full max-h-64" />
                    </div>
                  );
                }
                return null;
              })()}
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-colors active:scale-[0.98] cursor-pointer bg-teal-500 hover:bg-teal-600"
              >
                <Download className="w-4 h-4" />
                Unduh File Utuh
              </button>
            </section>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center justify-center text-center min-h-[400px] sticky top-20">
              <div className="w-20 h-20 rounded-2xl bg-teal-50 flex items-center justify-center mb-5">
                <Combine className="w-9 h-9 text-teal-300" />
              </div>
              <p className="text-sm font-semibold text-slate-400">File hasil gabungan akan muncul di sini</p>
              <p className="text-xs text-slate-300 mt-1">Unggah semua bagian .bin lalu klik Gabungkan File</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FragmentationViewProps {
  mode: FragMode;
  setMode: (m: FragMode) => void;
}

export function FragmentationView({ mode }: FragmentationViewProps) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const showToast = useCallback((message: string, type: ToastMsg['type']) => {
    const id = Math.random().toString(36).substring(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <div className="relative">
      <ToastStack toasts={toasts} />
      <div key={mode} className="animate-fadeUp">
        {mode === 'split' ? <SplitPanel showToast={showToast} /> : <MergePanel showToast={showToast} />}
      </div>
    </div>
  );
}
