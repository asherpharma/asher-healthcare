import Navbar from "@/components/layout/Navbar";
import Hero from "@/components/home/Hero";
import Services from "@/components/home/Services";
import WhyChooseUs from "@/components/home/WhyChooseUs";
import Doctors from "@/components/home/Doctors";
import Gallery from "@/components/home/Gallery";
import AppointmentCTA from "@/components/home/AppointmentCTA";
import Contact from "@/components/home/Contact";
import Footer from "@/components/layout/Footer";

const clinicSchema = {
  "@context": "https://schema.org",
  "@type": "MedicalClinic",
  name: "Asher Women and Child Healthcare",
  url: "https://asherhealthcare.in",
  telephone: "+91 90192 63709",
  image: "https://asherhealthcare.in/asher-hero-clinic.png",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Ground Floor, 546, Thanisandra Main Road, Sri Balaji Krupa Layout, RK Hegde Nagar",
    addressLocality: "Bengaluru",
    addressRegion: "Karnataka",
    postalCode: "560077",
    addressCountry: "IN",
  },
  medicalSpecialty: ["Pediatrics", "Obstetrics", "Gynecology"],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(clinicSchema) }}
      />
      <Navbar />
      <main id="main-content">
        <Hero />
        <Services />
        <WhyChooseUs />
        <Doctors />
        <Gallery />
        <AppointmentCTA />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
