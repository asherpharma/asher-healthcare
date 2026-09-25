/* eslint-disable @next/next/no-html-link-for-pages -- Full-page navigation isolates optional Ads measurement. */
"use client";

import Image from "next/image";
import { CalendarDays, Menu, Phone, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const links = [
  { label: "Services", href: "/#services" },
  { label: "Care guide", href: "/#care" },
  { label: "Doctors", href: "/#doctors" },
  { label: "Patient journey", href: "/#journey" },
  { label: "Contact", href: "/#contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <div className="topline">
        <div className="site-shell topline-inner">
          <span><ShieldCheck size={15} /> Specialist women & child care in North Bengaluru</span>
          <a href="tel:+919019263709"><Phone size={14} /> +91 90192 63709</a>
        </div>
      </div>
      <header className="nav-wrap">
        <div className="site-shell nav-inner">
          <a href="/" className="brand" aria-label="Asher Healthcare home">
            <span className="brand-mark"><Image src="/images/asher-logo-compact-v2.webp" alt="" width={54} height={54} priority /></span>
            <span><strong>Asher</strong><small>Women & Child Healthcare</small></span>
          </a>

          <nav className="desktop-nav" aria-label="Main navigation">
            {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>

          <div className="nav-actions">
            <a className="staff-link" href="/portal/login">Patient portal</a>
            <a className="staff-link" href="/admin/login">Staff login</a>
            <a className="button button-primary button-small" href="/#appointment">
              <CalendarDays size={18} /> Book appointment
            </a>
          </div>

          <button
            ref={menuButtonRef}
            className="menu-button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-controls="mobile-navigation"
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>

        {open && (
          <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation">
            {links.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}
            <a href="/portal/login" onClick={() => setOpen(false)}>Patient portal</a>
            <a href="/admin/login" onClick={() => setOpen(false)}>Staff login</a>
            <a className="button button-primary" href="/#appointment" onClick={() => setOpen(false)}>Book appointment</a>
          </nav>
        )}
      </header>
    </>
  );
}
