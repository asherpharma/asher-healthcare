import Image from "next/image";
import { Phone, CalendarDays, MapPin } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="mx-auto flex min-h-[90vh] max-w-7xl flex-col items-center justify-between gap-10 px-6 py-24 md:flex-row">
        {/* Left */}
        <div className="max-w-2xl">
          <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-[#233A59]">
            ⭐ Trusted Women & Child Healthcare in Bengaluru
          </span>

          <h1 className="mt-8 text-5xl font-extrabold leading-tight text-[#233A59] md:text-7xl">
            Compassionate Care
            <br />
            for Women &
            <span className="text-[#A8864A]"> Children</span>
          </h1>

          <p className="mt-8 text-lg leading-8 text-slate-600">
            Expert Pediatrics, Pregnancy Care, Obstetrics & Gynaecology,
            Vaccinations, Allergy Care, Women's Wellness, and Child Healthcare—
            all under one roof.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <button className="flex items-center gap-2 rounded-xl bg-[#233A59] px-8 py-4 font-semibold text-white transition hover:bg-[#1B2E48]">
              <CalendarDays size={20} />
              Book Appointment
            </button>

            <a
              href="tel:+919019263709"
              className="flex items-center gap-2 rounded-xl border border-[#233A59] px-8 py-4 font-semibold text-[#233A59]"
            >
              <Phone size={20} />
              Call Now
            </a>
          </div>

          <div className="mt-10 flex items-center gap-3 text-slate-600">
            <MapPin className="text-[#A8864A]" size={22} />
            RK Hegde Nagar, Bengaluru
          </div>
        </div>

        {/* Right */}
        <div className="relative">
          <div className="absolute -inset-4 rounded-3xl bg-[#233A59]/10 blur-3xl"></div>

          <Image
            src="/images/logo.png"
            alt="Asher Healthcare"
            width={450}
            height={450}
            priority
            className="relative rounded-3xl bg-white p-8 shadow-2xl"
          />
        </div>
      </div>
    </section>
  );
}