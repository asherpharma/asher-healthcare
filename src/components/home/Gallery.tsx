import Image from "next/image";
import { ArrowUpRight, Camera, Sparkles } from "lucide-react";

export default function Gallery() {
  return (
    <section id="clinic" className="section gallery-section">
      <div className="site-shell">
        <div className="section-heading split-heading light-heading">
          <div><span className="section-kicker">Inside the Asher experience</span><h2>A clinic designed to put families at ease.</h2></div>
          <p>Warm, contemporary and thoughtfully planned for comfortable consultations. Your original clinic photographs can be added to this gallery at any time.</p>
        </div>
        <div className="gallery-grid">
          <figure className="gallery-item gallery-main"><Image src="/asher-hero-clinic.png" alt="Modern Asher clinic concept" fill sizes="(max-width: 900px) 92vw, 58vw" /><figcaption><span><Camera /> Clinic experience</span><strong>Calm spaces. Considered care.</strong></figcaption></figure>
          <figure className="gallery-item gallery-art"><Image src="/asher-abstract-care.png" alt="Women and child care illustration" fill sizes="(max-width: 900px) 92vw, 35vw" /><figcaption><span><Sparkles /> Our care philosophy</span><strong>Women and children at the centre.</strong></figcaption></figure>
          <div className="gallery-note"><span className="gallery-logo"><Image src="/images/logo.png" alt="Asher Healthcare logo" width={116} height={116} /></span><div><small>Asher Women & Child Healthcare</small><h3>Independent specialist care in your neighbourhood.</h3><a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer">View on Google Maps <ArrowUpRight /></a></div></div>
        </div>
      </div>
    </section>
  );
}
