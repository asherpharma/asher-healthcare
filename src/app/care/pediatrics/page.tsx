import type { Metadata } from "next";

import CareDetailPage from "@/components/care/CareDetailPage";
import { careJourneyById } from "@/lib/public-clinic-content";

export const metadata: Metadata = {
  title: "Pediatrician & Newborn Care in RK Hegde Nagar",
  description:
    "Pediatric, newborn, vaccination, allergy and asthma care with Dr. Lt Col Shafi Ahamad at Asher Healthcare, Bengaluru.",
  alternates: { canonical: "/care/pediatrics" },
  openGraph: {
    title: "Pediatrics & Newborn Care | Asher Healthcare",
    description: "Calm, family-centred specialist care from newborn days to adolescence.",
    images: ["/images/pediatric-care-consultation-v2.webp"],
  },
};

export default function PediatricsPage() {
  return <CareDetailPage journey={careJourneyById("pediatrics")} />;
}
