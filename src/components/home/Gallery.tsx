import Image from "next/image";
import { ArrowUpRight, Sparkles } from "lucide-react";

export default function Gallery() {
  return (
    <section id="gallery" className="overflow-hidden bg-[#233A59] py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[0.2em] text-[#D7BF8E]">Clinic moments</p><h2 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">A warm setting for every family.</h2><p className="mt-5 text-lg leading-8 text-slate-300">A modern, welcoming visual language that reflects the care experience we are building at Asher.</p></div>
          <a href="#contact" className="inline-flex items-center gap-2 text-sm font-bold text-white transition hover:text-[#D7BF8E]">Plan your visit <ArrowUpRight size={17} /></a>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-12 md:grid-rows-2">
          <div className="group relative min-h-80 overflow-hidden rounded-[2rem] md:col-span-7 md:row-span-2"><Image src="/asher-hero-clinic.png" alt="Modern welcoming healthcare reception visual" fill sizes="(max-width: 768px) 100vw, 60vw" className="object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-[#15273f]/90 via-[#15273f]/20 to-transparent" /><div className="absolute inset-x-0 bottom-0 p-7 sm:p-9"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#D7BF8E]">A welcoming arrival</p><p className="mt-3 max-w-md text-2xl font-bold leading-8 text-white">A calm, thoughtful space for women, children, and families.</p></div></div>
          <div className="group relative min-h-52 overflow-hidden rounded-[2rem] bg-slate-100 md:col-span-5"><Image src="/asher-abstract-care.png" alt="Abstract Asher Healthcare care visual" fill sizes="(max-width: 768px) 100vw, 40vw" className="object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-[#233A59]/10" /></div>
          <div className="min-h-52 rounded-[2rem] bg-gradient-to-br from-[#5B7698] to-[#233A59] p-7 text-white md:col-span-3"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#D7BF8E]">Women</p><p className="mt-12 text-xl font-bold leading-7">Support through every stage of health.</p></div>
          <div className="min-h-52 rounded-[2rem] bg-[#F7F2E8] p-7 md:col-span-2"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#A8864A]"><Sparkles size={20} /></div><p className="mt-10 text-xl font-bold leading-7 text-[#233A59]">Care that feels considered.</p></div>
        </div>
      </div>
    </section>
  );
}
