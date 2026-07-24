import { Baby, CalendarDays, HeartPulse, Stethoscope } from "lucide-react";

const doctors = [
  {
    initials: "SA",
    name: "Dr. Lt Col Shafi Ahamad",
    qualifications: "MBBS, MD (Pediatrics)",
    role: "Consultant Pediatrician",
    focus: "Pediatric Allergy & Asthma Specialist",
    icon: Baby,
    accent: "doctor-blue",
  },
  {
    initials: "SR",
    name: "Dr. Shaik Reshma",
    qualifications: "MBBS, MS (OBG)",
    role: "Consultant Obstetrician & Gynaecologist",
    focus: "Laparoscopic Surgeon & Infertility Specialist",
    icon: HeartPulse,
    accent: "doctor-rose",
  },
];

export default function Doctors() {
  return (
    <section id="doctors" className="section doctors-section">
      <div className="site-shell">
        <div className="section-heading centered-heading">
          <span className="section-kicker">Meet your specialists</span>
          <h2>Expertise you can feel confident in.</h2>
          <p>Two focused practices, united by a shared commitment to careful, compassionate medicine.</p>
        </div>
        <div className="doctor-grid">
          {doctors.map((doctor) => {
            const Icon = doctor.icon;
            return (
              <article className={"doctor-card " + doctor.accent} key={doctor.name}>
                <div className="doctor-portrait" aria-label="Doctor photograph will be added soon"><span>{doctor.initials}</span><small>Photo coming soon</small></div>
                <div className="doctor-details">
                  <div className="doctor-specialty"><Icon /> {doctor.role}</div>
                  <h3>{doctor.name}</h3>
                  <p className="doctor-qualifications">{doctor.qualifications}</p>
                  <p className="doctor-focus">{doctor.focus}</p>
                  <div className="doctor-actions"><a href="#appointment"><CalendarDays /> Book consultation</a><a href="tel:+919019263709"><Stethoscope /> Call clinic</a></div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
