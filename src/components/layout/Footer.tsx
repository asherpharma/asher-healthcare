import Image from "next/image";
import Link from "next/link";
import { ArrowUp, Heart, Camera, MessageCircle, Phone } from "lucide-react";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-shell footer-grid">
        <div className="footer-brand"><div className="brand footer-logo"><span className="brand-mark"><Image src="/images/logo.png" alt="" width={56} height={56} /></span><span><strong>Asher</strong><small>Women & Child Healthcare</small></span></div><p>Compassionate specialist care for women, children and families in North Bengaluru.</p><div className="footer-social"><a href="tel:+919019263709" aria-label="Call Asher Healthcare"><Phone /></a><a href="https://wa.me/919019263709" target="_blank" rel="noreferrer" aria-label="WhatsApp Asher Healthcare"><MessageCircle /></a><a href="#" aria-label="Instagram"><Camera /></a></div></div>
        <div><h3>Explore</h3><a href="#services">Services</a><a href="#doctors">Doctors</a><a href="#clinic">Clinic</a><a href="#appointment">Appointments</a></div>
        <div><h3>Care</h3><a href="#services">Pediatrics</a><a href="#services">Pregnancy care</a><a href="#services">Women&apos;s health</a><a href="#services">Vaccinations</a></div>
        <div><h3>Clinic</h3><a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer">Get directions</a><a href="tel:+919019263709">+91 90192 63709</a><Link href="/admin/login">Staff login</Link><a href="#top"><ArrowUp /> Back to top</a></div>
      </div>
      <div className="site-shell footer-bottom"><span>© {new Date().getFullYear()} Asher Women & Child Healthcare.</span><span>Made with <Heart /> for healthier families.</span></div>
    </footer>
  );
}
