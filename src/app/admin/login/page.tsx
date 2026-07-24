import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";

export default function StaffLoginPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 sm:py-16">
      <div className="mx-auto max-w-lg">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]"><ArrowLeft size={16} />Back to website</Link>
        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60 sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#233A59] text-white"><LockKeyhole size={26} /></div>
          <p className="mt-7 text-sm font-bold uppercase tracking-[0.18em] text-[#A8864A]">Staff portal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#233A59]">Secure sign-in is being prepared.</h1>
          <p className="mt-5 leading-7 text-slate-600">This login will be connected to the clinic’s Firebase account before it is used for appointments or patient records.</p>
          <div className="mt-7 flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600"><ShieldCheck className="mt-0.5 shrink-0 text-[#233A59]" size={20} /><p>No patient data is stored or shown in this public preview.</p></div>
          <Link href="/admin" className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-[#233A59] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#1b2e48]">View setup status</Link>
        </section>
      </div>
    </main>
  );
}
