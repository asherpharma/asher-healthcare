import {
  CalendarCheck2,
  ClipboardCheck,
  FileHeart,
  HeartHandshake,
  LockKeyhole,
  Smartphone,
} from "lucide-react";
import Link from "next/link";

const steps = [
  {
    number: "01",
    icon: HeartHandshake,
    title: "Choose the right specialist",
    text: "Use the care guide or speak with reception if you are unsure where to begin.",
  },
  {
    number: "02",
    icon: CalendarCheck2,
    title: "Reserve a live slot",
    text: "Pick an available 15-minute appointment directly from the clinic schedule.",
  },
  {
    number: "03",
    icon: ClipboardCheck,
    title: "Complete one smooth visit",
    text: "Reception connects registration, consultation, payment, receipt and prescription.",
  },
  {
    number: "04",
    icon: FileHeart,
    title: "Keep care within reach",
    text: "When enabled by the clinic, the family portal keeps visits, reports and documents together.",
  },
] as const;

export default function PatientJourney() {
  return (
    <section id="journey" className="section public-journey-section" aria-labelledby="journey-heading">
      <div className="site-shell public-journey-shell">
        <div className="public-journey-intro">
          <span className="section-kicker">A simpler patient journey</span>
          <h2 id="journey-heading">From first click to follow-up, everything feels connected.</h2>
          <p>
            Asher combines personal clinical care with practical digital tools, so families spend
            less time coordinating and more time focused on health.
          </p>
          <div className="public-journey-trust">
            <span><LockKeyhole aria-hidden="true" /> Secure staff access</span>
            <span><Smartphone aria-hidden="true" /> Mobile-friendly experience</span>
          </div>
          <Link className="button public-journey-portal" href="/portal/login">
            Open family portal
          </Link>
        </div>

        <ol className="public-journey-steps">
          {steps.map(({ number, icon: Icon, title, text }) => (
            <li key={number}>
              <span className="public-journey-number">{number}</span>
              <span className="public-journey-icon"><Icon aria-hidden="true" /></span>
              <div><h3>{title}</h3><p>{text}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
