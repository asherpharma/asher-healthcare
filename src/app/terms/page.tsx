import LegalPage from "@/components/legal/LegalPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Website Terms",
  description: "Terms for using the Asher Women & Child Healthcare website, appointment and payment services.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Website terms"
      title="Terms of use"
      introduction="These terms explain the appropriate use of this website, its appointment service and any payment features made available by Asher Healthcare."
    >
      <section>
        <h2>Clinic information</h2>
        <p>Website information is provided for general awareness and does not replace an examination, diagnosis or personalised advice from a qualified medical professional.</p>
      </section>
      <section>
        <h2>Appointments</h2>
        <p>An online request is not confirmed until the clinic accepts it. Timings may change because clinical care can be unpredictable. Please provide accurate patient and contact information so the clinic can respond to your request.</p>
      </section>
      <section>
        <h2>Emergencies</h2>
        <p>This website and its appointment form are not emergency services and are not continuously monitored. For urgent or life-threatening symptoms, contact the appropriate emergency service or go to the nearest emergency department immediately.</p>
      </section>
      <section>
        <h2>Payments and receipts</h2>
        <p>Charges shown by the clinic apply to the stated consultation, service or invoice. Online payments, when enabled, may be processed by Razorpay. A payment is complete only after the clinic system records a successful transaction. Contact the clinic if a debit is not reflected in your receipt.</p>
      </section>
      <section>
        <h2>Cancellations and refunds</h2>
        <p>Please contact the clinic promptly to cancel or reschedule. Any refund depends on the service, payment status and clinic review. Payment gateway or banking processing times may apply.</p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>Do not attempt to access staff areas without authorisation, interfere with the website, submit false information, upload harmful content, or use the service in a way that could affect another patient or clinic operation.</p>
      </section>
      <section>
        <h2>Patient and family portal</h2>
        <p>Portal access is personal and may be provided only after clinic verification. Keep your sign-in secure, use a private device where possible and sign out from shared devices. A parent, guardian or caregiver may access a dependent&apos;s information only while the clinic&apos;s approval remains active. Contact the clinic immediately if access is incorrect, no longer appropriate or may have been compromised.</p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>We may update these terms as services change. The current version will remain available on this page. Call +91 90192 63709 with questions about an appointment, invoice or website service.</p>
      </section>
    </LegalPage>
  );
}
