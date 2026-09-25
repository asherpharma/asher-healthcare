/* eslint-disable @next/next/no-html-link-for-pages -- Full-page navigation isolates optional Ads measurement. */
import Image from "next/image";
import { ArrowUp, Camera, Heart, MessageCircle, Phone } from "lucide-react";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-shell footer-grid">
        <div className="footer-brand">
          <div className="brand footer-logo">
            <span className="brand-mark"><Image src="/images/asher-logo-compact-v2.webp" alt="" width={56} height={56} /></span>
            <span><strong>Asher</strong><small>Women & Child Healthcare</small></span>
          </div>
          <p>Compassionate specialist care for women, children and families in North Bengaluru.</p>
          <div className="footer-social">
            <a href="tel:+919019263709" aria-label="Call Asher Healthcare"><Phone /></a>
            <a href="https://wa.me/919019263709" target="_blank" rel="noreferrer" aria-label="WhatsApp Asher Healthcare"><MessageCircle /></a>
            <a href="/#clinic" aria-label="View clinic gallery"><Camera /></a>
          </div>
        </div>
        <div>
          <h3>Explore</h3>
          <a href="/#services">Services</a>
          <a href="/#care">Care guide</a>
          <a href="/care/pediatrics">Pediatrics</a>
          <a href="/care/womens-health">Women&apos;s health</a>
          <a href="/care/general-care-lab-tests">General care &amp; lab tests</a>
          <a href="/#doctors">Doctors</a>
          <a href="/#appointment">Appointments</a>
        </div>
        <div>
          <h3>Patient information</h3>
          <a href="/patient-rights">Patient rights</a>
          <a href="/privacy">Privacy policy</a>
          <a href="/terms">Website terms</a>
          <a href="/#contact">Contact the clinic</a>
        </div>
        <div>
          <h3>Clinic</h3>
          <a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer">Get directions</a>
          <a href="tel:+919019263709">+91 90192 63709</a>
          <a href="/admin/login">Staff login</a>
          <a href="#top"><ArrowUp /> Back to top</a>
        </div>
      </div>
      <div className="site-shell footer-bottom">
        <span>© {new Date().getFullYear()} Asher Women & Child Healthcare.</span>
        <span>Made with <Heart /> for healthier families.</span>
      </div>
    </footer>
  );
}
