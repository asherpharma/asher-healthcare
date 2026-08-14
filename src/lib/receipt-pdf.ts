import { jsPDF } from "jspdf";
import { clinicGold, clinicNavy, drawClinicFooter, drawClinicHeader } from "@/lib/clinic-pdf";

export type ReceiptLineItem = { description: string; quantity: number; unitPrice: number; amount: number };
export type ReceiptInvoice = {
  invoiceNumber: string;
  patientName: string;
  patientPhone: string;
  items: ReceiptLineItem[];
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: string;
  paymentMethod: string;
  paymentReference: string;
  notes: string;
  createdAt?: { toDate: () => Date };
};

function money(value: number) {
  return "INR " + value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function labelMethod(value: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not recorded";
}

async function createReceiptPdf(invoice: ReceiptInvoice) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 16;

  await drawClinicHeader(pdf, "Payment receipt");

  pdf.setTextColor(...clinicNavy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("RECEIPT NUMBER", margin, 54);
  pdf.text("DATE ISSUED", pageWidth - margin, 54, { align: "right" });

  const date = invoice.createdAt?.toDate?.() ?? new Date();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(invoice.invoiceNumber, margin, 61);
  pdf.text(
    date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    pageWidth - margin,
    61,
    { align: "right" },
  );

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, 68, pageWidth - margin * 2, 20, 2.5, 2.5, "F");
  pdf.setTextColor(100, 116, 139);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.text("PATIENT", margin + 4, 75);
  pdf.text("MOBILE", pageWidth - margin - 4, 75, { align: "right" });
  pdf.setTextColor(...clinicNavy);
  pdf.setFontSize(10);
  pdf.text(invoice.patientName, margin + 4, 82, { maxWidth: 110 });
  pdf.text(invoice.patientPhone, pageWidth - margin - 4, 82, { align: "right" });

  let y = 101;
  pdf.setFillColor(241, 245, 249);
  pdf.rect(margin, y - 6, pageWidth - margin * 2, 9, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...clinicNavy);
  pdf.text("Description", margin + 2, y);
  pdf.text("Qty", 125, y, { align: "right" });
  pdf.text("Rate", 158, y, { align: "right" });
  pdf.text("Amount", pageWidth - margin - 2, y, { align: "right" });
  y += 9;

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(60, 70, 85);
  for (const item of invoice.items) {
    const description = pdf.splitTextToSize(item.description || "Clinic service", 85);
    const rowHeight = Math.max(8, description.length * 5.5);
    if (y + rowHeight > 260) {
      pdf.addPage();
      await drawClinicHeader(pdf, "Payment receipt");
      y = 58;
    }
    pdf.text(description, margin + 2, y);
    pdf.text(String(item.quantity), 125, y, { align: "right" });
    pdf.text(money(item.unitPrice), 158, y, { align: "right" });
    pdf.text(money(item.amount), pageWidth - margin - 2, y, { align: "right" });
    y += rowHeight;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y - 3, pageWidth - margin, y - 3);
  }

  y += 5;
  const totalsX = 132;
  const valueX = pageWidth - margin - 2;
  pdf.setFont("helvetica", "normal");
  pdf.text("Subtotal", totalsX, y);
  pdf.text(money(invoice.subtotal), valueX, y, { align: "right" });
  y += 7;
  pdf.text("Discount", totalsX, y);
  pdf.text(money(invoice.discount), valueX, y, { align: "right" });
  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...clinicNavy);
  pdf.text("Total", totalsX, y);
  pdf.text(money(invoice.total), valueX, y, { align: "right" });
  y += 8;
  pdf.setTextColor(22, 101, 52);
  pdf.text("Amount received", totalsX, y);
  pdf.text(money(invoice.amountPaid), valueX, y, { align: "right" });
  y += 8;
  pdf.setTextColor(invoice.balance > 0 ? 185 : 35, invoice.balance > 0 ? 28 : 58, invoice.balance > 0 ? 28 : 89);
  pdf.text("Balance due", totalsX, y);
  pdf.text(money(invoice.balance), valueX, y, { align: "right" });

  y += 14;
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, y - 6, pageWidth - margin * 2, 24, 3, 3, "F");
  pdf.setTextColor(60, 70, 85);
  pdf.setFont("helvetica", "normal");
  pdf.text("Payment status: " + labelMethod(invoice.paymentStatus), margin + 4, y);
  pdf.text("Method: " + labelMethod(invoice.paymentMethod), margin + 4, y + 7);
  if (invoice.paymentReference) pdf.text("Reference: " + invoice.paymentReference, margin + 4, y + 14);

  y += 28;
  if (invoice.notes) {
    pdf.setTextColor(80, 90, 105);
    pdf.text(pdf.splitTextToSize("Notes: " + invoice.notes, pageWidth - margin * 2), margin, y);
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    drawClinicFooter(pdf, page, pageCount);
    if (page === pageCount) {
      pdf.setFontSize(7.5);
      pdf.setTextColor(...clinicGold);
      pdf.text(
        "Computer-generated receipt - thank you for choosing Asher Healthcare.",
        pageWidth / 2,
        273,
        { align: "center" },
      );
    }
  }

  return pdf;
}

function openPrintPage() {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Allow pop-ups for this site to open the receipt print preview.");
  }
  printWindow.document.title = "Print payment receipt";
  printWindow.document.body.textContent = "Preparing receipt print preview...";
  return printWindow;
}

export async function downloadReceiptPdf(
  invoice: ReceiptInvoice,
  requestedFileName?: string,
  canPresent: () => boolean = () => true,
) {
  const pdf = await createReceiptPdf(invoice);
  if (!canPresent()) return;
  pdf.save(requestedFileName || invoice.invoiceNumber + "-receipt.pdf");
}

export async function printReceiptPdf(
  invoice: ReceiptInvoice,
  existingPrintWindow?: Window,
  canPresent: () => boolean = () => true,
) {
  const printWindow = existingPrintWindow || openPrintPage();
  try {
    const pdf = await createReceiptPdf(invoice);
    if (!canPresent()) { printWindow.close(); return; }
    const pdfUrl = String(pdf.output("bloburl"));
    printWindow.location.replace(pdfUrl);
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 5 * 60_000);
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
