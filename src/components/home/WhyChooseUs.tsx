import Image from "next/image";
import { BadgeCheck, Clock3, HeartHandshake, ShieldCheck } from "lucide-react";

const reasons = [
  { icon: BadgeCheck, title: "Specialist-led", text: "Direct care from qualified pediatric and obstetric-gynaecology consultants." },
  { icon: HeartHandshake, title: "Personal by design", text: "Appointments that leave room for questions, explanation and informed choices." },
  { icon: ShieldCheck, title: "Calm & considered", text: "A clean, welcoming environment created for women, children and families." },
  { icon: Clock3, title: "Simple access", text: "Live Mon–Sat specialist slots, quick calling, WhatsApp help and one-tap directions." },
];

export default function WhyChooseUs() {
  return (
    <section className="section why-section">
      <div className="site-shell why-grid">
        <div className="why-visual">
          <div className="abstract-card"><Image src="/asher-abstract-care-v2.webp" alt="Abstract navy and gold artwork representing women and child healthcare" fill sizes="(max-width: 900px) 92vw, 44vw" /></div>
          <div className="care-quote"><strong>Care should feel clear, calm and human.</strong><span>That belief shapes every Asher appointment.</span></div>
        </div>
        <div className="why-copy">
          <span className="section-kicker">Why families choose Asher</span>
          <h2>Modern medicine. Meaningful attention.</h2>
          <p className="section-intro">We combine clinical expertise with the kind of listening and continuity that families value—so every visit feels understood and every next step feels clear.</p>
          <div className="reason-list">
            {reasons.map(({ icon: Icon, title, text }) => (
              <div className="reason-item" key={title}><span><Icon /></span><div><h3>{title}</h3><p>{text}</p></div></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
