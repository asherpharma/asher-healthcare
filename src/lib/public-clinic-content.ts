import type { DoctorId } from "@/lib/appointments";

export const CARE_SELECTION_EVENT = "asher:select-care";

export type CareJourney = {
  id: DoctorId;
  shortLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  image: string;
  imageAlt: string;
  href: string;
  doctor: string;
  doctorRole: string;
  reasons: readonly string[];
  preparation: readonly string[];
};

export const careJourneys: readonly CareJourney[] = [
  {
    id: "pediatrics",
    shortLabel: "Child care",
    title: "Pediatrics & newborn care",
    eyebrow: "From newborn days to adolescence",
    description:
      "A calm, family-centred space for everyday illnesses, growth, vaccination, allergy, asthma and developmental concerns.",
    image: "/images/pediatric-care-consultation-v2.webp",
    imageAlt:
      "Representative image of a South Asian family in a reassuring pediatric consultation",
    href: "/care/pediatrics",
    doctor: "Dr. Lt Col Shafi Ahamad",
    doctorRole: "Consultant Pediatrician",
    reasons: [
      "Newborn and routine child check-ups",
      "Fever and common childhood illnesses",
      "Vaccination planning and follow-up",
      "Allergy, wheezing and asthma care",
      "Growth, nutrition and development",
    ],
    preparation: [
      "Vaccination record when available",
      "Previous prescriptions and reports",
      "Current medicines and allergy details",
    ],
  },
  {
    id: "obg",
    shortLabel: "Women’s care",
    title: "Women’s health & pregnancy care",
    eyebrow: "Support through every life stage",
    description:
      "Private, respectful specialist care for pregnancy, periods, PCOS, fertility, preventive health and laparoscopic evaluation.",
    image: "/images/womens-care-consultation-v2.webp",
    imageAlt:
      "Representative image of a South Asian woman in a private gynaecology consultation",
    href: "/care/womens-health",
    doctor: "Dr. Shaik Reshma",
    doctorRole: "Consultant Obstetrician & Gynaecologist",
    reasons: [
      "Pregnancy, antenatal and postnatal care",
      "Periods, PCOS and hormonal concerns",
      "Fertility evaluation and counselling",
      "Preventive gynaecology and wellness",
      "Laparoscopic assessment and planning",
    ],
    preparation: [
      "Previous scan and laboratory reports",
      "Current medicines and cycle information",
      "Pregnancy or treatment records when relevant",
    ],
  },
] as const;

export function careJourneyById(id: DoctorId) {
  return careJourneys.find((journey) => journey.id === id) ?? careJourneys[0];
}
