import Image from "next/image";
import { ArrowRight, Baby, CalendarDays, CheckCircle2, HeartPulse, MapPin, Phone, ShieldCheck, Sparkles } from "lucide-react";

export default function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-orb hero-orb-one" />
      <div className="hero-orb hero-orb-two" />
      <div className="site-shell hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={16} /> Two specialists. One connected care experience.</div>
          <h1>Healthcare designed around <em>your family.</em></h1>
          <p className="hero-lead">
            Personal pediatric, obstetric and gynaecological care—supported by live booking,
            digital records and a secure family portal in RK Hegde Nagar.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#appointment"><CalendarDays size={20} /> Book an appointment <ArrowRight size={18} /></a>
            <a className="button button-ghost" href="tel:+919019263709"><Phone size={19} /> Call the clinic</a>
          </div>
          <div className="hero-proof">
            <span><CheckCircle2 /> Specialist slots Mon–Sat, 5–8 PM</span>
            <span><CheckCircle2 /> Live 15-minute booking</span>
            <span><CheckCircle2 /> Secure family portal</span>
          </div>
        </div>

        <div
          className="hero-visual premium-tilt"
          aria-label="Asher Women and Child Healthcare clinic"
          data-premium-tilt="3.5"
        >
          <div className="hero-depth-ring hero-depth-ring-one" aria-hidden="true"><span /></div>
          <div className="hero-depth-ring hero-depth-ring-two" aria-hidden="true"><span /></div>
          <div className="hero-image-wrap">
            <Image src="/asher-hero-clinic-v2.webp" alt="Representative concept of a calm modern women and child healthcare clinic" fill priority sizes="(max-width: 900px) 92vw, 48vw" />
            <div className="hero-glass-sheen" aria-hidden="true" />
            <div className="image-shade" />
            <div className="image-caption">
              <span className="pulse-dot" />
              <span><small>Now welcoming patients</small>RK Hegde Nagar, Bengaluru</span>
            </div>
          </div>
          <div className="floating-card floating-care"><HeartPulse /><span><strong>Women&apos;s care</strong><small>From wellness to maternity</small></span></div>
          <div className="floating-card floating-child"><Baby /><span><strong>Child health</strong><small>Newborn to adolescence</small></span></div>
          <div className="hero-security-chip"><ShieldCheck /><span><strong>Secure by design</strong><small>Private family records</small></span></div>
        </div>
      </div>

      <div className="site-shell specialty-strip">
        <span>Choose the care that fits your visit.</span>
        <div><HeartPulse /> Obstetrics & Gynaecology</div>
        <div><Baby /> Pediatrics & Newborn Care</div>
        <a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer"><MapPin /> Get directions</a>
      </div>
    </section>
  );
}
