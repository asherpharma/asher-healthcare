import { LoaderCircle } from "lucide-react";

export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-5xl" role="status" aria-live="polite">
      <section className="overflow-hidden rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
        <div className="flex items-center gap-3 text-sm font-bold text-[#233A59]">
          <LoaderCircle className="animate-spin text-[#A8864A]" size={20} />
          Opening clinic workspace…
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </section>
    </div>
  );
}
