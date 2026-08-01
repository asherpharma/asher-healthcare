"use client";

import { Clock3, LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type StaffLockReason = "manual" | "inactivity";

type StaffSessionProtectionProps = {
  onLock: (reason: StaffLockReason) => Promise<void> | void;
  idleTimeoutMs?: number;
  warningDurationMs?: number;
};

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_WARNING_DURATION_MS = 2 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 1000;

function formatRemainingTime(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function StaffSessionProtection({
  onLock,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  warningDurationMs = DEFAULT_WARNING_DURATION_MS,
}: StaffSessionProtectionProps) {
  const lastActivityAt = useRef<number | null>(null);
  const lastHandledActivityAt = useRef(0);
  const lockStarted = useRef(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastHandledActivityAt.current < ACTIVITY_THROTTLE_MS) return;
    lastHandledActivityAt.current = now;
    lastActivityAt.current = now;
    setRemainingMs(null);
  }, []);

  const lockForInactivity = useCallback(() => {
    if (lockStarted.current) return;
    lockStarted.current = true;
    void onLock("inactivity");
  }, [onLock]);

  useEffect(() => {
    lastActivityAt.current = Date.now();
    const handleActivity = () => markActive();
    const evaluateSession = () => {
      const now = Date.now();
      const lastActivity = lastActivityAt.current ?? now;
      const timeRemaining = idleTimeoutMs - (now - lastActivity);
      if (timeRemaining <= 0) {
        lockForInactivity();
        return;
      }
      setRemainingMs(timeRemaining <= warningDurationMs ? timeRemaining : null);
    };

    document.addEventListener("pointerdown", handleActivity, { passive: true });
    document.addEventListener("touchstart", handleActivity, { passive: true });
    document.addEventListener("wheel", handleActivity, { passive: true });
    window.addEventListener("scroll", handleActivity, { passive: true, capture: true });
    document.addEventListener("keydown", handleActivity);
    document.addEventListener("visibilitychange", evaluateSession);
    const timer = window.setInterval(evaluateSession, 1000);

    return () => {
      document.removeEventListener("pointerdown", handleActivity);
      document.removeEventListener("touchstart", handleActivity);
      document.removeEventListener("wheel", handleActivity);
      window.removeEventListener("scroll", handleActivity, { capture: true });
      document.removeEventListener("keydown", handleActivity);
      document.removeEventListener("visibilitychange", evaluateSession);
      window.clearInterval(timer);
    };
  }, [idleTimeoutMs, lockForInactivity, markActive, warningDurationMs]);

  if (remainingMs === null) return null;

  return (
    <aside
      aria-live="polite"
      aria-label="Session inactivity warning"
      className="fixed inset-x-3 bottom-24 z-[80] mx-auto max-w-md rounded-3xl border border-amber-200 bg-white p-4 shadow-2xl shadow-slate-950/20 sm:bottom-6 sm:p-5"
    >
      <div className="flex gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-800">
          <Clock3 aria-hidden="true" size={21} />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-[#233A59]">App will lock soon</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            No activity was detected. Your staff session will lock in <strong>{formatRemainingTime(remainingMs)}</strong>.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => markActive(true)}
          className="min-h-11 rounded-xl bg-[#233A59] px-3 text-sm font-bold text-white transition hover:bg-[#1b2e48] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
        >
          Keep working
        </button>
        <button
          type="button"
          onClick={() => {
            if (lockStarted.current) return;
            lockStarted.current = true;
            void onLock("manual");
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
        >
          <LockKeyhole aria-hidden="true" size={16} />
          Lock now
        </button>
      </div>
    </aside>
  );
}
