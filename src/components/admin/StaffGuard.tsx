"use client";

import { firebaseAuth, firestore, isFirebaseConfigured } from "@/firebase/config";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type StaffRole = "admin" | "doctor" | "reception";

export type StaffProfile = {
  uid: string;
  displayName: string;
  email: string;
  role: StaffRole;
  doctorName?: string;
};

type StaffContextValue = {
  user: User;
  profile: StaffProfile;
};

const StaffContext = createContext<StaffContextValue | null>(null);

export function useStaff() {
  const context = useContext(StaffContext);
  if (!context) throw new Error("useStaff must be used inside StaffGuard");
  return context;
}

export default function StaffGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<StaffContextValue | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseAuth || !firestore) return;

    return onAuthStateChanged(firebaseAuth!, async (user) => {
      if (!user) {
        router.replace("/admin/login");
        return;
      }

      try {
        const staffSnapshot = await getDoc(doc(firestore!, "staff", user.uid));
        const data = staffSnapshot.data();
        const role = data?.role as StaffRole | undefined;
        const validRole = role === "admin" || role === "doctor" || role === "reception";

        if (!staffSnapshot.exists() || data?.active !== true || !validRole) {
          await signOut(firebaseAuth!);
          router.replace("/admin/login?error=unauthorized");
          return;
        }

        setSession({
          user,
          profile: {
            uid: user.uid,
            displayName: String(data.displayName || user.displayName || "Clinic staff"),
            email: String(data.email || user.email || ""),
            role,
            doctorName: String(data.doctorName || ""),
          },
        });
      } catch {
        setError("We could not verify this staff account. Please try again.");
      }
    });
  }, [router]);

  if (!isFirebaseConfigured) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="max-w-lg rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <ShieldAlert className="text-amber-600" size={34} />
          <h1 className="mt-5 text-2xl font-bold text-[#233A59]">Secure portal is not connected yet</h1>
          <p className="mt-3 leading-7 text-slate-600">Firebase settings must be added before staff access or patient records can be used.</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
          <ShieldAlert className="mx-auto text-red-600" size={34} />
          <h1 className="mt-5 text-2xl font-bold text-[#233A59]">Access check failed</h1>
          <p className="mt-3 text-slate-600">{error}</p>
          <button className="mt-6 rounded-xl bg-[#233A59] px-5 py-3 font-bold text-white" onClick={() => location.reload()}>Try again</button>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 font-semibold text-[#233A59]"><LoaderCircle className="animate-spin" />Verifying secure access…</div>
      </main>
    );
  }

  return <StaffContext.Provider value={session}>{children}</StaffContext.Provider>;
}
