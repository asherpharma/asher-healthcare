import type { Metadata, Viewport } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const playfair = Playfair_Display({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://asherhealthcare.in"),
  title: { default: "Asher Women & Child Healthcare | Bengaluru", template: "%s | Asher Healthcare" },
  description: "Specialist pediatric, obstetric and gynaecology care in RK Hegde Nagar, Bengaluru. Book appointments with Asher Women and Child Healthcare.",
  keywords: ["pediatrician RK Hegde Nagar", "gynaecologist Thanisandra", "women and child clinic Bengaluru", "vaccination clinic", "pregnancy care"],
  openGraph: { title: "Asher Women & Child Healthcare", description: "Compassionate specialist care for women and children in North Bengaluru.", url: "https://asherhealthcare.in", siteName: "Asher Healthcare", images: [{ url: "/asher-hero-clinic.png", width: 1536, height: 1024 }], locale: "en_IN", type: "website" },
  twitter: { card: "summary_large_image", title: "Asher Women & Child Healthcare", description: "Specialist care for women and children in Bengaluru.", images: ["/asher-hero-clinic.png"] },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d2b45" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body id="top" className={geist.variable + " " + playfair.variable}>{children}</body></html>;
}
