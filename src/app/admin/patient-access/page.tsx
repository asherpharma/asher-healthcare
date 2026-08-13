"use client";

import PatientPortalAccessManager from "@/components/admin/PatientPortalAccessManager";
import { useStaff } from "@/components/admin/StaffGuard";
import { ShieldCheck } from "lucide-react";

export default function PatientPortalAccessPage() {
  const { profile } = useStaff();
  if (profile.role !== "admin") {
    return <section className="rounded-[28px] bg-white p-8 text-center shadow-sm ring-1 ring-slate-200"><ShieldCheck className="mx-auto text-[#A8864A]" size={38} /><h1 className="mt-5 text-2xl font-bold text-[#233A59]">Administrator access required</h1><p className="mt-2 text-slate-600">Only a clinic administrator can approve or revoke family portal access.</p></section>;
  }
  return <PatientPortalAccessManager />;
}

