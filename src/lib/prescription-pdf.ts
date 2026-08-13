import { jsPDF } from "jspdf";
import {
  clinicGold,
  clinicNavy,
  doctorCredentials,
  drawClinicFooter,
  drawClinicHeader,
  patientAge,
  safePdfName,
} from "@/lib/clinic-pdf";

export type PrescriptionPdfPatient = {
  fullName: string;
  patientNumber?: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
};

export type PrescriptionPdfRecord = {
  id: string;
  prescribedDate: string;
  doctorName: string;
  medicines: Array<{
    name: string;
    dose: string;
    frequency: string;
    duration: string;
    instructions: string;
  }>;
  advice: string;
};

function prescriptionDate(value?: string) {
  const parsed = value ? new Date(value + "T00:00:00") : new Date();
  return Number.isNaN(parsed.getTime())
    ? new Date().toLocaleDateString("en-IN")
    : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function drawDoctorDetails(pdf: jsPDF, doctorName: string, date: string) {
  const credentials = doctorCredentials(doctorName);
  const pageWidth = pdf.internal.pageSize.getWidth();

  pdf.setTextColor(...clinicNavy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12.5);
  pdf.text(doctorName, 14, 52);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(credentials[0], 14, 58);
  pdf.text(credentials[1], 14, 63);
  pdf.text(credentials[2], 14, 68);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text("DATE", pageWidth - 14, 54, { align: "right" });
  pdf.setTextColor(...clinicNavy);
  pdf.setFontSize(9.5);
  pdf.text(date, pageWidth - 14, 61, { align: "right" });
}

function drawPatientDetails(pdf: jsPDF, patient: PrescriptionPdfPatient) {
  const details = [
    { label: "PATIENT", value: patient.fullName, x: 18, width: 58 },
    { label: "MOBILE", value: patient.phone || "Not recorded", x: 80, width: 38 },
    { label: "AGE", value: patientAge(patient.dateOfBirth), x: 122, width: 28 },
    { label: "GENDER", value: patient.gender || "Not recorded", x: 154, width: 38 },
  ];

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(14, 75, 182, 21, 2.5, 2.5, "F");
  details.forEach(({ label, value, x, width }) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(label, x, 82);
    pdf.setFontSize(9);
    pdf.setTextColor(...clinicNavy);
    pdf.text(String(value), x, 89, { maxWidth: width });
  });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Patient ID: " + (patient.patientNumber ?? "Not assigned"), 18, 94);
}

function drawMedicineHeader(pdf: jsPDF, y: number) {
  pdf.setFillColor(238, 242, 247);
  pdf.roundedRect(14, y, 182, 9, 1.5, 1.5, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...clinicNavy);
  pdf.text("MEDICINE", 17, y + 6);
  pdf.text("DOSE", 86, y + 6);
  pdf.text("FREQUENCY", 112, y + 6);
  pdf.text("DURATION", 153, y + 6);
  return y + 12;
}

async function drawContinuationHeader(pdf: jsPDF, patient: PrescriptionPdfPatient, doctorName: string) {
  await drawClinicHeader(pdf, "Prescription");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...clinicNavy);
  pdf.text("Patient: " + patient.fullName, 14, 51);
  pdf.text("Doctor: " + doctorName, 196, 51, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Patient ID: " + (patient.patientNumber ?? "Not assigned"), 14, 57);
  return drawMedicineHeader(pdf, 64);
}

function drawBlankWritingArea(pdf: jsPDF, startY: number, doctorName: string) {
  pdf.setTextColor(...clinicNavy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("Rx", 14, startY);

  pdf.setDrawColor(232, 237, 242);
  pdf.setLineWidth(0.25);
  for (let y = startY + 14; y <= 244; y += 12) {
    pdf.line(18, y, 192, y);
  }

  pdf.setDrawColor(...clinicNavy);
  pdf.setLineWidth(0.4);
  pdf.line(145, 264, 195, 264);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...clinicNavy);
  pdf.text(doctorName, 170, 269, { align: "center", maxWidth: 50 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text("Doctor's signature", 170, 273, { align: "center" });
}

async function createBlankPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  doctorName: string,
) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await drawClinicHeader(pdf, "Prescription");
  drawDoctorDetails(pdf, doctorName, prescriptionDate());
  drawPatientDetails(pdf, patient);
  drawBlankWritingArea(pdf, 111, doctorName);
  drawClinicFooter(pdf);
  return pdf;
}

export async function downloadBlankPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  doctorName: string,
) {
  const pdf = await createBlankPrescriptionPdf(patient, doctorName);
  const fileName =
    "blank-prescription-" +
    safePdfName(patient.fullName) +
    "-" +
    new Date().toISOString().slice(0, 10) +
    ".pdf";
  pdf.save(fileName);
}

