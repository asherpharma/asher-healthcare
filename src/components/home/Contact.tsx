import { Clock3, MapPin, MessageCircle, Phone } from "lucide-react";

export default function Contact() {
  return (
    <section id="contact" className="bg-white py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid overflow-hidden rounded-[2rem] border border-slate-200 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="bg-[#233A59] p-8 text-white sm:p-12">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#D7BF8E]">Visit Asher</p>
            <h2 className="mt-4 text-4xl font-bold tracking-tight">Here when your family needs care.</h2>
            <div className="mt-10 space-y-6">
              <div className="flex gap-4"><MapPin className="mt-0.5 shrink-0 text-[#D7BF8E]" /><p className="leading-7 text-slate-200">Ground Floor, 546, Thanisandra Main Road,<br />RK Hegde Nagar, Bengaluru – 560077</p></div>
              <a href="tel:+919019263709" className="flex gap-4 transition hover:text-[#D7BF8E]"><Phone className="shrink-0 text-[#D7BF8E]" /><span><span className="block text-sm text-slate-300">Call the clinic</span><span className="font-bold">+91 90192 63709</span></span></a>
              <a href="https://wa.me/919019263709" target="_blank" rel="noreferrer" className="flex gap-4 transition hover:text-[#D7BF8E]"><MessageCircle className="shrink-0 text-[#D7BF8E]" /><span><span className="block text-sm text-slate-300">WhatsApp</span><span className="font-bold">Message the clinic team</span></span></a>
              <div className="flex gap-4"><Clock3 className="shrink-0 text-[#D7BF8E]" /><span><span className="block text-sm text-slate-300">Clinic hours</span><span className="font-bold">Please call to confirm today’s timings</span></span></div>
            </div>
          </div>
          <div className="min-h-96 bg-slate-100"><iframe title="Map showing Asher Women and Child Healthcare" src="https://www.google.com/maps?q=Asher%20Women%20and%20Child%20Healthcare%2C%20RK%20Hegde%20Nagar%2C%20Bengaluru&output=embed" className="h-full min-h-96 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>
        </div>
      </div>
    </section>
  );
}
