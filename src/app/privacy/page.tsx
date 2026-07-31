import LegalPage from "@/components/legal/LegalPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Asher Women & Child Healthcare collects, uses and protects website, appointment and clinic information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy & trust"
      title="Privacy policy"
      introduction="We treat health information with care and collect only what is needed to provide clinic services, manage appointments and maintain authorised records."
    >
      <section>
        <h2>Information we collect</h2>
        <p>When you book an appointment or receive care, we may collect your name, phone number, age or date of birth, appointment preferences, clinical records, prescriptions, reports and payment information. Website analytics may collect limited technical information such as device type and pages visited.</p>
      </section>
      <section>
        <h2>How information is used</h2>
        <p>Information is used to schedule and confirm appointments, identify patients, support clinical care, prepare prescriptions and reports, maintain billing records, contact you about requested services, improve clinic operations and meet applicable professional or legal obligations.</p>
      </section>
      <section>
        <h2>Who can access records</h2>
        <p>Patient records are available only to authorised Asher Healthcare staff with active accounts and an appropriate clinic role. We do not sell patient or visitor information. Access should be used only for legitimate care and clinic operations.</p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>We use carefully selected providers to operate the service, including Firebase for secure application infrastructure, Cloudflare for website delivery and protection, Google Analytics for limited website measurement, and Razorpay when online payment services are enabled. These providers process information under their own security and privacy terms.</p>
      </section>
      <section>
        <h2>Security and retention</h2>
        <p>We use encrypted connections, authenticated staff access, role-based permissions and restricted data rules. No system can guarantee absolute security. Records are retained only for clinic, professional, accounting and legal needs and are then removed or anonymised where appropriate.</p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>You may ask the clinic to correct inaccurate contact details, explain how your information is used, or help you access clinic records subject to identity checks and applicable requirements. Call the clinic at +91 90192 63709 for assistance.</p>
      </section>
      <section>
        <h2>Children&apos;s information</h2>
        <p>Information about children is provided by a parent, guardian or authorised caregiver and is used for paediatric care, vaccination, growth monitoring and related clinic services.</p>
      </section>
    </LegalPage>
  );
}
