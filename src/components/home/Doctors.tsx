import Image from "next/image";
import { Baby, CalendarDays, HeartPulse, Stethoscope } from "lucide-react";

const doctors = [
  {
    name: "Dr. Lt Col Shafi Ahamad",
    qualifications: "MBBS, MD (Pediatrics)",
    role: "Consultant Pediatrician",
    focus: "Pediatric Allergy & Asthma Specialist",
    image: "/images/dr-shafi-ahamad.jpg",
    imagePosition: "center 24%",
    icon: Baby,
    accent: "doctor-blue",
  },
  {
    name: "Dr. Shaik Reshma",
    qualifications: "MBBS, MS (OBG)",
    role: "Consultant Obstetrician & Gynaecologist",
    focus: "Laparoscopic Surgeon & Infertility Specialist",
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
          <h2>Expertise you can feel confident in.</h2>
          <p>Two focused practices, united by a shared commitment to careful, compassionate medicine.</p>
        </div>
        <div className="doctor-grid">
          {doctors.map((doctor) => {
            const Icon = doctor.icon;
            return (
              <article className={"doctor-card " + doctor.accent} key={doctor.name}>
                <div className="doctor-portrait">
                  <Image
                    src={doctor.image}
                    alt={`${doctor.name}, ${doctor.role} at Asher Women and Child Healthcare`}
                    fill
                    sizes="(max-width: 540px) calc(100vw - 28px), (max-width: 800px) 210px, (max-width: 1050px) 160px, 210px"
                    style={{ objectPosition: doctor.imagePosition }}
                    className="doctor-photo"
                  />
                </div>
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
