// Registrasi service worker + tangkap event "Install" dari Chrome.
import { registerSW } from "virtual:pwa-register";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();
const notify = () => listeners.forEach((fn) => fn(deferred !== null));

export function initPWA() {
  if (!import.meta.env.PROD) return; // SW hanya aktif di build produksi
  registerSW({ immediate: true });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // tahan banner bawaan, kita pakai tombol sendiri
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function onInstallAvailable(fn: (available: boolean) => void) {
  listeners.add(fn);
  fn(deferred !== null);
  return () => {
    listeners.delete(fn);
  };
}

export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  notify();
}
