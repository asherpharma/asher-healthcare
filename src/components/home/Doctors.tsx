import Image from "next/image";
import { Baby, CalendarDays, Clock3, HeartPulse } from "lucide-react";
import CareBookingLink from "./CareBookingLink";

const doctors = [
  {
    id: "pediatrics" as const,
    name: "Dr. Lt Col Shafi Ahamad",
    qualifications: "MBBS, MD (Pediatrics)",
    role: "Consultant Pediatrician",
    focus: "Pediatric Allergy & Asthma Specialist",
    hours: "Mon–Sat · 5:00 PM–8:00 PM",
    image: "/images/dr-shafi-ahamad.jpg",
    imagePosition: "center 24%",
    icon: Baby,
    accent: "doctor-blue",
  },
  {
    id: "obg" as const,
    name: "Dr. Shaik Reshma",
    qualifications: "MBBS, MS (OBG)",
    role: "Consultant Obstetrician & Gynaecologist",
    focus: "Laparoscopic Surgeon & Infertility Specialist",
    hours: "Mon–Sat · 7:00 PM–9:00 PM",
    image: "/images/dr-shaik-reshma.jpg",
    imagePosition: "center 20%",
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
          <h2>Your doctor. Your questions.<br /><em>Time for both.</em></h2>
          <p>Get to know the specialists who will be caring for you.</p>
        </div>
        <div className="doctor-grid">
          {doctors.map((doctor) => {
            const Icon = doctor.icon;
            return (
              <article
                className={`doctor-card ${doctor.accent}`}
                key={doctor.name}
              >
                <div className="doctor-portrait">
                  <Image
                    src={doctor.image}
                    alt={`${doctor.name}, ${doctor.role} at Asher Women and Child Healthcare`}
                    fill
                    sizes="(max-width: 540px) 110px, (max-width: 900px) 190px, 175px"
                    style={{ objectPosition: doctor.imagePosition }}
                    className="doctor-photo"
                  />
                </div>
                <div className="doctor-details">
                  <div className="doctor-specialty"><Icon /> {doctor.role}</div>
                  <h3>{doctor.name}</h3>
                  <p className="doctor-qualifications">{doctor.qualifications}</p>
                  <p className="doctor-focus">{doctor.focus}</p>
                  <p className="doctor-hours"><Clock3 aria-hidden="true" /><span><small>Usual consultation hours</small>{doctor.hours}</span></p>
                  <div className="doctor-actions"><CareBookingLink doctorId={doctor.id}><CalendarDays aria-hidden="true" /> Book with {doctor.id === "pediatrics" ? "Dr. Shafi" : "Dr. Reshma"}</CareBookingLink></div>
                </div>
              </article>
            );
          })}
        </div>
        <p className="patient-care-note">Timings can change. The booking form shows the latest schedule set by the clinic.</p>
      </div>
    </section>
  );
}
