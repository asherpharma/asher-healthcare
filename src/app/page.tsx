import Navbar from "@/components/layout/Navbar";
import Hero from "@/components/home/Hero";
import Services from "@/components/home/Services";

export default function Home() {
  return (
    <>
      <Navbar />

      <main className="pt-20">
        <Hero />
        <Services />
      </main>
    </>
  );
}