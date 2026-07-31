import LegalPage from "@/components/legal/LegalPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Patient Rights & Responsibilities",
  description: "A clear guide to respectful, informed and private care at Asher Women & Child Healthcare.",
  alternates: { canonical: "/patient-rights" },
};

export default function PatientRightsPage() {
  return (
    <LegalPage
      eyebrow="Care charter"
      title="Patient rights & responsibilities"
      introduction="Good care is a partnership. This charter describes what patients and families can expect from Asher Healthcare and how they can help us provide safe, respectful care."
    >
      <section>
        <h2>Your rights</h2>
        <ul>
          <li>Respectful, compassionate care without unfair discrimination.</li>
          <li>Clear explanations about the proposed examination, treatment, benefits, material risks and available alternatives.</li>
          <li>The opportunity to ask questions and participate in decisions about care.</li>
          <li>Privacy during consultation and reasonable protection of personal and clinical information.</li>
          <li>Information about expected fees and an itemised receipt for clinic payments.</li>
          <li>Access to available prescriptions, reports and relevant clinic records subject to identity verification and applicable requirements.</li>
          <li>The ability to raise a concern or provide feedback without affecting respectful care.</li>
        </ul>
      </section>
      <section>
        <h2>Your responsibilities</h2>
        <ul>
          <li>Provide complete and accurate information about symptoms, medicines, allergies, medical history and previous care.</li>
          <li>Tell the clinical team when information is unclear or when you cannot follow a care plan.</li>
          <li>Treat staff, other patients and clinic property with respect.</li>
          <li>Attend at the agreed time or inform the clinic as early as possible if plans change.</li>
          <li>Follow reasonable safety and infection-control guidance.</li>
          <li>Review bills and make agreed payments or discuss concerns promptly with reception.</li>
        </ul>
      </section>
      <section>
        <h2>Children and dependent patients</h2>
        <p>A parent, guardian or authorised caregiver should provide accurate information and participate in decisions where required. We aim to explain care in age-appropriate language and respect the child&apos;s comfort and dignity.</p>
      </section>
      <section>
        <h2>Questions or concerns</h2>
        <p>Speak with the doctor or reception team during your visit, or call +91 90192 63709. We will listen, review the concern and explain the next step.</p>
      </section>
    </LegalPage>
  );
}
