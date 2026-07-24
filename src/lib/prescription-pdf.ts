import { jsPDF } from "jspdf";

export type PrescriptionPdfPatient = {
  fullName: string;
  patientNumber?: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  allergies?: string;
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

function safeName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function doctorCredentials(name: string) {
  if (name.includes("Reshma")) {
    return ["MBBS, MS (OBG)", "Consultant Obstetrician & Gynaecologist", "Laparoscopic Surgeon & Infertility Specialist"];
  }
  return ["MBBS, MD (Pediatrics)", "Consultant Pediatrician", "Pediatric Allergy & Asthma Specialist"];
}

async function imageDataUrl(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Unable to load clinic logo");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function drawMedicineHeader(pdf: jsPDF, y: number) {
  pdf.setFillColor(238, 242, 247);
  pdf.roundedRect(14, y, 182, 9, 1.5, 1.5, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(35, 58, 89);
  pdf.text("MEDICINE", 17, y + 6);
  pdf.text("DOSE", 86, y + 6);
  pdf.text("FREQUENCY", 112, y + 6);
  pdf.text("DURATION", 153, y + 6);
  return y + 12;
}

function addPageHeader(pdf: jsPDF, patient: PrescriptionPdfPatient) {
  pdf.setFillColor(35, 58, 89);
  pdf.rect(0, 0, 210, 18, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("ASHER WOMEN & CHILD HEALTHCARE", 14, 11.5);
  pdf.setTextColor(35, 58, 89);
  pdf.setFontSize(9);
  pdf.text("Patient: " + patient.fullName + "   |   ID: " + (patient.patientNumber ?? "Not assigned"), 14, 27);
  return drawMedicineHeader(pdf, 33);
}

export async function downloadPrescriptionPdf(
  patient: PrescriptionPdfPatient,
  prescription: PrescriptionPdfRecord,
) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const navy: [number, number, number] = [35, 58, 89];
  const gold: [number, number, number] = [168, 134, 74];

  pdf.setFillColor(...navy);
  pdf.rect(0, 0, 210, 45, "F");
  try {
    const logo = await imageDataUrl("/images/logo.png");
    pdf.addImage(logo, "PNG", 14, 10, 24, 24, undefined, "FAST");
  } catch {
    pdf.setDrawColor(...gold);
    pdf.setLineWidth(1.2);
    pdf.circle(26, 22, 10);
  }

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("ASHER WOMEN & CHILD HEALTHCARE", 44, 18);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text("Women, children and family-centred specialist care", 44, 25);
  pdf.text("R.K. Hegde Nagar, Bengaluru - 560077  |  +91 90192 63709", 44, 31);

  const credentials = doctorCredentials(prescription.doctorName);
  pdf.setTextColor(...navy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(prescription.doctorName, 14, 56);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text(credentials[0], 14, 62);
  pdf.text(credentials[1], 14, 67);
  pdf.text(credentials[2], 14, 72);

  pdf.setDrawColor(220, 226, 232);
  pdf.line(14, 78, 196, 78);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text("PATIENT", 14, 86);
  pdf.text("PATIENT ID", 82, 86);
  pdf.text("DATE", 135, 86);
  pdf.text("DOB / GENDER", 165, 86);
  pdf.setTextColor(...navy);
  pdf.setFontSize(9.5);
  pdf.text(patient.fullName, 14, 92, { maxWidth: 62 });
  pdf.text(patient.patientNumber ?? "Not assigned", 82, 92);
  pdf.text(prescription.prescribedDate, 135, 92);
  pdf.text(patient.dateOfBirth + " / " + patient.gender, 165, 92, { maxWidth: 31 });

  if (patient.allergies) {
    pdf.setFillColor(255, 247, 237);
    pdf.roundedRect(14, 99, 182, 11, 2, 2, "F");
    pdf.setTextColor(154, 52, 18);
    pdf.setFontSize(8.5);
    pdf.text("ALLERGY ALERT: " + patient.allergies, 18, 106, { maxWidth: 174 });
  }

  pdf.setTextColor(...navy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text("Rx", 14, 122);
  let y = drawMedicineHeader(pdf, 127);

  prescription.medicines.forEach((medicine, index) => {
    const nameLines = pdf.splitTextToSize(String(index + 1) + ". " + medicine.name, 62) as string[];
    const doseLines = pdf.splitTextToSize(medicine.dose || "-", 22) as string[];
    const frequencyLines = pdf.splitTextToSize(medicine.frequency || "-", 35) as string[];
    const durationLines = pdf.splitTextToSize(medicine.duration || "-", 38) as string[];
    const lineCount = Math.max(nameLines.length, doseLines.length, frequencyLines.length, durationLines.length);
    const instructionsLines = medicine.instructions
      ? (pdf.splitTextToSize("Instructions: " + medicine.instructions, 170) as string[])
      : [];
    const rowHeight = Math.max(12, lineCount * 4.5 + instructionsLines.length * 4 + 5);

    if (y + rowHeight > 262) {
      pdf.addPage();
      y = addPageHeader(pdf, patient);
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
  });

  if (prescription.advice) {
    if (y > 235) {
      pdf.addPage();
      y = addPageHeader(pdf, patient);
    }
    pdf.setFillColor(248, 250, 252);
    const adviceLines = pdf.splitTextToSize(prescription.advice, 170) as string[];
    const adviceHeight = Math.max(18, adviceLines.length * 4.5 + 12);
    pdf.roundedRect(14, y + 3, 182, adviceHeight, 2, 2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...gold);
    pdf.text("ADVICE", 18, y + 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(51, 65, 85);
    pdf.text(adviceLines, 18, y + 16);
    y += adviceHeight + 7;
  }

  if (y > 248) {
    pdf.addPage();
    y = addPageHeader(pdf, patient);
  }
  pdf.setDrawColor(...navy);
  pdf.line(145, y + 18, 195, y + 18);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...navy);
  pdf.text(prescription.doctorName, 170, y + 24, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text("Doctor's signature", 170, y + 29, { align: "center" });

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(226, 232, 240);
    pdf.line(14, 285, 196, 285);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text("Asher Women & Child Healthcare | asherhealthcare.in", 14, 290);
    pdf.text("Page " + page + " of " + pageCount, 196, 290, { align: "right" });
  }

  const fileName = "prescription-" + safeName(patient.fullName) + "-" + (prescription.prescribedDate || "record") + ".pdf";
  pdf.save(fileName);
}
