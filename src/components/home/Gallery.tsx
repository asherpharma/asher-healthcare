import Image from "next/image";
import { ArrowUpRight, Camera, Sparkles } from "lucide-react";

export default function Gallery() {
  return (
    <section id="clinic" className="section gallery-section">
      <div className="site-shell">
        <div className="section-heading split-heading light-heading">
          <div><span className="section-kicker">The Asher care environment</span><h2>Calm by design. Personal by nature.</h2></div>
          <p>Our representative concept imagery expresses the welcoming experience we aim to create. Directions and clinic contact details below are current.</p>
        </div>
        <div className="gallery-grid">
          <figure className="gallery-item gallery-main premium-tilt" data-premium-tilt="2.5"><Image src="/asher-hero-clinic-v2.webp" alt="Representative concept of a calm modern family clinic" fill sizes="(max-width: 900px) 92vw, 58vw" /><figcaption><span><Camera /> Representative clinic concept</span><strong>Calm spaces. Considered care.</strong></figcaption></figure>
          <figure className="gallery-item gallery-art premium-tilt" data-premium-tilt="2.5"><Image src="/asher-abstract-care-v2.webp" alt="Abstract navy and gold women and child care artwork" fill sizes="(max-width: 900px) 92vw, 35vw" /><figcaption><span><Sparkles /> Our care philosophy</span><strong>Women and children at the centre.</strong></figcaption></figure>
          <div className="gallery-note"><span className="gallery-logo"><Image src="/images/asher-logo-compact-v2.webp" alt="Asher Healthcare logo" width={116} height={116} /></span><div><small>Asher Women & Child Healthcare</small><h3>Independent specialist care in your neighbourhood.</h3><a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer">View on Google Maps <ArrowUpRight /></a></div></div>
        </div>
      </div>
    </section>
  );
}
