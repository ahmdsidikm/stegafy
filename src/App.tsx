import { useState } from 'react';
import {
  Unlock, Lock, LockKeyhole, Shield, Info,
  Menu, ChevronLeft, Layers, Cpu, Boxes, Scissors, Combine,
} from 'lucide-react';
import { StegoView, type Tab } from './StegoView';
import { PixelEncryptorView } from './PixelEncryptor';
import { FragmentationView, type FragMode } from './Fragmentation';

type AppMode = 'stego' | 'pixel-encryptor' | 'fragmentation';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('stego');
  const [activeTab, setActiveTab] = useState<Tab>('embed');
  const [pixelMode, setPixelMode] = useState<'encrypt' | 'decrypt'>('encrypt');
  const [fragMode, setFragMode] = useState<FragMode>('split');

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* ====== SIDEBAR ====== */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
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

          <button
            onClick={() => { setAppMode('fragmentation'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all cursor-pointer ${
              appMode === 'fragmentation'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              appMode === 'fragmentation' ? 'bg-emerald-100' : 'bg-slate-100'
            }`}>
              <Boxes className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">Fragmentation</p>
              <p className="text-[10px] text-slate-400 truncate">Pecah & gabung file .bin</p>
            </div>
            {appMode === 'fragmentation' && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            )}
          </button>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <p className="text-[11px] text-slate-400 text-center">&copy; 2026 Steganografi Multi-Media</p>
          <p className="text-[10px] text-slate-300 text-center">By Ahmad Sidik</p>
        </div>
      </aside>

      {/* ====== MAIN CONTENT AREA ====== */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* ====== HEADER ====== */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
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
              {appMode === 'stego' && (
                <div>
                  <h1 className="text-base font-bold text-slate-800 leading-tight"></h1>
                  <p className="text-[11px] text-slate-400 leading-tight hidden sm:block"></p>
                </div>
              )}
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
              {appMode === 'fragmentation' && (
                <div className="flex bg-slate-100 rounded-xl p-1">
                  <button onClick={() => setFragMode('split')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${fragMode === 'split' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Scissors className="w-3.5 h-3.5" />
                    Pisahkan
                  </button>
                  <button onClick={() => setFragMode('merge')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${fragMode === 'merge' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Combine className="w-3.5 h-3.5" />
                    Gabungkan
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ====== MAIN ====== */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {appMode === 'pixel-encryptor' && (
            <div className="animate-fadeUp">
              <div className="mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">Image Pixel Encryptor</h2>
                <p className="text-sm text-slate-500 mt-1">Enkripsi dan dekripsi gambar pada level piksel menggunakan password.</p>
              </div>
              <PixelEncryptorView mode={pixelMode} setMode={setPixelMode} />
            </div>
          )}

          {appMode === 'fragmentation' && (
            <div className="animate-fadeUp">
              <div className="mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">File Fragmentation</h2>
                <p className="text-sm text-slate-500 mt-1">Pecah file menjadi beberapa bagian .bin, atau gabungkan kembali menjadi file utuh.</p>
              </div>
              <FragmentationView mode={fragMode} setMode={setFragMode} />
            </div>
          )}

          {appMode === 'stego' && <StegoView activeTab={activeTab} />}
        </main>

        {/* ====== FOOTER ====== */}
        <footer className="border-t border-slate-100 mt-auto bg-white">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col items-center gap-2">
            <a
              href={appMode === 'pixel-encryptor' ? 'about_PixelEncryptor.html' : 'about.html'}
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
