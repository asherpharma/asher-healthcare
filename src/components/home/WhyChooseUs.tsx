import { Baby, CalendarCheck2, HeartHandshake, ShieldCheck } from "lucide-react";

const reasons = [
  { title: "Care built around families", description: "A welcoming space for parents, women, and children, with clear conversations at every step.", icon: HeartHandshake },
  { title: "Focused specialist care", description: "Dedicated pediatric and obstetric & gynaecology consultations from one trusted clinic.", icon: ShieldCheck },
  { title: "Child-friendly experience", description: "Thoughtful, calm care designed to help young patients and their families feel at ease.", icon: Baby },
  { title: "Simple appointment requests", description: "Choose a doctor, preferred time, and contact method in just a few moments.", icon: CalendarCheck2 },
];

export default function WhyChooseUs() {
  return (
    <section className="bg-slate-50 py-24 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#A8864A]">Why Asher</p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight text-[#233A59] sm:text-5xl">Thoughtful healthcare, close to home.</h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">Every visit is designed to feel clear, respectful, and reassuring—from first questions to follow-up care.</p>
          <a href="#appointment" className="mt-8 inline-flex rounded-xl bg-[#233A59] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1b2e48]">Request an appointment</a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {reasons.map((reason) => {
            const Icon = reason.icon;
            return <article key={reason.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#233A59]/10 text-[#233A59]"><Icon size={24} /></div><h3 className="mt-5 text-lg font-bold text-[#233A59]">{reason.title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{reason.description}</p></article>;
          })}
        </div>
      </div>
    </section>
  );
}
