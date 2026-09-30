import {
  ArrowRight,
  MessageCircle,
  Phone,
  ShieldAlert,
} from "lucide-react";

export const clinicFaqs = [
  {
    question: "When can I book an appointment?",
    answer:
      "Online appointments are normally available Monday to Saturday in 15-minute slots: Dr. Shafi from 5:00 PM to 8:00 PM and Dr. Reshma from 7:00 PM to 9:00 PM. The booking form always shows the latest timings set by the clinic.",
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
          <span className="section-kicker">Good to know</span>
          <h2 id="faq-heading">Your questions,<br /><em>answered.</em></h2>
          <p className="section-intro">
            A few practical answers. For anything else, our reception team is a call away.
          </p>

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
