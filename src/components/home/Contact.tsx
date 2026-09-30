import { Clock3, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import ClinicMap from "./ClinicMap";

const address = "Ground Floor, 546, Thanisandra Main Road, Sri Balaji Krupa Layout, RK Hegde Nagar, Bengaluru, Karnataka 560077";

export default function Contact() {
  return (
    <section id="contact" className="section contact-section">
      <span id="clinic" className="patient-anchor" aria-hidden="true" />
      <div className="site-shell">
        <div className="section-heading split-heading"><div><span className="section-kicker">Visit Asher</span><h2>Specialist care, close to home.</h2></div><p>Conveniently located on Thanisandra Main Road in RK Hegde Nagar, with simple call, WhatsApp and navigation options.</p></div>
        <div className="contact-grid">
          <ClinicMap />
          <div className="contact-cards">
            <article><span><MapPin /></span><div><small>Clinic address</small><p>{address}</p></div></article>
            <article><span><Clock3 /></span><div><small>Usual specialist hours · Monday–Saturday</small><p><strong>Dr. Shafi: 5:00 PM–8:00 PM</strong><br /><strong>Dr. Reshma: 7:00 PM–9:00 PM</strong></p><small>Check the booking form for current availability.</small></div></article>
            <a href="tel:+919019263709"><span><Phone /></span><div><small>Call us</small><p><strong>+91 90192 63709</strong></p></div></a>
            <a href="https://wa.me/919019263709?text=Hello%20Asher%20Healthcare%2C%20I%20would%20like%20to%20book%20an%20appointment." target="_blank" rel="noreferrer"><span><MessageCircle /></span><div><small>WhatsApp</small><p><strong>Start a conversation</strong></p></div></a>
            <a href="mailto:info@asherhealthcare.in"><span><Mail /></span><div><small>Email</small><p><strong>info@asherhealthcare.in</strong></p></div></a>
          </div>
        </div>
      </div>
    </section>
  );
}
