import { Activity, Baby, Heart, HeartHandshake, Microscope, ShieldPlus, Sparkles, Stethoscope } from "lucide-react";

const services = [
  { icon: Baby, title: "Pediatric Care", text: "Thoughtful consultations for newborns, infants, children and adolescents." },
  { icon: ShieldPlus, title: "Vaccinations", text: "Age-appropriate immunisation guidance with clear follow-up schedules." },
  { icon: Activity, title: "Allergy & Asthma", text: "Specialist assessment and long-term care plans for respiratory and allergic conditions." },
  { icon: Heart, title: "Pregnancy Care", text: "Personal antenatal and postnatal support throughout your pregnancy journey." },
  { icon: Stethoscope, title: "Women's Health", text: "Routine gynaecology, menstrual health, PCOS and preventive wellness care." },
  { icon: Sparkles, title: "Fertility Support", text: "Sensitive infertility evaluation, counselling and coordinated treatment planning." },
  { icon: Microscope, title: "Laparoscopic Care", text: "Evaluation and surgical guidance with a minimally invasive approach where suitable." },
  { icon: HeartHandshake, title: "Growth & Nutrition", text: "Growth monitoring, developmental review and practical nutrition guidance for children." },
];

export default function Services() {
  return (
    <section id="services" className="section section-soft">
      <div className="site-shell">
        <div className="section-heading split-heading">
          <div><span className="section-kicker">Care for every chapter</span><h2>Specialist services, under one roof.</h2></div>
          <p>From a newborn&apos;s first check-up to a woman&apos;s lifelong wellness, our clinic is designed around continuity, clarity and comfort.</p>
        </div>
        <div className="service-grid">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <article className="service-card" key={service.title}>
                <span className="service-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="service-icon"><Icon /></div>
                <h3>{service.title}</h3>
                <p>{service.text}</p>
                <a href="#appointment">Book this service <span>→</span></a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
