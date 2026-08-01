import AdminShell from "@/components/admin/AdminShell";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Asher Staff Mobile V2",
  description: "Secure mobile-first clinic workspace for Asher Healthcare staff.",
  applicationName: "Asher Healthcare Staff V2",
  manifest: "/staff-v2.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Asher Staff V2",
    statusBarStyle: "black-translucent",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
