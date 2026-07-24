import AppointmentCTA from "@/components/home/AppointmentCTA";
import Contact from "@/components/home/Contact";
import Doctors from "@/components/home/Doctors";
import Gallery from "@/components/home/Gallery";
import Hero from "@/components/home/Hero";
import Services from "@/components/home/Services";
import WhyChooseUs from "@/components/home/WhyChooseUs";
import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";

export default function Home() {
  return (
    <>
      <Navbar />
      <main id="top" className="pt-20">
        <Hero />
        <WhyChooseUs />
        <Services />
        <Doctors />
        <Gallery />
        <AppointmentCTA />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
