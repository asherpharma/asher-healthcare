import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-slate-950 py-12 text-slate-300">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#A8864A] text-base font-bold text-white">A</div><div><p className="font-bold text-white">Asher Healthcare</p><p className="text-xs text-slate-400">Women & Child Care</p></div></div>
          <p className="mt-5 max-w-md text-sm leading-6 text-slate-400">Compassionate, specialist-led care for women and children in Bengaluru.</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold">
          <Link href="/#services" className="hover:text-white">Services</Link><Link href="/#doctors" className="hover:text-white">Doctors</Link><Link href="/#appointment" className="hover:text-white">Appointments</Link><Link href="/#contact" className="hover:text-white">Contact</Link><Link href="/admin/login" className="hover:text-white">Staff login</Link>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 px-6 pt-6 text-xs text-slate-500">© {new Date().getFullYear()} Asher Women & Child Healthcare. All rights reserved.</div>
    </footer>
  );
}
