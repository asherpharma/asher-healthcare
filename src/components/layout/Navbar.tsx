"use client";

import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Menu, Phone, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

const links = [
  { label: "Services", href: "#services" },
  { label: "Doctors", href: "#doctors" },
  { label: "Clinic", href: "#clinic" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="topline">
        <div className="site-shell topline-inner">
          <span><ShieldCheck size={15} /> Trusted women & child care in North Bengaluru</span>
          <a href="tel:+919019263709"><Phone size={14} /> +91 90192 63709</a>
        </div>
      </div>
      <header className="nav-wrap">
        <div className="site-shell nav-inner">
          <Link href="/" className="brand" aria-label="Asher Healthcare home">
            <span className="brand-mark"><Image src="/images/logo.png" alt="" width={54} height={54} priority /></span>
            <span><strong>Asher</strong><small>Women & Child Healthcare</small></span>
          </Link>

          <nav className="desktop-nav" aria-label="Main navigation">
            {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>

          <div className="nav-actions">
            <Link className="staff-link" href="/admin/login">Staff login</Link>
            <a className="button button-primary button-small" href="#appointment">
              <CalendarDays size={18} /> Book appointment
            </a>
          </div>

          <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>
            {open ? <X /> : <Menu />}
          </button>
        </div>

        {open && (
          <div className="mobile-nav">
            {links.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}
            <Link href="/admin/login" onClick={() => setOpen(false)}>Staff login</Link>
            <a className="button button-primary" href="#appointment" onClick={() => setOpen(false)}>Book appointment</a>
          </div>
        )}
      </header>
    </>
  );
}
