"use client";

import {
  CheckCircle2,
  Download,
  Share2,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type AppContext = "public" | "staff";

type AppInstalledEvent = CustomEvent<{ context: AppContext }>;

declare global {
  interface Window {
    __asherInstallPrompt?: InstallPromptEvent | null;
    __asherInstallPromptContext?: AppContext | null;
  }
}

const STAFF_APP_SESSION_KEY = "asher-staff-mobile-v2-session";

function isStaffPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function staffAppIsInstalled() {
  if (!isStandaloneDisplay()) return false;

  const launchedAsStaff = new URLSearchParams(window.location.search).get("app") === "mobile-v2";

  try {
    if (launchedAsStaff) sessionStorage.setItem(STAFF_APP_SESSION_KEY, "1");
    return launchedAsStaff || sessionStorage.getItem(STAFF_APP_SESSION_KEY) === "1";
  } catch {
    return launchedAsStaff;
  }
}

export function PwaRegister() {
  const pathname = usePathname();
  const appContext: AppContext = isStaffPath(pathname) ? "staff" : "public";

  useEffect(() => {
    let refreshingForUpdate = false;
    const hadController = Boolean(navigator.serviceWorker?.controller);

    // Preserve the staff launch identity before authentication redirects can
    // remove the manifest's `?app=mobile-v2` start marker.
    if (appContext === "staff") staffAppIsInstalled();

    // A prompt belongs to the manifest that was active when the browser created it.
    // Never carry a public-site prompt into the secure staff workspace (or vice versa).
    window.__asherInstallPrompt = null;
    window.__asherInstallPromptContext = null;
    window.dispatchEvent(new Event("asher-install-context-change"));

    const onControllerChange = () => {
      if (!hadController || refreshingForUpdate) return;
      refreshingForUpdate = true;
      window.location.reload();
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

      const workerUrl = appContext === "staff"
        ? "/staff-v2-sw.js?v=asher-staff-20260802-3"
        : "/sw.js?v=asher-public-20260802-3";
      const workerScope = appContext === "staff" ? "/admin" : "/";

      void navigator.serviceWorker
        .register(workerUrl, {
          scope: workerScope,
          updateViaCache: "none",
        })
        .then(async (registration) => {
          if (registration.waiting) registration.waiting.postMessage("SKIP_WAITING");
          await registration.update();
        })
        .catch(() => {
          // The app remains usable online even when service-worker registration is unavailable.
        });
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      window.__asherInstallPrompt = event as InstallPromptEvent;
      window.__asherInstallPromptContext = appContext;
      window.dispatchEvent(new Event("asher-install-available"));
    };
    const onInstalled = () => {
      window.__asherInstallPrompt = null;
      window.__asherInstallPromptContext = null;
      window.dispatchEvent(
        new CustomEvent("asher-app-installed", { detail: { context: appContext } }),
      );
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [appContext]);
  return null;
}

export function NetworkStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <span
      title={online ? "Connected" : "Offline"}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold " +
        (online
          ? "bg-emerald-50 text-emerald-700"
          : "bg-amber-50 text-amber-700")
      }
    >
      {online ? <Wifi size={13} /> : <WifiOff size={13} />}
      <span className="hidden lg:inline">{online ? "Online" : "Offline"}</span>
    </span>
  );
}

export function InstallAppButton({
  compact = false,
  wide = false,
}: {
  compact?: boolean;
  wide?: boolean;
}) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [insidePublicApp, setInsidePublicApp] = useState(false);

  useEffect(() => {
    const syncPrompt = () => {
      setPrompt(
        window.__asherInstallPromptContext === "staff"
          ? (window.__asherInstallPrompt ?? null)
          : null,
      );
    };
    const onInstalled = (event: Event) => {
      if ((event as AppInstalledEvent).detail?.context !== "staff") return;
      setPrompt(null);
      setInstalled(true);
    };
    const syncTimer = window.setTimeout(() => {
      const staffInstalled = staffAppIsInstalled();
      setInstalled(staffInstalled);
      setInsidePublicApp(isStandaloneDisplay() && !staffInstalled);
      syncPrompt();
    }, 0);
    window.addEventListener("asher-install-available", syncPrompt);
    window.addEventListener("asher-install-context-change", syncPrompt);
    window.addEventListener("asher-app-installed", onInstalled);
    return () => {
      window.clearTimeout(syncTimer);
      window.removeEventListener("asher-install-available", syncPrompt);
      window.removeEventListener("asher-install-context-change", syncPrompt);
      window.removeEventListener("asher-app-installed", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) {
      setShowHelp(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    window.__asherInstallPrompt = null;
    setPrompt(null);
  }

  if (installed && !wide) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        disabled={installed}
        className={
          "items-center justify-center gap-2 border border-[#233A59]/15 bg-blue-50 text-sm font-bold text-[#233A59] transition hover:bg-blue-100 " +
          (wide
            ? "flex min-h-12 w-full rounded-2xl px-4"
            : compact
              ? "inline-flex h-10 rounded-xl px-3"
              : "inline-flex min-h-10 rounded-xl px-3")
        }
      >
        {installed ? <CheckCircle2 size={17} /> : <Download size={17} />}
        <span className={compact ? "hidden sm:inline" : ""}>
          {installed ? "App installed" : "Install staff app"}
        </span>
      </button>

      {showHelp ? (
        <div className="fixed inset-0 z-[90] grid place-items-end bg-slate-950/50 p-0 backdrop-blur-sm sm:place-items-center sm:p-5">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-app-title"
            className="w-full max-w-lg rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px]"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#233A59] text-white">
                  <Smartphone size={23} />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#A8864A]">
                    Asher Staff
                  </p>
                  <h2 id="install-app-title" className="text-xl font-bold text-[#233A59]">
                    Add the app to this phone
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                aria-label="Close installation guide"
                className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600"
              >
                <X size={19} />
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {insidePublicApp ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-bold text-amber-900">Open the staff page in your browser first</p>
                  <p className="mt-1 text-sm leading-6 text-amber-800">
                    You are currently inside the Asher patient app. Use its browser menu to open
                    this page in Chrome or Safari, then follow the installation steps below.
                  </p>
                </div>
              ) : null}
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="font-bold text-[#233A59]">Android · Chrome</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Open the browser menu, then choose <strong>Install app</strong> or{" "}
                  <strong>Add to Home screen</strong>.
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="flex items-center gap-2 font-bold text-[#233A59]">
                  <Share2 size={17} /> iPhone · Safari
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Tap the Share button, choose <strong>Add to Home Screen</strong>, then tap{" "}
                  <strong>Add</strong>.
                </p>
              </div>
            </div>

            <p className="mt-5 text-xs leading-5 text-slate-500">
              The app uses the same secure staff login and live clinic records. Patient data is
              never stored in the offline cache.
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
