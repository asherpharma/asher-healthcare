import Navbar from "@/components/layout/Navbar";
import Hero from "@/components/home/Hero";
import Services from "@/components/home/Services";
import CarePathways from "@/components/home/CarePathways";
import WhyChooseUs from "@/components/home/WhyChooseUs";
import Doctors from "@/components/home/Doctors";
import PatientJourney from "@/components/home/PatientJourney";
import Gallery from "@/components/home/Gallery";
import AppointmentCTA from "@/components/home/AppointmentCTA";
import Contact from "@/components/home/Contact";
import FrequentlyAskedQuestions, { clinicFaqs } from "@/components/home/FrequentlyAskedQuestions";
import MobileCareBar from "@/components/home/MobileCareBar";
import Footer from "@/components/layout/Footer";

const clinicSchema = {
  "@context": "https://schema.org",
  "@type": "MedicalClinic",
  name: "Asher Women and Child Healthcare",
  url: "https://asherhealthcare.in",
  telephone: "+91 90192 63709",
  image: "https://asherhealthcare.in/asher-hero-clinic-v2.webp",
  logo: "https://asherhealthcare.in/images/asher-logo-original.png",
  hasMap: "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5",
  areaServed: "North Bengaluru",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Ground Floor, 546, Thanisandra Main Road, Sri Balaji Krupa Layout, RK Hegde Nagar",
    addressLocality: "Bengaluru",
    addressRegion: "Karnataka",
    postalCode: "560077",
    addressCountry: "IN",
  },
  medicalSpecialty: [
    "https://schema.org/Pediatric",
    "https://schema.org/Obstetric",
    "https://schema.org/Gynecologic",
  ],
  employee: [
    {
      "@type": "Person",
      name: "Dr. Lt Col Shafi Ahamad",
      image: "https://asherhealthcare.in/images/dr-shafi-ahamad.jpg",
      jobTitle: "Consultant Pediatrician",
      knowsAbout: ["Pediatrics", "Newborn care", "Child allergy", "Childhood asthma"],
    },
    {
      "@type": "Person",
      name: "Dr. Shaik Reshma",
      image: "https://asherhealthcare.in/images/dr-shaik-reshma.jpg",
      jobTitle: "Consultant Obstetrician and Gynaecologist",
      knowsAbout: ["Obstetrics", "Gynaecology", "Fertility care", "Laparoscopic surgery"],
    },
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: clinicFaqs.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(clinicSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navbar />
      <main id="main-content">
        <Hero />
        <Services />
        <CarePathways />
        <WhyChooseUs />
        <Doctors />
        <PatientJourney />
        <Gallery />
        <AppointmentCTA />
        <FrequentlyAskedQuestions />
        <Contact />
      </main>
      <MobileCareBar />
      <Footer />
    </>
  );
}