async function createPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  prescription: PrescriptionPdfRecord,
) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await drawClinicHeader(pdf, "Prescription");
  drawDoctorDetails(pdf, prescription.doctorName, prescriptionDate(prescription.prescribedDate));
  drawPatientDetails(pdf, patient);

  pdf.setTextColor(...clinicNavy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text("Rx", 14, 110);
  let y = drawMedicineHeader(pdf, 115);

  const safeMedicines = Array.isArray(prescription.medicines)
    ? prescription.medicines.filter((medicine) => medicine && typeof medicine === "object")
    : [];
  for (const [index, medicine] of safeMedicines.entries()) {
    const nameLines = pdf.splitTextToSize(String(index + 1) + ". " + medicine.name, 62) as string[];
    const doseLines = pdf.splitTextToSize(medicine.dose || "-", 22) as string[];
    const frequencyLines = pdf.splitTextToSize(medicine.frequency || "-", 35) as string[];
    const durationLines = pdf.splitTextToSize(medicine.duration || "-", 38) as string[];
    const lineCount = Math.max(nameLines.length, doseLines.length, frequencyLines.length, durationLines.length);
    const instructionsLines = medicine.instructions
      ? (pdf.splitTextToSize("Instructions: " + medicine.instructions, 170) as string[])
      : [];
    const rowHeight = Math.max(12, lineCount * 4.5 + instructionsLines.length * 4 + 5);

    if (y + rowHeight > 250) {
      pdf.addPage();
      y = await drawContinuationHeader(pdf, patient, prescription.doctorName);
    }

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(30, 41, 59);
    pdf.text(nameLines, 17, y + 3);
    pdf.text(doseLines, 86, y + 3);
    pdf.text(frequencyLines, 112, y + 3);
    pdf.text(durationLines, 153, y + 3);
    if (instructionsLines.length) {
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.text(instructionsLines, 17, y + lineCount * 4.5 + 3);
    }
    pdf.setDrawColor(226, 232, 240);
    pdf.line(14, y + rowHeight - 2, 196, y + rowHeight - 2);
    y += rowHeight;
  }

  if (prescription.advice) {
    const adviceLines = pdf.splitTextToSize(prescription.advice, 170) as string[];
    const adviceHeight = Math.max(18, adviceLines.length * 4.5 + 12);
    if (y + adviceHeight > 250) {
      pdf.addPage();
      y = await drawContinuationHeader(pdf, patient, prescription.doctorName);
    }
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(14, y + 3, 182, adviceHeight, 2, 2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...clinicGold);
    pdf.text("ADVICE", 18, y + 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(51, 65, 85);
    pdf.text(adviceLines, 18, y + 16);
    y += adviceHeight + 7;
  }

  if (y > 240) {
    pdf.addPage();
    y = await drawContinuationHeader(pdf, patient, prescription.doctorName);
  }
  pdf.setDrawColor(...clinicNavy);
  pdf.line(145, y + 18, 195, y + 18);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...clinicNavy);
  pdf.text(prescription.doctorName, 170, y + 24, { align: "center", maxWidth: 50 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text("Doctor's signature", 170, y + 29, { align: "center" });

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    drawClinicFooter(pdf, page, pageCount);
  }
  return pdf;
}

export async function downloadPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  prescription: PrescriptionPdfRecord,
) {
  const pdf = await createPrescriptionPdf(patient, prescription);
  const fileName =
    "prescription-" +
    safePdfName(patient.fullName) +
    "-" +
    (prescription.prescribedDate || "record") +
    ".pdf";
  pdf.save(fileName);
}

function openPrintPage(title: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Print preview was blocked. Please allow pop-ups for this clinic site.");
  }

  printWindow.opener = null;
  printWindow.document.title = title;
  printWindow.document.body.style.cssText =
    "margin:0;display:grid;min-height:100vh;place-items:center;background:#f8fafc;color:#233a59;font:600 16px system-ui,sans-serif";
  printWindow.document.body.textContent = "Preparing print preview...";
  return printWindow;
}

function showPdfInPrintPage(pdf: jsPDF, printWindow: Window) {
  const pdfUrl = String(pdf.output("bloburl"));
  printWindow.location.replace(pdfUrl);
  window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 5 * 60_000);
}

export async function printBlankPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  doctorName: string,
) {
  const printWindow = openPrintPage("Print prescription");
  try {
    const pdf = await createBlankPrescriptionPdf(patient, doctorName);
    showPdfInPrintPage(pdf, printWindow);
  } catch (error) {
    printWindow.close();
    throw error;
  }
}

export async function printPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  prescription: PrescriptionPdfRecord,
) {
  const printWindow = openPrintPage("Print prescription");
  try {
    const pdf = await createPrescriptionPdf(patient, prescription);
    showPdfInPrintPage(pdf, printWindow);
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
