import { useState, useRef, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import {
  Unlock, Upload, X, Download, Lock, Eye,
  FileIcon, Image, Film, Music, FileText, Plus,
  Trash2, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle, Loader2, Package,
  Shield, Info, DownloadCloud, AlertTriangle,
  EyeOff, LockKeyhole, MessageSquare, MessageSquarePlus,
  Maximize2, Edit3, Check, KeyRound, Search,
  LayoutGrid, Zap, ShieldCheck,
} from 'lucide-react';
import {
  embedFiles, extractFiles, checkForHiddenData, reEmbedFiles,
  readFileAsArrayBuffer, readFileAsDataURL, readFileAsText,
  blobToDataURL, blobToText, formatFileSize, getFileCategory,
  type HiddenFile, type EncryptionMethod,
} from './utils/stego';

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

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('embed');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({ open: false, fileId: '', fileName: '' });
  const [lightbox, setLightbox] = useState<ImageLightbox>({ open: false, src: '', alt: '' });

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

  // Filter & Search state
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const coverInputRef = useRef<HTMLInputElement>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const stegoInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

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
  };

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
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
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
    setDecryptedFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, comment } : f)));
    setModified(true);
  };

  const handleEmbed = async () => {
    if (!coverFile) return showToast('Pilih file cover terlebih dahulu!', 'error');
    if (secretFiles.length === 0) return showToast('Tambahkan minimal satu file rahasia!', 'error');

    setEmbedding(true);
    try {
      const renamedFiles = secretFiles.map((file, index) => {
        const customName = embedFileNames[index];
        if (customName && customName !== file.name) {
          return new File([file], customName, { type: file.type });
        }
        return file;
      });

      const methodToUse = embedPassword ? embedMethod : undefined;
      const { blob, extension } = await embedFiles(coverFile, renamedFiles, embedPassword || undefined, embedComments, methodToUse);
      const url = URL.createObjectURL(blob);
      setStegoResult({ url, extension });
      const defaultName = `stego_file.${extension}`;
      setStegoOutputName(defaultName);
      setEditingStegoName(false);

      const sp: FilePreview = { name: defaultName, size: blob.size, type: coverFile.type };
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
      if (check.method) {
        setDecryptMethod(check.method);
      }
      if (check.hasPassword) {
        const methodLabel = check.method === 'aes' ? 'AES-256' : 'XOR';
        showToast(`File memerlukan password (${methodLabel}) untuk dekripsi.`, 'info');
      } else {
        showToast('Data tersembunyi terdeteksi! Klik Dekripsi.', 'info');
      }
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const handleDecrypt = async () => {
    if (!stegoBuffer) return showToast('Pilih file stego terlebih dahulu!', 'error');
    setDecrypting(true);
    try {
      const files = await extractFiles(stegoBuffer, decryptPassword || undefined, detectedMethod);
      setDecryptedFiles(files);
      setModified(false);
      setOpenedDecryptPreviews(new Set());
      setEditingComments(new Set());
      setEditingFileNames(new Set());
      setDecryptionDone(true);
      setOriginalDecryptPassword(decryptPassword);
      setNewPassword(decryptPassword);
      setPasswordChanged(false);
      setAllDecryptPreviewsOpen(false);
      setFilterCategory('all');
      setSearchQuery('');
      if (detectedMethod) setDecryptMethod(detectedMethod);
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

  const requestRemoveDecryptedFile = (id: string, name: string) => {
    setConfirmDialog({ open: true, fileId: id, fileName: name });
  };

  const confirmRemoveDecryptedFile = () => {
    setDecryptedFiles((prev) => prev.filter((f) => f.id !== confirmDialog.fileId));
    setOpenedDecryptPreviews((prev) => { const next = new Set(prev); next.delete(confirmDialog.fileId); return next; });
    setEditingComments((prev) => { const next = new Set(prev); next.delete(confirmDialog.fileId); return next; });
    setEditingFileNames((prev) => { const next = new Set(prev); next.delete(confirmDialog.fileId); return next; });
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
        newFiles.push({ id, name: file.name, size: file.size, type: file.type, data: buffer, comment: '' });
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

  const handleUpdateAndDownload = async () => {
    if (!stegoBuffer || decryptedFiles.length === 0) return;
    setUpdating(true);
    try {
      const passwordToUse = passwordChanged ? newPassword : originalDecryptPassword;
      const newBlob = await reEmbedFiles(stegoBuffer, decryptedFiles, passwordToUse || undefined, passwordToUse ? decryptMethod : undefined);
      const newBuffer = await newBlob.arrayBuffer();
      setStegoBuffer(newBuffer);
      const url = URL.createObjectURL(newBlob);
      const ext = stegoFile?.name.split('.').pop() || 'bin';
      const a = document.createElement('a');
      a.href = url;
      a.download = `updated_stego.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setOriginalDecryptPassword(passwordToUse);
      setModified(false);
      setPasswordChanged(false);
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
        <p className={`text-sm font-bold mb-0.5 ${value === 'xor' && !disabled ? 'text-amber-700' : 'text-slate-600'}`}>XOR</p>
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
        <p className={`text-sm font-bold mb-0.5 ${value === 'aes' && !disabled ? 'text-emerald-700' : 'text-slate-600'}`}>AES-256</p>
        <p className={`text-[10px] leading-snug ${value === 'aes' && !disabled ? 'text-emerald-600/80' : 'text-slate-400'}`}>
          Standar industri. Lebih aman.
        </p>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
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

      {/* ====== TOASTS ====== */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[min(92vw,380px)]">
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-200">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800 leading-tight">Stegafy</h1>
              <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Sembunyikan File</p>
            </div>
          </div>
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
              <div className="lg:col-span-2 space-y-5">

                {/* Step 1: Cover */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">1</div>
                    <h3 className="text-sm font-bold text-slate-700">File Cover</h3>
                  </div>
                  <input ref={coverInputRef} type="file" className="hidden" onChange={handleCoverSelect} />
                  {!coverFile ? (
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

                {/* Step 2: Secret Files */}
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
                                  <textarea value={comment} onChange={(e) => { setEmbedComments((prev) => ({ ...prev, [index]: e.target.value })); resetStegoResult(); }} placeholder="Tambahkan komentar untuk file ini..." rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-700 placeholder-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition-all resize-none outline-none" />
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

                {/* Step 3: Password + Encryption Method (combined) */}
                <section className="bg-white rounded-2xl border border-slate-200 p-5 card-hover">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center text-xs font-bold">3</div>
                      <h3 className="text-sm font-bold text-slate-700">Password & Keamanan</h3>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wide">Opsional</span>
                    </div>
                    {embedPassword && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide ${
                        embedMethod === 'aes' ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'
                      }`}>
                        {embedMethod === 'aes' ? 'AES-256' : 'XOR'}
                      </span>
                    )}
                  </div>

                  {/* Password input */}
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type={showEmbedPassword ? 'text' : 'password'}
                      value={embedPassword}
                      onChange={(e) => setEmbedPassword(e.target.value)}
                      placeholder="Masukkan password..."
                      className="focus-ring w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-12 py-3 text-sm text-slate-700 placeholder-slate-400 focus:border-orange-300 transition-all"
                    />
                    <button onClick={() => setShowEmbedPassword(!showEmbedPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer">
                      {showEmbedPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Encryption method selector (below password) */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2.5">
                      <label className="text-xs font-semibold text-slate-500">Jenis Keamanan</label>
                      {!embedPassword && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Isi password untuk memilih
                        </span>
                      )}
                    </div>
                    {renderEncryptionMethodSelector(
                      embedMethod,
                      (m) => { setEmbedMethod(m); resetStegoResult(); },
                      !embedPassword
                    )}
                  </div>
                </section>

                {/* Embed Button */}
                <button
                  onClick={handleEmbed}
                  disabled={embedding || !coverFile || secretFiles.length === 0}
                  className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3.5 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                >
                  {embedding ? <><Loader2 className="w-4 h-4 animate-spin" />Menyembunyikan...</> : <><LockKeyhole className="w-4 h-4" />Sembunyikan File</>}
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
                    {embedPassword && (
                      <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-xl border ${
                        embedMethod === 'aes' ? 'bg-emerald-50/50 border-emerald-200 text-emerald-700' : 'bg-amber-50/50 border-amber-200 text-amber-700'
                      }`}>
                        {embedMethod === 'aes' ? <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> : <Zap className="w-3.5 h-3.5 shrink-0" />}
                        <span className="text-[11px] font-semibold">Dienkripsi dengan {embedMethod === 'aes' ? 'AES-256-GCM' : 'XOR'}</span>
                      </div>
                    )}
                    <a href={stegoResult.url} download={stegoOutputName || `stego_file.${stegoResult.extension}`} className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold transition-colors active:scale-[0.98]">
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
                                Enkripsi: {detectedMethod === 'aes' ? 'AES-256-GCM' : 'XOR'}
                              </span>
                            </div>
                          )}
                          {!detectedMethod && !needsPassword && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl animate-fadeIn">
                              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="text-xs font-semibold text-slate-500">Tanpa enkripsi</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* Step 2: Password + Encryption Method (combined, shown when password needed & before decryption) */}
                {stegoFile && needsPassword && !decryptionDone && (
                  <section className="bg-white rounded-2xl border border-slate-200 p-5 animate-fadeUp card-hover">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center text-xs font-bold">2</div>
                        <h3 className="text-sm font-bold text-slate-700">Password & Keamanan</h3>
                      </div>
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wide">Diperlukan</span>
                    </div>

                    {/* Password input */}
                    <div className="relative">
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
                {stegoFile && stegoDetected && !decryptionDone && (
                  <button
                    onClick={handleDecrypt}
                    disabled={decrypting || (needsPassword && !decryptPassword)}
                    className="w-full bg-gradient-to-r from-violet-500 to-purple-500 text-white py-3.5 rounded-xl font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-200 flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
                  >
                    {decrypting ? <><Loader2 className="w-4 h-4 animate-spin" />Mendekripsi...</> : <><Unlock className="w-4 h-4" />Dekripsi</>}
                  </button>
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
                        {updating ? <><Loader2 className="w-4 h-4 animate-spin" />Memperbarui...</> : <><RefreshCw className="w-4 h-4" />Perbarui & Unduh Cover</>}
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
                        <button onClick={toggleAllDecryptPreviews} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all cursor-pointer ${allDecryptPreviewsOpen ? 'text-violet-600 bg-violet-100 hover:bg-violet-200' : 'text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100'}`} title={allDecryptPreviewsOpen ? 'Tutup semua preview' : 'Buka semua preview'}>
                          {allDecryptPreviewsOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">{allDecryptPreviewsOpen ? 'Tutup Semua' : 'Buka Semua'}</span>
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
      </main>

      {/* ====== FOOTER ====== */}
      <footer className="border-t border-slate-100 mt-auto bg-white">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-xs text-slate-400">
          &copy; 2026 Steganografi Multi-Media. Semua proses dilakukan secara lokal di browser Anda.
        </div>
      </footer>
    </div>
  );
}
