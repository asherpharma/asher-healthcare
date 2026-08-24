import { Clock3, Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";

const address = "Ground Floor, 546, Thanisandra Main Road, Sri Balaji Krupa Layout, RK Hegde Nagar, Bengaluru, Karnataka 560077";

export default function Contact() {
  return (
    <section id="contact" className="section contact-section">
      <div className="site-shell">
        <div className="section-heading split-heading"><div><span className="section-kicker">Visit Asher</span><h2>Specialist care, close to home.</h2></div><p>Conveniently located on Thanisandra Main Road in RK Hegde Nagar, with simple call, WhatsApp and navigation options.</p></div>
        <div className="contact-grid">
          <div className="map-card">
            <iframe title="Asher Women and Child Healthcare location" src="https://www.google.com/maps?q=Asher%20Women%20and%20Child%20Healthcare%20RK%20Hegde%20Nagar%20Bengaluru&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <a className="map-button" href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer"><Navigation /> Open directions</a>
          </div>
          <div className="contact-cards">
            <article><span><MapPin /></span><div><small>Clinic address</small><p>{address}</p></div></article>
            <article><span><Clock3 /></span><div><small>Specialist appointments</small><p>Monday–Saturday<br /><strong>5:00 PM–8:00 PM</strong></p></div></article>
            <a href="tel:+919019263709"><span><Phone /></span><div><small>Call us</small><p><strong>+91 90192 63709</strong></p></div></a>
            <a href="https://wa.me/919019263709?text=Hello%20Asher%20Healthcare%2C%20I%20would%20like%20to%20book%20an%20appointment." target="_blank" rel="noreferrer"><span><MessageCircle /></span><div><small>WhatsApp</small><p><strong>Start a conversation</strong></p></div></a>
            <a href="mailto:info@asherhealthcare.in"><span><Mail /></span><div><small>Email</small><p><strong>info@asherhealthcare.in</strong></p></div></a>
          </div>
        </div>
      </div>
    </section>
  );
}
