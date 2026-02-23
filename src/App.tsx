import { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import {
  Unlock, Upload, X, Download, Lock, Eye,
  FileIcon, Image, Film, Music, FileText, Plus,
  Trash2, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle, Loader2, Package,
  Shield, Info, DownloadCloud, AlertTriangle,
  EyeOff, LockKeyhole,
} from 'lucide-react';
import {
  embedFiles, extractFiles, checkForHiddenData, reEmbedFiles,
  readFileAsArrayBuffer, readFileAsDataURL, readFileAsText,
  blobToDataURL, blobToText, formatFileSize, getFileCategory,
  type HiddenFile,
} from './utils/stego';

type Tab = 'embed' | 'decrypt';

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

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('embed');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({ open: false, fileId: '', fileName: '' });

  // Embed state
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<FilePreview | null>(null);
  const [secretFiles, setSecretFiles] = useState<File[]>([]);
  const [secretPreviews, setSecretPreviews] = useState<FilePreview[]>([]);
  const [embedPassword, setEmbedPassword] = useState('');
  const [showEmbedPassword, setShowEmbedPassword] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [stegoResult, setStegoResult] = useState<{ url: string; extension: string } | null>(null);
  const [stegoPreview, setStegoPreview] = useState<FilePreview | null>(null);
  // Previews that are opened — once opened, stays open (Set of indices)
  const [openedEmbedPreviews, setOpenedEmbedPreviews] = useState<Set<number>>(new Set());

  // Decrypt state
  const [stegoFile, setStegoFile] = useState<File | null>(null);
  const [stegoFilePreview, setStegoFilePreview] = useState<FilePreview | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [showDecryptPassword, setShowDecryptPassword] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptedFiles, setDecryptedFiles] = useState<HiddenFile[]>([]);
  const [stegoBuffer, setStegoBuffer] = useState<ArrayBuffer | null>(null);
  const [modified, setModified] = useState(false);
  const [updating, setUpdating] = useState(false);
  // Previews that are opened — once opened, stays open (Set of file IDs)
  const [openedDecryptPreviews, setOpenedDecryptPreviews] = useState<Set<string>>(new Set());
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [stegoDetected, setStegoDetected] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const stegoInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: Toast['type']) => {
    const id = Math.random().toString(36).substring(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // --- Build file preview ---
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

  // --- Cover file ---
  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setStegoResult(null);
    setStegoPreview(null);
    const preview = await buildFilePreview(file);
    setCoverPreview(preview);
  };

  // --- Secret files ---
  const handleSecretFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSecretFiles((prev) => [...prev, ...files]);
    setStegoResult(null);
    setStegoPreview(null);
    const previews = await Promise.all(files.map(buildFilePreview));
    setSecretPreviews((prev) => [...prev, ...previews]);
    if (secretInputRef.current) secretInputRef.current.value = '';
  };

  const removeSecretFile = (index: number) => {
    setSecretFiles((prev) => prev.filter((_, i) => i !== index));
    setSecretPreviews((prev) => prev.filter((_, i) => i !== index));
    setStegoResult(null);
    setStegoPreview(null);
    // Rebuild opened previews set (shift indices)
    setOpenedEmbedPreviews((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
        // skip the removed index
      });
      return next;
    });
  };

  // Open embed preview (stays open once opened)
  const openEmbedPreview = (index: number) => {
    setOpenedEmbedPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Open decrypt preview (stays open once opened)
  const openDecryptPreview = (fileId: string) => {
    setOpenedDecryptPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  // --- Embed ---
  const handleEmbed = async () => {
    if (!coverFile) return showToast('Pilih file cover terlebih dahulu!', 'error');
    if (secretFiles.length === 0) return showToast('Tambahkan minimal satu file rahasia!', 'error');

    setEmbedding(true);
    try {
      const { blob, extension } = await embedFiles(coverFile, secretFiles, embedPassword || undefined);
      const url = URL.createObjectURL(blob);
      setStegoResult({ url, extension });

      const sp: FilePreview = { name: `stego_file.${extension}`, size: blob.size, type: coverFile.type };
      const cat = getFileCategory(coverFile.type, coverFile.name);
      if (cat === 'image') sp.url = await blobToDataURL(blob);
      else if (cat === 'text') sp.text = await blobToText(blob);
      else if (cat === 'audio' || cat === 'video') sp.url = url;
      setStegoPreview(sp);

      showToast('File berhasil disembunyikan!', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
      setEmbedding(false);
    }
  };

  // --- Stego file for decrypt ---
  const handleStegoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStegoFile(file);
    setDecryptedFiles([]);
    setModified(false);
    setNeedsPassword(false);
    setDecryptPassword('');
    setShowDecryptPassword(false);
    setFilePreviews({});
    setOpenedDecryptPreviews(new Set());
    setStegoDetected(false);

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
      showToast(check.hasPassword ? 'File memerlukan password untuk dekripsi.' : 'Data tersembunyi terdeteksi! Klik Dekripsi.', 'info');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    }
  };

  // --- Decrypt ---
  const handleDecrypt = async () => {
    if (!stegoBuffer) return showToast('Pilih file stego terlebih dahulu!', 'error');
    setDecrypting(true);
    try {
      const files = extractFiles(stegoBuffer, decryptPassword || undefined);
      setDecryptedFiles(files);
      setModified(false);
      setOpenedDecryptPreviews(new Set());
      showToast(`Berhasil mendekripsi ${files.length} file!`, 'success');

      const previews: Record<string, string> = {};
      for (const f of files) {
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
      setDecrypting(false);
    }
  };

  // --- Delete with confirmation ---
  const requestRemoveDecryptedFile = (id: string, name: string) => {
    setConfirmDialog({ open: true, fileId: id, fileName: name });
  };

  const confirmRemoveDecryptedFile = () => {
    setDecryptedFiles((prev) => prev.filter((f) => f.id !== confirmDialog.fileId));
    setOpenedDecryptPreviews((prev) => {
      const next = new Set(prev);
      next.delete(confirmDialog.fileId);
      return next;
    });
    setModified(true);
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
        newFiles.push({ id, name: file.name, size: file.size, type: file.type, data: buffer });
        const cat = getFileCategory(file.type, file.name);
        if (cat === 'image') newPreviews[id] = await readFileAsDataURL(file);
        else if (cat === 'text') newPreviews[id] = await readFileAsText(file);
        else if (cat === 'audio' || cat === 'video') newPreviews[id] = URL.createObjectURL(file);
      }
      setDecryptedFiles((prev) => [...prev, ...newFiles]);
      setFilePreviews((prev) => ({ ...prev, ...newPreviews }));
      setModified(true);
      showToast(`${files.length} file ditambahkan.`, 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    }
    if (addFileInputRef.current) addFileInputRef.current.value = '';
  };

  const handleUpdateStego = async () => {
    if (!stegoBuffer || decryptedFiles.length === 0) return;
    setUpdating(true);
    try {
      const newBlob = await reEmbedFiles(stegoBuffer, decryptedFiles, decryptPassword || undefined);
      const newBuffer = await newBlob.arrayBuffer();
      setStegoBuffer(newBuffer);
      const url = URL.createObjectURL(newBlob);
      const ext = stegoFile?.name.split('.').pop() || 'bin';
      const a = document.createElement('a');
      a.href = url;
      a.download = `updated_stego.${ext}`;
      a.click();
      setModified(false);
      showToast('File cover diperbarui dan diunduh!', 'success');
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    } finally {
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

  // --- Preview renderers ---
  const renderPreview = (preview: FilePreview) => {
    const cat = getFileCategory(preview.type, preview.name);
    if (cat === 'image' && preview.url) {
      return (
        <div className="rounded-xl overflow-hidden bg-slate-50 border border-slate-200">
          <img src={preview.url} alt={preview.name} className="w-full max-h-64 object-contain" />
        </div>
      );
    }
    if (cat === 'video' && preview.url) {
      return <video src={preview.url} controls loop className="w-full max-h-64 rounded-xl bg-black border border-slate-200" />;
    }
    if (cat === 'audio' && preview.url) {
      return (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <audio src={preview.url} controls loop className="w-full" />
        </div>
      );
    }
    if (cat === 'text' && preview.text) {
      return (
        <div className="max-h-44 overflow-auto rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs font-mono text-slate-600 leading-relaxed whitespace-pre-wrap">
          {preview.text.substring(0, 2000)}
          {preview.text.length > 2000 && <span className="text-slate-400">... (terpotong)</span>}
        </div>
      );
    }
    return null;
  };

  const renderDecryptPreview = (fileId: string, type: string, name: string) => {
    const previewData = filePreviews[fileId];
    if (!previewData) return null;
    const cat = getFileCategory(type, name);
    if (cat === 'image') {
      return (
        <div className="rounded-xl overflow-hidden bg-slate-50 border border-slate-200">
          <img src={previewData} alt={name} className="w-full max-h-56 object-contain" />
        </div>
      );
    }
    if (cat === 'video') {
      return <video src={previewData} controls loop className="w-full max-h-56 rounded-xl bg-black border border-slate-200" />;
    }
    if (cat === 'audio') {
      return (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <audio src={previewData} controls loop className="w-full" />
        </div>
      );
    }
    if (cat === 'text') {
      return (
        <div className="max-h-40 overflow-auto rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs font-mono text-slate-600 leading-relaxed whitespace-pre-wrap">
          {previewData.substring(0, 2000)}
          {previewData.length > 2000 && <span className="text-slate-400">... (terpotong)</span>}
        </div>
      );
    }
    return null;
  };

  const clearStegoState = () => {
    setStegoFile(null);
    setStegoFilePreview(null);
    setStegoBuffer(null);
    setDecryptedFiles([]);
    setModified(false);
    setNeedsPassword(false);
    setDecryptPassword('');
    setShowDecryptPassword(false);
    setFilePreviews({});
    setOpenedDecryptPreviews(new Set());
    setStegoDetected(false);
    if (stegoInputRef.current) stegoInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
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
              <button
                onClick={cancelRemoveDecryptedFile}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors active:scale-[0.98] cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={confirmRemoveDecryptedFile}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 transition-colors active:scale-[0.98] cursor-pointer"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== TOASTS ====== */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[min(92vw,380px)]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-enter flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border
              ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : ''}
              ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : ''}
              ${toast.type === 'info' ? 'bg-blue-50 border-blue-200 text-blue-800' : ''}
            `}
          >
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-200">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800 leading-tight">Stegafy</h1>
              <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Sembunyikan File</p>
            </div>
          </div>

          <div className="flex bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setActiveTab('embed')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer
                ${activeTab === 'embed'
                  ? 'bg-white text-orange-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LockKeyhole className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sembunyikan</span>
              <span className="sm:hidden">Embed</span>
            </button>
            <button
              onClick={() => setActiveTab('decrypt')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer
                ${activeTab === 'decrypt'
                  ? 'bg-white text-violet-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Unlock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dekripsi</span>
              <span className="sm:hidden">Decrypt</span>
            </button>
          </div>
        </div>
      </header>

      {/* ====== MAIN ====== */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ============ EMBED TAB ============ */}
        {activeTab === 'embed' && (
          <div className="animate-fadeUp">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">Sembunyikan File</h2>
              <p className="text-sm text-slate-500 mt-1">Sisipkan file rahasia ke dalam file cover media Anda.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Left column: inputs */}
              <div className="lg:col-span-2 space-y-5">
                {/* Cover file */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">1</div>
                    <h3 className="text-sm font-bold text-slate-700">File Cover</h3>
                  </div>
                  <input ref={coverInputRef} type="file" className="hidden" onChange={handleCoverSelect} />

                  {!coverFile ? (
                    <button
                      onClick={() => coverInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-200 rounded-xl py-10 flex flex-col items-center gap-3 hover:border-orange-300 hover:bg-orange-50/30 transition-all group cursor-pointer"
                    >
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
                        <button
                          onClick={() => { setCoverFile(null); setCoverPreview(null); setStegoResult(null); setStegoPreview(null); if (coverInputRef.current) coverInputRef.current.value = ''; }}
                          className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {/* Cover preview — always visible */}
                      {coverPreview && renderPreview(coverPreview)}
                    </div>
                  )}
                </section>

                {/* Secret files */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">2</div>
                      <h3 className="text-sm font-bold text-slate-700">
                        File Rahasia
                        {secretFiles.length > 0 && <span className="text-slate-400 font-normal ml-1">({secretFiles.length})</span>}
                      </h3>
                    </div>
                    <input ref={secretInputRef} type="file" multiple className="hidden" onChange={handleSecretFilesSelect} />
                    {secretFiles.length > 0 && (
                      <button
                        onClick={() => secretInputRef.current?.click()}
                        className="flex items-center gap-1 text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />Tambah
                      </button>
                    )}
                  </div>

                  {secretFiles.length === 0 ? (
                    <button
                      onClick={() => secretInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center gap-3 hover:border-orange-300 hover:bg-orange-50/30 transition-all group cursor-pointer"
                    >
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
                        return (
                          <div key={index} className="rounded-xl overflow-hidden border border-slate-100 file-item">
                            <div className="flex items-center gap-3 p-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getFileIconColor(file.type, file.name)}`}>
                                {getFileIconEl(file.type, file.name)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                                <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {hasPreviewable && (
                                  <button
                                    onClick={() => openEmbedPreview(index)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                                    title={isOpen ? 'Tutup preview' : 'Lihat preview'}
                                  >
                                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                )}
                                <button onClick={() => removeSecretFile(index)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            {isOpen && secretPreviews[index] && (
                              <div className="px-3 pb-3 animate-slideDown">
                                {renderPreview(secretPreviews[index])}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Password */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">3</div>
                      <h3 className="text-sm font-bold text-slate-700">Password</h3>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wide">Opsional</span>
                    </div>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type={showEmbedPassword ? 'text' : 'password'}
                      value={embedPassword}
                      onChange={(e) => setEmbedPassword(e.target.value)}
                      placeholder="Masukkan password..."
                      className="focus-ring w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-orange-300 transition-all"
                    />
                    <button
                      onClick={() => setShowEmbedPassword(!showEmbedPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                    >
                      {showEmbedPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </section>

                {/* Embed Button */}
                <button
                  onClick={handleEmbed}
                  disabled={embedding || !coverFile || secretFiles.length === 0}
                  className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3.5 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                >
                  {embedding ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Menyembunyikan...</>
                  ) : (
                    <><LockKeyhole className="w-4 h-4" />Sembunyikan File</>
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

                    {/* Stego result preview — always visible */}
                    {stegoPreview && renderPreview(stegoPreview)}

                    <div className="bg-slate-50 rounded-xl p-3 mt-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500 shrink-0">
                          <Package className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-700 truncate">stego_file.{stegoResult.extension}</p>
                          {stegoPreview && <p className="text-xs text-slate-400">{formatFileSize(stegoPreview.size)}</p>}
                        </div>
                      </div>
                    </div>

                    <a
                      href={stegoResult.url}
                      download={`stego_file.${stegoResult.extension}`}
                      className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold transition-colors active:scale-[0.98]"
                    >
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
              {/* Left column: inputs */}
              <div className="lg:col-span-1 space-y-5">
                {/* Stego file input */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center text-xs font-bold">1</div>
                    <h3 className="text-sm font-bold text-slate-700">File Stego</h3>
                  </div>
                  <input ref={stegoInputRef} type="file" className="hidden" onChange={handleStegoSelect} />

                  {!stegoFile ? (
                    <button
                      onClick={() => stegoInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-200 rounded-xl py-10 flex flex-col items-center gap-3 hover:border-violet-300 hover:bg-violet-50/30 transition-all group cursor-pointer"
                    >
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
                      {/* File info bar */}
                      <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getFileIconColor(stegoFile.type, stegoFile.name)}`}>
                          {getFileIconEl(stegoFile.type, stegoFile.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-700 truncate">{stegoFile.name}</p>
                          <p className="text-xs text-slate-400">{formatFileSize(stegoFile.size)}</p>
                        </div>
                        <button
                          onClick={clearStegoState}
                          className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shrink-0 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Preview of the stego file — always visible */}
                      {stegoFilePreview && renderPreview(stegoFilePreview)}

                      {/* Status badge */}
                      {stegoDetected && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl animate-fadeIn">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="text-xs font-semibold text-emerald-700">Data tersembunyi terdeteksi</span>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* Password */}
                {stegoFile && needsPassword && (
                  <section className="bg-white rounded-2xl border border-slate-200 p-5 animate-fadeUp card-hover">
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center text-xs font-bold">2</div>
                      <h3 className="text-sm font-bold text-slate-700">Password</h3>
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wide">Diperlukan</span>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type={showDecryptPassword ? 'text' : 'password'}
                        value={decryptPassword}
                        onChange={(e) => setDecryptPassword(e.target.value)}
                        placeholder="Masukkan password..."
                        className="focus-ring-accent w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-violet-300 transition-all"
                      />
                      <button
                        onClick={() => setShowDecryptPassword(!showDecryptPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                      >
                        {showDecryptPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </section>
                )}

                {/* Decrypt button */}
                {stegoFile && stegoDetected && (
                  <button
                    onClick={handleDecrypt}
                    disabled={decrypting || (needsPassword && !decryptPassword)}
                    className="w-full bg-gradient-to-r from-violet-500 to-purple-500 text-white py-3.5 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                  >
                    {decrypting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Mendekripsi...</>
                    ) : (
                      <><Unlock className="w-4 h-4" />Dekripsi</>
                    )}
                  </button>
                )}
              </div>

              {/* Right column: results */}
              <div className="lg:col-span-2">
                {decryptedFiles.length > 0 ? (
                  <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 animate-fadeUp">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
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
                        <button
                          onClick={() => addFileInputRef.current?.click()}
                          className="flex items-center gap-1.5 text-xs font-semibold text-violet-500 hover:text-violet-600 bg-violet-50 hover:bg-violet-100 px-3 py-2 rounded-lg transition-all cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />Tambah File
                        </button>
                      </div>
                    </div>

                    {/* File list */}
                    <div className="space-y-2">
                      {decryptedFiles.map((file) => {
                        const cat = getFileCategory(file.type, file.name);
                        const hasPreview = cat !== 'other' && filePreviews[file.id];
                        const isOpen = openedDecryptPreviews.has(file.id);
                        return (
                          <div key={file.id} className="rounded-xl overflow-hidden border border-slate-100 file-item">
                            <div className="flex items-center gap-3 p-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getFileIconColor(file.type, file.name)}`}>
                                {getFileIconEl(file.type, file.name)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                                <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                {hasPreview && (
                                  <button
                                    onClick={() => openDecryptPreview(file.id)}
                                    className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                                    title={isOpen ? 'Tutup preview' : 'Lihat preview'}
                                  >
                                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                )}
                                <button
                                  onClick={() => downloadFile(file)}
                                  className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 transition-all cursor-pointer"
                                  title="Unduh"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => requestRemoveDecryptedFile(file.id, file.name)}
                                  className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all cursor-pointer"
                                  title="Hapus"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            {isOpen && hasPreview && (
                              <div className="px-3 pb-3 animate-slideDown">
                                {renderDecryptPreview(file.id, file.type, file.name)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Action buttons */}
                    <div className="mt-5 pt-5 border-t border-slate-100 space-y-2.5">
                      {/* Download All */}
                      <button
                        onClick={downloadAllFiles}
                        disabled={downloadingAll}
                        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-md shadow-emerald-200"
                      >
                        {downloadingAll ? (
                          <><Loader2 className="w-4 h-4 animate-spin" />Mengemas file...</>
                        ) : (
                          <><DownloadCloud className="w-4 h-4" />Unduh Semua ({decryptedFiles.length} file)</>
                        )}
                      </button>

                      {/* Update stego */}
                      {modified && (
                        <button
                          onClick={handleUpdateStego}
                          disabled={updating}
                          className="w-full bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 animate-fadeIn active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                        >
                          {updating ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />Memperbarui...</>
                          ) : (
                            <><RefreshCw className="w-4 h-4" />Unduh Cover yang Diperbarui</>
                          )}
                        </button>
                      )}
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
      </main>

      {/* ====== FOOTER ====== */}
      <footer className="border-t border-slate-100 mt-auto bg-white">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-xs text-slate-400">
          &copy; 2025 Steganografi Multi-Media. Semua proses dilakukan secara lokal di browser Anda.
        </div>
      </footer>
    </div>
  );
}
