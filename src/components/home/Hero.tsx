import Image from "next/image";
import { ArrowRight, CalendarDays, Clock3, MapPin, Phone } from "lucide-react";

export default function Hero() {
  return (
    <section className="patient-hero" aria-labelledby="welcome-heading">
      <div className="site-shell patient-hero-grid">
        <div className="patient-hero-copy">
          <div className="eyebrow">YOUR NEIGHBOURHOOD FAMILY CLINIC</div>
          <h1 id="welcome-heading">Expert care.<br />A familiar face.<br /><em>Every step of life.</em></h1>
          <p className="patient-hero-lead">Personal care for women, children and families. Meet your specialist at Asher Healthcare in RK Hegde Nagar, Bengaluru.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#appointment"><CalendarDays aria-hidden="true" /> Book an appointment <ArrowRight aria-hidden="true" /></a>
            <a className="button button-ghost" href="tel:+919019263709"><Phone aria-hidden="true" /> Speak to reception</a>
          </div>
          <p className="patient-hero-reassurance">Choose a specialist. See live availability. No account needed.</p>
        </div>
        <div className="patient-hero-portraits" aria-label="Meet the doctors at Asher Healthcare">
          <figure className="patient-hero-portrait patient-portrait-shafi">
            <div className="patient-portrait-image"><Image src="/images/dr-shafi-ahamad.jpg" alt="Dr. Lt Col Shafi Ahamad, Consultant Pediatrician at Asher Healthcare" fill preload sizes="(max-width: 700px) 44vw, 260px" style={{ objectPosition: "center 22%" }} /></div>
            <figcaption><small>CHILDREN&apos;S HEALTH</small><strong>Dr. Shafi Ahamad</strong><span>MBBS, MD (Pediatrics)</span></figcaption>
          </figure>
          <figure className="patient-hero-portrait patient-portrait-reshma">
            <div className="patient-portrait-image"><Image src="/images/dr-shaik-reshma.jpg" alt="Dr. Shaik Reshma, Consultant Obstetrician and Gynaecologist at Asher Healthcare" fill preload sizes="(max-width: 700px) 44vw, 260px" style={{ objectPosition: "center 18%" }} /></div>
            <figcaption><small>WOMEN&apos;S HEALTH</small><strong>Dr. Shaik Reshma</strong><span>MBBS, MS (OBG)</span></figcaption>
          </figure>
          <p className="patient-portrait-note"><span aria-hidden="true">✳</span> Two specialists. Care that stays personal.</p>
        </div>
      </div>
      <div className="site-shell patient-arrival-strip">
        <span><MapPin aria-hidden="true" /> RK Hegde Nagar · Thanisandra Main Road</span>
        <span><Clock3 aria-hidden="true" /> Specialist evenings · Usually Mon–Sat</span>
        <a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer">Get directions <ArrowRight aria-hidden="true" /></a>
      </div>
    </section>
  );
}
