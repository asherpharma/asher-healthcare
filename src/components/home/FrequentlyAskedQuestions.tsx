import {
  ArrowRight,
  CalendarCheck2,
  FileHeart,
  MessageCircle,
  Phone,
  ShieldAlert,
} from "lucide-react";

export const clinicFaqs = [
  {
    question: "When can I book an appointment?",
    answer:
      "Online specialist appointments are normally available Monday to Saturday from 5:00 PM to 8:00 PM in 15-minute slots. The booking form always shows the latest timings set by the clinic.",
  },
  {
    question: "Which specialist should I choose?",
    answer:
      "Choose Dr. Lt Col Shafi Ahamad for newborn, child, vaccination, allergy or asthma care. Choose Dr. Shaik Reshma for pregnancy, gynaecology, fertility or laparoscopic care.",
  },
  {
    question: "What should I bring to the consultation?",
    answer:
      "Bring relevant prescriptions, laboratory or scan reports, a list of current medicines, and your child's vaccination record or pregnancy record when applicable.",
  },
  {
    question: "Can two family members use the same mobile number?",
    answer:
      "Yes. Please make a separate appointment for each patient and enter each person's correct name. This helps the clinic keep their medical records separate and accurate.",
  },
  {
    question: "How do I change or cancel an appointment?",
    answer:
      "Call or WhatsApp the clinic on +91 90192 63709. The team will help cancel or reschedule it. Please do not submit a second booking unless the clinic asks you to.",
  },
  {
    question: "Should I use online booking for an emergency?",
    answer:
      "No. Online booking is for routine clinic visits. For a medical emergency, contact local emergency services or go to the nearest emergency department immediately.",
  },
] as const;

export default function FrequentlyAskedQuestions() {
  return (
    <section id="faq" className="section faq-section" aria-labelledby="faq-heading">
      <div className="site-shell faq-layout">
        <div className="faq-copy">
          <span className="section-kicker">Plan your visit</span>
          <h2 id="faq-heading">Helpful answers before you arrive.</h2>
          <p className="section-intro">
            A little preparation helps the consultation stay focused, comfortable and useful.
          </p>

          <div className="visit-guide" aria-label="Before your visit">
            <span className="visit-guide-icon"><FileHeart aria-hidden="true" /></span>
            <div>
              <h3>Keep important records ready</h3>
              <p>
                Carry previous prescriptions, reports, current medicines, and any vaccination or
                pregnancy records relevant to the visit.
              </p>
            </div>
          </div>

          <div className="visit-guide visit-guide-gold" aria-label="Appointment timing">
            <span className="visit-guide-icon"><CalendarCheck2 aria-hidden="true" /></span>
            <div>
              <h3>Arrive a few minutes early</h3>
              <p>
                Reception can complete registration and payment before the consultation begins.
              </p>
            </div>
          </div>

          <div className="urgent-note">
            <ShieldAlert aria-hidden="true" />
            <p><strong>For emergencies:</strong> use local emergency services or the nearest emergency department.</p>
          </div>
        </div>

        <div className="faq-panel">
          {clinicFaqs.map((item, index) => (
            <details key={item.question} className="faq-item" open={index === 0}>
              <summary>
                <span>{item.question}</span>
                <span className="faq-toggle" aria-hidden="true">+</span>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}

          <div className="faq-help-card">
            <div>
              <small>Still need help?</small>
              <strong>Speak directly with the clinic.</strong>
            </div>
            <div className="faq-help-actions">
              <a href="tel:+919019263709"><Phone aria-hidden="true" /> Call</a>
              <a href="https://wa.me/919019263709" target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden="true" /> WhatsApp <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
