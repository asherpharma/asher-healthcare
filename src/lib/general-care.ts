export const GENERAL_CARE_HREF = "/care/general-care-lab-tests";

export const clinicVisit = {
  phone: "+91 90192 63709",
  phoneHref: "tel:+919019263709",
  directionsHref: "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5",
  address:
    "Ground Floor, 546, Thanisandra Main Road, Sri Balaji Krupa Layout, RK Hegde Nagar, Bengaluru, Karnataka 560077",
} as const;

// Clinic-confirmed services. Do not infer availability, prices or general-care
// hours from the specialist appointment schedule.
export const generalCareServices = [
  {
    title: "General consultations for all ages",
    description:
      "Medical consultations for children and adults, with assessment of everyday health concerns and advice on the next steps in care.",
  },
  {
    title: "Blood and laboratory tests",
    description:
      "Blood tests and laboratory testing at Asher. Call to confirm the specific test, preparation instructions and expected report timing before your visit.",
  },
  {
    title: "X-ray and ultrasound services",
    description:
      "X-ray and ultrasound services at the clinic. Call with your prescribed investigation to check availability, preparation and booking arrangements.",
  },
  {
    title: "Doctor-prescribed day care & IV drips",
    description:
      "Medically supervised day-care and IV treatment when prescribed by a doctor and clinically appropriate after assessment.",
  },
  {
    title: "Vaccinations",
    description:
      "Vaccination services with clinical guidance. Contact the clinic to confirm the vaccine you need, availability and appointment arrangements.",
  },
  {
    title: "Fertility consultations & semen analysis",
    description:
      "Fertility consultations, semen analysis and male-fertility consultations. Call for preparation and booking details. On-site IVF treatment is not offered.",
  },
] as const;
