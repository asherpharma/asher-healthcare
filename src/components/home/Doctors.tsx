import { ArrowUpRight, Stethoscope } from "lucide-react";

const doctors = [
  { initials: "SA", name: "Dr. Lt Col Shafi Ahamad", qualifications: "MBBS, MD (Pediatrics)", role: "Consultant Pediatrician", focus: ["Pediatric care", "Allergy care", "Asthma care"] },
  { initials: "SR", name: "Dr. Shaik Reshma", qualifications: "MBBS, MS (OBG)", role: "Consultant Obstetrician & Gynaecologist", focus: ["Pregnancy care", "Women’s health", "Infertility care"] },
];

export default function Doctors() {
  return (
    <section id="doctors" className="bg-white py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[0.2em] text-[#A8864A]">Meet the specialists</p><h2 className="mt-4 text-4xl font-bold tracking-tight text-[#233A59] sm:text-5xl">Care with clinical focus and a human touch.</h2></div>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {doctors.map((doctor, index) => (
            <article key={doctor.name} className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50 p-7 sm:p-9">
              <div className="flex flex-col gap-7 sm:flex-row sm:items-start">
                <div className={index === 0 ? "flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-[#233A59] text-2xl font-bold text-white shadow-xl shadow-[#233A59]/20" : "flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-[#A8864A] text-2xl font-bold text-white shadow-xl shadow-[#A8864A]/20"} aria-hidden="true">{doctor.initials}</div>
                <div className="flex-1"><div className="flex items-start justify-between gap-4"><div><h3 className="text-2xl font-bold text-[#233A59]">{doctor.name}</h3><p className="mt-2 font-semibold text-[#A8864A]">{doctor.qualifications}</p></div><Stethoscope className="mt-1 shrink-0 text-[#233A59]/30" size={28} /></div><p className="mt-4 text-slate-600">{doctor.role}</p><div className="mt-5 flex flex-wrap gap-2">{doctor.focus.map((item) => <span key={item} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">{item}</span>)}</div><a href="#appointment" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#233A59] transition group-hover:text-[#A8864A]">Request a consultation <ArrowUpRight size={16} /></a></div>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-500">Doctor photographs and extended profiles will be added when supplied by the clinic.</p>
      </div>
    </section>
  );
}
