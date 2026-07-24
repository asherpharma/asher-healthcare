"use client";

import Link from "next/link";
import { Menu, Phone, CalendarDays } from "lucide-react";
import { useState } from "react";

export default function Navbar() {
  const [open, setOpen] = useState(false);

  const links = [
    { name: "Home", href: "#" },
    { name: "Services", href: "#services" },
    { name: "Doctors", href: "#doctors" },
    { name: "Gallery", href: "#gallery" },
    { name: "Contact", href: "#contact" },
  ];

  return (
    <header className="fixed top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#233A59] text-lg font-bold text-white">
            A
          </div>

          <div>
            <h1 className="text-lg font-bold text-[#233A59]">
              Asher Healthcare
            </h1>
            <p className="text-xs text-gray-500">
              Women & Child Clinic
            </p>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              className="font-medium text-slate-700 transition hover:text-[#233A59]"
            >
              {link.name}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="tel:+919019263709"
            className="flex items-center gap-2 rounded-xl border px-4 py-2 hover:bg-slate-100"
          >
            <Phone size={18} />
            Call
          </a>

          <button className="flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-2 text-white hover:bg-[#1b2d46]">
            <CalendarDays size={18} />
            Book Appointment
          </button>
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="md:hidden"
          aria-label="Toggle menu"
        >
          <Menu />
        </button>
      </div>

      {open && (
        <div className="border-t bg-white md:hidden">
          <div className="flex flex-col gap-4 p-6">
            {links.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.name}
              </Link>
            ))}

            <a
              href="tel:+919019263709"
              className="rounded-xl border p-3 text-center"
            >
              Call Clinic
            </a>

            <button className="rounded-xl bg-[#233A59] p-3 text-white">
              Book Appointment
            </button>
          </div>
        </div>
      )}
    </header>
  );
}