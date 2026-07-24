import Image from "next/image";
import { ArrowUpRight, Sparkles } from "lucide-react";

export default function Gallery() {
  return (
    <section id="gallery" className="overflow-hidden bg-[#233A59] py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end"><div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[0.2em] text-[#D7BF8E]">Clinic moments</p><h2 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">A warm setting for every family.</h2><p className="mt-5 text-lg leading-8 text-slate-300">We are preparing a full gallery of the clinic. Until then, explore the care-led visual direction behind Asher.</p></div><a href="#contact" className="inline-flex items-center gap-2 text-sm font-bold text-white transition hover:text-[#D7BF8E]">Plan your visit <ArrowUpRight size={17} /></a></div>
        <div className="mt-12 grid gap-4 md:grid-cols-12 md:grid-rows-2">
          <div className="relative min-h-72 overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#A8864A] via-[#D7BF8E] to-[#F7F2E8] p-8 md:col-span-5 md:row-span-2"><div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/40 blur-2xl" /><div className="relative flex h-full flex-col justify-between"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 text-[#233A59]"><Sparkles size={23} /></div><div><p className="text-2xl font-bold text-[#233A59]">Care that feels considered.</p><p className="mt-3 max-w-sm text-sm leading-6 text-[#233A59]/80">Calm colours, easy access, and a family-first approach to every visit.</p></div></div></div>
          <div className="relative min-h-52 overflow-hidden rounded-[2rem] bg-slate-100 p-7 md:col-span-4"><Image src="/images/logo.png" alt="Asher Healthcare logo" fill sizes="(max-width: 768px) 100vw, 35vw" className="object-contain p-8" /></div>
          <div className="min-h-52 rounded-[2rem] bg-gradient-to-br from-[#5B7698] to-[#233A59] p-7 text-white md:col-span-3"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#D7BF8E]">Women</p><p className="mt-12 text-xl font-bold leading-7">Support through every stage of health.</p></div>
          <div className="min-h-52 rounded-[2rem] bg-gradient-to-br from-[#E8F2F5] to-[#B8D7E0] p-7 md:col-span-3"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#233A59]">Children</p><p className="mt-12 text-xl font-bold leading-7 text-[#233A59]">A gentler experience for little ones.</p></div>
          <div className="min-h-52 rounded-[2rem] bg-[#F7F2E8] p-7 md:col-span-4"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Bengaluru</p><p className="mt-12 text-xl font-bold leading-7 text-[#233A59]">Care for families in RK Hegde Nagar.</p></div>
        </div>
      </div>
    </section>
  );
}
