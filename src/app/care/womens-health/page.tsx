import type { Metadata } from "next";

import CareDetailPage from "@/components/care/CareDetailPage";
import { careJourneyById } from "@/lib/public-clinic-content";

export const metadata: Metadata = {
  title: "Gynaecologist & Pregnancy Care in RK Hegde Nagar",
  description:
    "Pregnancy, gynaecology, fertility and laparoscopic care with Dr. Shaik Reshma at Asher Healthcare, Bengaluru.",
  alternates: { canonical: "/care/womens-health" },
  openGraph: {
    title: "Women’s Health & Pregnancy Care | Asher Healthcare",
    description: "Private, respectful specialist care through every stage of women’s health.",
    images: ["/images/womens-care-consultation-v2.webp"],
  },
};

export default function WomensHealthPage() {
  return <CareDetailPage journey={careJourneyById("obg")} />;
}
