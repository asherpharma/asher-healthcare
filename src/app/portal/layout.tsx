import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Patient & Family Portal",
  description: "Secure access to your Asher Healthcare appointments, prescriptions, reports and receipts.",
  applicationName: "Asher Family",
  manifest: "/patient-portal.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Asher Family", statusBarStyle: "default" },
};

export default function PatientPortalLayout({ children }: { children: ReactNode }) {
  return children;
}

