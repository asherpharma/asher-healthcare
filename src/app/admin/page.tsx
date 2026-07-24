import Link from "next/link";
import { ArrowLeft, Database, LockKeyhole, UsersRound } from "lucide-react";

const steps = [
  "Create the clinic Firebase project and enable Email/Password authentication.",
  "Add the Firebase web configuration to .env.local.",
  "Apply the default-deny Firestore and Storage rules, then add role-based staff access.",
  "Only then activate appointments, patient records, and report uploads.",
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]"><ArrowLeft size={16} />Back to website</Link>
        <p className="mt-10 text-sm font-bold uppercase tracking-[0.18em] text-[#A8864A]">Staff portal setup</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-[#233A59]">Clinic system is securely staged.</h1>
        <p className="mt-5 max-w-2xl leading-8 text-slate-600">The public website is ready. The protected admin area stays locked until clinic-owned Firebase credentials and staff roles are configured.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><LockKeyhole className="text-[#233A59]" /><h2 className="mt-5 font-bold text-[#233A59]">Patient records</h2><p className="mt-2 text-sm leading-6 text-slate-600">Not enabled in the public build—intentionally.</p></article>
          <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><UsersRound className="text-[#233A59]" /><h2 className="mt-5 font-bold text-[#233A59]">Staff roles</h2><p className="mt-2 text-sm leading-6 text-slate-600">Admin, doctor, and reception permissions will be added after sign-in setup.</p></article>
          <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:col-span-2"><Database className="text-[#233A59]" /><h2 className="mt-5 font-bold text-[#233A59]">Activation checklist</h2><ol className="mt-4 space-y-3 text-sm leading-6 text-slate-600">{steps.map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#233A59] text-xs font-bold text-white">{index + 1}</span>{step}</li>)}</ol></article>
        </div>
      </div>
    </main>
  );
}
