import Image from "next/image";
import { ArrowRight, Baby, CalendarDays, CheckCircle2, HeartPulse, MapPin, Phone, Sparkles } from "lucide-react";

export default function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-orb hero-orb-one" />
      <div className="hero-orb hero-orb-two" />
      <div className="site-shell hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={16} /> Specialist care, thoughtfully personal</div>
          <h1>Healthcare that grows with <em>your family.</em></h1>
          <p className="hero-lead">
            Complete pediatric, obstetric and gynaecological care from two dedicated specialists—delivered in a calm, modern clinic in RK Hegde Nagar.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#appointment"><CalendarDays size={20} /> Book an appointment <ArrowRight size={18} /></a>
            <a className="button button-ghost" href="tel:+919019263709"><Phone size={19} /> Call the clinic</a>
          </div>
          <div className="hero-proof">
            <span><CheckCircle2 /> Women & child specialists</span>
            <span><CheckCircle2 /> Open every day</span>
            <span><CheckCircle2 /> Easy directions & booking</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Asher Women and Child Healthcare clinic">
          <div className="hero-image-wrap">
            <Image src="/asher-hero-clinic.png" alt="A calm modern women and child healthcare clinic" fill priority sizes="(max-width: 900px) 92vw, 48vw" />
            <div className="image-shade" />
            <div className="image-caption">
              <span className="pulse-dot" />
              <span><small>Now welcoming patients</small>RK Hegde Nagar, Bengaluru</span>
            </div>
          </div>
          <div className="floating-card floating-care"><HeartPulse /><span><strong>Women&apos;s care</strong><small>From wellness to maternity</small></span></div>
          <div className="floating-card floating-child"><Baby /><span><strong>Child health</strong><small>Newborn to adolescence</small></span></div>
        </div>
      </div>

      <div className="site-shell specialty-strip">
        <span>Two specialist practices. One trusted clinic.</span>
        <div><HeartPulse /> Obstetrics & Gynaecology</div>
        <div><Baby /> Pediatrics & Newborn Care</div>
        <a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer"><MapPin /> Get directions</a>
      </div>
    </section>
  );
}
