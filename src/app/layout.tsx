import { PwaRegister } from "@/components/pwa/PwaRegister";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://asherhealthcare.in"),
  applicationName: "Asher Women & Child Healthcare",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Asher Healthcare",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  title: {
    default: "Asher Women & Child Healthcare | Bengaluru",
    template: "%s | Asher Healthcare",
  },
  description:
    "Specialist pediatric, obstetric and gynaecology care in RK Hegde Nagar, Bengaluru. Book appointments with Asher Women and Child Healthcare.",
  keywords: [
    "pediatrician RK Hegde Nagar",
    "gynaecologist Thanisandra",
    "women and child clinic Bengaluru",
    "vaccination clinic",
    "pregnancy care",
  ],
  openGraph: {
    title: "Asher Women & Child Healthcare",
    description:
      "Compassionate specialist care for women and children in North Bengaluru.",
    url: "https://asherhealthcare.in",
    siteName: "Asher Healthcare",
    images: [
      {
        url: "/asher-hero-clinic-v2.webp",
        width: 1600,
        height: 900,
      },
    ],
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Asher Women & Child Healthcare",
    description:
      "Specialist care for women and children in Bengaluru.",
    images: ["/asher-hero-clinic-v2.webp"],
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d2b45",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body id="top">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <PwaRegister />
        {children}

      </body>
    </html>
  );
}
