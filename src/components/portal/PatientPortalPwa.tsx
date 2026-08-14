"use client";

import { CheckCircle2, Download, Share2, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

export default function PatientPortalPwa({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installModeChecked, setInstallModeChecked] = useState(false);
  const installButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/patient-portal-sw.js?v=20260813-1", {
        scope: "/portal",
        updateViaCache: "none",
      }).then((registration) => registration.update()).catch(() => {});
    }

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateInstalled = () => {
      setInstalled(displayMode.matches || Boolean((navigator as NavigatorWithStandalone).standalone));
      setInstallModeChecked(true);
    };
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setHelp(false);
    };

    updateInstalled();
    displayMode.addEventListener("change", updateInstalled);
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      displayMode.removeEventListener("change", updateInstalled);
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!help) return;
    const opener = installButton.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelp(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", containKeyboardFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", containKeyboardFocus);
      opener?.focus();
    };
  }, [help]);

  async function install() {
    if (!prompt) {
      setHelp(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === "accepted") setInstalled(true);
  }

  if (!installModeChecked || installed) return null;

  return (
    <>
      <button
        ref={installButton}
        type="button"
        onClick={() => void install()}
        aria-label="Install Asher Family app"
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#233A59]/15 bg-white px-3 text-xs font-bold text-[#233A59] transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
      >
        <Download aria-hidden="true" size={16} />
        <span className={compact ? "hidden sm:inline" : ""}>Install app</span>
      </button>

      {help ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-end bg-slate-950/55 backdrop-blur-sm sm:place-items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHelp(false);
          }}
        >
          <section
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="portal-install-title"
            aria-describedby="portal-install-description"
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#233A59] text-white">
                  <Smartphone aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#A8864A]">Asher Family</p>
                  <h2 id="portal-install-title" className="mt-1 text-xl font-bold leading-tight text-[#233A59]">
                    Add the secure portal to your phone
                  </h2>
                </div>
              </div>
              <button
                ref={closeButton}
                type="button"
                aria-label="Close installation help"
                onClick={() => setHelp(false)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <p id="portal-install-description" className="mt-5 text-sm leading-6 text-slate-600">
              Installation adds a convenient home-screen shortcut. Your medical and billing records are still loaded securely each time and are never stored for offline viewing.
            </p>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                <strong className="flex items-center gap-2 text-[#233A59]"><CheckCircle2 aria-hidden="true" size={17} />Android · Chrome</strong>
                <p className="mt-1">Open the browser menu, then choose <b>Install app</b> or <b>Add to Home screen</b>.</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                <strong className="flex items-center gap-2 text-[#233A59]"><Share2 aria-hidden="true" size={17} />iPhone · Safari</strong>
                <p className="mt-1">Tap <b>Share</b>, choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHelp(false)}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
            >
              Done
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
