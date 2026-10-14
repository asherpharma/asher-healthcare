import type { Metadata } from "next";
import AppointmentCTA from "@/components/home/AppointmentCTA";
import VisitGuide from "@/components/home/VisitGuide";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import "../patient-home.css";

export const metadata: Metadata = {
  title: "Book an appointment",
  description: "Choose your Asher specialist and reserve an available appointment time.",
  alternates: { canonical: "/book" },
  robots: { index: false, follow: true },
};

export default function BookingPage() {
  return (
    <div className="patient-home">
      <Navbar />
      <main id="main-content">
        <div className="site-shell booking-page-heading">
          <h1>Book your appointment</h1>
          <p>Choose a time, add the patient&apos;s details, and wait for clinic confirmation.</p>
          <noscript><p>Enable JavaScript to reserve online, or call <a href="tel:+919019263709">+91 90192 63709</a> for an appointment.</p></noscript>
        </div>
        <AppointmentCTA />
        <VisitGuide />
      </main>
      <Footer />
    </div>
  );
}
