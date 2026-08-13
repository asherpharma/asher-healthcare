"use client";

import { Download, Share2, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PatientPortalPwa() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/patient-portal-sw.js?v=20260813-1", {
        scope: "/portal",
        updateViaCache: "none",
      }).then((registration) => registration.update()).catch(() => {});
    }
    const handle = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", handle);
    return () => window.removeEventListener("beforeinstallprompt", handle);
  }, []);

  async function install() {
    if (!prompt) { setHelp(true); return; }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }

  return <>
    <button type="button" onClick={() => void install()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#233A59]/15 bg-white px-3 text-xs font-bold text-[#233A59]"><Download size={16} />Install app</button>
    {help ? <div className="fixed inset-0 z-[100] grid place-items-end bg-slate-950/50 sm:place-items-center sm:p-5"><section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-t-[28px] bg-white p-6 sm:rounded-[28px]"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#233A59] text-white"><Smartphone /></span><div><p className="text-xs font-bold uppercase tracking-wider text-[#A8864A]">Asher Family</p><h2 className="text-xl font-bold text-[#233A59]">Add this portal to your phone</h2></div></div><button type="button" aria-label="Close" onClick={() => setHelp(false)} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100"><X size={18} /></button></div><div className="mt-6 space-y-3"><p className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600"><strong className="block text-[#233A59]">Android · Chrome</strong>Open the browser menu and choose Install app or Add to Home screen.</p><p className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600"><strong className="flex items-center gap-2 text-[#233A59]"><Share2 size={16} />iPhone · Safari</strong>Tap Share, choose Add to Home Screen, then tap Add.</p></div><p className="mt-5 text-xs leading-5 text-slate-500">Clinical and billing information always requires an internet connection and is never saved in the offline cache.</p></section></div> : null}
  </>;
}

