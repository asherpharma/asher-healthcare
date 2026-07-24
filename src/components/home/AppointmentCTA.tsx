import { CalendarDays, MessageCircle, Phone } from "lucide-react";

export default function AppointmentCTA() {
  return (
    <section id="appointment" className="bg-slate-50 py-24 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#A8864A]">Appointments</p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight text-[#233A59] sm:text-5xl">Start your appointment request here.</h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">For the quickest response, send the clinic team a WhatsApp message with the preferred doctor and date. They will confirm the best available time.</p>
        </div>
        <div className="rounded-[2rem] bg-white p-8 shadow-xl shadow-slate-200/70 ring-1 ring-slate-200 sm:p-10">
          <CalendarDays className="text-[#A8864A]" size={32} />
          <h3 className="mt-5 text-2xl font-bold text-[#233A59]">Book with the clinic team</h3>
          <p className="mt-3 leading-7 text-slate-600">Please do not include detailed medical history in your first message. The team will guide you on the next steps.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <a href="https://wa.me/919019263709?text=Hello%20Asher%20Healthcare%2C%20I%20would%20like%20to%20request%20an%20appointment." target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#1b2e48]"><MessageCircle size={18} />WhatsApp us</a>
            <a href="tel:+919019263709" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3.5 text-sm font-bold text-[#233A59] transition hover:border-[#233A59]"><Phone size={18} />Call clinic</a>
          </div>
          <p className="mt-5 text-center text-xs text-slate-500">Appointment availability is confirmed by the clinic team.</p>
        </div>
      </div>
    </section>
  );
}
