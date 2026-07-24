import {
  Baby,
  HeartPulse,
  ShieldPlus,
  Stethoscope,
  Activity,
  Heart,
} from "lucide-react";

const services = [
  {
    title: "Obstetrics & Gynaecology",
    description:
      "Complete women's healthcare including pregnancy, infertility and routine checkups.",
    icon: Heart,
  },
  {
    title: "Pregnancy Care",
    description:
      "Comprehensive antenatal and postnatal care for a healthy pregnancy journey.",
    icon: HeartPulse,
  },
  {
    title: "Pediatrics",
    description:
      "Complete healthcare for newborns, infants, children and adolescents.",
    icon: Baby,
  },
  {
    title: "Vaccination",
    description:
      "Routine immunizations following the latest national vaccination schedule.",
    icon: ShieldPlus,
  },
  {
    title: "Women's Wellness",
    description:
      "Preventive health checkups, menstrual care and menopause management.",
    icon: Activity,
  },
  {
    title: "Child Development",
    description:
      "Growth monitoring, nutrition advice and developmental assessments.",
    icon: Stethoscope,
  },
];

export default function Services() {
  return (
    <section id="services" className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center">
          <h2 className="text-4xl font-bold text-[#233A59]">
            Our Services
          </h2>

          <p className="mt-4 text-slate-600">
            Comprehensive healthcare services for women and children.
          </p>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const Icon = service.icon;

            return (
              <div
                key={service.title}
                className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-2 hover:shadow-xl"
              >
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#233A59]/10">
                  <Icon className="h-8 w-8 text-[#233A59]" />
                </div>

                <h3 className="text-xl font-semibold text-[#233A59]">
                  {service.title}
                </h3>

                <p className="mt-4 leading-7 text-slate-600">
                  {service.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}