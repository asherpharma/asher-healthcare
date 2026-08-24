"use client";

import {
  Baby,
  CalendarDays,
  CheckCircle2,
  HeartPulse,
  Phone,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import type { DoctorId } from "@/lib/appointments";
import {
  CARE_SELECTION_EVENT,
  careJourneyById,
  careJourneys,
} from "@/lib/public-clinic-content";

const careIcons = {
  pediatrics: Baby,
  obg: HeartPulse,
} satisfies Record<DoctorId, typeof Baby>;

function scrollToBooking() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("appointment")?.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

export default function CarePathways() {
  const [selectedId, setSelectedId] = useState<DoctorId>("pediatrics");
  const selected = careJourneyById(selectedId);
  const SelectedIcon = careIcons[selected.id];

  function chooseAndBook(doctorId: DoctorId) {
    setSelectedId(doctorId);
    const url = new URL(window.location.href);
    url.searchParams.set("care", doctorId);
    url.hash = "appointment";
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(
      new CustomEvent(CARE_SELECTION_EVENT, { detail: { doctorId } }),
    );
    scrollToBooking();
  }

  return (
    <section id="care" className="section public-care-section" aria-labelledby="care-heading">
      <div className="site-shell">
        <div className="section-heading split-heading public-care-heading">
          <div>
            <span className="section-kicker">Find the right care</span>
            <h2 id="care-heading">One clinic. Two specialist pathways.</h2>
          </div>
          <p id="care-guidance">
            Choose the closest match to see who to book, common reasons to visit,
            and what to bring. This guide helps with navigation—it does not diagnose.
          </p>
        </div>

        <div className="public-care-tabs" role="group" aria-label="Choose a care pathway">
          {careJourneys.map((journey) => {
            const Icon = careIcons[journey.id];
            const active = journey.id === selectedId;
            return (
              <button
                key={journey.id}
                type="button"
                aria-pressed={active}
                className={active ? "public-care-tab is-active" : "public-care-tab"}
                onClick={() => setSelectedId(journey.id)}
              >
                <span><Icon aria-hidden="true" /></span>
                <span><small>{journey.eyebrow}</small><strong>{journey.shortLabel}</strong></span>
              </button>
            );
          })}
        </div>

        <article
          className={`public-care-panel public-care-panel-${selected.id}`}
        >
          <div className="public-care-image">
            <Image
              key={selected.image}
              src={selected.image}
              alt={selected.imageAlt}
              fill
              sizes="(max-width: 800px) calc(100vw - 28px), 48vw"
            />
            <span className="public-care-image-label">
              <Sparkles aria-hidden="true" /> Representative care experience
            </span>
          </div>

          <div className="public-care-copy">
            <span className="public-care-icon"><SelectedIcon aria-hidden="true" /></span>
            <p className="public-care-eyebrow">{selected.eyebrow}</p>
            <h3>{selected.title}</h3>
            <p className="public-care-description">{selected.description}</p>

            <div className="public-care-doctor">
              <small>Your specialist</small>
              <strong>{selected.doctor}</strong>
              <span>{selected.doctorRole}</span>
            </div>

            <ul className="public-care-reasons" aria-label="Common reasons to visit">
              {selected.reasons.map((reason) => (
                <li key={reason}><CheckCircle2 aria-hidden="true" /> {reason}</li>
              ))}
            </ul>

            <div className="public-care-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => chooseAndBook(selected.id)}
              >
                <CalendarDays aria-hidden="true" /> Choose this care
              </button>
              <Link className="button button-ghost" href={selected.href}>Learn more</Link>
            </div>
          </div>
        </article>

        <div className="public-care-support">
          <div>
            <ShieldAlert aria-hidden="true" />
            <p><strong>Not sure which specialist to choose?</strong> Our clinic team can guide you. For emergencies, use local emergency services or the nearest emergency department.</p>
          </div>
          <a href="tel:+919019263709"><Phone aria-hidden="true" /> Call +91 90192 63709</a>
        </div>
      </div>
    </section>
  );
}
