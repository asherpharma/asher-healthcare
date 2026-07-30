import { jsPDF } from "jspdf";

export const clinicNavy: [number, number, number] = [35, 58, 89];
export const clinicGold: [number, number, number] = [168, 134, 74];

const clinicLogoPath = "/images/asher-logo-print.png";
let clinicLogoPromise: Promise<string> | null = null;

export function safePdfName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function doctorCredentials(name: string) {
  if (name.includes("Reshma")) {
    return [
      "MBBS, MS (OBG)",
      "Consultant Obstetrician & Gynaecologist",
      "Laparoscopic Surgeon & Infertility Specialist",
    ];
  }

  return [
    "MBBS, MD (Pediatrics)",
    "Consultant Pediatrician",
    "Pediatric Allergy & Asthma Specialist",
  ];
}

export function patientAge(dateOfBirth: string, asOf = new Date()) {
  const birthDate = new Date(dateOfBirth + "T00:00:00");
  if (!dateOfBirth || Number.isNaN(birthDate.getTime()) || birthDate > asOf) return "Not recorded";

  let years = asOf.getFullYear() - birthDate.getFullYear();
  let months = asOf.getMonth() - birthDate.getMonth();
  let days = asOf.getDate() - birthDate.getDate();

  if (days < 0) {
    months -= 1;
    days += new Date(asOf.getFullYear(), asOf.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years >= 2) return years + " years";
  if (years === 1) return months ? "1 year " + months + " months" : "1 year";
  if (months > 0) return months + " month" + (months === 1 ? "" : "s");
  return Math.max(0, days) + " day" + (days === 1 ? "" : "s");
}

async function loadClinicLogoDataUrl() {
  const response = await fetch(clinicLogoPath);
  if (!response.ok) throw new Error("Unable to load clinic logo");
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function clinicLogoDataUrl() {
  clinicLogoPromise ??= loadClinicLogoDataUrl().catch((error) => {
    clinicLogoPromise = null;
    throw error;
  });
  return clinicLogoPromise;
}

export function preloadClinicPdfAssets() {
  return clinicLogoDataUrl().then(() => undefined);
}

function drawLogoFallback(pdf: jsPDF) {
  pdf.setDrawColor(...clinicGold);
  pdf.setLineWidth(1.1);
  pdf.circle(28, 21, 12);
  pdf.setTextColor(...clinicGold);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("A+", 28, 24, { align: "center" });
}

export async function drawClinicHeader(pdf: jsPDF, documentTitle: string) {
  const pageWidth = pdf.internal.pageSize.getWidth();

  try {
    const logo = await clinicLogoDataUrl();
    pdf.addImage(logo, "PNG", 14, 7, 28, 28, undefined, "FAST");
  } catch {
    drawLogoFallback(pdf);
  }

  pdf.setTextColor(...clinicNavy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(24);
  pdf.text("ASHER", 47, 19);
  pdf.setFontSize(10.5);
  pdf.text("WOMEN AND CHILD HEALTHCARE", 47, 28);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text("R.K. Hegde Nagar, Bengaluru - 560077  |  +91 90192 63709", 47, 34);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(documentTitle.toUpperCase(), pageWidth - 14, 18, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text("asherhealthcare.in", pageWidth - 14, 26, { align: "right" });
  pdf.text("info@asherhealthcare.in", pageWidth - 14, 32, { align: "right" });

  pdf.setFillColor(...clinicGold);
  pdf.rect(0, 40, pageWidth, 1.5, "F");
  pdf.setFillColor(...clinicNavy);
  pdf.rect(0, 41.5, pageWidth, 0.7, "F");
}

export function drawClinicFooter(pdf: jsPDF, pageNumber?: number, pageCount?: number) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  pdf.setFillColor(...clinicGold);
  pdf.rect(0, pageHeight - 19, pageWidth, 1.5, "F");
  pdf.setFillColor(...clinicNavy);
  pdf.rect(0, pageHeight - 17.5, pageWidth, 17.5, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.text(
    "No. 546, Ground Floor, R.K. Hegde Nagar Main Road, SRK Post, Bengaluru - 560077",
    pageWidth / 2,
    pageHeight - 10.5,
    { align: "center" },
  );
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.2);
  pdf.text(
    "Ph: 90192 63709  |  info@asherhealthcare.in  |  www.asherhealthcare.in",
    pageWidth / 2,
    pageHeight - 5.2,
    { align: "center" },
  );

  if (pageNumber && pageCount && pageCount > 1) {
    pdf.setFontSize(6.5);
    pdf.text(pageNumber + " / " + pageCount, pageWidth - 5, pageHeight - 5.2, { align: "right" });
  }
}
